"""In-memory survey registry + parse orchestration.

ponytail: registry is a dict, uploads live under data/uploads/<id>/. Finished surveys are
pickled to data/surveys/ and restored at startup. Swap for SQLite + a job queue when a
second process needs to see the same surveys.
"""

from __future__ import annotations

import pickle
import secrets
import threading
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from backend.ingest.models import SurveyMeta
from backend.ingest.xtf import read_survey

UPLOAD_DIR = Path("data/uploads")
SAVE_DIR = Path("data/surveys")
MAX_BYTES = 800 * 1024 * 1024        # apiendpoints.md section 9 FILE_TOO_LARGE
# (raised from 500 MB: the GA0346 HF lines are 400-570 MB each)
TRACK_MAX_POINTS = 5000              # apiendpoints.md section 4


@dataclass
class Survey:
    survey_id: str
    filename: str
    path: str
    size_bytes: int
    created_at: str
    status: str = "uploaded"
    meta: SurveyMeta | None = None
    pings: list | None = None
    progress: float = 0.0
    pings_processed: int = 0
    message: str | None = None
    detections: list = field(default_factory=list)   # filled at Step 8
    prerendered: object = None    # (n_pings, width) uint8 for tile/image surveys; bypasses display chain
    display_width: int | None = None   # square-ground-pixel across-track width for the display chain

    @property
    def ping_count(self) -> int:
        return self.meta.ping_count if self.meta else 0


SURVEYS: dict[str, Survey] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_survey(filename: str, data: bytes) -> Survey:
    sid = "svy_" + secrets.token_hex(3)
    dest = UPLOAD_DIR / sid
    dest.mkdir(parents=True, exist_ok=True)
    fpath = dest / filename
    fpath.write_bytes(data)
    s = Survey(survey_id=sid, filename=filename, path=str(fpath),
               size_bytes=len(data), created_at=_now())
    SURVEYS[sid] = s
    return s


_LAT0, _LON0 = 13.05, 80.30           # off Chennai - plausible for the PS area
_C, _SLANT_RANGE_M = 1500.0, 60.0


