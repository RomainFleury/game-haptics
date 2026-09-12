"""Shared ROI prep used by every ammo OCR engine."""

from __future__ import annotations

from typing import Iterator, List, Tuple

from .types import OcrRoi

# Tiny HUD crops often fail; nearest-neighbor upscale to about this size.
_MIN_OCR_HEIGHT = 96
_MIN_OCR_WIDTH = 160
_MAX_SCALE = 8
# Windows OCR frequently misses isolated single digits without side margin.
_WIDE_PAD_MIN = 48


def prepare_roi(raw_bgra: bytes, width: int, height: int) -> OcrRoi:
    """Upscale tiny HUD ROIs, pad edges, force opaque alpha."""
    bgra, w, h = _prepare_roi_bytes(raw_bgra, width, height, wide_pad=False, contrast=False)
    return OcrRoi(bgra=bgra, width=w, height=h)


def invert_roi(roi: OcrRoi) -> OcrRoi:
    return OcrRoi(bgra=_invert_bgra(roi.bgra, roi.width, roi.height), width=roi.width, height=roi.height)


def iter_roi_variants(raw_bgra: bytes, width: int, height: int) -> Iterator[OcrRoi]:
    """
    Yield preprocess variants for stubborn HUD digits (esp. single-digit ammo).

    Order: normal → inverted → wide-padded → wide+inverted → contrast → contrast+inverted.
    """
    seen: set[Tuple[int, int, bytes]] = set()
    specs: List[Tuple[bool, bool]] = [
        (False, False),
        (True, False),
        (False, True),
        (True, True),
    ]
    for wide_pad, contrast in specs:
        bgra, w, h = _prepare_roi_bytes(raw_bgra, width, height, wide_pad=wide_pad, contrast=contrast)
        key = (w, h, bgra)
        if key in seen:
            continue
        seen.add(key)
        roi = OcrRoi(bgra=bgra, width=w, height=h)
        yield roi
        inv = invert_roi(roi)
        inv_key = (inv.width, inv.height, inv.bgra)
        if inv_key not in seen:
            seen.add(inv_key)
            yield inv


def _prepare_roi_bytes(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    wide_pad: bool,
    contrast: bool,
) -> Tuple[bytes, int, int]:
    w, h = int(width), int(height)
    expected = w * h * 4
    if w <= 0 or h <= 0:
        raise ValueError("width and height must be > 0")
    if len(raw_bgra) < expected:
        raise ValueError(f"BGRA buffer too small: {len(raw_bgra)} < {expected}")

    try:
        import numpy as np
    except Exception as e:  # pragma: no cover
        raise RuntimeError("numpy required for OCR ROI prep") from e

    img = np.frombuffer(raw_bgra[:expected], dtype=np.uint8).reshape((h, w, 4)).copy()
    img[:, :, 3] = 255

    if contrast:
        # Stretch luminance so faint HUD digits pop for OCR.
        bgr = img[:, :, :3].astype(np.float32)
        # Rec. 601 luma approximation in BGR order.
        y = 0.114 * bgr[:, :, 0] + 0.587 * bgr[:, :, 1] + 0.299 * bgr[:, :, 2]
        y_min = float(y.min())
        y_max = float(y.max())
        if y_max - y_min > 8.0:
            scale = 255.0 / (y_max - y_min)
            y2 = (y - y_min) * scale
            # Rebuild as grayscale BGR (OCR cares about edges, not hue).
            g = np.clip(y2, 0, 255).astype(np.uint8)
            img[:, :, 0] = g
            img[:, :, 1] = g
            img[:, :, 2] = g

    scale_h = max(1, int((_MIN_OCR_HEIGHT + h - 1) // h)) if h < _MIN_OCR_HEIGHT else 1
    scale_w = max(1, int((_MIN_OCR_WIDTH + w - 1) // w)) if w < _MIN_OCR_WIDTH else 1
    scale = min(_MAX_SCALE, max(scale_h, scale_w))
    if scale > 1:
        img = np.repeat(np.repeat(img, scale, axis=0), scale, axis=1)

    pad = max(4, scale * 2)
    if wide_pad:
        # Extra side margin: isolated "1"/"7" often fail without surrounding space.
        pad_x = max(pad, _WIDE_PAD_MIN, int(img.shape[1] * 0.75))
        pad_y = max(pad, _WIDE_PAD_MIN // 2)
    else:
        pad_x = pad
        pad_y = pad

    out_h, out_w = int(img.shape[0]) + pad_y * 2, int(img.shape[1]) + pad_x * 2
    padded = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    padded[:, :, 3] = 255
    border = np.median(img[:, :, :3].reshape(-1, 3), axis=0).astype(np.uint8)
    padded[:, :, 0] = border[0]
    padded[:, :, 1] = border[1]
    padded[:, :, 2] = border[2]
    padded[pad_y : pad_y + img.shape[0], pad_x : pad_x + img.shape[1]] = img

    return padded.tobytes(), out_w, out_h


def _invert_bgra(raw_bgra: bytes, width: int, height: int) -> bytes:
    try:
        import numpy as np
    except Exception as e:  # pragma: no cover
        raise RuntimeError("numpy required for OCR ROI prep") from e
    expected = int(width) * int(height) * 4
    img = np.frombuffer(raw_bgra[:expected], dtype=np.uint8).reshape((int(height), int(width), 4)).copy()
    img[:, :, :3] = 255 - img[:, :, :3]
    img[:, :, 3] = 255
    return img.tobytes()
