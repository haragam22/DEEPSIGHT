# Deep-Sight  API Contract

**This file is frozen.** It is the only agreement between `/backend` and `/frontend`.

- Garv builds endpoints that return exactly these shapes.
- P builds a UI that consumes exactly these shapes, against a mock server, from day one.
- Neither of us waits for the other.
- **Changing anything here requires both of us to agree, and both implementation files updated in the same
  commit.** A silent shape change is the only way this repo can produce a merge disaster.

Base URL: `http://localhost:8000`
All REST responses are `application/json` unless stated. All timestamps ISO-8601 UTC.
All errors use the shape in §9.

---

## 0 · Vocabulary

| Term | Meaning |
|---|---|
| **survey** | One uploaded XTF file, and everything derived from it |
| **ping** | One sonar pulse = one row of the waterfall. Indexed from 0 within a survey |
| **detection** | One flagged target, with a position, an error radius and a class |
| **error radius** | Metres. The radius of the circle you'd actually have to search to find the object |
| **nadir** | Centre column of the waterfall, directly beneath the fish |

---

## 1 · Survey lifecycle

### `POST /api/surveys`
Upload an XTF file.

Request: `multipart/form-data`, field `file`.

Response `201`:
```json
{
  "survey_id": "svy_7f3a91",
  "filename": "SS01-snip-2145-to-end.XTF",
  "size_bytes": 110938112,
  "status": "uploaded",
  "created_at": "2026-09-06T10:22:31Z"
}
```

`status` is always one of: `uploaded` · `parsing` · `ready` · `processing` · `complete` · `failed`.

---

### `GET /api/surveys`
List all surveys, newest first.

```json
{
  "surveys": [
    {
      "survey_id": "svy_7f3a91",
      "filename": "SS01-snip-2145-to-end.XTF",
      "status": "complete",
      "ping_count": 41208,
      "detection_count": 8,
      "created_at": "2026-09-06T10:22:31Z"
    }
  ]
}
```

---

### `GET /api/surveys/{survey_id}`
Everything the UI needs to set up the view before playback starts.

```json
{
  "survey_id": "svy_7f3a91",
  "filename": "SS01-snip-2145-to-end.XTF",
  "status": "complete",
  "ping_count": 41208,
  "samples_per_channel": 2048,
  "range_m": 75.0,
  "frequency_khz": 410,
  "duration_s": 1834.2,
  "altitude_source": "xtf_header",
  "altitude_mean_m": 42.3,
  "sound_speed_ms": 1447.0,
  "bounds": { "north": -65.2011, "south": -65.3140, "east": -60.1042, "west": -60.4477 },
  "start_time": "2010-02-14T20:45:02Z",
  "warnings": [
    "Range setting changed at ping 18402 (75m to 100m)"
  ]
}
```

- `altitude_source` is `"xtf_header"` or `"blank_zone_estimate"`. **P must surface this in the UI**  it
  changes how much to trust every error radius in the survey. See §8.
- `warnings` is a possibly-empty array of plain-English strings. Render them; don't hide them.

---

### `DELETE /api/surveys/{survey_id}`
Drop a survey and everything derived from it (detections, cached imagery, playback state).
The store is in-memory, so this frees the RAM at once and the id stops resolving.

- Response `204` with no body on success.
- `404` with the standard error envelope (§9, code `SURVEY_NOT_FOUND`) if the id was already gone.
- Irreversible. The frontend must confirm with the user before calling it.

---

### `POST /api/surveys/{survey_id}/process`
Kick off detection over the whole survey (headless  separate from live playback).

Response `202`:
```json
{ "survey_id": "svy_7f3a91", "status": "processing", "job_id": "job_2b8e11" }
```

---

### `GET /api/surveys/{survey_id}/status`
Poll during processing. Cheap; safe to hit every 1s.

```json
{
  "survey_id": "svy_7f3a91",
  "status": "processing",
  "progress": 0.42,
  "pings_processed": 17307,
  "detections_so_far": 5,
  "message": "Running detection on line segment 2 of 3"
}
```

`progress` is 0.0–1.0. On `failed`, `message` carries the human-readable reason.

---

## 2 · Live playback  WebSocket

### `WS /ws/surveys/{survey_id}/playback`

This is the demo. Backend streams waterfall rows and detections in survey order; the frontend animates
their arrival so it looks like the survey is replaying live.

