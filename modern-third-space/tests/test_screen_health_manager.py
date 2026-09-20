import time

import pytest

from modern_third_space.server import screen_health_manager as shm


def test_normalized_rect_to_pixels_basic():
    rect = shm.NormalizedRect(x=0.5, y=0.5, w=0.2, h=0.2)
    left, top, w, h = shm.normalized_rect_to_pixels(rect, frame_w=100, frame_h=100)
    assert (left, top, w, h) == (50, 50, 20, 20)


def test_normalized_rect_to_pixels_clamps_to_frame():
    # This would exceed the frame to the right/bottom; ensure we clamp.
    rect = shm.NormalizedRect(x=0.9, y=0.9, w=0.5, h=0.5)
    left, top, w, h = shm.normalized_rect_to_pixels(rect, frame_w=100, frame_h=100)
    assert left == 90
    assert top == 90
    assert w == 10
    assert h == 10


def test_clamp_crop_rect_clips_to_actual_frame():
    assert shm.clamp_crop_rect(100, 90, 50, 50, 120, 130) == (100, 90, 20, 40)


def test_as_captured_bgra_accepts_tuple_and_bytes():
    raw = b"\x00\x00\xff\xff" * 6
    assert shm._as_captured_bgra((raw, 3, 2), 10, 10) == (raw, 3, 2)
    assert shm._as_captured_bgra(raw, 3, 2) == (raw, 3, 2)


def test_manager_skips_undersized_capture_without_dying(monkeypatch):
    class FakeCapture:
        def __init__(self, monitor_index: int):
            self.monitor_index = monitor_index

        def get_frame_size(self):
            return 10, 10

        def capture_multiple_bgra(self, regions):
            return [b"\x00\x00\xff\xff"]  # 1 pixel; requested ROI is larger

    monkeypatch.setattr(shm, "_create_capture_backend", lambda *, monitor_index: FakeCapture(monitor_index))

    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    ok, err = manager.start(
        {
            "schema_version": 0,
            "name": "undersized",
            "capture": {"source": "monitor", "monitor_index": 1, "tick_ms": 10},
            "detectors": [
                {
                    "type": "redness_rois",
                    "cooldown_ms": 200,
                    "threshold": {"min_score": 0.2},
                    "rois": [{"name": "roi1", "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}}],
                }
            ],
        }
    )
    assert ok, err
    try:
        time.sleep(0.05)
        assert manager._thread is not None
        assert manager._thread.is_alive()
    finally:
        manager.stop()



def test_redness_score_from_bgra_expected_value():
    # 2x1 pixels: [pure red, gray]
    # pure red dominance: (255 - max(0,0))/255 = 1
    # gray dominance: (128 - max(128,128))/255 = 0
    # mean = 0.5
    raw = bytes(
        [
            0,
            0,
            255,
            255,  # BGRA red
            128,
            128,
            128,
            255,  # BGRA gray
        ]
    )
    score = shm.redness_score_from_bgra(raw, width=2, height=1)
    assert score == pytest.approx(0.5, abs=1e-6)


def test_color_match_score_from_bgra_expected_value():
    # 2x1: exact orange + black. tolerance 120 → orange=1, black L1=383 → 0. Mean 0.5
    raw = bytes(
        [
            0,
            128,
            255,
            255,  # BGRA orange (255,128,0)
            0,
            0,
            0,
            255,  # BGRA black
        ]
    )
    score = shm.color_match_score_from_bgra(
        raw, width=2, height=1, target_rgb=(255, 128, 0), tolerance_l1=120
    )
    assert score == pytest.approx(0.5, abs=1e-6)


def test_parse_profile_color_vignette():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "color_vignette_only",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "color_vignette",
                    "cooldown_ms": 180,
                    "threshold": {"min_score": 0.4},
                    "target_rgb": [40, 180, 255],
                    "tolerance_l1": 90,
                    "rois": [
                        {
                            "name": "edge",
                            "direction": "front",
                            "rect": {"x": 0.0, "y": 0.0, "w": 0.1, "h": 0.2},
                        }
                    ],
                }
            ],
        }
    )
    assert parsed.redness_detector is None
    assert parsed.color_vignette_detector is not None
    assert parsed.color_vignette_detector.min_score == pytest.approx(0.4)
    assert parsed.color_vignette_detector.cooldown_ms == 180
    assert parsed.color_vignette_detector.tolerance_l1 == 90
    assert parsed.color_vignette_detector.target.as_tuple() == (40, 180, 255)
    assert len(parsed.color_vignette_rois) == 1
    assert parsed.color_vignette_rois[0].name == "edge"


