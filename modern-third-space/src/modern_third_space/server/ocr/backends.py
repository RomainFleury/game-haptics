"""Built-in digit OCR backends. Add a class here and include it in BUILTIN_ENGINES."""

from __future__ import annotations

import asyncio
import base64
import threading
from typing import List, Optional

# On Windows, onnxruntime's DLL fails to load if WinRT was imported first.
try:
    import onnxruntime  # noqa: F401
except Exception:
    pass

from .opencv_digits import opencv_unavailable_reason, read_opencv_cells_number, read_opencv_knn_number
from .parse import number_from_ocr_text
from .registry import register
from .types import DigitOcrBackend, OcrRoi

_ENGINE_LOCK = threading.Lock()
_WINDOWS_ENGINE = None
_RAPIDOCR_LOCK = threading.Lock()
_RAPIDOCR = None
_RAPIDOCR_FAILED: Optional[str] = None


def rapidocr_unavailable_reason() -> Optional[str]:
    try:
        import onnxruntime  # noqa: F401
    except Exception as e:
        return (
            "onnxruntime is not installed. Install into the daemon interpreter, e.g.\n"
            "  py -3.14 -m pip install onnxruntime rapidocr\n"
            f"Import error: {e}"
        )
    try:
        import rapidocr_onnxruntime  # noqa: F401
        return None
    except Exception:
        pass
    try:
        import rapidocr  # noqa: F401
        return None
    except Exception as e:
        return (
            "RapidOCR is not installed. Install into the daemon interpreter, e.g.\n"
            "  py -3.14 -m pip install rapidocr onnxruntime\n"
            f"Import error: {e}"
        )


_TESSERACT_CMD: Optional[str] = None
_TESSERACT_RESOLVED = False


def _common_tesseract_paths() -> List[str]:
    import os
    import sys

    if sys.platform == "win32":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        return [
            os.path.join(pf, "Tesseract-OCR", "tesseract.exe"),
            os.path.join(pf86, "Tesseract-OCR", "tesseract.exe"),
            os.path.join(local, "Programs", "Tesseract-OCR", "tesseract.exe"),
            os.path.join(local, "Tesseract-OCR", "tesseract.exe"),
        ]
    return [
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
    ]


def resolve_tesseract_cmd() -> Optional[str]:
    """Find tesseract on PATH or common install dirs; configure pytesseract."""
    global _TESSERACT_CMD, _TESSERACT_RESOLVED
    if _TESSERACT_RESOLVED:
        return _TESSERACT_CMD

    import os
    import shutil

    found = shutil.which("tesseract")
    if not found:
        for path in _common_tesseract_paths():
            if path and os.path.isfile(path):
                found = path
                break

    _TESSERACT_CMD = found
    _TESSERACT_RESOLVED = True
    if found:
        try:
            import pytesseract

            pytesseract.pytesseract.tesseract_cmd = found
        except Exception:
            pass
    return found


def tesseract_unavailable_reason() -> Optional[str]:
    try:
        import pytesseract  # noqa: F401
    except Exception as e:
        return (
            "pytesseract is not installed. Install into the daemon interpreter, e.g.\n"
            "  py -3.14 -m pip install pytesseract\n"
            f"Import error: {e}"
        )
    if not resolve_tesseract_cmd():
        return (
            "Tesseract binary not found. Install Tesseract for Windows "
            "(UB Mannheim build), or add tesseract.exe to PATH, then restart the daemon."
        )
    return None


def tesseract_boxes_unavailable_reason() -> Optional[str]:
    tess = tesseract_unavailable_reason()
    if tess:
        return tess
    return opencv_unavailable_reason()


WINDOWS_OCR_GUIDE = (
    "Windows OCR is the default ammo reader. The Python WinRT packages ship with the daemon, "
    "but Windows itself must have an OCR language pack.\n\n"
    "Install it:\n"
    "  1. Open Windows Settings → Time & language → Language & region\n"
    "  2. Under Languages, open English (United States) — or add it\n"
    "  3. Language options → Features → Optical character recognition → Download\n"
    "  4. Restart the Third Space daemon, then click Refresh here\n\n"
    "Or: Settings search for “language packs”, then add OCR for your Windows display language."
)


