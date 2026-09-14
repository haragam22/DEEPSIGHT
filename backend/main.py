"""Deep-Sight backend  FastAPI app, routes only (thin).

Contract: docs/apiendpoints.md (frozen). Logic lives in backend.state / backend.report /
backend.imaging. Geometry-dependent fields (per-detection coordinates, error budget) are
Step 5 and are absent until then; detection endpoints return empty results until Step 8.
"""

from __future__ import annotations

import asyncio
import base64
import json
import math

import cv2
import numpy as np
from fastapi import BackgroundTasks, FastAPI, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from backend import state
from backend.imaging import display
from backend.report import engine
from backend.schemas import CLASS_DISPLAY, ApiError  # noqa: F401

app = FastAPI(title="Deep-Sight", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)
state.load_saved()


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=exc.body())


def _get(sid: str) -> state.Survey:
    s = state.SURVEYS.get(sid)
    if s is None:
        raise ApiError("SURVEY_NOT_FOUND", 404, "That survey no longer exists.", survey_id=sid)
    return s


def _need_ready(s: state.Survey) -> None:
    if s.status in ("uploaded", "parsing"):
        raise ApiError("NOT_READY", 409, "Still parsing  this takes about a minute.",
                       survey_id=s.survey_id)
    if s.status == "failed":
        raise ApiError("PARSE_FAILED", 422, s.message or "Parse failed.",
                       survey_id=s.survey_id)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# --- section 1 · survey lifecycle ---
@app.post("/api/surveys", status_code=201)
async def upload_survey(file: UploadFile, background: BackgroundTasks) -> dict:
    data = await file.read()
    if len(data) > state.MAX_BYTES:
        raise ApiError("FILE_TOO_LARGE", 413, "That file is over the 500 MB limit.")
    s = state.create_survey(file.filename or "survey.xtf", data)
    background.add_task(state.parse_survey, s.survey_id)
    # the merged frontend never calls POST /process; chain detection so playback has
    # targets. BackgroundTasks run in order, so this sees the parsed survey.
    background.add_task(_run_detection, s.survey_id)
    return {"survey_id": s.survey_id, "filename": s.filename, "size_bytes": s.size_bytes,
            "status": s.status, "created_at": s.created_at}


# path kept as-is: it is in the frozen contract and older clients call it
@app.post("/api/dev/demo-survey", status_code=201)
def a4sss_survey() -> dict:
    """Register the "A4 & SSS" pseudo-survey from SSS Mine test tiles + synthetic nav, so
    the frontend has something the trained detector actually fires on. Run /process after."""
    s = state.create_a4sss_survey()
    return {"survey_id": s.survey_id, "filename": s.filename, "status": s.status,
            "ping_count": s.ping_count}


@app.post("/api/surveys/image", status_code=201)
async def upload_images(files: list[UploadFile]) -> dict:
    """Register a pseudo-survey from uploaded side-scan images (PNG/JPG), stacked with
    synthetic nav. Run /process, then playback. Coordinates are not real (see warnings)."""
    imgs = [(f.filename or "img", await f.read()) for f in files]
    total = sum(len(b) for _, b in imgs)
    if total > state.MAX_BYTES:
        raise ApiError("FILE_TOO_LARGE", 413, "Images exceed the 500 MB limit.")
    try:
        s = state.create_image_survey(imgs)
    except ValueError as exc:
        raise ApiError("PARSE_FAILED", 422, str(exc))
    return {"survey_id": s.survey_id, "filename": s.filename, "status": s.status,
            "ping_count": s.ping_count}


@app.get("/api/surveys")
def list_surveys() -> dict:
    items = sorted(state.SURVEYS.values(), key=lambda s: s.created_at, reverse=True)
    return {"surveys": [
        {"survey_id": s.survey_id, "filename": s.filename, "status": s.status,
         "ping_count": s.ping_count, "detection_count": len(s.detections),
         "created_at": s.created_at}
        for s in items
    ]}


@app.get("/api/surveys/{sid}")
def get_survey(sid: str) -> dict:
    return state.survey_detail(_get(sid))