**Client → server, first message (required):**
```json
{ "type": "start", "start_ping": 0, "speed": 1.0, "batch_size": 32 }
```
- `speed`  playback multiplier. `1.0` = real time. Demo will run `4.0`–`8.0`.
- `batch_size`  pings per message. 32 is the default; keeps message rate sane.

**Client → server, control messages (any time):**
```json
{ "type": "pause" }
{ "type": "resume" }
{ "type": "seek", "ping": 12000 }
{ "type": "speed", "speed": 4.0 }
{ "type": "stop" }
```

**Server → client messages.** Every message has a `type`. P should switch on it and ignore unknown types
rather than erroring  that keeps the frontend forward-compatible if we add one.

**`ping_batch`**  the waterfall data.
```json
{
  "type": "ping_batch",
  "start_ping": 4096,
  "count": 32,
  "width": 1024,
  "encoding": "u8_base64",
  "rows": "iVBORw0KGgoAAAANS...",
  "nav": [
    { "ping": 4096, "lat": -65.2288, "lon": -60.3311, "heading": 118.4, "altitude_m": 41.8, "speed_kn": 3.2 }
  ]
}
```
- `rows` is `count × width` 8-bit greyscale values, row-major, base64-encoded. Decode to a
  `Uint8ClampedArray` and blit straight into an ImageData. **Already gain-normalised and contrast-mapped
  by the backend**  P does no signal processing, only colour mapping and scrolling.
- `width` is the resampled across-track width in **square ground pixels**, port on the left, starboard on
  the right, nadir at `width / 2`. It is constant for a whole survey.
- `nav` has one entry per ping in the batch, in order, for drawing the track. Fields may be `null` if the
  header lacked them  P must handle nulls by skipping that track vertex, not by drawing at 0,0.

**`detection`**  a target was found in pings already sent.
```json
{ "type": "detection", "detection": { /* full Detection object, see §3 */ } }
```

**`status`**  progress and non-fatal notices.
```json
{ "type": "status", "ping": 12800, "progress": 0.31, "message": null }
```

**`done`**  end of survey reached.
```json
{ "type": "done", "total_pings": 41208, "total_detections": 8 }
```

**`error`**  fatal; server will close the socket after sending this.
```json
{ "type": "error", "code": "PARSE_FAILED", "message": "Malformed ping header at 18402" }
```

**Reconnection:** if the socket drops, P reconnects and sends `start` with `start_ping` set to the last
ping received. The backend must honour arbitrary `start_ping`. P should not lose the detections already
rendered.

---

## 3 · Detections

### The Detection object

Used identically in the WebSocket `detection` message, the list endpoint, and the JSON report.

```json
{
  "detection_id": "det_0a44",
  "survey_id": "svy_7f3a91",
  "ping": 12844,
  "timestamp": "2010-02-14T21:04:19Z",
  "lat": -65.2301,
  "lon": -60.3402,
  "error_radius_m": 14.7,
  "class": "wreck",
  "class_display": "Wreck",
  "confidence": 0.81,
  "bbox_m_width": 11.2,
  "bbox_m_height": 4.6,
  "object_height_m": 2.1,
  "channel": "starboard",
  "ground_range_m": 38.4,
  "bbox_px": { "x": 712, "y": 12844, "w": 96, "h": 41 },
  "altitude_source": "xtf_header",
  "flags": ["near_nadir"]
}
```

**`class`** is one of exactly these four. Nothing else will ever appear:

| `class` | `class_display` | What it is |
|---|---|---|
| `wreck` | Wreck | Shipwreck or large structural debris |
| `milco` | Rigid man-made object | Mine-like contact  a compact, hard, manufactured object |
| `nombo` | Natural bottom object | A rock or natural feature that resembles a target. **Shown, not hidden** |
| `pipeline` | Pipeline | Linear engineered structure |

P renders `class_display`, never the raw code  but the raw code stays visible in the detail panel and in
the exported report, because provenance is part of the pitch.

> **`nombo` is not a false positive we failed to remove.** It's a class we deliberately trained on so the
> model can tell rocks from targets. In the worklist it should be visually de-emphasised (muted, lower in
> the sort order) but never dropped  being able to say "we detected the rock and correctly called it a
> rock" is a differentiator.