def windows_ocr_unavailable_reason() -> Optional[str]:
    import sys

    if sys.platform != "win32":
        return "Windows OCR is only available on Windows."
    try:
        from winrt.windows.media.ocr import OcrEngine  # type: ignore  # noqa: F401
    except Exception as e:
        return (
            "Windows OCR Python packages are missing from the daemon interpreter "
            f"(they should install with the app: pip install -e modern-third-space).\n"
            f"Import error: {e}"
        )
    try:
        get_windows_ocr_engine()
    except RuntimeError as e:
        return f"{e}\n\n{WINDOWS_OCR_GUIDE}"
    return None


def get_windows_ocr_engine():
    global _WINDOWS_ENGINE
    with _ENGINE_LOCK:
        if _WINDOWS_ENGINE is not None:
            return _WINDOWS_ENGINE
        try:
            from winrt.windows.media.ocr import OcrEngine  # type: ignore
        except Exception as e:
            raise RuntimeError(
                "Windows OCR packages not installed on this Python. "
                "Install into the daemon interpreter, e.g.\n"
                '  py -3.14 -m pip install "winrt-runtime~=3.2" '
                '"winrt-Windows.Foundation~=3.2" '
                '"winrt-Windows.Foundation.Collections~=3.2" '
                '"winrt-Windows.Globalization~=3.2" '
                '"winrt-Windows.Graphics.Imaging~=3.2" '
                '"winrt-Windows.Media.Ocr~=3.2" '
                '"winrt-Windows.Security.Cryptography~=3.2" '
                '"winrt-Windows.Storage.Streams~=3.2"\n'
                f"Import error: {e}"
            ) from e

        eng = OcrEngine.try_create_from_user_profile_languages()
        if eng is None:
            try:
                from winrt.windows.globalization import Language  # type: ignore

                for tag in ("en-US", "en"):
                    lang = Language(tag)
                    if OcrEngine.is_language_supported(lang):
                        eng = OcrEngine.try_create_from_language(lang)
                        if eng is not None:
                            break
            except Exception:
                eng = None
        if eng is None:
            raise RuntimeError(
                "Windows OCR engine unavailable. Install an OCR language pack "
                "in Windows Settings → Time & Language → Language."
            )
        _WINDOWS_ENGINE = eng
        return _WINDOWS_ENGINE


def _bgra_to_software_bitmap(raw_bgra: bytes, width: int, height: int):
    from winrt.windows.graphics.imaging import (  # type: ignore
        BitmapPixelFormat,
        SoftwareBitmap,
    )
    from winrt.windows.security.cryptography import CryptographicBuffer  # type: ignore

    w, h = int(width), int(height)
    expected = w * h * 4
    if w <= 0 or h <= 0:
        raise ValueError("width and height must be > 0")
    if len(raw_bgra) < expected:
        raise ValueError(f"BGRA buffer too small: {len(raw_bgra)} < {expected}")
    payload = bytes(raw_bgra[:expected])
    rtbuf = CryptographicBuffer.decode_from_base64_string(base64.b64encode(payload).decode("ascii"))
    return SoftwareBitmap.create_copy_from_buffer(rtbuf, BitmapPixelFormat.BGRA8, w, h)


async def _recognize_windows_async(raw_bgra: bytes, width: int, height: int) -> str:
    engine = get_windows_ocr_engine()
    bitmap = _bgra_to_software_bitmap(raw_bgra, width, height)
    result = await engine.recognize_async(bitmap)
    return str(getattr(result, "text", "") or "")


def recognize_windows_ocr_text(raw_bgra: bytes, width: int, height: int) -> str:
    get_windows_ocr_engine()
    box: list = []
    errors: list = []

    def _runner() -> None:
        try:
            box.append(asyncio.run(_recognize_windows_async(raw_bgra, width, height)))
        except Exception as exc:
            errors.append(exc)

    t = threading.Thread(target=_runner, name="windows-ocr", daemon=True)
    t.start()
    t.join(timeout=8.0)
    if errors:
        raise errors[0]
    if not box:
        raise RuntimeError("Windows OCR timed out")
    return str(box[0])