@app.delete("/api/surveys/{sid}", status_code=204)
def delete_survey(sid: str) -> Response:
    """Drop a survey and everything derived from it. In-memory store, so this frees the
    RAM immediately. 404 if it was already gone."""
    _get(sid)
    state.SURVEYS.pop(sid, None)
    state.forget(sid)
    return Response(status_code=204)


def _run_detection(sid: str) -> None:
    from backend.detect.infer import detect_survey

    s = state.SURVEYS.get(sid)
    if s is None:
        return
    if s.status == "failed" or not s.pings:   # parse failed / nothing to run on
        return
    try:
        s.status = "processing"
        s.message = "Running detection"
        s.detections = detect_survey(s)
        s.status = "complete"
        s.message = f"{len(s.detections)} detections"
    except Exception as exc:                       # noqa: BLE001 - surfaced via status
        s.status = "failed"
        s.message = f"{type(exc).__name__}: {exc}"
        return
    if sid in state.SURVEYS:                       # not deleted while detection ran
        try:
            state.save(s)
        except OSError as exc:                     # disk trouble must not fail a finished run
            print(f"[state] could not save {sid}: {exc}")


@app.post("/api/surveys/{sid}/process", status_code=202)
def process_survey(sid: str, background: BackgroundTasks) -> dict:
    s = _get(sid)
    _need_ready(s)
    s.status = "processing"
    s.message = "Running detection"
    background.add_task(_run_detection, sid)
    return {"survey_id": sid, "status": "processing", "job_id": "job_" + sid[4:]}


