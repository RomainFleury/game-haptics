"""Shared ammo OCR pipeline: prepare ROI variants → chosen engine → number."""

from __future__ import annotations

from typing import Optional, Tuple

from .parse import number_from_ocr_text
from .preprocess import iter_roi_variants, prepare_roi
from .registry import DEFAULT_AMMO_OCR_ENGINE, get_backend, normalize_text_ocr_engine
from .types import DigitOcrBackend, OcrRoi


def read_ammo_number(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    engine: str = DEFAULT_AMMO_OCR_ENGINE,
    min_value: int = 0,
    max_value: int = 999,
    backend: Optional[DigitOcrBackend] = None,
) -> Optional[int]:
    """
    Run the shared pipeline and return only the integer (or None).

    Tries several preprocess variants (normal / wide-pad / contrast / inverted)
    so single-digit ammo still reads when multi-digit already worked.
    """
    value, _text = read_ammo_value_from_bgra(
        raw_bgra,
        width,
        height,
        engine=engine,
        min_value=min_value,
        max_value=max_value,
        backend=backend,
    )
    return value


def read_ammo_value_from_bgra(
    raw_bgra: bytes,
    width: int,
    height: int,
    *,
    min_value: int = 0,
    max_value: int = 999,
    engine: str = DEFAULT_AMMO_OCR_ENGINE,
    backend: Optional[DigitOcrBackend] = None,
) -> Tuple[Optional[int], str]:
    """
    Return (number, raw_ocr_text).

    `raw_ocr_text` is the last non-empty engine text even when parsing fails,
    so Test OCR logs are useful for single-digit misses.
    """
    impl = backend or get_backend(normalize_text_ocr_engine(engine))
    reason = impl.unavailable_reason()
    if reason:
        raise RuntimeError(reason)

    # Text engines override recognize_text; digits-only engines only implement read_number.
    uses_text = type(impl).recognize_text is not DigitOcrBackend.recognize_text
    limit = getattr(impl, "max_roi_variants", None)
    last_text = ""
    for index, variant in enumerate(iter_roi_variants(raw_bgra, width, height)):
        if limit is not None and index >= int(limit):
            break
        if uses_text:
            text = _engine_text(impl, variant)
            if text:
                last_text = text
            value = number_from_ocr_text(text) if text else None
        else:
            value = impl.read_number(variant)
            text = "" if value is None else str(value)
            if text:
                last_text = text
        if value is None:
            continue
        if int(min_value) <= int(value) <= int(max_value):
            return int(value), text or str(value)
    return None, last_text


def recognize_text_with_engine(raw_bgra: bytes, width: int, height: int, engine: str) -> str:
    """Run one polarity of the chosen engine; return the number as text (or empty)."""
    impl = get_backend(engine)
    reason = impl.unavailable_reason()
    if reason:
        raise RuntimeError(reason)
    roi = prepare_roi(raw_bgra, width, height)
    text = _engine_text(impl, roi)
    if text:
        return text
    value = impl.read_number(roi)
    return "" if value is None else str(value)


def _engine_text(impl: DigitOcrBackend, roi: OcrRoi) -> str:
    recognize = getattr(impl, "recognize_text", None)
    if callable(recognize):
        try:
            return str(recognize(roi) or "").strip()
        except Exception:
            return ""
    return ""