def test_parse_profile_skips_empty_color_vignette_rois():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "empty_color_then_health",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "color_vignette",
                    "target_rgb": [255, 255, 255],
                    "rois": [],
                },
                {
                    "type": "health_bar",
                    "name": "health_bar",
                    "roi": {"x": 0.1, "y": 0.9, "w": 0.3, "h": 0.03},
                    "orientation": "horizontal",
                    "threshold_fallback": {"mode": "brightness", "min": 0.5},
                    "hit_on_decrease": {"min_drop": 0.02, "cooldown_ms": 150},
                },
            ],
        }
    )
    assert parsed.color_vignette_detector is None
    assert parsed.color_vignette_rois == []
    assert len(parsed.health_bars) == 1


def test_health_bar_percent_from_bgra_half_filled():
    # 10x2 ROI: left half filled (red), right half empty (dark)
    w, h = 10, 2
    filled = (220, 40, 40)
    empty = (40, 40, 40)

    def px(rgb):
        r, g, b = rgb
        return [b, g, r, 255]  # BGRA

    raw = bytearray()
    for _y in range(h):
        for x in range(w):
            raw.extend(px(filled if x < 5 else empty))

    percent = shm.health_bar_percent_from_bgra(
        bytes(raw),
        w,
        h,
        filled_rgb=filled,
        empty_rgb=empty,
        tolerance_l1=0,
        column_threshold=0.5,
    )
    assert percent == pytest.approx(0.5, abs=1e-6)


def test_manager_cooldown_prevents_hit_spam(monkeypatch):
    class FakeCapture:
        def __init__(self, monitor_index: int):
            self.monitor_index = monitor_index

        def get_frame_size(self):
            return 10, 10

        def capture_bgra(self, left: int, top: int, width: int, height: int) -> bytes:
            # Always return pure red ROI (score=1)
            return bytes([0, 0, 255, 255] * (width * height))

        def capture_multiple_bgra(self, regions):
            return [self.capture_bgra(l, t, w, h) for l, t, w, h in regions]

    monkeypatch.setattr(shm, "_create_capture_backend", lambda *, monitor_index: FakeCapture(monitor_index))

    events = []

    def on_game_event(event_type: str, params: dict):
        events.append((event_type, params))

    manager = shm.ScreenHealthManager(on_game_event=on_game_event, on_trigger=lambda c, s: None)

    profile = {
        "schema_version": 0,
        "name": "test",
        "capture": {"source": "monitor", "monitor_index": 1, "tick_ms": 10},
        "detectors": [
            {
                "type": "redness_rois",
                "cooldown_ms": 200,
                "threshold": {"min_score": 0.2},
                "rois": [{"name": "roi1", "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}}],
            }
        ],
    }

    ok, err = manager.start(profile)
    assert ok, err
    try:
        time.sleep(0.06)  # ~6 ticks
    finally:
        manager.stop()

    hit_events = [e for e in events if e[0] == "hit_recorded"]
    assert len(hit_events) == 1, "Cooldown should prevent multiple hits within 200ms"


def test_profile_allows_meta_and_rejects_invalid_direction(monkeypatch):
    class FakeCapture:
        def __init__(self, monitor_index: int):
            self.monitor_index = monitor_index

        def get_frame_size(self):
            return 10, 10

        def capture_bgra(self, left: int, top: int, width: int, height: int) -> bytes:
            return bytes([0, 0, 0, 255] * (width * height))

        def capture_multiple_bgra(self, regions):
            return [self.capture_bgra(l, t, w, h) for l, t, w, h in regions]

    monkeypatch.setattr(shm, "_create_capture_backend", lambda *, monitor_index: FakeCapture(monitor_index))

    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)

    ok, err = manager.start(
        {
            "schema_version": 0,
            "name": "meta ok",
            "meta": {"preset_id": "x", "game_name": "y"},
            "capture": {"source": "monitor", "monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "redness_rois",
                    "cooldown_ms": 0,
                    "threshold": {"min_score": 1.0},
                    "rois": [{"name": "r1", "rect": {"x": 0, "y": 0, "w": 0.5, "h": 0.5}}],
                }
            ],
        }
    )
    assert ok, err
    manager.stop()

    ok, err = manager.start(
        {
            "schema_version": 0,
            "name": "bad direction",
            "capture": {"source": "monitor", "monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "redness_rois",
                    "cooldown_ms": 0,
                    "threshold": {"min_score": 1.0},
                    "rois": [
                        {
                            "name": "r1",
                            "direction": "diagonal_up_left",
                            "rect": {"x": 0, "y": 0, "w": 0.5, "h": 0.5},
                        }
                    ],
                }
            ],
        }
    )
    assert ok is False
    assert err


