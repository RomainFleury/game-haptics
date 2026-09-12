from modern_third_space.server.ocr.pipeline import read_ammo_number, read_ammo_value_from_bgra
from modern_third_space.server.ocr.preprocess import iter_roi_variants, prepare_roi
from modern_third_space.server.ocr.types import DigitOcrBackend, OcrRoi


class _ConstEngine(DigitOcrBackend):
    id = "test_const"
    label = "Test const"

    def read_number(self, roi: OcrRoi) -> int | None:
        return 42


class _NoneEngine(DigitOcrBackend):
    id = "test_none"
    label = "Test none"

    def read_number(self, roi: OcrRoi) -> int | None:
        return None


class _TextEngine(DigitOcrBackend):
    id = "test_text"
    label = "Test text"

    def __init__(self, text: str) -> None:
        self._text = text

    def recognize_text(self, roi: OcrRoi) -> str:
        return self._text

    def read_number(self, roi: OcrRoi) -> int | None:
        return None


def test_pipeline_returns_engine_number():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    assert read_ammo_number(raw, w, h, backend=_ConstEngine()) == 42


def test_pipeline_rejects_out_of_range_engine_number():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    assert read_ammo_number(raw, w, h, backend=_ConstEngine(), min_value=0, max_value=10) is None


def test_pipeline_none_when_engine_unreadable():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    assert read_ammo_number(raw, w, h, backend=_NoneEngine()) is None


def test_pipeline_returns_raw_text_on_parse_miss():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    value, text = read_ammo_value_from_bgra(raw, w, h, backend=_TextEngine("nope"))
    assert value is None
    assert text == "nope"


def test_pipeline_parses_single_digit_from_recognize_text():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    value, text = read_ammo_value_from_bgra(raw, w, h, backend=_TextEngine("7"))
    assert value == 7
    assert text == "7"


class _CountingTextEngine(DigitOcrBackend):
    id = "test_count"
    label = "Test count"
    max_roi_variants = 2

    def __init__(self) -> None:
        self.recognize_calls = 0
        self.read_calls = 0

    def recognize_text(self, roi: OcrRoi) -> str:
        self.recognize_calls += 1
        return ""

    def read_number(self, roi: OcrRoi) -> int | None:
        self.read_calls += 1
        return None


def test_pipeline_text_engine_does_not_double_call_read_number():
    w, h = 40, 20
    raw = bytes([0, 0, 0, 255] * (w * h))
    eng = _CountingTextEngine()
    value, text = read_ammo_value_from_bgra(raw, w, h, backend=eng)
    assert value is None
    assert text == ""
    assert eng.read_calls == 0
    assert eng.recognize_calls == 2


def test_prepare_roi_and_variants_grow_narrow_digit_crop():
    w, h = 37, 49
    buf = bytearray([10, 10, 10, 255] * (w * h))
    for y in range(10, 40):
        for x in range(12, 25):
            i = (y * w + x) * 4
            buf[i : i + 3] = b"\xdc\xdc\xdc"
    raw = bytes(buf)
    base = prepare_roi(raw, w, h)
    assert base.width >= 160
    assert base.height >= 96
    variants = list(iter_roi_variants(raw, w, h))
    assert len(variants) >= 4
    assert any(v.width > base.width for v in variants)
