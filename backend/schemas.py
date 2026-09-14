"""Pydantic response models  exact shapes from docs/apiendpoints.md (frozen).

Field names and nesting must not drift from that file. If a shape must change,
that is a contract change: both humans agree and both implementation docs update
in the same commit (apiendpoints.md section 0).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Status = Literal["uploaded", "parsing", "ready", "processing", "complete", "failed"]
DetClass = Literal["wreck", "milco", "nombo", "pipeline"]

CLASS_DISPLAY = {
    "wreck": "Wreck",
    "milco": "Rigid man-made object",
    "nombo": "Natural bottom object",
    "pipeline": "Pipeline",
}


# --- section 1 · survey lifecycle ---
class UploadResponse(BaseModel):
    survey_id: str
    filename: str
    size_bytes: int
    status: Status
    created_at: str


class SurveyListItem(BaseModel):
    survey_id: str
    filename: str
    status: Status
    ping_count: int
    detection_count: int
    created_at: str


class SurveyList(BaseModel):
    surveys: list[SurveyListItem]


class Bounds(BaseModel):
    north: float | None
    south: float | None
    east: float | None
    west: float | None


class SurveyDetail(BaseModel):
    survey_id: str
    filename: str
    status: Status
    ping_count: int
    samples_per_channel: int
    range_m: float
    frequency_khz: int
    duration_s: float
    altitude_source: Literal["xtf_header", "blank_zone_estimate"]
    altitude_mean_m: float
    sound_speed_ms: float
    bounds: Bounds
    start_time: str
    warnings: list[str]


class ProcessResponse(BaseModel):
    survey_id: str
    status: Status
    job_id: str


class StatusResponse(BaseModel):
    survey_id: str
    status: Status
    progress: float
    pings_processed: int
    detections_so_far: int
    message: str | None = None


# --- section 3 · detections ---
class BboxPx(BaseModel):
    x: int
    y: int
    w: int
    h: int


class Detection(BaseModel):
    detection_id: str
    survey_id: str
    ping: int
    timestamp: str
    lat: float | None
    lon: float | None
    error_radius_m: float | None
    detection_class: DetClass  # serialised as "class" via alias below
    class_display: str
    confidence: float
    bbox_m_width: float | None
    bbox_m_height: float | None
    object_height_m: float | None
    channel: Literal["port", "starboard"]
    ground_range_m: float | None
    bbox_px: BboxPx
    altitude_source: str
    flags: list[str]

    model_config = {"populate_by_name": True}

    def model_dump_api(self) -> dict:
        d = self.model_dump()
        d["class"] = d.pop("detection_class")
        return d


class DetectionList(BaseModel):
    survey_id: str
    count: int
    detections: list[dict]


class ErrorTerm(BaseModel):
    source: str
    label: str
    value_m: float
    kind: Literal["independent", "systematic"]


class ErrorBudget(BaseModel):
    total_m: float
    method: str
    terms: list[ErrorTerm]
    dominant_term: str
    explanation: str


class DetectionGeometry(BaseModel):
    slant_range_m: float | None
    ground_range_m: float | None
    altitude_m: float | None
    layback_m: float | None
    heading_deg: float | None
    fish_lat: float | None
    fish_lon: float | None


class Relief(BaseModel):
    rows: int
    cols: int
    cell_m_across: float
    cell_m_along: float | None
    heights: list[float]
    max_height_m: float
    measured_fraction: float


class DetectionDetail(BaseModel):
    detection: dict
    error_budget: ErrorBudget | None
    geometry: DetectionGeometry | None
    relief: Relief | None


# --- section 7 · stats ---
class Stats(BaseModel):
    area_surveyed_m2: float
    line_length_km: float
    targets_flagged: int
    targets_by_class: dict[str, int]
    review_area_fraction: float
    mean_error_radius_m: float
    headline: str


# --- section 9 · errors ---
class ApiError(Exception):
    def __init__(self, code: str, status: int, message: str,
                 detail: str | None = None, survey_id: str | None = None):
        self.code = code
        self.status = status
        self.message = message
        self.detail = detail
        self.survey_id = survey_id

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message,
                          "detail": self.detail, "survey_id": self.survey_id}}


NOT_FOUND = ("SURVEY_NOT_FOUND", 404)
PARSE_FAILED = ("PARSE_FAILED", 422)
NOT_READY = ("NOT_READY", 409)
PROCESSING_FAILED = ("PROCESSING_FAILED", 500)
FILE_TOO_LARGE = ("FILE_TOO_LARGE", 413)