def test_manager_health_bar_hit_on_decrease(monkeypatch):
    class FakeCapture:
        def __init__(self, monitor_index: int):
            self.monitor_index = monitor_index
            self._calls = 0

        def get_frame_size(self):
            return 10, 10

        def capture_bgra(self, left: int, top: int, width: int, height: int) -> bytes:
            # First few ticks: fully filled; then drop to 70% filled.
            self._calls += 1
            filled_cols = width if self._calls <= 3 else int(width * 0.7)

            filled = (220, 40, 40)
            empty = (40, 40, 40)

            def px(rgb):
                r, g, b = rgb
                return [b, g, r, 255]

            raw = bytearray()
            for _y in range(height):
                for x in range(width):
                    raw.extend(px(filled if x < filled_cols else empty))
            return bytes(raw)

        def capture_multiple_bgra(self, regions):
            return [self.capture_bgra(l, t, w, h) for l, t, w, h in regions]

    monkeypatch.setattr(shm, "_create_capture_backend", lambda *, monitor_index: FakeCapture(monitor_index))

    events = []

    def on_game_event(event_type: str, params: dict):
        events.append((event_type, params))

    manager = shm.ScreenHealthManager(on_game_event=on_game_event, on_trigger=lambda *_: None)
    profile = {
        "schema_version": 0,
        "name": "hb test",
        "capture": {"source": "monitor", "monitor_index": 1, "tick_ms": 10},
        "detectors": [
            {
                "type": "health_bar",
                "name": "hb1",
                "roi": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5},
                "orientation": "horizontal",
                "color_sampling": {
                    "filled_rgb": [220, 40, 40],
                    "empty_rgb": [40, 40, 40],
                    "tolerance_l1": 0,
                },
                "hit_on_decrease": {"min_drop": 0.1, "cooldown_ms": 0},
            }
        ],
    }

    ok, err = manager.start(profile)
    assert ok, err
    try:
        time.sleep(0.07)  # ~7 ticks
    finally:
        manager.stop()

    hit_events = [e for e in events if e[0] == "hit_recorded" and e[1].get("source") == "health_bar"]
    assert len(hit_events) >= 1


def test_binarize_bgra_to_bitmap_basic():
    # 2x1 pixels: [black, white] with threshold 0.5 => [0,1]
    raw = bytes(
        [
            0,
            0,
            0,
            255,  # black
            255,
            255,
            255,
            255,  # white
        ]
    )
    bits, w, h = shm.binarize_bgra_to_bitmap(raw, 2, 1, threshold=0.5, invert=False, scale=1)
    assert (w, h) == (2, 1)
    assert bits[:2] == [0, 1]


