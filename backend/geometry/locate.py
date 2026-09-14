"""Tie the geometry chain together for one detection (implementation_garv.md section 3).

across-track pixel -> slant range -> ground range -> (layback -> fish position) ->
geodesic offset -> target lat/lon, plus the per-target error budget and the flags that
explain why its circle is the size it is.

Not in the section 1 module list, but the chain needs one caller; slant/layback/project/
budget stay single-purpose.
"""

from __future__ import annotations

import math

import numpy as np

from backend.geometry.budget import error_budget
from backend.geometry.layback import layback as _layback
from backend.geometry.project import fish_position, geodesic_m, target_position

_TURN_WINDOW = 20          # pings either side to measure a heading change
_TURN_DEG = 3.0
_LONG_LAYBACK_M = 60.0


def _ping_spacing_m(all_pings, i: int, window: int = 15) -> float | None:
    lo, hi = max(0, i - window), min(len(all_pings), i + window)
    pts = [(p.lat, p.lon) for p in all_pings[lo:hi]
           if math.isfinite(p.lat) and math.isfinite(p.lon)]
    if len(pts) < 2:
        return None
    d = [geodesic_m(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:])]
    d = [x for x in d if x > 0]
    return float(np.median(d)) if d else None


def _on_turn(all_pings, i: int) -> bool:
    lo, hi = max(0, i - _TURN_WINDOW), min(len(all_pings) - 1, i + _TURN_WINDOW)
    dh = abs((all_pings[hi].heading_deg - all_pings[lo].heading_deg + 180) % 360 - 180)
    return dh > _TURN_DEG


def locate_detection(*, all_pings, ping_index: int, bbox_px: dict, channel: str,
                     width: int, meta) -> dict:
    p = all_pings[ping_index]
    half = width / 2.0
    cx = bbox_px["x"] + bbox_px["w"] / 2.0
    # distance from nadir in half-swath fraction -> slant range on the display waterfall
    frac = (cx - half) / half if channel == "starboard" else (half - cx) / half
    frac = min(max(frac, 0.0), 1.0)
    slant = frac * p.slant_range_m
    alt = p.altitude_m
    ground_range = math.sqrt(max(slant ** 2 - alt ** 2, 0.0))

    lb = _layback(p.cable_out_m, p.fish_depth_m, alt)

    fish_lat = fish_lon = None
    tgt_lat = tgt_lon = None
    if math.isfinite(p.lat) and math.isfinite(p.lon):
        fish_lat, fish_lon = fish_position(p.lat, p.lon, p.heading_deg, lb.distance_m)
        if ground_range > 0:
            tgt_lat, tgt_lon = target_position(fish_lat, fish_lon, p.heading_deg,
                                               ground_range, channel)

    sample_res = (p.sound_speed_ms / (2.0 * p.sample_rate_hz)) if p.sample_rate_hz else 0.0
    m_per_px_across = p.slant_range_m / half
    bbox_m_width = round(bbox_px["w"] * m_per_px_across, 2)
    spacing = _ping_spacing_m(all_pings, ping_index)
    bbox_m_height = round(bbox_px["h"] * spacing, 2) if spacing else None

    on_turn = _on_turn(all_pings, ping_index)
    flags: list[str] = []
    if slant < alt * 1.3 or ground_range < 0.12 * p.slant_range_m:
        flags.append("near_nadir")
    if on_turn:
        flags.append("on_turn")
    if lb.distance_m > _LONG_LAYBACK_M:
        flags.append("long_layback")
    if meta.altitude_source == "blank_zone_estimate":
        flags.append("estimated_altitude")
    if any("Range setting changed" in w or "Samples per ping changed" in w
           for w in meta.warnings):
        flags.append("range_change_nearby")

    budget = error_budget(
        slant_range_m=slant, ground_range_m=ground_range, altitude_m=alt,
        altitude_source=meta.altitude_source, layback=lb, sample_res_m=sample_res,
        bbox_m_width=bbox_m_width, bbox_m_height=bbox_m_height, flags=flags,
        on_turn=on_turn,
    ).as_dict()

    geometry = {
        "slant_range_m": round(slant, 2),
        "ground_range_m": round(ground_range, 2),
        "altitude_m": round(alt, 2),
        "layback_m": round(lb.distance_m, 2),
        "heading_deg": round(p.heading_deg, 2),
        "fish_lat": fish_lat, "fish_lon": fish_lon,
    }
    return {
        "lat": tgt_lat, "lon": tgt_lon,
        "error_radius_m": round(budget["total_m"], 2),
        "ground_range_m": round(ground_range, 2),
        "bbox_m_width": bbox_m_width,
        "bbox_m_height": bbox_m_height,
        "object_height_m": None,          # filled by the caller from the shadow (infer.py, section 3.6)
        "flags": flags,
        "_error_budget": budget,
        "_geometry": geometry,
    }