**`bbox_px`** is in raw waterfall pixel space: `x` across-track (0 to `width`), `y` = absolute ping index.
This is what P draws on the waterfall. `bbox_m_*` are the real-world metre dimensions for the detail panel
and report.

**`flags`** is a possibly-empty array of strings from a fixed set. P shows them as small labels:
`near_nadir` · `on_turn` · `long_layback` · `estimated_altitude` · `range_change_nearby`.
These are the reasons a particular circle is large, and they are the Q&A ammunition.

---

### `GET /api/surveys/{survey_id}/detections`
All detections for a survey.

Query params (all optional): `class`, `min_confidence`, `sort` (`confidence` | `ping` | `error_radius`).

```json
{
  "survey_id": "svy_7f3a91",
  "count": 8,
  "detections": [ /* Detection objects */ ]
}
```

---

### `GET /api/detections/{detection_id}`
One detection, plus the full error budget breakdown. **This endpoint is a differentiator  the detail
panel built on it is the answer to "how did you get that coordinate?"**

```json
{
  "detection": { /* Detection object */ },
  "error_budget": {
    "total_m": 14.7,
    "method": "rss_independent_plus_linear_systematic",
    "terms": [
      { "source": "gnss_fix",        "label": "GPS fix",              "value_m": 3.0,  "kind": "independent" },
      { "source": "layback",         "label": "Layback estimate",     "value_m": 9.6,  "kind": "independent" },
      { "source": "heading",         "label": "Heading × layback",    "value_m": 2.8,  "kind": "independent" },
      { "source": "altitude",        "label": "Altitude error",       "value_m": 4.1,  "kind": "independent" },
      { "source": "sound_speed",     "label": "Sound speed",          "value_m": 0.1,  "kind": "systematic" },
      { "source": "target_extent",   "label": "Object size",          "value_m": 5.6,  "kind": "systematic" }
    ],
    "dominant_term": "layback",
    "explanation": "Long cable-out on a turning line  layback dominates this position."
  },
  "geometry": {
    "slant_range_m": 57.2,
    "ground_range_m": 38.4,
    "altitude_m": 42.3,
    "layback_m": 78.1,
    "heading_deg": 118.4,
    "fish_lat": -65.2288,
    "fish_lon": -60.3311
  },
  "relief": {
    "rows": 12,
    "cols": 18,
    "cell_m_across": 0.62,
    "cell_m_along": 0.38,
    "heights": [0.0, 0.0, 1.84, 2.1, "… rows × cols values, row-major"],
    "max_height_m": 2.1,
    "measured_fraction": 0.71
  }
}
```

`terms` is ordered largest-first by the backend. P renders it as a horizontal bar breakdown; `explanation`
is a pre-written plain-English sentence P displays verbatim.