def test_binarize_bgra_to_bitmap_invert():
    # 2x1 pixels: [black, white] with threshold 0.5, invert=True => [1,0]
    raw = bytes(
        [
            0,
            0,
            0,
            255,  # black
            255,
            255,
            255,
            255,  # white
        ]
    )
    bits, w, h = shm.binarize_bgra_to_bitmap(raw, 2, 1, threshold=0.5, invert=True, scale=1)
    assert (w, h) == (2, 1)
    assert bits[:2] == [1, 0]


def test_binarize_bgra_to_bitmap_scale_replicates_pixels():
    # 1x1 pixel: white, scale=2 => 2x2 all ones (threshold 0.5)
    raw = bytes([255, 255, 255, 255])
    bits, w, h = shm.binarize_bgra_to_bitmap(raw, 1, 1, threshold=0.5, invert=False, scale=2)
    assert (w, h) == (2, 2)
    assert bits == [1, 1, 1, 1]


def _tmpl_digit_0(w: int, h: int) -> list[int]:
    # Border rectangle
    out: list[int] = [0] * (w * h)
    for y in range(h):
        for x in range(w):
            if x == 0 or x == (w - 1) or y == 0 or y == (h - 1):
                out[y * w + x] = 1
    return out


def _tmpl_digit_1(w: int, h: int) -> list[int]:
    # Center vertical line
    out: list[int] = [0] * (w * h)
    cx = w // 2
    for y in range(h):
        out[y * w + cx] = 1
    return out