def _synthetic_pings(wf: np.ndarray, t0: datetime) -> list:
    """Straight-line eastward track at 0.2 s per row over a stacked tile waterfall."""
    from backend.ingest.models import PingRecord

    width = wf.shape[1]
    fs = (width // 2) * _C / (2 * _SLANT_RANGE_M)
    dlon = 0.15 / (111_320.0 * np.cos(np.deg2rad(_LAT0)))
    return [PingRecord(
        ping_number=i, time=t0 + timedelta(seconds=0.2 * i),
        lat=_LAT0, lon=_LON0 + dlon * i,
        heading_deg=90.0, pitch_deg=0.0, roll_deg=0.0, heave_m=0.0,
        altitude_m=12.0, sound_speed_ms=_C, sample_rate_hz=fs, slant_range_m=_SLANT_RANGE_M,
        port=wf[i, :width // 2], starboard=wf[i, width // 2:],
    ) for i in range(wf.shape[0])]


def create_a4sss_survey(n_tiles: int = 24, width: int = 1024) -> Survey:
    """Stack boxed SSS Mine test tiles into a pseudo-survey ("A4 & SSS") with a
    synthetic straight-line track, so the trained detector produces visible results.
    The Larsen XTF imagery is speckle-only and yields nothing (see project notes).
    """
    import glob

    import cv2

    tiles = []
    for f in sorted(glob.glob("data/detect/yolo/images/val/sss_*.jpg")):
        lf = f.replace("images", "labels").replace(".jpg", ".txt")
        try:
            if Path(lf).read_text().strip():
                tiles.append(f)
        except FileNotFoundError:
            pass
        if len(tiles) >= n_tiles:
            break
    if not tiles:
        raise RuntimeError("no boxed SSS tiles under data/detect/yolo/images/val")

    wf = np.vstack([cv2.resize(cv2.imread(f, cv2.IMREAD_GRAYSCALE), (width, width))
                    for f in tiles]).astype(np.uint8)
    s = _tile_survey(wf, filename="A4 & SSS", sid="svy_a4sss" + secrets.token_hex(2),
                     frequency_khz=900, sonar_name="A4 & SSS tiles",
                     recording_program="deepsight-a4sss", warnings=[])
    SURVEYS[s.survey_id] = s
    return s


def _tile_survey(wf: np.ndarray, *, filename: str, sid: str, frequency_khz: int,
                 sonar_name: str, recording_program: str, warnings: list[str]) -> Survey:
    n = wf.shape[0]
    t0 = datetime.now(timezone.utc).replace(microsecond=0)
    pings = _synthetic_pings(wf, t0)
    meta = SurveyMeta(
        filename=filename, path="", ping_count=n,
        samples_per_channel=wf.shape[1] // 2, range_m=_SLANT_RANGE_M,
        frequency_khz=frequency_khz,
        duration_s=0.2 * n, altitude_source="xtf_header", altitude_mean_m=12.0,
        sound_speed_ms=_C,
        bounds={"north": _LAT0, "south": _LAT0, "east": pings[-1].lon, "west": _LON0},
        start_time=t0, sonar_name=sonar_name, recording_program=recording_program,
        warnings=warnings,
    )
    return Survey(survey_id=sid, filename=meta.filename,
               path="", size_bytes=int(wf.nbytes), created_at=_now(), status="ready",
                  meta=meta, pings=pings, prerendered=wf, progress=1.0, pings_processed=n)


def create_image_survey(images: list[tuple[str, bytes]], width: int = 1024) -> Survey:
    """Register a pseudo-survey from uploaded sonar image tiles + synthetic straight-line
    nav. Lets any side-scan image be run through detection + playback. Not an XTF -
    geometry is not real, so it carries a warning and no true coordinates.
    """
    import cv2

    mats = []
    for name, data in images:
        arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
        if arr is None:
            raise ValueError(f"could not decode image: {name}")
        mats.append(cv2.resize(arr, (width, width)))
    if not mats:
        raise ValueError("no images")
    wf = np.vstack(mats).astype(np.uint8)
    s = _tile_survey(wf, filename=f"IMAGES-{len(mats)}-tiles",
                     sid="svy_img" + secrets.token_hex(3), frequency_khz=0,
                     sonar_name="uploaded images", recording_program="deepsight-image",
                     warnings=["Image upload: synthetic navigation, coordinates are not real."])
    SURVEYS[s.survey_id] = s
    return s


def save(s: Survey) -> None:
    """Write a finished survey to disk so a restart does not lose it. Pings are not
    stored: tile surveys rebuild them from the waterfall, XTF surveys re-parse the upload."""
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SAVE_DIR / f"{s.survey_id}.tmp"
    with tmp.open("wb") as f:
        pickle.dump(replace(s, pings=None), f, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(SAVE_DIR / f"{s.survey_id}.pkl")


def forget(sid: str) -> None:
    (SAVE_DIR / f"{sid}.pkl").unlink(missing_ok=True)


def load_saved() -> None:
    """Restore saved surveys at startup. XTF re-parses run in one background thread
    (status shows 'parsing' until the pings are back; detections are kept)."""
    reparse = []
    for p in sorted(SAVE_DIR.glob("*.pkl")):
        try:
            with p.open("rb") as f:
                s: Survey = pickle.load(f)
        except Exception as exc:                   # noqa: BLE001 - one bad file must not stop startup
            print(f"[state] skipped {p.name}: {type(exc).__name__}: {exc}")
            continue
        if s.prerendered is not None:
            s.pings = _synthetic_pings(s.prerendered, s.meta.start_time)
        elif Path(s.path).is_file():
            s.status, s.message = "parsing", "Restoring after restart"
            reparse.append(s)
        else:
            continue                               # upload file gone - nothing to restore from
        SURVEYS[s.survey_id] = s

    def _restore():
        for s in reparse:
            try:
                s.meta, s.pings = read_survey(s.path)
                s.status, s.message = "complete", f"{len(s.detections)} detections"
            except Exception as exc:               # noqa: BLE001 - surfaced via status
                s.status, s.message = "failed", f"{type(exc).__name__}: {exc}"

    if reparse:
        threading.Thread(target=_restore, daemon=True).start()


def parse_survey(sid: str) -> None:
    """Blocking parse  run via BackgroundTasks / asyncio.to_thread."""
    s = SURVEYS.get(sid)
    if s is None:
        return
    s.status = "parsing"
    s.message = "Reading ping headers"
    try:
        meta, pings = read_survey(s.path)
        s.meta, s.pings = meta, pings
        s.pings_processed = meta.ping_count
        from backend.imaging.display import square_display_width
        s.display_width = square_display_width(pings, meta.range_m)
        s.progress = 1.0
        s.status = "ready"
        s.message = None
    except Exception as exc:                       # noqa: BLE001 - surfaced to the client
        s.status = "failed"
        s.message = f"{type(exc).__name__}: {exc}"


def survey_detail(s: Survey) -> dict:
    m = s.meta
    return {
        "survey_id": s.survey_id,
        "filename": s.filename,
        "status": s.status,
        "ping_count": s.ping_count,
        "samples_per_channel": m.samples_per_channel if m else 0,
        "range_m": m.range_m if m else 0.0,
        "frequency_khz": m.frequency_khz if m else 0,
        "duration_s": m.duration_s if m else 0.0,
        "altitude_source": m.altitude_source if m else "xtf_header",
        "altitude_mean_m": m.altitude_mean_m if m else 0.0,
        "sound_speed_ms": m.sound_speed_ms if m else 0.0,
        "bounds": (m.bounds if m else
                   {"north": None, "south": None, "east": None, "west": None}),
        "start_time": (m.start_time.isoformat().replace("+00:00", "Z")
                       if m else s.created_at),
        "warnings": m.warnings if m else [],
    }


def track_geojson(s: Survey) -> dict:
    pings = s.pings or []
    coords = [[p.lon, p.lat] for p in pings
              if np.isfinite(p.lon) and np.isfinite(p.lat)]
    decimated_from = len(pings)
    if len(coords) > TRACK_MAX_POINTS:
        step = int(np.ceil(len(coords) / TRACK_MAX_POINTS))
        coords = coords[::step]
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {"survey_id": s.survey_id, "point_count": len(coords),
                       "decimated_from": decimated_from},
    }


def _line_length_m(pings) -> float:
    pts = [(p.lat, p.lon) for p in pings if np.isfinite(p.lat) and np.isfinite(p.lon)]
    if len(pts) < 2:
        return 0.0
    lat = np.array([a for a, _ in pts])
    lon = np.array([b for _, b in pts])
    mlat = np.deg2rad(np.nanmean(lat))
    dn = np.diff(lat) * 111_320.0
    de = np.diff(lon) * 111_320.0 * np.cos(mlat)
    return float(np.sum(np.hypot(dn, de)))


def stats(s: Survey) -> dict:
    pings = s.pings or []
    line_m = _line_length_m(pings)
    swath = 2.0 * (s.meta.range_m if s.meta else 0.0)
    area = line_m * swath
    dets = s.detections
    by_class: dict[str, int] = {}
    for d in dets:
        by_class[d["class"]] = by_class.get(d["class"], 0) + 1
    radii = [d["error_radius_m"] for d in dets if d.get("error_radius_m")]
    mean_r = float(np.mean(radii)) if radii else 0.0
    review_frac = 0.0
    if area > 0 and radii:
        review_frac = min(1.0, sum(np.pi * r * r for r in radii) / area)
    headline = (f"{area:,.0f} m\u00b2 surveyed \u00b7 {len(dets)} targets \u00b7 "
                f"review {review_frac * 100:.0f}% of the area instead of 100%")
    return {
        "area_surveyed_m2": round(area, 1),
        "line_length_km": round(line_m / 1000.0, 2),
        "targets_flagged": len(dets),
        "targets_by_class": by_class,
        "review_area_fraction": round(review_frac, 4),
        "mean_error_radius_m": round(mean_r, 1),
        "headline": headline,
    }
