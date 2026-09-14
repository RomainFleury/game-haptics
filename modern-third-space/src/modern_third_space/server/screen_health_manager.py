"""
Generic Screen Health Watcher (Phase A - redness ROIs).

This manager is a daemon-side integration that watches configured screen ROIs
and emits a standardized "hit_recorded" event when a redness threshold is
exceeded, optionally with a direction key.

Design constraints:
- Windows-only runtime (screen capture backend is optional-import)
- Must be importable in dev/test environments without capture deps installed
- Uses vest.cell_layout constants for haptic triggering (random cell in Phase A)
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import struct
import threading
import time
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from ..vest.cell_layout import ALL_CELLS
from .screen_ocr import (
    DEFAULT_AMMO_OCR_ENGINE,
    PROFILE_OCR_DAEMON,
    TEXT_OCR_ENGINES,
    uses_text_ocr_engine,
)

logger = logging.getLogger(__name__)


class DirectionKey(str, Enum):
    FRONT = "front"
    BACK = "back"
    LEFT = "left"
    RIGHT = "right"
    FRONT_LEFT = "front_left"
    FRONT_RIGHT = "front_right"
    BACK_LEFT = "back_left"
    BACK_RIGHT = "back_right"


@dataclass(frozen=True)
class NormalizedRect:
    """Rectangle in normalized coordinates (0-1)."""

    x: float
    y: float
    w: float
    h: float

    def validate(self) -> None:
        for name, v in (("x", self.x), ("y", self.y), ("w", self.w), ("h", self.h)):
            if not isinstance(v, (int, float)):
                raise ValueError(f"rect.{name} must be a number")
        if self.w <= 0 or self.h <= 0:
            raise ValueError("rect.w and rect.h must be > 0")
        if self.x < 0 or self.y < 0 or self.x > 1 or self.y > 1:
            raise ValueError("rect.x and rect.y must be in [0, 1]")
        if self.x + self.w <= 0 or self.y + self.h <= 0:
            raise ValueError("rect must have positive area")


def normalized_rect_to_pixels(rect: NormalizedRect, frame_w: int, frame_h: int) -> Tuple[int, int, int, int]:
    """
    Convert a normalized rect to a pixel rect (left, top, width, height).

    Values are clamped so the resulting rect fits within the frame.
    """
    if frame_w <= 0 or frame_h <= 0:
        raise ValueError("frame_w and frame_h must be > 0")
    rect.validate()

    # Convert to pixel coordinates
    left = int(round(rect.x * frame_w))
    top = int(round(rect.y * frame_h))
    width = int(round(rect.w * frame_w))
    height = int(round(rect.h * frame_h))

    # Clamp minimum size
    width = max(1, width)
    height = max(1, height)

    # Clamp origin
    left = max(0, min(left, frame_w - 1))
    top = max(0, min(top, frame_h - 1))

    # Clamp size to fit
    width = max(1, min(width, frame_w - left))
    height = max(1, min(height, frame_h - top))

    return left, top, width, height


def clamp_crop_rect(
    left: int, top: int, width: int, height: int, frame_w: int, frame_h: int
) -> Tuple[int, int, int, int]:
    """Clamp a pixel crop so it stays inside the actual captured frame."""
    fw = max(1, int(frame_w))
    fh = max(1, int(frame_h))
    l = max(0, min(int(left), fw - 1))
    t = max(0, min(int(top), fh - 1))
    w = max(1, min(max(1, int(width)), fw - l))
    h = max(1, min(max(1, int(height)), fh - t))
    return l, t, w, h


def _as_captured_bgra(item: Any, req_w: int, req_h: int) -> Tuple[bytes, int, int]:
    """Normalize capture_multiple_bgra output to (bytes, width, height)."""
    if isinstance(item, tuple) and len(item) >= 3:
        raw, w, h = item[0], int(item[1]), int(item[2])
        return bytes(raw), max(1, w), max(1, h)
    return bytes(item), int(req_w), int(req_h)


def redness_score_from_bgra(raw_bgra: bytes, width: int, height: int) -> float:
    """
    Compute a redness score in [0,1] from BGRA bytes.

    Score is mean of per-pixel red-dominance:
        (R - max(G, B)) / 255, clipped to [0,1]
    """
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be > 0")
    expected = width * height * 4
    if len(raw_bgra) < expected:
        raise ValueError("raw_bgra is smaller than expected for BGRA frame")

    # Fast-ish Python loop; ROI rectangles are expected to be small.
    total = 0.0
    count = width * height
    # Iterate per pixel (BGRA)
    for i in range(0, expected, 4):
        b = raw_bgra[i]
        g = raw_bgra[i + 1]
        r = raw_bgra[i + 2]
        m = g if g >= b else b
        d = r - m
        if d <= 0:
            continue
        total += d / 255.0
    return max(0.0, min(1.0, total / float(count)))


def color_match_score_from_bgra(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    target_rgb: Tuple[int, int, int],
    tolerance_l1: int,
) -> float:
    """
    Mean per-pixel match to a target RGB in [0,1].

    Pixel score = max(0, 1 - L1(pixel, target) / max(1, tolerance_l1)).
    Use this for tinted damage vignettes that are not purely red-dominant.
    """
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be > 0")
    expected = width * height * 4
    if len(raw_bgra) < expected:
        raise ValueError("raw_bgra is smaller than expected for BGRA frame")
    if tolerance_l1 < 0 or tolerance_l1 > 765:
        raise ValueError("tolerance_l1 must be in [0, 765]")

    tr, tg, tb = target_rgb
    denom = float(max(1, int(tolerance_l1)))
    total = 0.0
    count = width * height
    for i in range(0, expected, 4):
        b = raw_bgra[i]
        g = raw_bgra[i + 1]
        r = raw_bgra[i + 2]
        dist = abs(r - tr) + abs(g - tg) + abs(b - tb)
        if dist >= denom:
            continue
        total += 1.0 - (dist / denom)
    return max(0.0, min(1.0, total / float(count)))


def _parse_vignette_rois(rois_data: Any) -> List[RednessROI]:
    rois: List[RednessROI] = []
    for idx, r in enumerate(rois_data):
        if not isinstance(r, dict):
            continue
        r_name = str(r.get("name") or f"roi_{idx}")
        rect_data = r.get("rect") or r.get("roi")
        if not isinstance(rect_data, dict):
            raise ValueError(f"roi '{r_name}': missing rect")
        rect = NormalizedRect(
            x=float(rect_data.get("x", 0)),
            y=float(rect_data.get("y", 0)),
            w=float(rect_data.get("w", 0)),
            h=float(rect_data.get("h", 0)),
        )
        rect.validate()
        direction_raw = r.get("direction")
        direction = DirectionKey(direction_raw) if direction_raw else None
        rois.append(RednessROI(name=r_name, rect=rect, direction=direction))
    return rois


def background_coverage_from_bgra(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    background_rgb: Tuple[int, int, int],
    tolerance_l1: int,
) -> float:
    """
    Fraction of ROI pixels that still look like the bar background in [0,1].

    Used for fill-up recoil: white/red fill is simply "not background". A drop in
    coverage means more of the bar filled → a shot. Higher tolerance_l1 helps with
    translucent backgrounds that shift slightly with what's behind them.
    """
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be > 0")
    expected = width * height * 4
    if len(raw_bgra) < expected:
        raise ValueError("raw_bgra is smaller than expected for BGRA frame")
    if tolerance_l1 < 0 or tolerance_l1 > 765:
        raise ValueError("tolerance_l1 must be in [0, 765]")

    br, bg, bb = background_rgb
    total = width * height
    if total <= 0:
        return 0.0
    matched = 0
    i = 0
    for _ in range(total):
        b = raw_bgra[i]
        g = raw_bgra[i + 1]
        r = raw_bgra[i + 2]
        i += 4
        if abs(r - br) + abs(g - bg) + abs(b - bb) <= tolerance_l1:
            matched += 1
    return max(0.0, min(1.0, matched / float(total)))


def health_bar_percent_from_bgra(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    filled_rgb: Tuple[int, int, int],
    empty_rgb: Tuple[int, int, int],
    tolerance_l1: int,
    column_threshold: float = 0.5,
) -> float:
    """
    Compute a horizontal health bar fill percent in [0,1] from BGRA bytes.

    Canonical Phase C algorithm:
    - Classify each pixel as filled if:
        df = L1(pixel_rgb, filled_rgb)
        de = L1(pixel_rgb, empty_rgb)
        df <= tolerance_l1 AND df <= de
    - For each column x: filled_ratio[x] = filled_pixels_in_column / H
    - Column is filled if filled_ratio[x] >= column_threshold
    - Scan left -> right to find first empty column; percent = x_boundary / W
    """
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be > 0")
    expected = width * height * 4
    if len(raw_bgra) < expected:
        raise ValueError("raw_bgra is smaller than expected for BGRA frame")
    if tolerance_l1 < 0 or tolerance_l1 > 765:
        raise ValueError("tolerance_l1 must be in [0, 765]")
    if not (0.0 <= column_threshold <= 1.0):
        raise ValueError("column_threshold must be in [0, 1]")

    fr, fg, fb = filled_rgb
    er, eg, eb = empty_rgb

    filled_counts_by_col = [0] * width
    # raw_bgra is row-major: for pixel (x,y) index = (y*width + x)*4
    i = 0
    for _y in range(height):
        for x in range(width):
            b = raw_bgra[i]
            g = raw_bgra[i + 1]
            r = raw_bgra[i + 2]
            i += 4

            df = abs(r - fr) + abs(g - fg) + abs(b - fb)
            if df > tolerance_l1:
                continue
            de = abs(r - er) + abs(g - eg) + abs(b - eb)
            if df <= de:
                filled_counts_by_col[x] += 1

    # Find first column that is not filled.
    col_min = int(column_threshold * height)
    for x in range(width):
        if filled_counts_by_col[x] < col_min:
            return max(0.0, min(1.0, x / float(width)))
    return 1.0


def _resize_bitmap_nearest(bits: List[int], src_w: int, src_h: int, dst_w: int, dst_h: int) -> List[int]:
    if src_w <= 0 or src_h <= 0 or dst_w <= 0 or dst_h <= 0:
        raise ValueError("bitmap sizes must be > 0")
    if len(bits) < src_w * src_h:
        raise ValueError("bitmap bits too small for src size")
    out: List[int] = [0] * (dst_w * dst_h)
    for y in range(dst_h):
        sy = int(y * src_h / dst_h)
        for x in range(dst_w):
            sx = int(x * src_w / dst_w)
            out[y * dst_w + x] = 1 if bits[sy * src_w + sx] else 0
    return out


def binarize_bgra_to_bitmap(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    threshold: float,
    invert: bool,
    scale: int,
) -> Tuple[List[int], int, int]:
    """
    Convert BGRA ROI to a binary bitmap (row-major) with optional integer scaling.

    Output bits are 0/1 with 1 representing "foreground/ink".

    Notes:
    - Uses integer grayscale: gray ≈ 0.299R + 0.587G + 0.114B
    - Threshold compares gray/255 >= threshold
    - If invert=True, bits are flipped
    - Scaling uses nearest-neighbor replication (equivalent to NN scale before binarization)
    """
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be > 0")
    expected = width * height * 4
    if len(raw_bgra) < expected:
        raise ValueError("raw_bgra is smaller than expected for BGRA frame")
    if not (0.0 <= float(threshold) <= 1.0):
        raise ValueError("threshold must be in [0,1]")
    if not isinstance(scale, int) or scale < 1:
        raise ValueError("scale must be an int >= 1")

    thr = int(round(float(threshold) * 255.0))
    out_w = width * scale
    out_h = height * scale
    out: List[int] = [0] * (out_w * out_h)

    i = 0
    for y in range(height):
        for x in range(width):
            b = raw_bgra[i]
            g = raw_bgra[i + 1]
            r = raw_bgra[i + 2]
            i += 4

            gray = (r * 299 + g * 587 + b * 114) // 1000
            bit = 1 if gray >= thr else 0
            if invert:
                bit = 0 if bit else 1

            if scale == 1:
                out[y * out_w + x] = bit
            else:
                oy0 = y * scale
                ox0 = x * scale
                for yy in range(scale):
                    row = (oy0 + yy) * out_w
                    for xx in range(scale):
                        out[row + (ox0 + xx)] = bit

    return out, out_w, out_h


def hamming_distance_bits(a: List[int], b: List[int], n: Optional[int] = None) -> int:
    if n is None:
        n = min(len(a), len(b))
    d = 0
    for i in range(n):
        d += 1 if (a[i] ^ b[i]) else 0
    return d


@dataclass(frozen=True)
class RednessROI:
    name: str
    rect: NormalizedRect
    direction: Optional[DirectionKey] = None


@dataclass(frozen=True)
class RednessDetectorConfig:
    min_score: float = 0.35
    cooldown_ms: int = 200


@dataclass(frozen=True)
class ColorVignetteDetectorConfig:
    target: "RGB"
    tolerance_l1: int = 120
    min_score: float = 0.35
    cooldown_ms: int = 200

    def validate(self) -> None:
        self.target.validate()
        if not isinstance(self.tolerance_l1, int):
            raise ValueError("color_vignette.tolerance_l1 must be an int")
        if not (0 <= self.tolerance_l1 <= 765):
            raise ValueError("color_vignette.tolerance_l1 must be in [0, 765]")
        if not isinstance(self.min_score, (int, float)):
            raise ValueError("threshold.min_score must be a number")
        if not (0.0 <= float(self.min_score) <= 1.0):
            raise ValueError("threshold.min_score must be in [0,1]")
        if not isinstance(self.cooldown_ms, int):
            raise ValueError("detector.cooldown_ms must be an int")
        if self.cooldown_ms < 0:
            raise ValueError("detector.cooldown_ms must be >= 0")


@dataclass(frozen=True)
class RGB:
    r: int
    g: int
    b: int

    def validate(self) -> None:
        for name, v in (("r", self.r), ("g", self.g), ("b", self.b)):
            if not isinstance(v, int):
                raise ValueError(f"rgb.{name} must be an int")
            if not (0 <= v <= 255):
                raise ValueError(f"rgb.{name} must be in [0,255]")

    def as_tuple(self) -> Tuple[int, int, int]:
        return (self.r, self.g, self.b)


def _rgb_from_list(raw: Any, fallback: Tuple[int, int, int], field_name: str) -> RGB:
    if isinstance(raw, list) and len(raw) == 3:
        rgb = RGB(int(raw[0]), int(raw[1]), int(raw[2]))
    else:
        rgb = RGB(int(fallback[0]), int(fallback[1]), int(fallback[2]))
    try:
        rgb.validate()
    except ValueError as exc:
        raise ValueError(f"{field_name}: {exc}") from exc
    return rgb


@dataclass(frozen=True)
class HealthBarColorSampling:
    filled: RGB
    empty: RGB
    tolerance_l1: int

    def validate(self) -> None:
        self.filled.validate()
        self.empty.validate()
        if not isinstance(self.tolerance_l1, int):
            raise ValueError("color_sampling.tolerance_l1 must be an int")
        if not (0 <= self.tolerance_l1 <= 765):
            raise ValueError("color_sampling.tolerance_l1 must be in [0,765]")


@dataclass(frozen=True)
class HealthBarThresholdFallback:
    mode: str  # "brightness" | "saturation"
    min_value: float

    def validate(self) -> None:
        if self.mode not in ("brightness", "saturation"):
            raise ValueError("threshold_fallback.mode must be 'brightness' or 'saturation'")
        if not isinstance(self.min_value, (int, float)):
            raise ValueError("threshold_fallback.min must be a number")
        if not (0.0 <= float(self.min_value) <= 1.0):
            raise ValueError("threshold_fallback.min must be in [0,1]")


@dataclass(frozen=True)
class HealthBarHitOnDecrease:
    min_drop: float
    cooldown_ms: int

    def validate(self) -> None:
        if not isinstance(self.min_drop, (int, float)):
            raise ValueError("hit_on_decrease.min_drop must be a number")
        if not (0.0 <= float(self.min_drop) <= 1.0):
            raise ValueError("hit_on_decrease.min_drop must be in [0,1]")
        if not isinstance(self.cooldown_ms, int):
            raise ValueError("hit_on_decrease.cooldown_ms must be an int")
        if self.cooldown_ms < 0:
            raise ValueError("hit_on_decrease.cooldown_ms must be >= 0")


@dataclass(frozen=True)
class HealthBarDetector:
    rect: NormalizedRect
    orientation: str  # Phase C: "horizontal"
    color_sampling: Optional[HealthBarColorSampling]
    hit_on_decrease: HealthBarHitOnDecrease
    threshold_fallback: Optional[HealthBarThresholdFallback] = None
    name: str = "health_bar"

    def validate(self) -> None:
        self.rect.validate()
        if self.orientation != "horizontal":
            raise ValueError("health_bar.orientation must be 'horizontal' (Phase C)")
        if self.color_sampling is not None:
            self.color_sampling.validate()
        if self.threshold_fallback is not None:
            self.threshold_fallback.validate()
        self.hit_on_decrease.validate()
        if not isinstance(self.name, str) or not self.name:
            raise ValueError("health_bar.name must be a non-empty string")


@dataclass(frozen=True)
class FillUpBarDetector:
    """Recoil channel: pulse when the bar's background coverage shrinks.

    Pick the unfilled bar background (often translucent). White or red fill is
    treated the same: not-background. When background % drops, a shot fired.
    """

    rect: NormalizedRect
    background: RGB
    tolerance_l1: int
    min_background_drop: float
    cooldown_ms: int
    duration_ms: int
    name: str = "fill_up_bar"

    def validate(self) -> None:
        self.rect.validate()
        self.background.validate()
        if not isinstance(self.tolerance_l1, int) or not (0 <= self.tolerance_l1 <= 765):
            raise ValueError("fill_up_bar.tolerance_l1 must be an int in [0,765]")
        if not isinstance(self.min_background_drop, (int, float)) or not (
            0.0 < float(self.min_background_drop) <= 1.0
        ):
            raise ValueError("fill_up_bar.min_background_drop must be in (0,1]")
        if not isinstance(self.cooldown_ms, int) or self.cooldown_ms < 0:
            raise ValueError("fill_up_bar.cooldown_ms must be an int >= 0")
        if not isinstance(self.duration_ms, int) or self.duration_ms < 1:
            raise ValueError("fill_up_bar.duration_ms must be an int >= 1")
        if not isinstance(self.name, str) or not self.name:
            raise ValueError("fill_up_bar.name must be a non-empty string")


@dataclass(frozen=True)
class HealthNumberPreprocess:
    invert: bool
    threshold: float
    scale: int

    def validate(self) -> None:
        if not isinstance(self.invert, bool):
            raise ValueError("preprocess.invert must be a boolean")
        if not isinstance(self.threshold, (int, float)) or not (0.0 <= float(self.threshold) <= 1.0):
            raise ValueError("preprocess.threshold must be in [0,1]")
        if not isinstance(self.scale, int) or self.scale < 1:
            raise ValueError("preprocess.scale must be an int >= 1")


@dataclass(frozen=True)
class HealthNumberReadout:
    min_value: int
    max_value: int
    stable_reads: int

    def validate(self) -> None:
        if not isinstance(self.min_value, int) or not isinstance(self.max_value, int):
            raise ValueError("readout.min and readout.max must be ints")
        if self.min_value > self.max_value:
            raise ValueError("readout.min must be <= readout.max")
        if not isinstance(self.stable_reads, int) or self.stable_reads < 1:
            raise ValueError("readout.stable_reads must be an int >= 1")


@dataclass(frozen=True)
class HealthNumberHitOnDecrease:
    min_drop: int
    cooldown_ms: int

    def validate(self) -> None:
        if not isinstance(self.min_drop, int) or self.min_drop < 1:
            raise ValueError("hit_on_decrease.min_drop must be an int >= 1")
        if not isinstance(self.cooldown_ms, int) or self.cooldown_ms < 0:
            raise ValueError("hit_on_decrease.cooldown_ms must be an int >= 0")


@dataclass(frozen=True)
class HealthNumberTemplates:
    template_set_id: str
    hamming_max: int
    width: int
    height: int
    digits: Dict[str, List[int]]

    def validate(self) -> None:
        if not isinstance(self.template_set_id, str) or not self.template_set_id:
            raise ValueError("templates.template_set_id must be a non-empty string")
        if not isinstance(self.hamming_max, int) or self.hamming_max < 0:
            raise ValueError("templates.hamming_max must be an int >= 0")
        if not isinstance(self.width, int) or self.width <= 0:
            raise ValueError("templates.width must be an int > 0")
        if not isinstance(self.height, int) or self.height <= 0:
            raise ValueError("templates.height must be an int > 0")
        if not isinstance(self.digits, dict) or not self.digits:
            raise ValueError("templates.digits must be a non-empty dict")
        expected = self.width * self.height
        for k, v in self.digits.items():
            if k not in [str(i) for i in range(10)]:
                raise ValueError("templates.digits keys must be '0'..'9'")
            if not isinstance(v, list) or len(v) != expected:
                raise ValueError(f"templates.digits['{k}'] must be a list of length {expected}")


@dataclass(frozen=True)
class HealthNumberDetector:
    rect: NormalizedRect
    digits: int
    preprocess: HealthNumberPreprocess
    readout: HealthNumberReadout
    hit_on_decrease: HealthNumberHitOnDecrease
    templates: Optional[HealthNumberTemplates] = None
    name: str = "health_number"
    # "templates" = taught bitmasks (legacy); "daemon" / text engines = Daemon Settings OCR
    engine: str = "templates"

    def validate(self) -> None:
        self.rect.validate()
        if not isinstance(self.digits, int) or self.digits < 1:
            raise ValueError("health_number.digits must be an int >= 1")
        allowed = ("templates", PROFILE_OCR_DAEMON) + TEXT_OCR_ENGINES
        if self.engine not in allowed:
            raise ValueError(f"health_number.engine must be one of {allowed}")
        self.preprocess.validate()
        self.readout.validate()
        self.hit_on_decrease.validate()
        if self.engine == "templates" and self.templates is not None:
            self.templates.validate()
        if not isinstance(self.name, str) or not self.name:
            raise ValueError("health_number.name must be a non-empty string")


@dataclass(frozen=True)
class ScreenCaptureConfig:
    monitor_index: int = 1  # 1-based to match common UX in Electron
    tick_ms: int = 50


@dataclass(frozen=True)
class ScreenHealthDebugConfig:
    """
    Optional debug config to help calibrate detectors.

    Note: This is intentionally "best effort" and should never make the watcher fail.
    """

    log_values: bool = False
    log_every_n_ticks: int = 20  # periodic log (avoid spam)
    save_roi_images: bool = False
    save_dir: Optional[str] = None

    def validate(self) -> None:
        if not isinstance(self.log_values, bool):
            raise ValueError("debug.log_values must be a boolean")
        if not isinstance(self.log_every_n_ticks, int) or self.log_every_n_ticks < 1:
            raise ValueError("debug.log_every_n_ticks must be an int >= 1")
        if not isinstance(self.save_roi_images, bool):
            raise ValueError("debug.save_roi_images must be a boolean")
        if self.save_dir is not None and (not isinstance(self.save_dir, str) or not self.save_dir):
            raise ValueError("debug.save_dir must be a non-empty string when provided")


@dataclass(frozen=True)
class ScreenHealthProfile:
    schema_version: int
    name: str
    capture: ScreenCaptureConfig
    redness_rois: List[RednessROI]
    redness_detector: Optional[RednessDetectorConfig]
    health_bars: List[HealthBarDetector]
    health_numbers: List[HealthNumberDetector]
    ammo_numbers: List[HealthNumberDetector] = field(default_factory=list)
    fill_up_bars: List[FillUpBarDetector] = field(default_factory=list)
    color_vignette_rois: List[RednessROI] = field(default_factory=list)
    color_vignette_detector: Optional[ColorVignetteDetectorConfig] = None
    recoil_duration_ms: int = 40
    debug: Optional[ScreenHealthDebugConfig] = None


def _bgra_tight_bytes_to_hwc(raw: bytes, width: int, height: int) -> Any:
    """Interpret tight row-major BGRA bytes as HxWx4 uint8 (same layout as BetterCam)."""
    try:
        import numpy as np
    except ImportError as e:
        raise RuntimeError("frame requires numpy (bundled with bettercam)") from e
    w, h = int(width), int(height)
    if w <= 0 or h <= 0:
        raise ValueError("frame_width and frame_height must be > 0")
    expected = w * h * 4
    if len(raw) != expected:
        raise ValueError(f"frame length {len(raw)} != width*height*4 ({expected}) for {w}x{h}")
    return np.frombuffer(raw, dtype=np.uint8).reshape((h, w, 4))


def _decode_inline_bgra_base64_to_hwc(b64: str, width: int, height: int) -> Any:
    """Decode standard base64 into HxWx4 uint8 BGRA (legacy; prefer file + raw bytes)."""
    raw = base64.b64decode(b64.strip(), validate=False)
    return _bgra_tight_bytes_to_hwc(raw, width, height)


def _crop_bgra_regions_from_hwc(
    frame_hwc: Any, regions: List[Tuple[int, int, int, int]]
) -> List[Tuple[bytes, int, int]]:
    """Crop (left, top, width, height) from HxWx4 BGRA; clamp to the real frame size."""
    results: List[Tuple[bytes, int, int]] = []
    fh, fw = int(frame_hwc.shape[0]), int(frame_hwc.shape[1])
    for left, top, width, height in regions:
        l, t, w, h = clamp_crop_rect(left, top, width, height, fw, fh)
        cropped = frame_hwc[t : t + h, l : l + w, :]
        try:
            raw = cropped.tobytes(order="C")
        except TypeError:
            raw = cropped.tobytes()
        results.append((raw, w, h))
    return results


class ScreenHealthManager:
    """
    Daemon-managed screen watcher.

    Callbacks:
    - on_game_event(event_type: str, params: dict)
    - on_trigger(cell: int, speed: int)
    - on_recoil(duration_ms: int)  # USB relay / solenoid pulse
    """

    _BATCH_CAPTURE_FAIL_LOG_INTERVAL_S = 10.0

    def __init__(
        self,
        on_game_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        on_trigger: Optional[Callable[[int, int], None]] = None,
        on_recoil: Optional[Callable[[int], None]] = None,
        get_ocr_engine: Optional[Callable[[], str]] = None,
    ) -> None:
        self._on_game_event = on_game_event
        self._on_trigger = on_trigger
        self._on_recoil = on_recoil
        self._get_ocr_engine = get_ocr_engine

        self._thread: Optional[threading.Thread] = None
        self._stop_evt = threading.Event()

        self._profile: Optional[ScreenHealthProfile] = None
        self._running = False

        # Debug runtime (opt-in)
        self._debug_log_values = False
        self._debug_log_every_n_ticks = 20
        self._debug_save_roi_images = False
        self._debug_save_dir: Optional[Path] = None
        self._debug_emit_events = False
        self._debug_tick = 0
        self._debug_saved_once: set[str] = set()

        # Stats
        self.events_received = 0
        self.last_event_ts: Optional[float] = None
        self.last_hit_ts: Optional[float] = None
        self.last_recoil_ts: Optional[float] = None

        # Cooldown state
        self._last_hit_by_roi: Dict[str, float] = {}

        # Health bar state
        self._prev_health_percent_by_detector: Dict[str, float] = {}
        self._last_health_emit_by_detector: Dict[str, float] = {}
        self._last_health_percent_emitted: Dict[str, float] = {}

        # Health number OCR state
        self._health_number_candidate_value: Dict[str, int] = {}
        self._health_number_candidate_count: Dict[str, int] = {}
        self._prev_health_value_by_detector: Dict[str, int] = {}
        self._last_health_value_emitted: Dict[str, int] = {}

        # Fill-up bar recoil state
        self._prev_fill_up_background: Dict[str, float] = {}
        self._last_fill_up_recoil_ts: Dict[str, float] = {}

        self._last_batch_capture_fail_log_ts: float = 0.0
        self._batch_capture_fail_burst: bool = False
        self._last_region_fail_log_ts: float = 0.0

    @property
    def is_running(self) -> bool:
        return self._running

    def start(self, profile: Dict[str, Any] | str) -> Tuple[bool, Optional[str]]:
        if self._running:
            return True, None

        try:
            self._profile = self._parse_profile(profile)
        except Exception as e:
            return False, str(e)

        # Reset all runtime state so a previous run/profile doesn't affect this run.
        self._reset_runtime_state()

        # Configure optional debug mode (profile.debug + env overrides).
        self._configure_debug(self._profile.debug if self._profile else None)

        self._stop_evt.clear()
        self._thread = threading.Thread(target=self._run_loop, name="screen_health", daemon=True)
        self._thread.start()
        self._running = True
        return True, None

    def stop(self) -> bool:
        if not self._running:
            return True
        self._stop_evt.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        self._running = False
        # Clear per-run state after stop to avoid stale values on next start().
        self._reset_runtime_state()
        return True

    def status(self) -> Dict[str, Any]:
        return {
            "running": self._running,
            "profile_name": self._profile.name if self._profile else None,
            "events_received": self.events_received,
            "last_event_ts": self.last_event_ts,
            "last_hit_ts": self.last_hit_ts,
            "last_recoil_ts": self.last_recoil_ts,
            "debug_log_values": self._debug_log_values,
            "debug_save_roi_images": self._debug_save_roi_images,
            "debug_save_dir": str(self._debug_save_dir) if self._debug_save_dir else None,
        }

    def test_profile_once(
        self,
        profile: Dict[str, Any] | str,
        *,
        frame_bgra_bytes: bytes,
        frame_width: int,
        frame_height: int,
        output_dir: Optional[str] = None,
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Validate a profile and run a single evaluation pass (no thread, no events).

        ROIs are cropped from tight row-major BGRA bytes (same layout as BetterCam). The client
        typically writes these bytes to a temp file and passes the path to the daemon over TCP.

        Returns:
        - success: bool
        - result: dict (timings + evaluations + saved ROI crops)
        - error: str
        """
        try:
            parsed = self._parse_profile(profile)
        except Exception as e:
            return False, None, str(e)

        out_dir: Optional[Path] = None
        if output_dir:
            try:
                out_dir = Path(output_dir).expanduser().resolve()
                out_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                return False, None, f"failed to prepare output_dir: {e}"

        fw = int(frame_width)
        fh = int(frame_height)
        if not frame_bgra_bytes or fw <= 0 or fh <= 0:
            return (
                False,
                None,
                "frame_bgra_bytes (non-empty), frame_width, and frame_height (> 0) are required",
            )
        try:
            frame_hwc = _bgra_tight_bytes_to_hwc(frame_bgra_bytes, fw, fh)
            frame_w, frame_h = fw, fh
        except Exception as e:
            return False, None, f"static frame: {e}"
        frame_source = "file_bgra"

        t0 = time.perf_counter()
        detectors_out: List[Dict[str, Any]] = []
        errors: List[str] = []

        def save_crop(kind: str, name: str, raw_bgra: bytes, w: int, h: int) -> Optional[str]:
            if out_dir is None:
                return None
            ts_ms = int(time.time() * 1000.0)
            fname = f"{ts_ms}_{self._safe_file_part(kind)}_{self._safe_file_part(name)}_{w}x{h}.bmp"
            try:
                self._write_bmp_bgra(out_dir / fname, raw_bgra, w, h)
                return str(out_dir / fname)
            except Exception as e:
                errors.append(f"save_crop {kind}:{name}: {e}")
                return None

        # Collect all regions to capture in a single batch
        # Format: (detector_type, detector_obj, name, left, top, width, height)
        all_regions: List[Tuple[str, Any, str, int, int, int, int]] = []

        # Redness
        if parsed.redness_detector is not None:
            for roi in parsed.redness_rois:
                left, top, w, h = normalized_rect_to_pixels(roi.rect, frame_w, frame_h)
                all_regions.append(("redness", roi, roi.name, left, top, w, h))

        if parsed.color_vignette_detector is not None:
            for roi in parsed.color_vignette_rois:
                left, top, w, h = normalized_rect_to_pixels(roi.rect, frame_w, frame_h)
                all_regions.append(("color_vignette", roi, roi.name, left, top, w, h))

        # Health bar
        for hb in parsed.health_bars:
            left, top, w, h = normalized_rect_to_pixels(hb.rect, frame_w, frame_h)
            all_regions.append(("health_bar", hb, hb.name, left, top, w, h))

        # Health number OCR (single read; stability is handled in the continuous loop)
        for hn in parsed.health_numbers:
            if not uses_text_ocr_engine(getattr(hn, "engine", "templates")) and hn.templates is None:
                detectors_out.append(
                    {
                        "type": "health_number",
                        "name": hn.name,
                        "error": "missing templates",
                    }
                )
                continue
            left, top, w, h = normalized_rect_to_pixels(hn.rect, frame_w, frame_h)
            all_regions.append(("health_number", hn, hn.name, left, top, w, h))

        for an in parsed.ammo_numbers:
            if an.engine == "templates" and an.templates is None:
                detectors_out.append(
                    {
                        "type": "ammo_number",
                        "name": an.name,
                        "error": "missing templates",
                    }
                )
                continue
            left, top, w, h = normalized_rect_to_pixels(an.rect, frame_w, frame_h)
            all_regions.append(("ammo_number", an, an.name, left, top, w, h))

        for bar in parsed.fill_up_bars:
            left, top, w, h = normalized_rect_to_pixels(bar.rect, frame_w, frame_h)
            all_regions.append(("fill_up_bar", bar, bar.name, left, top, w, h))

        # Single batch capture for all regions
        if not all_regions:
            total_ms = (time.perf_counter() - t0) * 1000.0
            result = {
                "profile_name": parsed.name,
                "capture": {"monitor_index": parsed.capture.monitor_index, "tick_ms": parsed.capture.tick_ms},
                "frame": {"w": frame_w, "h": frame_h},
                "frame_source": frame_source,
                "total_ms": total_ms,
                "detectors": detectors_out,
                "output_dir": str(out_dir) if out_dir else None,
                "errors": errors,
            }
            return True, result, None

        cap0 = time.perf_counter()
        try:
            regions_only = [(l, t, w, h) for _, _, _, l, t, w, h in all_regions]
            captured_data = _crop_bgra_regions_from_hwc(frame_hwc, regions_only)
        except Exception as e:
            return False, None, f"batch capture failed: {e}"
        cap_ms = (time.perf_counter() - cap0) * 1000.0

        # Process all captured regions
        for (detector_type, detector_obj, name, left, top, req_w, req_h), item in zip(all_regions, captured_data):
            eval0 = time.perf_counter()
            raw, w, h = _as_captured_bgra(item, req_w, req_h)
            if len(raw) < w * h * 4:
                errors.append(f"{detector_type}:{name} crop too small ({len(raw)} bytes for {w}x{h})")
                continue

            if detector_type == "redness":
                roi = detector_obj
                score = float(redness_score_from_bgra(raw, w, h))
                hit = score >= float(parsed.redness_detector.min_score)
                eval_ms = (time.perf_counter() - eval0) * 1000.0

                detectors_out.append(
                    {
                        "type": "redness_rois",
                        "name": roi.name,
                        "rect_px": {"left": left, "top": top, "w": w, "h": h},
                        "score": score,
                        "threshold": float(parsed.redness_detector.min_score),
                        "hit": bool(hit),
                        "capture_ms": cap_ms,
                        "eval_ms": eval_ms,
                        "image_path": save_crop("redness", roi.name, raw, w, h),
                    }
                )

            elif detector_type == "color_vignette":
                roi = detector_obj
                cv = parsed.color_vignette_detector
                if cv is None:
                    continue
                score = float(
                    color_match_score_from_bgra(
                        raw,
                        w,
                        h,
                        target_rgb=cv.target.as_tuple(),
                        tolerance_l1=cv.tolerance_l1,
                    )
                )
                hit = score >= float(cv.min_score)
                eval_ms = (time.perf_counter() - eval0) * 1000.0

                detectors_out.append(
                    {
                        "type": "color_vignette",
                        "name": roi.name,
                        "rect_px": {"left": left, "top": top, "w": w, "h": h},
                        "score": score,
                        "threshold": float(cv.min_score),
                        "target_rgb": list(cv.target.as_tuple()),
                        "tolerance_l1": int(cv.tolerance_l1),
                        "hit": bool(hit),
                        "capture_ms": cap_ms,
                        "eval_ms": eval_ms,
                        "image_path": save_crop("color_vignette", roi.name, raw, w, h),
                    }
                )

            elif detector_type == "health_bar":
                hb = detector_obj
                percent_raw: Optional[float] = None
                mode = None
                if hb.color_sampling is not None:
                    mode = "color_sampling"
                    percent_raw = health_bar_percent_from_bgra(
                        raw,
                        w,
                        h,
                        filled_rgb=hb.color_sampling.filled.as_tuple(),
                        empty_rgb=hb.color_sampling.empty.as_tuple(),
                        tolerance_l1=hb.color_sampling.tolerance_l1,
                    )
                elif hb.threshold_fallback is not None:
                    mode = "threshold_fallback"
                    percent_raw = self._health_bar_percent_threshold_fallback(raw, w, h, hb.threshold_fallback)
                percent = float(max(0.0, min(1.0, float(percent_raw or 0.0))))
                eval_ms = (time.perf_counter() - eval0) * 1000.0

                detectors_out.append(
                    {
                        "type": "health_bar",
                        "name": hb.name,
                        "rect_px": {"left": left, "top": top, "w": w, "h": h},
                        "mode": mode,
                        "percent": percent,
                        "capture_ms": cap_ms,
                        "eval_ms": eval_ms,
                        "image_path": save_crop("health_bar", hb.name, raw, w, h),
                    }
                )

            elif detector_type in ("health_number", "ammo_number"):
                hn = detector_obj
                if uses_text_ocr_engine(getattr(hn, "engine", "templates")):
                    ocr_text = ""
                    try:
                        value, ocr_text = self._ammo_try_read_text_ocr(raw, w, h, hn)
                        ocr_err = None
                    except Exception as e:
                        value = None
                        ocr_err = str(e)
                    eval_ms = (time.perf_counter() - eval0) * 1000.0
                    logger.info(
                        "[screen_health_test] %s name=%s rect=%sx%s read=%s text=%r err=%s eval_ms=%.2f",
                        hn.engine,
                        hn.name,
                        w,
                        h,
                        value,
                        ocr_text,
                        ocr_err,
                        eval_ms,
                    )
                    out_row = {
                        "type": detector_type,
                        "name": hn.name,
                        "engine": hn.engine,
                        "rect_px": {"left": left, "top": top, "w": w, "h": h},
                        "read": int(value) if value is not None else None,
                        "ocr_text": ocr_text,
                        "error": ocr_err,
                        "capture_ms": cap_ms,
                        "eval_ms": eval_ms,
                        "image_path": save_crop(detector_type, hn.name, raw, w, h),
                    }
                    # Template matching needs a fixed digit count; text OCR is variable-width.
                    if str(getattr(hn, "engine", "")) == "templates":
                        out_row["digits"] = int(hn.digits)
                    detectors_out.append(out_row)
                else:
                    bits, bw, bh = binarize_bgra_to_bitmap(
                        raw,
                        w,
                        h,
                        threshold=hn.preprocess.threshold,
                        invert=hn.preprocess.invert,
                        scale=hn.preprocess.scale,
                    )
                    if detector_type == "ammo_number":
                        value = self._ammo_number_try_read_templates(bits, bw, bh, hn)
                    else:
                        value = self._health_number_try_read(bits, bw, bh, hn)
                    eval_ms = (time.perf_counter() - eval0) * 1000.0

                    detectors_out.append(
                        {
                            "type": detector_type,
                            "name": hn.name,
                            "engine": getattr(hn, "engine", "templates"),
                            "rect_px": {"left": left, "top": top, "w": w, "h": h},
                            "read": int(value) if value is not None else None,
                            "digits": int(hn.digits),
                            "hamming_max": int(hn.templates.hamming_max) if hn.templates else None,
                            "capture_ms": cap_ms,
                            "eval_ms": eval_ms,
                            "image_path": save_crop(detector_type, hn.name, raw, w, h),
                        }
                    )

            elif detector_type == "fill_up_bar":
                bar = detector_obj
                background_frac, fill_frac = self._evaluate_fill_up_bar(bar, raw, w, h)
                eval_ms = (time.perf_counter() - eval0) * 1000.0
                detectors_out.append(
                    {
                        "type": "fill_up_bar",
                        "name": bar.name,
                        "rect_px": {"left": left, "top": top, "w": w, "h": h},
                        "background_fraction": background_frac,
                        "fill_fraction": fill_frac,
                        # Back-compat alias for older UI labels
                        "percent": fill_frac,
                        "capture_ms": cap_ms,
                        "eval_ms": eval_ms,
                        "image_path": save_crop("fill_up_bar", bar.name, raw, w, h),
                    }
                )

        total_ms = (time.perf_counter() - t0) * 1000.0
        result = {
            "profile_name": parsed.name,
            "capture": {"monitor_index": parsed.capture.monitor_index, "tick_ms": parsed.capture.tick_ms},
            "frame": {"w": frame_w, "h": frame_h},
            "frame_source": frame_source,
            "total_ms": total_ms,
            "detectors": detectors_out,
            "output_dir": str(out_dir) if out_dir else None,
            "errors": errors,
        }
        return True, result, None

    # ---------------------------------------------------------------------
    # Internal
    # ---------------------------------------------------------------------

    def _emit_game_event(self, event_type: str, params: Dict[str, Any]) -> None:
        self.events_received += 1
        self.last_event_ts = time.time()
        if self._on_game_event:
            self._on_game_event(event_type, params)

    def _reset_runtime_state(self) -> None:
        # Stats
        self.events_received = 0
        self.last_event_ts = None
        self.last_hit_ts = None
        self.last_recoil_ts = None

        # Cooldowns
        self._last_hit_by_roi.clear()

        # Health bar state
        self._prev_health_percent_by_detector.clear()
        self._last_health_emit_by_detector.clear()
        self._last_health_percent_emitted.clear()

        # Health number OCR state
        self._health_number_candidate_value.clear()
        self._health_number_candidate_count.clear()
        self._prev_health_value_by_detector.clear()
        self._last_health_value_emitted.clear()

        self._prev_fill_up_background.clear()
        self._last_fill_up_recoil_ts.clear()

        # Debug runtime
        self._debug_tick = 0
        self._debug_saved_once.clear()

        self._last_batch_capture_fail_log_ts = 0.0
        self._batch_capture_fail_burst = False
        self._last_region_fail_log_ts = 0.0

    def _env_flag(self, name: str) -> bool:
        v = os.getenv(name)
        if v is None:
            return False
        return str(v).strip().lower() in ("1", "true", "yes", "on")

    def _configure_debug(self, cfg: Optional[ScreenHealthDebugConfig]) -> None:
        """
        Configure optional debug mode.

        Env vars:
        - THIRD_SPACE_SCREEN_HEALTH_DEBUG=1             => enable value logs
        - THIRD_SPACE_SCREEN_HEALTH_DEBUG_SAVE=1        => save ROI crops as .bmp
        - THIRD_SPACE_SCREEN_HEALTH_DEBUG_DIR=...       => output dir
        - THIRD_SPACE_SCREEN_HEALTH_DEBUG_EVERY_N=...   => log cadence (ticks)
        """

        self._debug_log_values = bool(cfg.log_values) if cfg else False
        self._debug_log_every_n_ticks = int(cfg.log_every_n_ticks) if cfg else 20
        self._debug_save_roi_images = bool(cfg.save_roi_images) if cfg else False
        save_dir = cfg.save_dir if cfg else None

        # Env overrides (useful in dev)
        if self._env_flag("THIRD_SPACE_SCREEN_HEALTH_DEBUG"):
            self._debug_log_values = True
        if self._env_flag("THIRD_SPACE_SCREEN_HEALTH_DEBUG_SAVE"):
            self._debug_save_roi_images = True
        every_n = os.getenv("THIRD_SPACE_SCREEN_HEALTH_DEBUG_EVERY_N")
        if every_n:
            try:
                self._debug_log_every_n_ticks = max(1, int(every_n))
            except Exception:
                pass
        env_dir = os.getenv("THIRD_SPACE_SCREEN_HEALTH_DEBUG_DIR")
        if env_dir:
            save_dir = env_dir

        self._debug_save_dir = Path(save_dir).expanduser().resolve() if save_dir else None
        if self._debug_save_roi_images and self._debug_save_dir is None:
            self._debug_save_dir = Path.cwd() / "screen_health_debug"

        if self._debug_save_roi_images and self._debug_save_dir is not None:
            try:
                self._debug_save_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                # Best-effort: disable saving if we can't create the dir.
                self._debug_save_roi_images = False
                self._debug_save_dir = None

        self._debug_emit_events = bool(self._debug_log_values or self._debug_save_roi_images)

        if self._debug_log_values:
            logger.info(
                "[screen_health] debug enabled: log_values=%s every_n=%s save_roi_images=%s dir=%s",
                self._debug_log_values,
                self._debug_log_every_n_ticks,
                self._debug_save_roi_images,
                str(self._debug_save_dir) if self._debug_save_dir else None,
            )

    def _write_bmp_bgra(self, path: Path, raw_bgra: bytes, width: int, height: int) -> None:
        """
        Write a simple uncompressed 32bpp BMP (top-down) from BGRA bytes.
        """
        if width <= 0 or height <= 0:
            raise ValueError("width/height must be > 0")
        expected = width * height * 4
        if len(raw_bgra) < expected:
            raise ValueError("raw_bgra is smaller than expected for BGRA frame")

        pixel_bytes = width * height * 4
        file_header_size = 14
        dib_header_size = 40
        off_bits = file_header_size + dib_header_size
        file_size = off_bits + pixel_bytes

        # BITMAPFILEHEADER
        bf = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, off_bits)
        # BITMAPINFOHEADER (negative height => top-down)
        bi = struct.pack(
            "<IiiHHIIiiII",
            dib_header_size,
            int(width),
            int(-height),
            1,  # planes
            32,  # bpp
            0,  # BI_RGB
            pixel_bytes,
            0,
            0,
            0,
            0,
        )
        path.write_bytes(bf + bi + raw_bgra[:expected])

    def _safe_file_part(self, s: str) -> str:
        out = []
        for ch in s:
            if ch.isalnum() or ch in ("-", "_"):
                out.append(ch)
            else:
                out.append("_")
        return "".join(out).strip("_") or "unnamed"

    def _debug_maybe_save_roi(
        self,
        *,
        key: str,
        kind: str,
        name: str,
        raw_bgra: bytes,
        width: int,
        height: int,
        extra: Dict[str, Any],
        force: bool = False,
    ) -> Optional[str]:
        """
        Best-effort saving of ROI crops when debug.save_roi_images is enabled.

        Returns saved filename (basename) if saved; otherwise None.
        """
        if not self._debug_save_roi_images or self._debug_save_dir is None:
            return None

        if not force and key in self._debug_saved_once:
            return None

        ts_ms = int(time.time() * 1000.0)
        fname = f"{ts_ms}_{self._safe_file_part(kind)}_{self._safe_file_part(name)}_{width}x{height}.bmp"
        path = self._debug_save_dir / fname
        try:
            self._write_bmp_bgra(path, raw_bgra, width, height)
            self._debug_saved_once.add(key)
            logger.info("[screen_health] saved roi kind=%s name=%s file=%s extra=%s", kind, name, fname, extra)
            if self._debug_emit_events:
                self._emit_game_event(
                    "debug",
                    {
                        "kind": "roi_saved",
                        "detector": name,
                        "detector_kind": kind,
                        "saved_filename": fname,
                        "saved_dir": str(self._debug_save_dir) if self._debug_save_dir else None,
                        "extra": extra,
                    },
                )
            return fname
        except Exception as e:
            logger.warning("[screen_health] failed to save roi kind=%s name=%s err=%s", kind, name, str(e))
            return None

    def _log_region_fail(self, detector_type: str, name: str, err: BaseException) -> None:
        now = time.time()
        if now - self._last_region_fail_log_ts >= self._BATCH_CAPTURE_FAIL_LOG_INTERVAL_S:
            logger.error("[screen_health] %s detector=%s failed: %s", detector_type, name, err)
            self._last_region_fail_log_ts = now
        else:
            logger.debug("[screen_health] %s detector=%s failed (throttled): %s", detector_type, name, err)

    def _trigger_hit(self, intensity: float) -> None:
        """Trigger a Phase A random-cell haptic."""
        if not self._on_trigger:
            return
        # Map intensity [0,1] -> speed [1,10]
        speed = max(1, min(10, int(round(1 + intensity * 9))))
        cell = int(random.choice(list(ALL_CELLS)))
        self._on_trigger(cell, speed)

    def _trigger_recoil(self, duration_ms: int) -> None:
        """Pulse USB relay / solenoid (no vest)."""
        if not self._on_recoil:
            return
        self.last_recoil_ts = time.time()
        self._on_recoil(int(duration_ms))

    def _evaluate_fill_up_bar(
        self, bar: FillUpBarDetector, raw_bgra: bytes, width: int, height: int
    ) -> Tuple[float, float]:
        background_frac = background_coverage_from_bgra(
            raw_bgra,
            width,
            height,
            background_rgb=bar.background.as_tuple(),
            tolerance_l1=bar.tolerance_l1,
        )
        fill_frac = max(0.0, min(1.0, 1.0 - float(background_frac)))
        return float(background_frac), float(fill_frac)

    def _tick_fill_up_recoil(
        self,
        bar: FillUpBarDetector,
        background_frac: float,
        now: float,
    ) -> Optional[Dict[str, Any]]:
        """Pulse when background coverage drops (bar fills with white or red)."""
        key = bar.name
        prev = self._prev_fill_up_background.get(key)
        last_ts = self._last_fill_up_recoil_ts.get(key, 0.0)

        if prev is None:
            self._prev_fill_up_background[key] = background_frac
            return None

        # Background grew again (cooldown / emptying) — track, no pulse.
        if background_frac + 0.005 >= prev:
            # Small noise upward or flat: keep highest recent background only if rising a lot
            if background_frac > prev:
                self._prev_fill_up_background[key] = background_frac
            return None

        drop = prev - background_frac
        if drop < float(bar.min_background_drop):
            return None
        if (now - last_ts) * 1000.0 < float(bar.cooldown_ms):
            # Still track fill progress so we don't catch-fire after cooldown.
            self._prev_fill_up_background[key] = background_frac
            return None

        self._prev_fill_up_background[key] = background_frac
        self._last_fill_up_recoil_ts[key] = now
        fill_frac = max(0.0, min(1.0, 1.0 - background_frac))
        return {
            "roi": bar.name,
            "source": "fill_up_bar",
            "background_fraction": background_frac,
            "prev_background_fraction": prev,
            "background_drop": drop,
            "fill_fraction": fill_frac,
            "percent": fill_frac,
            "duration_ms": int(bar.duration_ms),
        }

    def _run_loop(self) -> None:
        assert self._profile is not None
        profile = self._profile

        # Lazily create capture backend so imports do not break tests.
        capture = _create_capture_backend(monitor_index=profile.capture.monitor_index)

        tick_s = max(0.01, profile.capture.tick_ms / 1000.0)

        while not self._stop_evt.is_set():
            loop_start = time.time()
            self._debug_tick += 1
            should_periodic_log = self._debug_log_values and (self._debug_tick % self._debug_log_every_n_ticks == 0)

            try:
                frame_w, frame_h = capture.get_frame_size()
            except Exception:
                # If capture isn't available (missing deps / wrong OS), back off.
                time.sleep(0.5)
                continue

            # Collect all regions to capture in a single batch
            # Format: (detector_type, detector_obj, name, left, top, width, height)
            all_regions: List[Tuple[str, Any, str, int, int, int, int]] = []

            # Redness ROIs (Phase A)
            if profile.redness_detector is not None:
                for roi in profile.redness_rois:
                    if self._stop_evt.is_set():
                        break
                    left, top, w, h = normalized_rect_to_pixels(roi.rect, frame_w, frame_h)
                    all_regions.append(("redness", roi, roi.name, left, top, w, h))

            if profile.color_vignette_detector is not None:
                for roi in profile.color_vignette_rois:
                    if self._stop_evt.is_set():
                        break
                    left, top, w, h = normalized_rect_to_pixels(roi.rect, frame_w, frame_h)
                    all_regions.append(("color_vignette", roi, roi.name, left, top, w, h))

            # Health bars (Phase C)
            for hb in profile.health_bars:
                if self._stop_evt.is_set():
                    break
                left, top, w, h = normalized_rect_to_pixels(hb.rect, frame_w, frame_h)
                all_regions.append(("health_bar", hb, hb.name, left, top, w, h))

            # Health numbers (Phase D)
            for hn in profile.health_numbers:
                if self._stop_evt.is_set():
                    break
                if not uses_text_ocr_engine(getattr(hn, "engine", "templates")) and hn.templates is None:
                    continue
                left, top, w, h = normalized_rect_to_pixels(hn.rect, frame_w, frame_h)
                all_regions.append(("health_number", hn, hn.name, left, top, w, h))

            # Ammo numbers → solenoid recoil (independent channel)
            for an in profile.ammo_numbers:
                if self._stop_evt.is_set():
                    break
                if an.engine == "templates" and an.templates is None:
                    continue
                left, top, w, h = normalized_rect_to_pixels(an.rect, frame_w, frame_h)
                all_regions.append(("ammo_number", an, an.name, left, top, w, h))

            for bar in profile.fill_up_bars:
                if self._stop_evt.is_set():
                    break
                left, top, w, h = normalized_rect_to_pixels(bar.rect, frame_w, frame_h)
                all_regions.append(("fill_up_bar", bar, bar.name, left, top, w, h))

            # Single batch capture for all regions
            if not all_regions:
                elapsed = time.time() - loop_start
                sleep_for = tick_s - elapsed
                if sleep_for > 0:
                    time.sleep(sleep_for)
                continue

            try:
                regions_only = [(l, t, w, h) for _, _, _, l, t, w, h in all_regions]
                captured_data = capture.capture_multiple_bgra(regions_only)
            except Exception as e:
                now = time.time()
                if now - self._last_batch_capture_fail_log_ts >= self._BATCH_CAPTURE_FAIL_LOG_INTERVAL_S:
                    logger.error("[screen_health] Batch capture failed: %s", e)
                    self._last_batch_capture_fail_log_ts = now
                else:
                    logger.debug("[screen_health] Batch capture failed (throttled): %s", e)
                self._batch_capture_fail_burst = True
                elapsed = time.time() - loop_start
                sleep_for = tick_s - elapsed
                if sleep_for > 0:
                    time.sleep(sleep_for)
                continue

            if self._batch_capture_fail_burst:
                logger.info("[screen_health] Batch capture recovered")
                self._batch_capture_fail_burst = False

            # Process all captured regions
            for (detector_type, detector_obj, name, left, top, req_w, req_h), item in zip(
                all_regions, captured_data
            ):
                if self._stop_evt.is_set():
                    break
                raw_bgra, w, h = _as_captured_bgra(item, req_w, req_h)
                if len(raw_bgra) < w * h * 4:
                    self._log_region_fail(
                        detector_type,
                        name,
                        ValueError(
                            f"BGRA crop too small: {len(raw_bgra)} bytes for {w}x{h} "
                            f"(requested {req_w}x{req_h})"
                        ),
                    )
                    continue

                # Redness ROIs (Phase A)
                if detector_type == "redness":
                    roi = detector_obj
                    try:
                        score = redness_score_from_bgra(raw_bgra, w, h)
                    except Exception as e:
                        self._log_region_fail(detector_type, name, e)
                        continue
                    if should_periodic_log:
                        logger.info(
                            "[screen_health] redness roi=%s score=%.4f thr=%.4f",
                            roi.name,
                            float(score),
                            float(profile.redness_detector.min_score),
                        )
                        if self._debug_emit_events:
                            self._emit_game_event(
                                "debug",
                                {
                                    "kind": "redness_score",
                                    "detector": roi.name,
                                    "score": float(score),
                                    "threshold": float(profile.redness_detector.min_score),
                                },
                            )

                    # Save one example crop per ROI to ease calibration.
                    self._debug_maybe_save_roi(
                        key=f"redness_once:{roi.name}",
                        kind="redness_rois",
                        name=roi.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"score": float(score)},
                        force=False,
                    )
                    if score < profile.redness_detector.min_score:
                        continue

                    now = time.time()
                    key = f"redness:{roi.name}"
                    last = self._last_hit_by_roi.get(key, 0.0)
                    if (now - last) * 1000.0 < profile.redness_detector.cooldown_ms:
                        continue

                    self._last_hit_by_roi[key] = now
                    self.last_hit_ts = now

                    saved = self._debug_maybe_save_roi(
                        key=f"redness_hit:{roi.name}",
                        kind="redness_rois_hit",
                        name=roi.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"score": float(score)},
                        force=True,
                    )
                    if self._debug_log_values:
                        logger.info(
                            "[screen_health] HIT redness roi=%s score=%.4f cooldown_ms=%s saved=%s",
                            roi.name,
                            float(score),
                            int(profile.redness_detector.cooldown_ms),
                            saved,
                        )

                    self._emit_game_event(
                        "hit_recorded",
                        {
                            "roi": roi.name,
                            "direction": roi.direction.value if roi.direction else None,
                            "score": score,
                            "source": "redness_rois",
                        },
                    )
                    self._trigger_hit(intensity=score)

                elif detector_type == "color_vignette":
                    roi = detector_obj
                    cv = profile.color_vignette_detector
                    if cv is None:
                        continue
                    try:
                        score = color_match_score_from_bgra(
                            raw_bgra,
                            w,
                            h,
                            target_rgb=cv.target.as_tuple(),
                            tolerance_l1=cv.tolerance_l1,
                        )
                    except Exception as e:
                        self._log_region_fail(detector_type, name, e)
                        continue
                    if should_periodic_log:
                        logger.info(
                            "[screen_health] color_vignette roi=%s score=%.4f thr=%.4f target=%s",
                            roi.name,
                            float(score),
                            float(cv.min_score),
                            cv.target.as_tuple(),
                        )
                        if self._debug_emit_events:
                            self._emit_game_event(
                                "debug",
                                {
                                    "kind": "color_vignette_score",
                                    "detector": roi.name,
                                    "score": float(score),
                                    "threshold": float(cv.min_score),
                                    "target_rgb": list(cv.target.as_tuple()),
                                },
                            )

                    self._debug_maybe_save_roi(
                        key=f"color_vignette_once:{roi.name}",
                        kind="color_vignette",
                        name=roi.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"score": float(score)},
                        force=False,
                    )
                    if score < cv.min_score:
                        continue

                    now = time.time()
                    key = f"color_vignette:{roi.name}"
                    last = self._last_hit_by_roi.get(key, 0.0)
                    if (now - last) * 1000.0 < cv.cooldown_ms:
                        continue

                    self._last_hit_by_roi[key] = now
                    self.last_hit_ts = now

                    saved = self._debug_maybe_save_roi(
                        key=f"color_vignette_hit:{roi.name}",
                        kind="color_vignette_hit",
                        name=roi.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"score": float(score)},
                        force=True,
                    )
                    if self._debug_log_values:
                        logger.info(
                            "[screen_health] HIT color_vignette roi=%s score=%.4f cooldown_ms=%s saved=%s",
                            roi.name,
                            float(score),
                            int(cv.cooldown_ms),
                            saved,
                        )

                    self._emit_game_event(
                        "hit_recorded",
                        {
                            "roi": roi.name,
                            "direction": roi.direction.value if roi.direction else None,
                            "score": score,
                            "source": "color_vignette",
                            "target_rgb": list(cv.target.as_tuple()),
                        },
                    )
                    self._trigger_hit(intensity=score)

                # Health bar (Phase C)
                elif detector_type == "health_bar":
                    hb = detector_obj
                    percent_raw: Optional[float] = None
                    try:
                        if hb.color_sampling is not None:
                            percent_raw = health_bar_percent_from_bgra(
                                raw_bgra,
                                w,
                                h,
                                filled_rgb=hb.color_sampling.filled.as_tuple(),
                                empty_rgb=hb.color_sampling.empty.as_tuple(),
                                tolerance_l1=hb.color_sampling.tolerance_l1,
                            )
                        elif hb.threshold_fallback is not None:
                            percent_raw = self._health_bar_percent_threshold_fallback(
                                raw_bgra, w, h, hb.threshold_fallback
                            )
                    except Exception as e:
                        self._log_region_fail(detector_type, name, e)
                        continue

                    if percent_raw is None:
                        continue

                    # Clamp for safety
                    percent = max(0.0, min(1.0, float(percent_raw)))
                    if should_periodic_log:
                        logger.info("[screen_health] health_bar detector=%s percent=%.4f", hb.name, float(percent))
                        if self._debug_emit_events:
                            self._emit_game_event(
                                "debug",
                                {
                                    "kind": "health_bar_percent",
                                    "detector": hb.name,
                                    "percent": float(percent),
                                },
                            )

                    # Save one example crop per detector to ease calibration.
                    self._debug_maybe_save_roi(
                        key=f"health_bar_once:{hb.name}",
                        kind="health_bar",
                        name=hb.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"percent": float(percent)},
                        force=False,
                    )

                    # Emit health_percent (throttled)
                    now = time.time()
                    last_emit = self._last_health_emit_by_detector.get(hb.name, 0.0)
                    last_val = self._last_health_percent_emitted.get(hb.name)
                    should_emit = False
                    if last_val is None:
                        should_emit = True
                    elif abs(percent - last_val) >= 0.005:
                        should_emit = True
                    elif (now - last_emit) * 1000.0 >= 500.0:
                        should_emit = True

                    if should_emit:
                        self._last_health_emit_by_detector[hb.name] = now
                        self._last_health_percent_emitted[hb.name] = percent
                        self._emit_game_event(
                            "health_percent",
                            {
                                "detector": hb.name,
                                "percent": percent,
                            },
                        )

                    # Hit on decrease
                    prev = self._prev_health_percent_by_detector.get(hb.name)
                    self._prev_health_percent_by_detector[hb.name] = percent
                    if prev is None:
                        continue

                    drop = float(prev) - float(percent)
                    if drop < hb.hit_on_decrease.min_drop:
                        continue

                    key = f"health_bar:{hb.name}"
                    last_hit = self._last_hit_by_roi.get(key, 0.0)
                    if (now - last_hit) * 1000.0 < hb.hit_on_decrease.cooldown_ms:
                        continue

                    self._last_hit_by_roi[key] = now
                    self.last_hit_ts = now

                    saved = self._debug_maybe_save_roi(
                        key=f"health_bar_hit:{hb.name}",
                        kind="health_bar_hit",
                        name=hb.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"percent": float(percent), "prev_percent": float(prev), "drop": float(drop)},
                        force=True,
                    )
                    if self._debug_log_values:
                        logger.info(
                            "[screen_health] HIT health_bar detector=%s prev=%.4f now=%.4f drop=%.4f saved=%s",
                            hb.name,
                            float(prev),
                            float(percent),
                            float(drop),
                            saved,
                        )

                    self._emit_game_event(
                        "hit_recorded",
                        {
                            "roi": hb.name,
                            "direction": None,
                            "score": max(0.0, min(1.0, drop)),
                            "source": "health_bar",
                            "percent": percent,
                            "prev_percent": float(prev),
                            "drop": drop,
                        },
                    )
                    # Map intensity to drop, but keep within [0,1]
                    self._trigger_hit(intensity=max(0.0, min(1.0, drop)))

                # Health / ammo number OCR (Phase D + recoil)
                elif detector_type in ("health_number", "ammo_number"):
                    hn = detector_obj
                    is_ammo = detector_type == "ammo_number"
                    if uses_text_ocr_engine(getattr(hn, "engine", "templates")):
                        try:
                            value, ocr_text = self._ammo_try_read_text_ocr(raw_bgra, w, h, hn)
                            if value is None and should_periodic_log:
                                logger.info(
                                    "[screen_health] %s no-read detector=%s size=%sx%s text=%r",
                                    hn.engine,
                                    hn.name,
                                    w,
                                    h,
                                    ocr_text,
                                )
                        except Exception as e:
                            if should_periodic_log:
                                logger.warning(
                                    "[screen_health] %s failed detector=%s err=%s",
                                    hn.engine,
                                    hn.name,
                                    e,
                                )
                            continue
                    else:
                        bits, bw, bh = binarize_bgra_to_bitmap(
                            raw_bgra,
                            w,
                            h,
                            threshold=hn.preprocess.threshold,
                            invert=hn.preprocess.invert,
                            scale=hn.preprocess.scale,
                        )
                        if is_ammo:
                            value = self._ammo_number_try_read_templates(bits, bw, bh, hn)
                        else:
                            value = self._health_number_try_read(bits, bw, bh, hn)
                    if should_periodic_log:
                        logger.info(
                            "[screen_health] health_number detector=%s read=%s stable_reads=%s",
                            hn.name,
                            value,
                            int(hn.readout.stable_reads),
                        )
                        if self._debug_emit_events:
                            self._emit_game_event(
                                "debug",
                                {
                                    "kind": "health_number_read",
                                    "detector": hn.name,
                                    "read": int(value) if value is not None else None,
                                    "stable_reads": int(hn.readout.stable_reads),
                                },
                            )

                    # Save one example crop per detector to ease calibration.
                    self._debug_maybe_save_roi(
                        key=f"health_number_once:{hn.name}",
                        kind="health_number",
                        name=hn.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"read": value},
                        force=False,
                    )
                    if value is None:
                        continue

                    # Stability filtering: require stable_reads consecutive identical reads.
                    cand = self._health_number_candidate_value.get(hn.name)
                    if cand is None or cand != value:
                        self._health_number_candidate_value[hn.name] = value
                        self._health_number_candidate_count[hn.name] = 1
                        if should_periodic_log:
                            logger.info(
                                "[screen_health] health_number detector=%s candidate=%s count=1/%s",
                                hn.name,
                                value,
                                int(hn.readout.stable_reads),
                            )
                        continue

                    self._health_number_candidate_count[hn.name] = self._health_number_candidate_count.get(hn.name, 1) + 1
                    if self._health_number_candidate_count[hn.name] < hn.readout.stable_reads:
                        if should_periodic_log:
                            logger.info(
                                "[screen_health] health_number detector=%s candidate=%s count=%s/%s",
                                hn.name,
                                value,
                                int(self._health_number_candidate_count[hn.name]),
                                int(hn.readout.stable_reads),
                            )
                        continue

                    # Only emit if it changed (or hasn't been emitted yet)
                    last_emitted = self._last_health_value_emitted.get(hn.name)
                    if last_emitted is None or last_emitted != value:
                        self._last_health_value_emitted[hn.name] = value
                        self._emit_game_event(
                            "ammo_value" if is_ammo else "health_value",
                            {
                                "detector": hn.name,
                                "value": value,
                            },
                        )

                    # Hit on decrease (integer)
                    prev_val = self._prev_health_value_by_detector.get(hn.name)
                    self._prev_health_value_by_detector[hn.name] = value
                    if prev_val is None:
                        continue

                    drop_i = int(prev_val) - int(value)
                    if drop_i < hn.hit_on_decrease.min_drop:
                        continue

                    now = time.time()
                    key = f"{'ammo_number' if is_ammo else 'health_number'}:{hn.name}"
                    last_hit = self._last_hit_by_roi.get(key, 0.0)
                    if (now - last_hit) * 1000.0 < hn.hit_on_decrease.cooldown_ms:
                        continue

                    self._last_hit_by_roi[key] = now
                    if is_ammo:
                        self.last_recoil_ts = now
                    else:
                        self.last_hit_ts = now

                    saved = self._debug_maybe_save_roi(
                        key=f"{'ammo_number' if is_ammo else 'health_number'}_hit:{hn.name}",
                        kind="ammo_number_hit" if is_ammo else "health_number_hit",
                        name=hn.name,
                        raw_bgra=raw_bgra,
                        width=w,
                        height=h,
                        extra={"value": int(value), "prev_value": int(prev_val), "drop": int(drop_i)},
                        force=True,
                    )
                    if self._debug_log_values:
                        logger.info(
                            "[screen_health] %s detector=%s prev=%s now=%s drop=%s saved=%s",
                            "RECOIL ammo_number" if is_ammo else "HIT health_number",
                            hn.name,
                            int(prev_val),
                            int(value),
                            int(drop_i),
                            saved,
                        )

                    if is_ammo:
                        self._emit_game_event(
                            "recoil_fired",
                            {
                                "roi": hn.name,
                                "source": "ammo_number",
                                "value": value,
                                "prev_value": int(prev_val),
                                "drop": drop_i,
                                "duration_ms": int(profile.recoil_duration_ms),
                            },
                        )
                        self._trigger_recoil(profile.recoil_duration_ms)
                    else:
                        self._emit_game_event(
                            "hit_recorded",
                            {
                                "roi": hn.name,
                                "direction": None,
                                "score": max(0.0, min(1.0, float(drop_i) / 25.0)),
                                "source": "health_number",
                                "value": value,
                                "prev_value": int(prev_val),
                                "drop": drop_i,
                            },
                        )
                        self._trigger_hit(intensity=max(0.0, min(1.0, float(drop_i) / 25.0)))

                elif detector_type == "fill_up_bar":
                    bar = detector_obj
                    try:
                        background_frac, fill_frac = self._evaluate_fill_up_bar(
                            bar, raw_bgra, w, h
                        )
                    except Exception as e:
                        self._log_region_fail(detector_type, name, e)
                        continue

                    now = time.time()
                    if should_periodic_log:
                        logger.info(
                            "[screen_health] fill_up_bar detector=%s background=%.3f fill=%.3f",
                            bar.name,
                            background_frac,
                            fill_frac,
                        )
                        if self._debug_emit_events:
                            self._emit_game_event(
                                "debug",
                                {
                                    "kind": "fill_up_bar",
                                    "detector": bar.name,
                                    "background_fraction": background_frac,
                                    "fill_fraction": fill_frac,
                                    "percent": fill_frac,
                                },
                            )

                    shot = self._tick_fill_up_recoil(bar, background_frac, now)
                    if shot:
                        self._emit_game_event("recoil_fired", shot)
                        self._trigger_recoil(bar.duration_ms)

            elapsed = time.time() - loop_start
            sleep_for = tick_s - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)

    def _parse_profile(self, profile: Dict[str, Any] | str) -> ScreenHealthProfile:
        data: Dict[str, Any]
        if isinstance(profile, str):
            data = json.loads(profile)
        elif isinstance(profile, dict):
            data = profile
        else:
            raise ValueError("profile must be dict or JSON string")

        schema_version = int(data.get("schema_version", 0))
        name = str(data.get("name") or "Unnamed Profile")

        capture_data = data.get("capture") or {}
        capture = ScreenCaptureConfig(
            monitor_index=int(capture_data.get("monitor_index", 1)),
            tick_ms=int(capture_data.get("tick_ms", 50)),
        )
        if capture.tick_ms <= 0:
            raise ValueError("capture.tick_ms must be > 0")

        debug_cfg: Optional[ScreenHealthDebugConfig] = None
        debug_data = data.get("debug")
        if debug_data is not None:
            if not isinstance(debug_data, dict):
                raise ValueError("profile.debug must be an object")
            debug_cfg = ScreenHealthDebugConfig(
                log_values=bool(debug_data.get("log_values", False)),
                log_every_n_ticks=int(debug_data.get("log_every_n_ticks", 20)),
                save_roi_images=bool(debug_data.get("save_roi_images", False)),
                save_dir=(str(debug_data.get("save_dir")) if debug_data.get("save_dir") else None),
            )
            debug_cfg.validate()

        detectors = data.get("detectors") or []
        if not isinstance(detectors, list):
            raise ValueError("profile.detectors must be a list")

        redness_detector: Optional[RednessDetectorConfig] = None
        redness_rois: List[RednessROI] = []
        color_vignette_detector: Optional[ColorVignetteDetectorConfig] = None
        color_vignette_rois: List[RednessROI] = []
        health_bars: List[HealthBarDetector] = []
        health_numbers: List[HealthNumberDetector] = []

        # Parse detectors (schema_version 0 extensions)
        for d in detectors:
            if not isinstance(d, dict):
                continue
            d_type = d.get("type")
            if d_type == "redness_rois":
                threshold = d.get("threshold") or {}
                detector = RednessDetectorConfig(
                    min_score=float(threshold.get("min_score", 0.35)),
                    cooldown_ms=int(d.get("cooldown_ms", 200)),
                )
                if detector.cooldown_ms < 0:
                    raise ValueError("detector.cooldown_ms must be >= 0")
                if not (0.0 <= detector.min_score <= 1.0):
                    raise ValueError("threshold.min_score must be in [0,1]")

                rois_data = d.get("rois") or d.get("zones") or []
                if not isinstance(rois_data, list) or not rois_data:
                    continue

                parsed_rois = _parse_vignette_rois(rois_data)
                if not parsed_rois:
                    continue
                redness_detector = detector
                redness_rois = parsed_rois
                continue

            if d_type == "color_vignette":
                threshold = d.get("threshold") or {}
                target_raw = d.get("target_rgb") or d.get("color_rgb") or d.get("target")
                if not isinstance(target_raw, (list, tuple)) or len(target_raw) != 3:
                    raise ValueError("color_vignette.target_rgb must be [r, g, b]")
                cv = ColorVignetteDetectorConfig(
                    target=RGB(int(target_raw[0]), int(target_raw[1]), int(target_raw[2])),
                    tolerance_l1=int(d.get("tolerance_l1", 120)),
                    min_score=float(threshold.get("min_score", 0.35)),
                    cooldown_ms=int(d.get("cooldown_ms", 200)),
                )
                cv.validate()

                rois_data = d.get("rois") or d.get("zones") or []
                if not isinstance(rois_data, list) or not rois_data:
                    continue

                parsed_cv_rois = _parse_vignette_rois(rois_data)
                if not parsed_cv_rois:
                    continue
                color_vignette_detector = cv
                color_vignette_rois = parsed_cv_rois
                continue

            if d_type == "health_bar":
                name_raw = d.get("name") or "health_bar"
                name = str(name_raw)

                roi = d.get("roi")
                if not isinstance(roi, dict):
                    raise ValueError("health_bar.roi is required")
                rect = NormalizedRect(
                    x=float(roi.get("x", 0)),
                    y=float(roi.get("y", 0)),
                    w=float(roi.get("w", 0)),
                    h=float(roi.get("h", 0)),
                )
                rect.validate()

                orientation = str(d.get("orientation") or "horizontal")
                if orientation != "horizontal":
                    raise ValueError("health_bar.orientation must be 'horizontal' (Phase C)")

                color_sampling_data = d.get("color_sampling")
                color_sampling: Optional[HealthBarColorSampling] = None
                if isinstance(color_sampling_data, dict):
                    filled_arr = color_sampling_data.get("filled_rgb")
                    empty_arr = color_sampling_data.get("empty_rgb")
                    if (
                        isinstance(filled_arr, list)
                        and len(filled_arr) == 3
                        and isinstance(empty_arr, list)
                        and len(empty_arr) == 3
                    ):
                        filled = RGB(int(filled_arr[0]), int(filled_arr[1]), int(filled_arr[2]))
                        empty = RGB(int(empty_arr[0]), int(empty_arr[1]), int(empty_arr[2]))
                        color_sampling = HealthBarColorSampling(
                            filled=filled,
                            empty=empty,
                            tolerance_l1=int(color_sampling_data.get("tolerance_l1", 120)),
                        )
                        color_sampling.validate()

                threshold_fallback_data = d.get("threshold_fallback")
                threshold_fallback: Optional[HealthBarThresholdFallback] = None
                if isinstance(threshold_fallback_data, dict):
                    threshold_fallback = HealthBarThresholdFallback(
                        mode=str(threshold_fallback_data.get("mode") or "brightness"),
                        min_value=float(threshold_fallback_data.get("min", 0.5)),
                    )
                    threshold_fallback.validate()

                hit_on_decrease_data = d.get("hit_on_decrease")
                if not isinstance(hit_on_decrease_data, dict):
                    raise ValueError("health_bar.hit_on_decrease is required")
                hit_on_decrease = HealthBarHitOnDecrease(
                    min_drop=float(hit_on_decrease_data.get("min_drop", 0.02)),
                    cooldown_ms=int(hit_on_decrease_data.get("cooldown_ms", 150)),
                )
                hit_on_decrease.validate()

                hb = HealthBarDetector(
                    name=name,
                    rect=rect,
                    orientation=orientation,
                    color_sampling=color_sampling,
                    threshold_fallback=threshold_fallback,
                    hit_on_decrease=hit_on_decrease,
                )
                hb.validate()
                health_bars.append(hb)
                continue

            if d_type == "health_number":
                health_numbers.append(self._parse_health_number_detector(d))
                continue

        ammo_numbers: List[HealthNumberDetector] = []
        fill_up_bars: List[FillUpBarDetector] = []
        recoil_duration_ms = 40
        recoil_data = data.get("recoil")
        recoil_type = str(recoil_data.get("type") or "") if isinstance(recoil_data, dict) else ""
        if recoil_type == "ammo_number":
            recoil_duration_ms = max(1, int(recoil_data.get("duration_ms", 40)))
            # Prefer recoil.zones[] (dual-wield / multi gun). Legacy single roi still works.
            zones_raw = recoil_data.get("zones")
            zone_specs: List[Dict[str, Any]] = []
            if isinstance(zones_raw, list) and zones_raw:
                for idx, zone in enumerate(zones_raw):
                    if not isinstance(zone, dict):
                        continue
                    zone_roi = zone.get("roi")
                    if not isinstance(zone_roi, dict):
                        raise ValueError(f"recoil.zones[{idx}].roi is required")
                    zone_specs.append(
                        {
                            "name": str(zone.get("name") or f"ammo_{idx + 1}"),
                            "roi": zone_roi,
                        }
                    )
                if not zone_specs:
                    raise ValueError("recoil.zones must contain at least one valid zone")
            elif isinstance(recoil_data.get("roi"), dict):
                zone_specs.append(
                    {
                        "name": str(recoil_data.get("name") or "ammo_number"),
                        "roi": recoil_data["roi"],
                    }
                )
            else:
                raise ValueError("recoil.ammo_number requires roi or zones[]")

            used_names: set[str] = set()
            for idx, zone in enumerate(zone_specs):
                ammo_dict = dict(recoil_data)
                ammo_dict.pop("zones", None)
                ammo_dict["type"] = "health_number"
                ammo_dict["roi"] = zone["roi"]
                base_name = str(zone["name"] or f"ammo_{idx + 1}").strip() or f"ammo_{idx + 1}"
                name = base_name
                suffix = 2
                while name in used_names:
                    name = f"{base_name}_{suffix}"
                    suffix += 1
                used_names.add(name)
                ammo_dict["name"] = name
                # Default: follow the daemon-wide OCR engine (Daemon Settings page)
                if "engine" not in ammo_dict:
                    ammo_dict["engine"] = PROFILE_OCR_DAEMON
                engine_name = str(ammo_dict.get("engine") or PROFILE_OCR_DAEMON)
                allowed_ammo = ("templates", PROFILE_OCR_DAEMON) + TEXT_OCR_ENGINES
                if engine_name not in allowed_ammo:
                    raise ValueError(f"recoil.engine must be one of {allowed_ammo}")
                # Variable-width ammo (1–3); keep schema digits field as an upper bound only
                if uses_text_ocr_engine(engine_name):
                    ammo_dict["digits"] = 3
                    readout = ammo_dict.get("readout") if isinstance(ammo_dict.get("readout"), dict) else {}
                    ammo_dict["readout"] = {
                        "min": 0,
                        "max": 999,
                        "stable_reads": int(readout.get("stable_reads", 2)),
                    }
                ammo_numbers.append(self._parse_health_number_detector(ammo_dict))
        elif recoil_type == "fill_up_bar":
            bar = self._parse_fill_up_bar_detector(recoil_data)
            fill_up_bars.append(bar)
            recoil_duration_ms = bar.duration_ms

        if (
            redness_detector is None
            and color_vignette_detector is None
            and not health_bars
            and not health_numbers
            and not ammo_numbers
            and not fill_up_bars
        ):
            raise ValueError("profile must include a hit detector or ammo recoil")

        return ScreenHealthProfile(
            schema_version=schema_version,
            name=name,
            capture=capture,
            redness_rois=redness_rois,
            redness_detector=redness_detector,
            health_bars=health_bars,
            health_numbers=health_numbers,
            ammo_numbers=ammo_numbers,
            fill_up_bars=fill_up_bars,
            color_vignette_rois=color_vignette_rois,
            color_vignette_detector=color_vignette_detector,
            recoil_duration_ms=recoil_duration_ms,
            debug=debug_cfg,
        )

    def _parse_fill_up_bar_detector(self, d: Dict[str, Any]) -> FillUpBarDetector:
        roi = d.get("roi")
        if not isinstance(roi, dict):
            raise ValueError("fill_up_bar.roi is required")
        rect = NormalizedRect(
            x=float(roi.get("x", 0)),
            y=float(roi.get("y", 0)),
            w=float(roi.get("w", 0)),
            h=float(roi.get("h", 0)),
        )
        colors = d.get("color_sampling") if isinstance(d.get("color_sampling"), dict) else d
        # Prefer background_rgb; accept empty_rgb from older profiles.
        bg_raw = colors.get("background_rgb", colors.get("empty_rgb"))
        background = _rgb_from_list(bg_raw, (40, 40, 45), "fill_up_bar.background_rgb")
        fill_up = d.get("fill_up") if isinstance(d.get("fill_up"), dict) else {}
        # Prefer min_background_drop; accept min_rise from older profiles.
        min_drop = fill_up.get(
            "min_background_drop",
            fill_up.get("min_rise", d.get("min_background_drop", d.get("min_rise", 0.03))),
        )
        bar = FillUpBarDetector(
            name=str(d.get("name") or "fill_up_bar"),
            rect=rect,
            background=background,
            # Higher default helps translucent HUD backgrounds.
            tolerance_l1=int(colors.get("tolerance_l1", d.get("tolerance_l1", 180))),
            min_background_drop=float(min_drop),
            cooldown_ms=int(fill_up.get("cooldown_ms", d.get("cooldown_ms", 40))),
            duration_ms=max(1, int(d.get("duration_ms", 40))),
        )
        bar.validate()
        return bar

    def _parse_health_number_detector(self, d: Dict[str, Any]) -> HealthNumberDetector:
        name_raw = d.get("name") or "health_number"
        name = str(name_raw)
        templates_data = d.get("templates")
        has_templates = isinstance(templates_data, dict) and bool(templates_data.get("digits"))
        if d.get("engine"):
            engine = str(d.get("engine"))
        elif has_templates:
            engine = "templates"
        else:
            engine = PROFILE_OCR_DAEMON

        roi = d.get("roi")
        if not isinstance(roi, dict):
            raise ValueError("health_number.roi is required")
        rect = NormalizedRect(
            x=float(roi.get("x", 0)),
            y=float(roi.get("y", 0)),
            w=float(roi.get("w", 0)),
            h=float(roi.get("h", 0)),
        )
        rect.validate()

        digits = int(d.get("digits", 0))
        if digits < 1:
            raise ValueError("health_number.digits must be >= 1")

        preprocess_data = d.get("preprocess")
        if isinstance(preprocess_data, dict):
            preprocess = HealthNumberPreprocess(
                invert=bool(preprocess_data.get("invert", False)),
                threshold=float(preprocess_data.get("threshold", 0.6)),
                scale=int(preprocess_data.get("scale", 1)),
            )
        elif uses_text_ocr_engine(engine):
            preprocess = HealthNumberPreprocess(invert=False, threshold=0.6, scale=1)
        else:
            raise ValueError("health_number.preprocess is required")
        preprocess.validate()

        readout_data = d.get("readout")
        if not isinstance(readout_data, dict):
            raise ValueError("health_number.readout is required")
        readout = HealthNumberReadout(
            min_value=int(readout_data.get("min", 0)),
            max_value=int(readout_data.get("max", 999)),
            stable_reads=int(readout_data.get("stable_reads", 1)),
        )
        readout.validate()

        hod_data = d.get("hit_on_decrease")
        if not isinstance(hod_data, dict):
            raise ValueError("health_number.hit_on_decrease is required")
        hit_on_decrease = HealthNumberHitOnDecrease(
            min_drop=int(hod_data.get("min_drop", 1)),
            cooldown_ms=int(hod_data.get("cooldown_ms", 150)),
        )
        hit_on_decrease.validate()

        templates: Optional[HealthNumberTemplates] = None
        if not uses_text_ocr_engine(engine) and isinstance(templates_data, dict):
            t_id = str(templates_data.get("template_set_id") or "learned_v1")
            hamming_max = int(templates_data.get("hamming_max", 120))
            t_w = int(templates_data.get("width", 0))
            t_h = int(templates_data.get("height", 0))
            digits_map = templates_data.get("digits")
            parsed_digits: Dict[str, List[int]] = {}
            if isinstance(digits_map, dict) and t_w > 0 and t_h > 0:
                expected = t_w * t_h
                for k, v in digits_map.items():
                    kk = str(k)
                    if isinstance(v, str):
                        if len(v) != expected:
                            continue
                        parsed_digits[kk] = [1 if ch == "1" else 0 for ch in v]
                    elif isinstance(v, list) and len(v) == expected:
                        parsed_digits[kk] = [1 if int(x) else 0 for x in v]
            if parsed_digits:
                templates = HealthNumberTemplates(
                    template_set_id=t_id,
                    hamming_max=hamming_max,
                    width=t_w,
                    height=t_h,
                    digits=parsed_digits,
                )
                templates.validate()

        hn = HealthNumberDetector(
            name=name,
            rect=rect,
            digits=digits,
            preprocess=preprocess,
            readout=readout,
            hit_on_decrease=hit_on_decrease,
            templates=templates,
            engine=engine,
        )
        hn.validate()
        return hn

    def _ammo_try_read_text_ocr(
        self, raw_bgra: bytes, width: int, height: int, hn: HealthNumberDetector
    ) -> Tuple[Optional[int], str]:
        from .screen_ocr import is_text_ocr_engine, normalize_text_ocr_engine, read_ammo_value_from_bgra

        engine = str(hn.engine)
        if self._get_ocr_engine is not None:
            try:
                engine = normalize_text_ocr_engine(self._get_ocr_engine())
            except Exception:
                if is_text_ocr_engine(engine):
                    pass
                else:
                    engine = DEFAULT_AMMO_OCR_ENGINE
        elif not is_text_ocr_engine(engine):
            engine = DEFAULT_AMMO_OCR_ENGINE

        value, text = read_ammo_value_from_bgra(
            raw_bgra,
            width,
            height,
            min_value=int(hn.readout.min_value),
            max_value=int(hn.readout.max_value),
            engine=engine,
        )
        if self._debug_log_values:
            logger.info(
                "[screen_health] %s detector=%s size=%sx%s text=%r value=%s",
                engine,
                hn.name,
                width,
                height,
                text,
                value,
            )
        return value, text

    def _ammo_number_try_read_templates(
        self, bits: List[int], bw: int, bh: int, hn: HealthNumberDetector
    ) -> Optional[int]:
        """Try digit widths 1..hn.digits so a lone '7' still matches in a wide ROI."""
        max_digits = max(1, int(hn.digits))
        for n in range(1, max_digits + 1):
            value = self._health_number_try_read(bits, bw, bh, hn, digit_count=n)
            if value is not None:
                return value
        return None

    def _health_number_try_read(
        self,
        bits: List[int],
        bw: int,
        bh: int,
        hn: HealthNumberDetector,
        *,
        digit_count: Optional[int] = None,
    ) -> Optional[int]:
        assert hn.templates is not None
        n_digits = int(digit_count) if digit_count is not None else int(hn.digits)
        if n_digits <= 0:
            return None
        if bw <= 0 or bh <= 0:
            return None

        # Split into fixed-width digit slices.
        digits_str = ""
        for i in range(n_digits):
            x0 = int(round(i * bw / n_digits))
            x1 = int(round((i + 1) * bw / n_digits))
            x1 = max(x0 + 1, min(bw, x1))
            slice_w = x1 - x0

            # Extract slice bits (row-major)
            slice_bits: List[int] = [0] * (slice_w * bh)
            for y in range(bh):
                src_off = y * bw + x0
                dst_off = y * slice_w
                slice_bits[dst_off : dst_off + slice_w] = bits[src_off : src_off + slice_w]

            # Resize to template size
            norm = _resize_bitmap_nearest(slice_bits, slice_w, bh, hn.templates.width, hn.templates.height)

            # Reject empty / solid slices (usually background eating the digit)
            ink = sum(1 for b in norm if b)
            nbits = hn.templates.width * hn.templates.height
            if ink < max(2, nbits // 50) or ink > nbits - max(2, nbits // 50):
                return None

            best_digit: Optional[str] = None
            best_dist: Optional[int] = None
            second_dist: Optional[int] = None
            for dch, tmpl in hn.templates.digits.items():
                dist = hamming_distance_bits(norm, tmpl, n=nbits)
                if best_dist is None or dist < best_dist:
                    second_dist = best_dist
                    best_dist = dist
                    best_digit = dch
                elif second_dist is None or dist < second_dist:
                    second_dist = dist

            if best_digit is None or best_dist is None or best_dist > hn.templates.hamming_max:
                return None
            # Reject ambiguous near-ties (skip when exact match)
            if best_dist > 0 and second_dist is not None:
                margin = max(8, nbits // 32)
                if (second_dist - best_dist) < margin:
                    return None
            digits_str += best_digit

        if not digits_str:
            return None
        try:
            value = int(digits_str)
        except Exception:
            return None
        if value < hn.readout.min_value or value > hn.readout.max_value:
            return None
        return value

    def _health_bar_percent_threshold_fallback(
        self, raw_bgra: bytes, width: int, height: int, fallback: HealthBarThresholdFallback
    ) -> float:
        """
        Fallback % when color sampling isn't available.

        This is intentionally simple and Phase C only guarantees support (not canonical).
        - brightness: treat pixel filled if max(r,g,b)/255 >= min_value
        - saturation: treat pixel filled if (max-min)/max >= min_value, with max>0
        """
        expected = width * height * 4
        if len(raw_bgra) < expected:
            raise ValueError("raw_bgra is smaller than expected for BGRA frame")

        filled_counts_by_col = [0] * width
        i = 0
        min_v = float(fallback.min_value)
        for _y in range(height):
            for x in range(width):
                b = raw_bgra[i]
                g = raw_bgra[i + 1]
                r = raw_bgra[i + 2]
                i += 4

                mx = r if r >= g else g
                mx = mx if mx >= b else b
                mn = r if r <= g else g
                mn = mn if mn <= b else b

                if fallback.mode == "brightness":
                    if (mx / 255.0) >= min_v:
                        filled_counts_by_col[x] += 1
                else:  # saturation
                    if mx <= 0:
                        continue
                    sat = (mx - mn) / float(mx)
                    if sat >= min_v:
                        filled_counts_by_col[x] += 1

        col_min = int(0.5 * height)
        for x in range(width):
            if filled_counts_by_col[x] < col_min:
                return max(0.0, min(1.0, x / float(width)))
        return 1.0


class _BetterCamCaptureBackend:
    """
    BetterCam-based capture backend (Windows, DXGI).

    BetterCam is a high-performance screen capture library using Desktop Duplication API.
    """

    def __init__(self, monitor_index: int) -> None:
        self._monitor_index = monitor_index
        self._cap = None
        self._output_w = 0
        self._output_h = 0

    def _ensure(self) -> None:
        if self._cap is not None:
            return
        try:
            import bettercam  # type: ignore
        except (ModuleNotFoundError, ImportError) as e:  # pragma: no cover
            raise RuntimeError(
                "bettercam is required for BetterCam capture backend "
                "(pip install bettercam)"
            ) from e
        except Exception as e:  # pragma: no cover\
            # Preserve the original error so users know what to fix.
            raise RuntimeError(f"bettercam import failed: {e}") from e

        # bettercam uses 0-based output index; our UI/daemon config is 1-based.
        out_idx = int(self._monitor_index) - 1
        if out_idx < 0:
            raise ValueError(f"Invalid monitor_index={self._monitor_index}. Must be >= 1")

        # Create capture for this output. Use BGRA to match our downstream processing.
        cap = bettercam.create(output_idx=out_idx, output_color="BGRA")
        if cap is None:  # pragma: no cover
            raise RuntimeError("bettercam.create returned None")
        self._cap = cap

        frame = None
        for _attempt in range(3):
            frame = self._cap.grab()
            if frame is not None:
                break
            time.sleep(0.1)

        if frame is not None:
            self._output_h = int(frame.shape[0])
            self._output_w = int(frame.shape[1])
            return

        res = getattr(getattr(self._cap, "output", None), "resolution", None)
        if isinstance(res, (tuple, list)) and len(res) == 2:
            self._output_w = int(res[0])
            self._output_h = int(res[1])
            return
        raise RuntimeError("bettercam grab returned None (capture not available)")

    def get_frame_size(self) -> Tuple[int, int]:
        self._ensure()
        return self._output_w, self._output_h

    def capture_multiple_bgra(self, regions: List[Tuple[int, int, int, int]]) -> List[Any]:
        """
        Capture multiple regions from a single full frame grab.
        
        Args:
            regions: List of (left, top, width, height) tuples
            
        Returns:
            List of BGRA byte arrays, one per region (same order as input)
            
        Raises:
            RuntimeError: If bettercam.grab() returns None (no retry - fails immediately)
        """
        self._ensure()
        assert self._cap is not None
        
        if not regions:
            return []
        
        # BetterCam doesn't support region parameter in grab()
        # Grab full frame once and extract all regions from it
        frame = self._cap.grab()
        if frame is None:
            raise RuntimeError("bettercam grab returned None")
        self._output_h = int(frame.shape[0])
        self._output_w = int(frame.shape[1])
        return _crop_bgra_regions_from_hwc(frame, regions)


def _create_capture_backend(*, monitor_index: int):
    """
    Create the capture backend using BetterCam.

    BetterCam on Windows (DXGI, high performance) is required.
    BetterCam is compatible with Python 3.14+ and more reliable than rapidshot.
    """
    if os.name == "nt":
        return _BetterCamCaptureBackend(monitor_index=monitor_index)
    raise RuntimeError("Screen health capture is only supported on Windows with BetterCam")