def _tmpl_digit_5(w: int, h: int) -> list[int]:
    # Simple "5": top, middle, bottom bars + left-top + right-bottom stems
    out: list[int] = [0] * (w * h)
    for x in range(w):
        out[0 * w + x] = 1
        out[(h // 2) * w + x] = 1
        out[(h - 1) * w + x] = 1
    for y in range(1, h // 2):
        out[y * w + 0] = 1
    for y in range((h // 2) + 1, h - 1):
        out[y * w + (w - 1)] = 1
    return out


def _render_digits_bits(digits: str, templates: dict[str, list[int]], w: int, h: int) -> list[int]:
    # Compose digit slices horizontally, row by row (row-major for the whole ROI)
    out: list[int] = []
    for y in range(h):
        for ch in digits:
            t = templates[ch]
            out.extend(t[y * w : (y + 1) * w])
    return out


def _make_hn_detector(*, digits: int, templates: dict[str, list[int]], w: int, h: int, hamming_max: int, min_v: int = 0, max_v: int = 999) -> shm.HealthNumberDetector:
    return shm.HealthNumberDetector(
        rect=shm.NormalizedRect(x=0.0, y=0.0, w=1.0, h=1.0),
        digits=digits,
        preprocess=shm.HealthNumberPreprocess(invert=False, threshold=0.5, scale=1),
        readout=shm.HealthNumberReadout(min_value=min_v, max_value=max_v, stable_reads=1),
        hit_on_decrease=shm.HealthNumberHitOnDecrease(min_drop=1, cooldown_ms=0),
        templates=shm.HealthNumberTemplates(
            template_set_id="unit_test",
            hamming_max=hamming_max,
            width=w,
            height=h,
            digits=templates,
        ),
        name="hn_test",
    )


def test_health_number_try_read_single_digit_exact_match():
    w, h = 5, 7
    templates = {"0": _tmpl_digit_0(w, h), "1": _tmpl_digit_1(w, h)}
    hn = _make_hn_detector(digits=1, templates=templates, w=w, h=h, hamming_max=0)

    bits = templates["1"]
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    assert manager._health_number_try_read(bits, bw=w, bh=h, hn=hn) == 1


def test_health_number_try_read_multi_digit_exact_match():
    w, h = 5, 7
    templates = {"0": _tmpl_digit_0(w, h), "1": _tmpl_digit_1(w, h), "5": _tmpl_digit_5(w, h)}
    hn = _make_hn_detector(digits=3, templates=templates, w=w, h=h, hamming_max=0)

    bits = _render_digits_bits("105", templates, w, h)
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    assert manager._health_number_try_read(bits, bw=3 * w, bh=h, hn=hn) == 105


def test_health_number_try_read_allows_small_noise_with_hamming_max():
    w, h = 5, 7
    templates = {"1": _tmpl_digit_1(w, h)}
    # Allow exactly 1 bit difference
    hn = _make_hn_detector(digits=1, templates=templates, w=w, h=h, hamming_max=1)

    noisy = list(templates["1"])
    noisy[0] = 0 if noisy[0] else 1  # flip one bit
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    assert manager._health_number_try_read(noisy, bw=w, bh=h, hn=hn) == 1


def test_health_number_try_read_rejects_when_hamming_exceeds_max():
    w, h = 5, 7
    templates = {"1": _tmpl_digit_1(w, h)}
    hn = _make_hn_detector(digits=1, templates=templates, w=w, h=h, hamming_max=0)

    noisy = list(templates["1"])
    noisy[0] = 0 if noisy[0] else 1  # flip one bit => distance 1 > 0
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    assert manager._health_number_try_read(noisy, bw=w, bh=h, hn=hn) is None


def test_health_number_try_read_rejects_value_outside_range():
    w, h = 5, 7
    templates = {"5": _tmpl_digit_5(w, h)}
    hn = _make_hn_detector(digits=3, templates=templates, w=w, h=h, hamming_max=0, min_v=0, max_v=200)

    bits = _render_digits_bits("555", templates, w, h)
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    assert manager._health_number_try_read(bits, bw=3 * w, bh=h, hn=hn) is None


def test_parse_profile_recoil_ammo_number():
    manager = shm.ScreenHealthManager()
    profile = {
        "schema_version": 0,
        "name": "with_recoil",
        "capture": {"monitor_index": 1, "tick_ms": 50},
        "detectors": [
            {
                "type": "redness_rois",
                "cooldown_ms": 200,
                "threshold": {"min_score": 0.35},
                "rois": [{"name": "r1", "rect": {"x": 0, "y": 0, "w": 0.1, "h": 0.1}}],
            }
        ],
        "recoil": {
            "type": "ammo_number",
            "duration_ms": 45,
            "roi": {"x": 0.8, "y": 0.9, "w": 0.08, "h": 0.04},
            "digits": 2,
            "preprocess": {"invert": False, "threshold": 0.6, "scale": 2},
            "readout": {"min": 0, "max": 99, "stable_reads": 1},
            "hit_on_decrease": {"min_drop": 1, "cooldown_ms": 50},
            "templates": {
                "template_set_id": "t",
                "hamming_max": 120,
                "width": 2,
                "height": 2,
                "digits": {"0": "0000", "1": "1111"},
            },
        },
    }
    parsed = manager._parse_profile(profile)
    assert len(parsed.ammo_numbers) == 1
    assert parsed.ammo_numbers[0].name == "ammo_number"
    assert parsed.recoil_duration_ms == 45
    assert parsed.ammo_numbers[0].engine == "daemon"
    assert parsed.ammo_numbers[0].templates is None


def test_parse_profile_recoil_ammo_number_zones():
    """Dual-wield: two ammo number ROIs under recoil.zones[]."""
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "rdr_dual_ammo",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [],
            "recoil": {
                "type": "ammo_number",
                "engine": "daemon",
                "duration_ms": 40,
                "digits": 3,
                "readout": {"min": 0, "max": 999, "stable_reads": 2},
                "hit_on_decrease": {"min_drop": 1, "cooldown_ms": 50},
                "zones": [
                    {"name": "ammo_primary", "roi": {"x": 0.82, "y": 0.88, "w": 0.06, "h": 0.04}},
                    {"name": "ammo_offhand", "roi": {"x": 0.74, "y": 0.88, "w": 0.06, "h": 0.04}},
                ],
            },
        }
    )
    assert len(parsed.ammo_numbers) == 2
    assert parsed.ammo_numbers[0].name == "ammo_primary"
    assert parsed.ammo_numbers[1].name == "ammo_offhand"
    assert parsed.ammo_numbers[0].rect.x == pytest.approx(0.82)
    assert parsed.ammo_numbers[1].rect.x == pytest.approx(0.74)
    assert parsed.fill_up_bars == []


def test_parse_profile_skips_empty_redness_rois():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "health_bar_only",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "redness_rois",
                    "cooldown_ms": 200,
                    "threshold": {"min_score": 0.35},
                    "rois": [],
                },
                {
                    "type": "health_bar",
                    "name": "health_bar",
                    "roi": {"x": 0.1, "y": 0.9, "w": 0.3, "h": 0.03},
                    "orientation": "horizontal",
                    "threshold_fallback": {"mode": "brightness", "min": 0.5},
                    "hit_on_decrease": {"min_drop": 0.02, "cooldown_ms": 150},
                },
            ],
        }
    )
    assert parsed.redness_detector is None
    assert parsed.redness_rois == []
    assert len(parsed.health_bars) == 1


