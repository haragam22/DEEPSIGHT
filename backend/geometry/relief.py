"""Estimated relief of a detected object (contract section 3, `relief`).

A 2.5D heightfield built from two things the waterfall really measures:

- footprint: pixels inside the detection box brighter than the ping's seabed median
  (the acoustic highlight - the face of the object turned toward the fish)
- height: the shadow length per ping row, through the same similar-triangles formula as
  shadow.py, so each along-track slice of the object gets its own height

Rows with no readable shadow borrow the height of the nearest measured row;
`measured_fraction` says how many rows were measured rather than filled. The far side of
the object is inside its own shadow and is never seen - this is relief, not a 3D model.
"""

from __future__ import annotations

import cv2
import numpy as np

from backend.geometry.shadow import _MIN_RUN_PX, _shadow_length_px

MAX_CELLS = 40           # grid is at most MAX_CELLS x MAX_CELLS
_HIGHLIGHT_FRAC = 1.25   # footprint pixel sits above this multiple of the ping's seabed median
_CELL_FILL = 0.25        # a cell belongs to the footprint if this share of its pixels is highlight
_ROW_WINDOW = 2          # median shadow length over +- this many pings (one row is noisy)


def _solid_body(cell: np.ndarray) -> np.ndarray:
    """Speckled highlight cells -> one enclosed footprint: close small gaps, fill interior
    holes, keep the largest connected piece."""
    k = max(3, (max(cell.shape) // 8) | 1)           # gap closing scales with the grid: 5 at 40 cells
    cell = cv2.morphologyEx(cell, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    pad = np.pad(cell, 1)
    outside = pad.copy()
    cv2.floodFill(outside, None, (0, 0), 1)          # everything reachable from the border
    cell = cell | (1 - outside[1:-1, 1:-1])           # unreachable = interior hole
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cell, connectivity=8)
    if n <= 1:
        return cell
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == big).astype(np.uint8)


def relief(wf: np.ndarray, bbox_px: dict, channel: str, *, altitude_m: float,
           ground_range_m: float, m_per_px_across: float,
           m_per_ping: float | None) -> dict | None:
    """Heightfield dict, or None when there is no footprint or no readable shadow."""
    if altitude_m <= 0 or ground_range_m <= 1e-3 or m_per_px_across <= 0:
        return None
    n, width = wf.shape
    x0, y0 = max(0, bbox_px["x"]), max(0, bbox_px["y"])
    x1, y1 = min(width, bbox_px["x"] + bbox_px["w"]), min(n, bbox_px["y"] + bbox_px["h"])
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None

    box = wf[y0:y1, x0:x1].astype(np.float32)
    rows = wf[y0:y1].astype(np.float32)
    lit = np.where(rows > 0, rows, np.nan)
    seabed = np.nanmedian(lit, axis=1, keepdims=True)          # per ping
    mask = box > _HIGHLIGHT_FRAC * np.nan_to_num(seabed, nan=np.inf)
    if not mask.any():
        return None

    # shadow per ping, measured outboard of that ping's outermost highlight pixel
    outward = 1 if channel == "starboard" else -1
    raw = np.zeros(y1 - y0)
    for r in range(y1 - y0):
        cols = np.flatnonzero(mask[r])
        if cols.size == 0:
            continue
        edge = x0 + (cols[-1] if outward == 1 else cols[0])
        raw[r] = _shadow_length_px(wf, y0 + r, edge, outward)
    raw[raw < _MIN_RUN_PX] = 0

    heights = np.full(y1 - y0, np.nan)
    for r in range(y1 - y0):
        win = raw[max(0, r - _ROW_WINDOW):r + _ROW_WINDOW + 1]
        win = win[win > 0]
        if win.size and raw[r] > 0:
            L = float(np.median(win)) * m_per_px_across
            h = L * altitude_m / (ground_range_m + L)
            if 0 < h <= altitude_m:
                heights[r] = h
    measured = np.flatnonzero(np.isfinite(heights))
    if measured.size == 0:
        return None
    # unmeasured rows take the nearest measured row's height
    nearest = measured[np.abs(np.arange(heights.size)[:, None] - measured[None, :]).argmin(axis=1)]
    heights = heights[nearest]

    # downsample to the grid
    bh, bw = mask.shape
    sy, sx = int(np.ceil(bh / MAX_CELLS)), int(np.ceil(bw / MAX_CELLS))
    gr, gc = int(np.ceil(bh / sy)), int(np.ceil(bw / sx))
    cell = np.zeros((gr, gc), np.uint8)
    row_h = np.zeros(gr)
    for i in range(gr):
        row_h[i] = float(np.median(heights[i * sy:(i + 1) * sy]))
        for j in range(gc):
            if mask[i * sy:(i + 1) * sy, j * sx:(j + 1) * sx].mean() >= _CELL_FILL:
                cell[i, j] = 1
    cell = _solid_body(cell)
    if not cell.any():
        return None
    # one body: every footprint cell gets its row height, then neighbours are smoothed so
    # single noisy rows do not stand up as spikes
    grid = np.where(cell > 0, row_h[:, None], 0.0).astype(np.float32)
    smooth = cv2.medianBlur(grid, 5 if max(grid.shape) >= 24 else 3)   # float32: 3 or 5 only
    grid = np.where(cell > 0, np.where(smooth > 0, smooth, grid), 0.0)

    return {
        "rows": gr,
        "cols": gc,
        "cell_m_across": round(sx * m_per_px_across, 3),
        "cell_m_along": round(sy * m_per_ping, 3) if m_per_ping else None,
        "heights": [round(float(v), 2) for v in grid.ravel()],
        "max_height_m": round(float(grid.max()), 2),
        "measured_fraction": round(measured.size / heights.size, 2),
    }


if __name__ == "__main__":
    # starboard object: highlight rows 5..14 at x 260..272, shadow 272..300 only on rows 5..9
    W = 400
    wf = np.full((20, W), 120, np.uint8)
    wf[5:15, 260:272] = 240
    wf[5:10, 272:300] = 5
    out = relief(wf, {"x": 255, "y": 3, "w": 20, "h": 14}, "starboard",
                 altitude_m=12.0, ground_range_m=40.0, m_per_px_across=0.25, m_per_ping=0.2)
    assert out is not None
    g = np.array(out["heights"]).reshape(out["rows"], out["cols"])
    assert g[:2].max() == 0, "rows above the object are seabed"
    assert 1.3 < out["max_height_m"] < 2.3, out["max_height_m"]
    assert 0 < out["measured_fraction"] < 1, "rows 10..14 are filled, not measured"
    assert out["cell_m_along"] == 0.2
    assert relief(np.full((20, W), 120, np.uint8), {"x": 255, "y": 3, "w": 20, "h": 14},
                  "starboard", altitude_m=12.0, ground_range_m=40.0,
                  m_per_px_across=0.25, m_per_ping=0.2) is None, "flat seabed has no relief"
    ring = np.ones((6, 6), np.uint8)
    ring[2:4, 2:4] = 0
    ring[0, 5] = 0
    speck = np.zeros((10, 10), np.uint8)
    speck[1:7, 1:7] = ring
    speck[9, 9] = 1
    body = _solid_body(speck)
    assert body[3, 3] == 1, "interior hole filled"
    assert body[9, 9] == 0, "stray speck dropped"
    print(f"relief.py ok: {out['rows']}x{out['cols']} grid, max {out['max_height_m']} m, "
          f"measured {out['measured_fraction']}")