def _public(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


@app.get("/api/surveys/{sid}/status")
def survey_status(sid: str) -> dict:
    s = _get(sid)
    return {"survey_id": sid, "status": s.status, "progress": s.progress,
            "pings_processed": s.pings_processed, "detections_so_far": len(s.detections),
            "message": s.message}


# --- section 4 · track ---
@app.get("/api/surveys/{sid}/track")
def get_track(sid: str) -> dict:
    s = _get(sid)
    _need_ready(s)
    return state.track_geojson(s)


# --- section 5 · waterfall tiles ---
@app.get("/api/surveys/{sid}/waterfall")
def get_waterfall(sid: str, start_ping: int, count: int, corrected: bool = False) -> Response:
    s = _get(sid)
    _need_ready(s)
    if count > 2048:
        raise ApiError("NOT_READY", 409, "count must be <= 2048", survey_id=sid)
    pings = (s.pings or [])[start_ping:start_ping + count]
    if not pings:
        raise ApiError("NOT_READY", 409, "no pings in that range", survey_id=sid)
    if s.prerendered is not None:
        u8 = np.ascontiguousarray(s.prerendered[start_ping:start_ping + count])
    else:
        u8 = display.to_u8(pings, width=s.display_width)
    if corrected:
        u8 = _slant_correct(u8, pings, s.meta.sound_speed_ms)
    ok, buf = cv2.imencode(".png", u8)
    return Response(content=buf.tobytes(), media_type="image/png")


def _slant_correct(u8: np.ndarray, pings, sound_speed_ms: float) -> np.ndarray:
    from backend.geometry.slant import slant_to_ground_row

    half = u8.shape[1] // 2
    out = np.zeros_like(u8)
    for r, p in enumerate(pings):
        fs = p.sample_rate_hz
        out[r, :half] = slant_to_ground_row(u8[r, :half][::-1], p.altitude_m,
                                            sound_speed_ms, fs, half)[::-1]
        out[r, half:] = slant_to_ground_row(u8[r, half:], p.altitude_m,
                                            sound_speed_ms, fs, half)
    return out


# --- section 3 · detections ---
@app.get("/api/surveys/{sid}/detections")
def list_detections(sid: str, cls: str | None = None, min_confidence: float = 0.0,
                    sort: str = "ping") -> dict:
    s = _get(sid)
    dets = [d for d in s.detections
            if (cls is None or d["class"] == cls) and d["confidence"] >= min_confidence]
    key = {"confidence": lambda d: -d["confidence"],
           "error_radius": lambda d: (d["error_radius_m"] or 0.0)}.get(sort,
                                                                       lambda d: d["ping"])
    dets = sorted(dets, key=key)
    return {"survey_id": sid, "count": len(dets), "detections": [_public(d) for d in dets]}


@app.get("/api/detections/{did}")
def get_detection(did: str) -> dict:
    for s in state.SURVEYS.values():
        for d in s.detections:
            if d["detection_id"] == did:
                return {"detection": _public(d), "error_budget": d.get("_error_budget"),
                        "geometry": d.get("_geometry"), "relief": d.get("_relief")}
    raise ApiError("SURVEY_NOT_FOUND", 404, "No such detection.")


# --- section 6 · report ---
@app.get("/api/surveys/{sid}/report.json")
def report_json(sid: str) -> dict:
    s = _get(sid)
    _need_ready(s)
    return engine.report_json(s)


@app.get("/api/surveys/{sid}/report.csv")
def report_csv(sid: str) -> Response:
    s = _get(sid)
    _need_ready(s)
    return PlainTextResponse(
        engine.report_csv(s), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{sid}_report.csv"'},
    )


# --- section 7 · stats ---
@app.get("/api/surveys/{sid}/stats")
def get_stats(sid: str) -> dict:
    s = _get(sid)
    _need_ready(s)
    return state.stats(s)


# --- section 2 · live playback ---
@app.websocket("/ws/surveys/{sid}/playback")
async def playback(ws: WebSocket, sid: str):
    await ws.accept()
    s = state.SURVEYS.get(sid)
    if s is None or s.status in ("uploaded", "parsing", "failed"):
        await ws.send_json({"type": "error", "code": "NOT_READY",
                            "message": "survey not parsed"})
        await ws.close()
        return

    pings = s.pings or []
    total = len(pings)
    ping_rate = (total / s.meta.duration_s) if s.meta and s.meta.duration_s else 5.0

    try:
        first = await ws.receive_json()
    except (WebSocketDisconnect, json.JSONDecodeError):
        return
    cur = int(first.get("start_ping", 0))
    speed = float(first.get("speed", 1.0))
    batch = int(first.get("batch_size", 32))
    paused = False

    async def drain_control() -> bool:
        """Apply any pending control message. Returns True if playback should stop."""
        nonlocal cur, speed, batch, paused
        try:
            msg = await asyncio.wait_for(ws.receive_json(), timeout=0.001)
        except (asyncio.TimeoutError, json.JSONDecodeError):
            return False
        except WebSocketDisconnect:
            return True
        t = msg.get("type")
        if t == "pause":
            paused = True
        elif t == "resume":
            paused = False
        elif t == "seek":
            cur = max(0, int(msg.get("ping", cur)))
        elif t == "speed":
            speed = float(msg.get("speed", speed))
        elif t == "stop":
            return True
        return False

    while cur < total:
        if await drain_control():
            break
        if paused:
            await asyncio.sleep(0.1)
            continue
        chunk = pings[cur:cur + batch]
        if s.prerendered is not None:
            u8 = np.ascontiguousarray(s.prerendered[cur:cur + batch])
        else:
            u8 = display.to_u8(chunk, width=s.display_width)
        nav = [{
            "ping": cur + i,
            "lat": None if not math.isfinite(p.lat) else p.lat,
            "lon": None if not math.isfinite(p.lon) else p.lon,
            "heading": p.heading_deg,
            "altitude_m": p.altitude_m,
            "speed_kn": None,
        } for i, p in enumerate(chunk)]
        await ws.send_json({
            "type": "ping_batch", "start_ping": cur, "count": len(chunk),
            "width": u8.shape[1], "encoding": "u8_base64",
            "rows": base64.b64encode(u8.tobytes()).decode(),
            "nav": nav,
        })
        for d in s.detections:
            if cur <= d["ping"] < cur + len(chunk):
                await ws.send_json({"type": "detection", "detection": _public(d)})
        cur += len(chunk)
        if cur % (batch * 8) < batch:
            await ws.send_json({"type": "status", "ping": cur,
                                "progress": round(cur / total, 3), "message": None})
        await asyncio.sleep(len(chunk) / ping_rate / max(speed, 0.01))

    try:
        await ws.send_json({"type": "done", "total_pings": total,
                            "total_detections": len(s.detections)})
        await ws.close()
    except (WebSocketDisconnect, RuntimeError):
        pass