def test_parse_profile_ammo_only_without_hit_detector():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "ammo_only",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [],
            "recoil": {
                "type": "ammo_number",
                "engine": "daemon",
                "duration_ms": 40,
                "roi": {"x": 0.8, "y": 0.9, "w": 0.08, "h": 0.04},
                "digits": 3,
                "readout": {"min": 0, "max": 999, "stable_reads": 2},
                "hit_on_decrease": {"min_drop": 1, "cooldown_ms": 50},
            },
        }
    )
    assert parsed.redness_detector is None
    assert parsed.health_bars == []
    assert parsed.health_numbers == []
    assert len(parsed.ammo_numbers) == 1
    assert parsed.ammo_numbers[0].engine == "daemon"


def test_parse_profile_rejects_empty_setup():
    manager = shm.ScreenHealthManager()
    with pytest.raises(ValueError, match="hit detector or ammo recoil"):
        manager._parse_profile(
            {
                "schema_version": 0,
                "name": "empty",
                "capture": {"monitor_index": 1, "tick_ms": 50},
                "detectors": [
                    {
                        "type": "redness_rois",
                        "cooldown_ms": 200,
                        "threshold": {"min_score": 0.35},
                        "rois": [],
                    }
                ],
            }
        )


def test_parse_profile_health_number_uses_daemon_ocr_without_templates():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "hp_ocr",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "health_number",
                    "name": "health_number",
                    "engine": "daemon",
                    "roi": {"x": 0.05, "y": 0.9, "w": 0.12, "h": 0.06},
                    "digits": 3,
                    "readout": {"min": 0, "max": 300, "stable_reads": 2},
                    "hit_on_decrease": {"min_drop": 1, "cooldown_ms": 150},
                }
            ],
        }
    )
    assert len(parsed.health_numbers) == 1
    assert parsed.health_numbers[0].engine == "daemon"
    assert parsed.health_numbers[0].templates is None
    assert parsed.health_numbers[0].readout.max_value == 300


def test_parse_profile_health_number_keeps_templates_when_present():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        {
            "schema_version": 0,
            "name": "hp_templates",
            "capture": {"monitor_index": 1, "tick_ms": 50},
            "detectors": [
                {
                    "type": "health_number",
                    "roi": {"x": 0.05, "y": 0.9, "w": 0.12, "h": 0.06},
                    "digits": 1,
                    "preprocess": {"invert": False, "threshold": 0.6, "scale": 1},
                    "readout": {"min": 0, "max": 9, "stable_reads": 1},
                    "hit_on_decrease": {"min_drop": 1, "cooldown_ms": 50},
                    "templates": {
                        "template_set_id": "t",
                        "hamming_max": 0,
                        "width": 2,
                        "height": 2,
                        "digits": {"1": "1100"},
                    },
                }
            ],
        }
    )
    assert parsed.health_numbers[0].engine == "templates"
    assert parsed.health_numbers[0].templates is not None



