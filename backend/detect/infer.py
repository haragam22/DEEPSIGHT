"""Inference over a survey (implementation_garv.md section 8 Step 8).

Loads the trained YOLO weights, tiles a survey's display-chain waterfall along-track,
runs detection per tile, maps boxes back to absolute (across-track px, ping index),
de-duplicates across tile overlap, applies the suppression rules, and returns
Detection dicts in the apiendpoints.md section 3 shape.

Geometry (layback, geodesic projection, error budget) is Step 5 and still stubbed, so
lat/lon/error_radius_m/ground_range_m come back null. bbox_px, class, confidence and the
metre dimensions from bbox size are real.
"""

from __future__ import annotations

import secrets
from functools import lru_cache

import numpy as np

from backend.imaging import analysis, display  # noqa: F401 (display kept for callers)
from backend.schemas import CLASS_DISPLAY

WEIGHTS = "backend/detect/weights/best.pt"
TILE_H = 640
TILE_OVERLAP = 128
CONF = 0.25
DEDUP_IOU = 0.5


@lru_cache(maxsize=2)
def load_model(weights: str = WEIGHTS):
    from ultralytics import YOLO

    return YOLO(weights)


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix, iy = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, ix2 - ix) * max(0, iy2 - iy)
    u = aw * ah + bw * bh - inter
    return inter / u if u else 0.0


def _dedup(dets: list[dict]) -> list[dict]:
    dets = sorted(dets, key=lambda d: -d["confidence"])
    kept: list[dict] = []
    for d in dets:
        box = (d["bbox_px"]["x"], d["bbox_px"]["y"], d["bbox_px"]["w"], d["bbox_px"]["h"])
        if any(d["bbox_px"] and k["class"] == d["class"]
               and _iou(box, (k["bbox_px"]["x"], k["bbox_px"]["y"],
                              k["bbox_px"]["w"], k["bbox_px"]["h"])) > DEDUP_IOU
               for k in kept):
            continue
        kept.append(d)
    return kept


def detect_survey(survey, conf: float = CONF) -> list[dict]:
    pings = survey.pings or []
    if not pings:
        return []
    model = load_model()
    # detector runs on the ANALYSIS chain (log + nadir mask + wavelet despeckle), never the
    # display chain (idea.md section 6). prerendered surveys are already-processed imagery
    # (A4 & SSS tiles / uploaded PNGs) - leave those untouched.
    wf = survey.prerendered if survey.prerendered is not None else analysis.to_u8_analysis(pings)
    wf = np.ascontiguousarray(wf)             # (n_pings, width) uint8
    n, width = wf.shape
    m_per_px_across = (survey.meta.range_m * 2 / width) if survey.meta else 0.0

    raw: list[dict] = []
    step = TILE_H - TILE_OVERLAP
    for y0 in range(0, max(1, n - TILE_OVERLAP), step):
        y1 = min(y0 + TILE_H, n)
        tile = np.repeat(wf[y0:y1, :, None], 3, axis=2)   # YOLO wants 3-channel
        res = model.predict(tile, conf=conf, imgsz=640, verbose=False)[0]
        for b in res.boxes:
            x1, ty1, x2, ty2 = b.xyxy[0].tolist()
            cls = int(b.cls[0])
            name = model.names[cls]
            abs_y = int(y0 + (ty1 + ty2) / 2)
            bx, bw = int(x1), int(x2 - x1)
            bh = int(ty2 - ty1)
            ping = pings[min(abs_y, n - 1)]
            raw.append({
                "detection_id": "det_" + secrets.token_hex(3),
                "survey_id": survey.survey_id,
                "ping": abs_y,
                "timestamp": ping.time.isoformat().replace("+00:00", "Z"),
                "lat": None, "lon": None, "error_radius_m": None,
                "class": name, "class_display": CLASS_DISPLAY.get(name, name),
                "confidence": round(float(b.conf[0]), 4),
                "bbox_m_width": round(bw * m_per_px_across, 2) if m_per_px_across else None,
                "bbox_m_height": None,          # along-track metres need ping spacing (Step 5)
                "object_height_m": None,        # from shadow + geometry (Step 5)
                "channel": "port" if (bx + bw / 2) < width / 2 else "starboard",
                "ground_range_m": None,
                "bbox_px": {"x": bx, "y": abs_y - bh // 2, "w": bw, "h": bh},
                "altitude_source": survey.meta.altitude_source if survey.meta else "xtf_header",
                "flags": [],
                "_error_budget": None,
                "_geometry": None,
            })

    from backend.detect.suppress import apply_rules, rule3_height_footprint

    dets = apply_rules(_dedup(raw), wf, width)
    if survey.meta is None:
        return dets

    from backend.geometry.locate import locate_detection
    from backend.geometry.relief import relief
    from backend.geometry.shadow import object_height_m

    m_per_px_across = (survey.meta.range_m * 2 / width) if width else 0.0
    located = []
    for d in dets:
        geo = locate_detection(all_pings=pings, ping_index=min(d["ping"], n - 1),
                               bbox_px=d["bbox_px"], channel=d["channel"],
                               width=width, meta=survey.meta)
        g = geo["_geometry"]
        # a hit inside the nadir gap has no seabed return - dropping it is correct
        # (implementation_garv.md section 3.2), not a missed detection
        if g["ground_range_m"] <= 0.0:
            continue
        d.update(geo)
        d["object_height_m"] = object_height_m(
            wf, d["bbox_px"], d["channel"],
            altitude_m=g["altitude_m"], ground_range_m=g["ground_range_m"],
            slant_range_m=g["slant_range_m"], m_per_px_across=m_per_px_across,
        )
        bh = d["bbox_px"]["h"]
        d["_relief"] = relief(
            wf, d["bbox_px"], d["channel"],
            altitude_m=g["altitude_m"], ground_range_m=g["ground_range_m"],
            m_per_px_across=m_per_px_across,
            m_per_ping=(d["bbox_m_height"] / bh) if d["bbox_m_height"] and bh else None,
        )
        located.append(d)

    return rule3_height_footprint(located)


if __name__ == "__main__":
    # standalone check: run the model directly on a few training tiles
    import glob

    import cv2

    model = load_model()
    files = sorted(glob.glob("data/detect/yolo/images/val/sss_*.jpg"))[:200]
    hits = 0
    for f in files:
        r = model.predict(cv2.imread(f), conf=0.25, imgsz=640, verbose=False)[0]
        hits += len(r.boxes)
    print(f"{len(files)} val tiles -> {hits} raw detections "
          f"({hits / len(files):.2f}/tile) with {WEIGHTS}")