**`relief`** (added post-freeze with the owner's agreement) is an estimated 2.5D heightfield of the object,
or `null` when the box has no highlight or no readable shadow. `heights` is `rows × cols` metres,
row-major: row 0 is the earliest ping of the box, column 0 is the smallest across-track pixel. `0` means
seabed (outside the footprint). The footprint comes from the acoustic highlight, closed into one solid body; each row's height comes
from that ping's shadow length. Rows with no readable shadow copy the nearest measured row, and
`measured_fraction` is the share of rows actually measured. `cell_m_along` is `null` when along-track ping
spacing is unknown. The far side of the object is never seen  P labels this as estimated relief, not a
3D model.

---

## 4 · Vessel track

### `GET /api/surveys/{survey_id}/track`
GeoJSON LineString for the map. Decimated server-side to ≤ 5,000 points.

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[-60.4477, -65.3140], [-60.4471, -65.3138]] },
  "properties": { "survey_id": "svy_7f3a91", "point_count": 4820, "decimated_from": 41208 }
}
```

Coordinates are `[lon, lat]`  GeoJSON order, not lat/lon. Easy mistake; don't make it.

---

## 5 · Waterfall tiles (REST fallback + scrubbing)

### `GET /api/surveys/{survey_id}/waterfall`
Query: `start_ping` (required), `count` (required, ≤ 2048), `corrected` (`true` | `false`, default `false`).

Returns `image/png`  a greyscale strip, `count` rows tall, `width` px wide.

Two uses:
1. **Scrubbing.** When the operator drags the timeline, fetch the strip directly instead of replaying.
2. **Fallback.** If the WebSocket fails, P polls this on a timer and the demo still runs. Slower and less
   impressive, but it never shows an empty screen.

`corrected=true` returns the slant-range-corrected view for the raw-vs-corrected toggle (demo beat 4).

---

## 6 · Report

### `GET /api/surveys/{survey_id}/report.json`
```json
{
  "survey": { /* the GET /api/surveys/{id} object */ },
  "generated_at": "2026-09-06T11:02:44Z",
  "stats": { /* the stats object, §7 */ },
  "detections": [ /* Detection objects */ ],
  "method_notes": [
    "Slant-range correction applied assuming locally flat seabed.",
    "Altitude read from XTF header.",
    "Confidence is a raw detector score and is not calibrated.",
    "Positions are WGS-84. Error radius is a 1-sigma search radius."
  ]
}
```

`method_notes` is generated by the backend and **must be rendered in any UI preview of the report.** It is
where our honesty lives; it is not boilerplate to collapse.

### `GET /api/surveys/{survey_id}/report.csv`
Returns `text/csv` with `Content-Disposition: attachment`. Header row, one row per detection:

```
detection_id,timestamp,lat,lon,error_radius_m,class,confidence,bbox_m_width,bbox_m_height,object_height_m,ping,altitude_source
```

---

## 7 · Survey stats

### `GET /api/surveys/{survey_id}/stats`
Drives the headline number on screen.

```json
{
  "area_surveyed_m2": 1240500,
  "line_length_km": 8.27,
  "targets_flagged": 8,
  "targets_by_class": { "wreck": 2, "milco": 3, "nombo": 2, "pipeline": 1 },
  "review_area_fraction": 0.031,
  "mean_error_radius_m": 16.2,
  "headline": "1,240,500 m² surveyed · 8 targets · review 3% of the area instead of 100%"
}
```

`headline` is pre-formatted by the backend so the number in the demo and the number in the report can
never disagree. P displays it verbatim.

---

## 8 · Rules P must follow

These aren't style preferences; each one is a correctness or credibility issue.

1. **Never invent a coordinate.** If a field is `null`, render "unavailable", not `0`.
2. **Circles, not pins.** Every detection on the map is a circle whose radius is `error_radius_m` at the
   map's current scale. Pins imply precision we don't have and throw away our best differentiator.
3. **Surface `altitude_source`.** When it is `blank_zone_estimate`, show a persistent notice on the survey:
   *"Altitude estimated from water column  positions carry higher uncertainty."*
4. **Never claim calibration.** Label confidence as "detector score", not "probability" or "certainty".
5. **`nombo` stays visible.** De-emphasise, never filter out by default.
6. **Render `warnings`, `flags` and `method_notes`.** They are the product, not clutter.
7. **The waterfall is measured data.** Never apply blur, smoothing, sharpening or any generative filter to
   it. Colour mapping and scaling only. If a judge asks "is this AI-generated?" the answer must be a flat
   no, and that has to be true of the pixels on screen.

---

## 9 · Errors

Every failing request returns this shape with an appropriate HTTP status:

```json
{
  "error": {
    "code": "PARSE_FAILED",
    "message": "Could not read ping headers  file may not be a valid XTF.",
    "detail": "Unexpected magic number at offset 0x00",
    "survey_id": "svy_7f3a91"
  }
}
```

Codes P should handle explicitly:

| Code | Status | What P shows |
|---|---|---|
| `SURVEY_NOT_FOUND` | 404 | "That survey no longer exists." |
| `PARSE_FAILED` | 422 | The `message`, plus a prompt to try another file |
| `NOT_READY` | 409 | "Still parsing  this takes about a minute." |
| `PROCESSING_FAILED` | 500 | The `message`, plus a retry button |
| `FILE_TOO_LARGE` | 413 | "That file is over the 500 MB limit." |

`message` is always safe to show a user. `detail` is for the console, not the screen.

---

## 10 · Mock server

Garv ships `/backend/mock/` on **day one**, before any real parsing works: a FastAPI app that serves every
endpoint above with fixed sample data and streams a canned waterfall over the WebSocket. P develops
against it entirely and never blocks.

```bash
cd backend && uvicorn mock.main:app --reload --port 8000
```

The mock and the real server are contract-identical. If P's UI works against the mock, it works against
the real thing.