def test_debug_write_bmp_bgra_writes_valid_header(tmp_path):
    manager = shm.ScreenHealthManager(on_game_event=lambda *_: None, on_trigger=lambda *_: None)
    # 2x1 BGRA: [black, white]
    raw = bytes(
        [
            0,
            0,
            0,
            255,
            255,
            255,
            255,
            255,
        ]
    )
    out = tmp_path / "roi.bmp"
    manager._write_bmp_bgra(out, raw, 2, 1)
    data = out.read_bytes()
    assert data[:2] == b"BM"
    # BMP header is 54 bytes, then pixel data
    assert len(data) == 54 + (2 * 1 * 4)


def _fill_up_profile(**overrides):
    recoil = {
        "type": "fill_up_bar",
        "duration_ms": 40,
        "roi": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
        "color_sampling": {
            "background_rgb": [30, 30, 30],
            "tolerance_l1": 0,
        },
        "fill_up": {
            "min_background_drop": 0.1,
            "cooldown_ms": 0,
        },
    }
    recoil.update(overrides.pop("recoil", {}))
    profile = {
        "schema_version": 0,
        "name": "fill_up_only",
        "capture": {"monitor_index": 1, "tick_ms": 10},
        "detectors": [],
        "recoil": recoil,
    }
    profile.update(overrides)
    return profile


def _horizontal_bar_bgra(
    width: int, height: int, *, filled_frac: float = 0.0, fill_color: str = "white"
) -> bytes:
    """Synthetic heat bar: left portion filled (white or red), rest is background."""
    background = (30, 30, 30)
    white = (220, 220, 210)
    red = (200, 40, 40)
    fill = red if fill_color == "red" else white
    filled_cols = int(width * filled_frac)
    raw = bytearray()
    for _y in range(height):
        for x in range(width):
            rgb = fill if x < filled_cols else background
            r, g, b = rgb
            raw.extend((b, g, r, 255))
    return bytes(raw)


def test_parse_profile_recoil_fill_up_bar():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(_fill_up_profile())
    assert len(parsed.fill_up_bars) == 1
    assert parsed.ammo_numbers == []
    bar = parsed.fill_up_bars[0]
    assert bar.name == "fill_up_bar"
    assert parsed.recoil_duration_ms == 40
    assert bar.background.as_tuple() == (30, 30, 30)
    assert bar.min_background_drop == pytest.approx(0.1)


def test_parse_profile_fill_up_bar_accepts_legacy_empty_rgb():
    manager = shm.ScreenHealthManager()
    parsed = manager._parse_profile(
        _fill_up_profile(
            recoil={
                "color_sampling": {
                    "empty_rgb": [12, 13, 14],
                    "tolerance_l1": 50,
                },
                "fill_up": {"min_rise": 0.05, "cooldown_ms": 0},
            }
        )
    )
    bar = parsed.fill_up_bars[0]
    assert bar.background.as_tuple() == (12, 13, 14)
    assert bar.min_background_drop == pytest.approx(0.05)