def _get_rapidocr():
    global _RAPIDOCR, _RAPIDOCR_FAILED
    with _RAPIDOCR_LOCK:
        if _RAPIDOCR is not None:
            return _RAPIDOCR
        if _RAPIDOCR_FAILED:
            raise RuntimeError(_RAPIDOCR_FAILED)
        reason = rapidocr_unavailable_reason()
        if reason:
            _RAPIDOCR_FAILED = reason
            raise RuntimeError(reason)
        try:
            try:
                from rapidocr_onnxruntime import RapidOCR  # type: ignore
            except Exception:
                from rapidocr import RapidOCR  # type: ignore
            _RAPIDOCR = RapidOCR()
            _RAPIDOCR_FAILED = None
            return _RAPIDOCR
        except Exception as e:
            _RAPIDOCR_FAILED = f"Failed to initialize RapidOCR: {e}"
            raise RuntimeError(_RAPIDOCR_FAILED) from e


def _rapidocr_result_to_text(out: object) -> str:
    texts: List[str] = []
    txts = getattr(out, "txts", None)
    if txts:
        texts.extend(str(t) for t in txts if t)
        return " ".join(texts).strip()
    rows = out
    if isinstance(out, tuple) and out:
        rows = out[0]
    if not rows:
        return ""
    for item in rows:
        if item is None:
            continue
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            texts.append(str(item[1]))
        else:
            texts.append(str(item))
    return " ".join(texts).strip()


class WindowsOcrEngine(DigitOcrBackend):
    id = "windows_ocr"
    label = "Windows OCR"
    beta = False
    group = "system"
    offered_in_ui = True
    ui_summary = (
        "Default for live recoil (~8 ms per frame). Bundled Python bindings; Windows still "
        "needs an OCR language pack (Settings → Language → Optical character recognition)."
    )
    description = "Windows.Media.Ocr (WinRT). Needs an OCR language pack. Good baseline on Windows HUDs."
    install = WINDOWS_OCR_GUIDE

    def unavailable_reason(self) -> Optional[str]:
        return windows_ocr_unavailable_reason()

    def recognize_text(self, roi: OcrRoi) -> str:
        return recognize_windows_ocr_text(roi.bgra, roi.width, roi.height)

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        return number_from_ocr_text(self.recognize_text(roi))


class RapidOcrEngine(DigitOcrBackend):
    id = "rapidocr"
    label = "RapidOCR (ONNX)"
    beta = True
    group = "neural"
    offered_in_ui = True
    # Full detect+recognize on CPU; keep preprocess variants low or live recoil crawls.
    max_roi_variants = 2
    ui_summary = (
        "Local ONNX model — often better on stylized HUD fonts, but slow on CPU "
        "(detect+recognize). Prefer Tesseract when speed matters. Needs rapidocr + onnxruntime."
    )
    description = "Small ONNX text model on CPU. Closest to a lightweight neural net for live HUD text."
    install = "py -3.14 -m pip install rapidocr onnxruntime"

    def unavailable_reason(self) -> Optional[str]:
        return rapidocr_unavailable_reason()

    def recognize_text(self, roi: OcrRoi) -> str:
        import numpy as np

        engine = _get_rapidocr()
        expected = int(roi.width) * int(roi.height) * 4
        img = np.frombuffer(roi.bgra[:expected], dtype=np.uint8).reshape((int(roi.height), int(roi.width), 4))
        bgr = np.ascontiguousarray(img[:, :, :3])
        return _rapidocr_result_to_text(engine(bgr))

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        return number_from_ocr_text(self.recognize_text(roi))


class TesseractEngine(DigitOcrBackend):
    id = "tesseract"
    label = "Tesseract OCR"
    beta = False
    group = "system"
    offered_in_ui = True
    ui_summary = (
        "Classic local OCR (digits-only). Much faster than RapidOCR on a small ammo ROI. "
        "Uses the Tesseract Windows install (auto-found under Program Files) plus pytesseract."
    )
    description = "Classic Tesseract, digits-only. Install the Tesseract binary plus pytesseract."
    install = "Install Tesseract for Windows, then: py -3.14 -m pip install pytesseract"

    def unavailable_reason(self) -> Optional[str]:
        return tesseract_unavailable_reason()

    def recognize_text(self, roi: OcrRoi) -> str:
        import numpy as np
        import pytesseract
        from PIL import Image

        resolve_tesseract_cmd()
        expected = int(roi.width) * int(roi.height) * 4
        img = np.frombuffer(roi.bgra[:expected], dtype=np.uint8).reshape((int(roi.height), int(roi.width), 4))
        rgba = img[:, :, [2, 1, 0, 3]]
        pil = Image.fromarray(rgba, mode="RGBA").convert("L")
        # Try single-line first (fast); fall back to single-char for 1-digit ammo.
        for psm in (7, 10):
            config = f"--psm {psm} -c tessedit_char_whitelist=0123456789"
            text = str(pytesseract.image_to_string(pil, config=config) or "").strip()
            if text:
                return text
        return ""

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        return number_from_ocr_text(self.recognize_text(roi))