def test_fill_up_recoil_state_machine_on_background_drop():
    manager = shm.ScreenHealthManager()
    bar = shm.FillUpBarDetector(
        rect=shm.NormalizedRect(x=0, y=0, w=1, h=1),
        background=shm.RGB(30, 30, 30),
        tolerance_l1=40,
        min_background_drop=0.1,
        cooldown_ms=0,
        duration_ms=40,
    )
    bar.validate()
    now = 1000.0
    # Seed with mostly-empty bar (high background coverage).
    assert manager._tick_fill_up_recoil(bar, 0.9, now) is None
    # White fill: background drops → shot.
    shot = manager._tick_fill_up_recoil(bar, 0.7, now)
    assert shot is not None
    assert shot["source"] == "fill_up_bar"
    assert shot["background_drop"] == pytest.approx(0.2)
    assert shot["fill_fraction"] == pytest.approx(0.3)
    # Small further drop ignored.
    assert manager._tick_fill_up_recoil(bar, 0.68, now) is None
    # Red fill continues: same detector, still a background drop → shot.
    shot_red = manager._tick_fill_up_recoil(bar, 0.4, now)
    assert shot_red is not None
    # Prev stayed at 0.7 (sub-threshold 0.68 ignored) → drop is 0.3.
    assert shot_red["background_drop"] == pytest.approx(0.3)
    # Background recovers (cooldown / empty) — no pulse, track upward.
    assert manager._tick_fill_up_recoil(bar, 1.0, now) is None
    # Next fill after empty → shot again.
    shot2 = manager._tick_fill_up_recoil(bar, 0.75, now)
    assert shot2 is not None
    assert shot2["percent"] == pytest.approx(0.25)


def test_background_coverage_from_bgra():
    raw = _horizontal_bar_bgra(10, 4, filled_frac=0.4, fill_color="white")
    bg = shm.background_coverage_from_bgra(
        raw, 10, 4, background_rgb=(30, 30, 30), tolerance_l1=0
    )
    assert bg == pytest.approx(0.6)
    raw_red = _horizontal_bar_bgra(10, 4, filled_frac=0.4, fill_color="red")
    bg_red = shm.background_coverage_from_bgra(
        raw_red, 10, 4, background_rgb=(30, 30, 30), tolerance_l1=0
    )
    assert bg_red == pytest.approx(0.6)


def test_test_profile_once_fill_up_bar():
    manager = shm.ScreenHealthManager()
    raw = _horizontal_bar_bgra(10, 4, filled_frac=0.5)
    ok, result, err = manager.test_profile_once(
        _fill_up_profile(),
        frame_bgra_bytes=raw,
        frame_width=10,
        frame_height=4,
    )
    assert ok, err
    det = next(d for d in result["detectors"] if d["type"] == "fill_up_bar")
    assert det["background_fraction"] == pytest.approx(0.5)
    assert det["fill_fraction"] == pytest.approx(0.5)
    assert det["percent"] == pytest.approx(0.5)


def test_manager_fill_up_bar_recoil_on_background_drop(monkeypatch):
    class FakeCapture:
        def __init__(self, monitor_index: int):
            self.monitor_index = monitor_index
            self._calls = 0

        def get_frame_size(self):
            return 10, 4

        def capture_bgra(self, left: int, top: int, width: int, height: int) -> bytes:
            self._calls += 1
            if self._calls <= 3:
                return _horizontal_bar_bgra(width, height, filled_frac=0.2)
            if self._calls <= 6:
                return _horizontal_bar_bgra(width, height, filled_frac=0.6)
            if self._calls <= 8:
                # Continue filling in red — still not background → further drop.
                return _horizontal_bar_bgra(width, height, filled_frac=0.9, fill_color="red")
            if self._calls <= 10:
                return _horizontal_bar_bgra(width, height, filled_frac=0.0)
            return _horizontal_bar_bgra(width, height, filled_frac=0.35)

        def capture_multiple_bgra(self, regions):
            return [self.capture_bgra(l, t, w, h) for l, t, w, h in regions]

    monkeypatch.setattr(shm, "_create_capture_backend", lambda *, monitor_index: FakeCapture(monitor_index))
    events = []
    recoils = []

    manager = shm.ScreenHealthManager(
        on_game_event=lambda event_type, params: events.append((event_type, params)),
        on_recoil=lambda ms: recoils.append(ms),
    )
    ok, err = manager.start(_fill_up_profile())
    assert ok, err
    try:
        time.sleep(0.18)
    finally:
        manager.stop()

    shots = [e for e in events if e[0] == "recoil_fired" and e[1].get("source") == "fill_up_bar"]
    assert len(shots) >= 2
    assert len(recoils) == len(shots)