class TesseractBoxesEngine(DigitOcrBackend):
    id = "tesseract_boxes"
    label = "OpenCV + Tesseract boxes"
    beta = True
    group = "opencv"
    description = (
        "Otsu threshold to black/white, then Tesseract sparse-digit search (PSM 11) "
        "with bounding boxes and confidence filter. Same pipeline as "
        "misc-documentations/orc/example.md."
    )
    install = (
        "Install the Tesseract EXE, then:\n"
        '  py -3.14 -m pip install pytesseract "opencv-python-headless>=4.8,<5"'
    )

    def unavailable_reason(self) -> Optional[str]:
        return tesseract_boxes_unavailable_reason()

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        import cv2
        import numpy as np
        import pytesseract

        resolve_tesseract_cmd()
        expected = int(roi.width) * int(roi.height) * 4
        img = np.frombuffer(roi.bgra[:expected], dtype=np.uint8).reshape((int(roi.height), int(roi.width), 4))
        bgr = np.ascontiguousarray(img[:, :, :3])
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        config = r"--psm 11 -c tessedit_char_whitelist=0123456789"
        data = pytesseract.image_to_data(thresh, config=config, output_type=pytesseract.Output.DICT)
        hits: list[tuple[int, str]] = []
        n = len(data.get("text") or [])
        for i in range(n):
            digit = str(data["text"][i] or "").strip()
            if not digit:
                continue
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                continue
            if conf <= 50:
                continue
            hits.append((int(data["left"][i]), digit))
        hits.sort(key=lambda item: item[0])
        return number_from_ocr_text("".join(text for _x, text in hits))


class OpencvKnnEngine(DigitOcrBackend):
    id = "opencv_knn"
    label = "OpenCV contours + kNN"
    beta = False
    group = "opencv"
    offered_in_ui = True
    ui_summary = (
        "Optional override: about 2 ms per frame. Faster than Windows OCR, but more often "
        "returns a wrong number instead of blank. Needs OpenCV 4.x in the daemon Python "
        "(not in the Electron build)."
    )
    description = (
        "Finds bounding boxes around digit blobs (contour isolation, same idea as "
        "classic OpenCV digit-recognition repos) and classifies each with kNN."
    )
    install = 'py -3.14 -m pip install "opencv-python-headless>=4.8,<5"'

    def unavailable_reason(self) -> Optional[str]:
        return opencv_unavailable_reason()

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        return read_opencv_knn_number(roi.bgra, roi.width, roi.height)


class OpencvCellsEngine(DigitOcrBackend):
    id = "opencv_cells"
    label = "OpenCV cells + kNN"
    beta = True
    group = "opencv"
    description = (
        "Splits the ROI into digit columns via ink projection (grid/cell slicing, "
        "same idea as Sudoku-OpenCV solvers) then kNN on each cell."
    )
    install = 'py -3.14 -m pip install "opencv-python-headless>=4.8,<5"'

    def unavailable_reason(self) -> Optional[str]:
        return opencv_unavailable_reason()

    def read_number(self, roi: OcrRoi) -> Optional[int]:
        return read_opencv_cells_number(roi.bgra, roi.width, roi.height)


BUILTIN_ENGINES: tuple[type[DigitOcrBackend], ...] = (
    WindowsOcrEngine,
    RapidOcrEngine,
    TesseractEngine,
    TesseractBoxesEngine,
    OpencvKnnEngine,
    OpencvCellsEngine,
)


def register_builtin_engines() -> None:
    for cls in BUILTIN_ENGINES:
        register(cls())
