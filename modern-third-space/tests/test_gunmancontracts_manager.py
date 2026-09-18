"""Unit tests for Gunman Contracts haptic mapping and TCP event handling."""

import time

from modern_third_space.server.gunmancontracts_manager import (
    DEFAULT_ENABLED_EVENTS,
    GunmanContractsEvent,
    GunmanContractsManager,
    cells_for_hit_angle,
    map_event_to_haptics,
    normalize_enabled_events,
)
from modern_third_space.vest.cell_layout import LEFT_ARM, LEFT_SIDE, LOWER_CELLS, RIGHT_ARM, Cell


def test_gun_fire_left_uses_left_arm():
    event = GunmanContractsEvent(type="gun_fire", params={"hand": "left"})
    commands = map_event_to_haptics(event)
    cells = [cell for cell, _speed in commands]
    assert cells == list(LEFT_ARM)
    assert all(speed == 5 for _cell, speed in commands)


def test_gun_fire_right_uses_right_arm():
    event = GunmanContractsEvent(type="gun_fire", params={"hand": "right"})
    commands = map_event_to_haptics(event)
    cells = [cell for cell, _speed in commands]
    assert cells == list(RIGHT_ARM)


def test_rifle_fire_stronger_than_gun_fire():
    event = GunmanContractsEvent(type="rifle_fire", params={"hand": "right"})
    commands = map_event_to_haptics(event)
    cells = [cell for cell, _speed in commands]
    assert cells == list(RIGHT_ARM)
    assert all(speed == 6 for _cell, speed in commands)


def test_bow_fire_uses_arm():
    event = GunmanContractsEvent(type="bow_fire", params={"hand": "left"})
    commands = map_event_to_haptics(event)
    cells = [cell for cell, _speed in commands]
    assert cells == list(LEFT_ARM)
    assert all(speed == 5 for _cell, speed in commands)


def test_shotgun_fire_left_uses_left_side():
    event = GunmanContractsEvent(type="shotgun_fire", params={"hand": "left"})
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LEFT_SIDE)


def test_player_hit_front_angle():
    event = GunmanContractsEvent(type="player_hit", params={"angle": 0.0})
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == {Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT}


def test_player_hit_left_angle():
    event = GunmanContractsEvent(type="player_hit", params={"angle": 90.0})
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LEFT_SIDE)


def test_cells_for_hit_angle_back():
    assert set(cells_for_hit_angle(180.0)) == {Cell.BACK_UPPER_LEFT, Cell.BACK_UPPER_RIGHT}


def test_holster_hip_lower_front():
    event = GunmanContractsEvent(
        type="holster_in",
        params={"hand": "right", "holster": "hip"},
    )
    commands = map_event_to_haptics(event)
    assert commands == [(Cell.FRONT_LOWER_RIGHT, 3)]


def test_holster_shoulder_upper_back():
    event = GunmanContractsEvent(
        type="holster_out",
        params={"hand": "left", "holster": "shoulder"},
    )
    commands = map_event_to_haptics(event)
    assert commands == [(Cell.BACK_UPPER_LEFT, 3)]


def test_mag_eject_uses_arm():
    event = GunmanContractsEvent(type="mag_eject", params={"hand": "right"})
    cells = [cell for cell, _speed in map_event_to_haptics(event)]
    assert cells == list(RIGHT_ARM)


def test_reload_uses_hip():
    event = GunmanContractsEvent(type="reload", params={"hand": "left"})
    assert map_event_to_haptics(event) == [(Cell.FRONT_LOWER_LEFT, 4)]


def test_cock_back_uses_arm():
    event = GunmanContractsEvent(type="cock_back", params={"hand": "right"})
    cells = [cell for cell, _speed in map_event_to_haptics(event)]
    assert cells == list(RIGHT_ARM)


def test_ammo_pouch_upper_front():
    event = GunmanContractsEvent(type="ammo_pouch")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == {Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT}


def test_heartbeat_both_front_lower():
    event = GunmanContractsEvent(type="heartbeat")
    commands = map_event_to_haptics(event)
    assert set(commands) == {
        (Cell.FRONT_LOWER_LEFT, 2),
        (Cell.FRONT_LOWER_RIGHT, 2),
    }


def test_healing_uses_lower_cells():
    event = GunmanContractsEvent(type="healing")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LOWER_CELLS)


def test_heartbeat_control_events_map_to_nothing():
    assert map_event_to_haptics(GunmanContractsEvent(type="heartbeat_start")) == []
    assert map_event_to_haptics(GunmanContractsEvent(type="heartbeat_stop")) == []


def test_unknown_event_maps_to_nothing():
    event = GunmanContractsEvent(type="not_a_real_event")
    assert map_event_to_haptics(event) == []


def test_normalize_enabled_events_defaults_all_on():
    assert normalize_enabled_events(None) == DEFAULT_ENABLED_EVENTS
    partial = normalize_enabled_events({"gun_fire": False})
    assert partial["gun_fire"] is False
    assert partial["player_hit"] is True


def test_process_event_ignored_until_started():
    triggers = []
    manager = GunmanContractsManager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    assert manager.process_event("gun_fire", hand="right") is False
    assert triggers == []
    assert manager.events_received == 0


def test_process_event_triggers_and_recoil_when_enabled():
    triggers = []
    recoils = []
    manager = GunmanContractsManager(
        on_trigger=lambda cell, speed: triggers.append((cell, speed)),
        on_recoil=lambda duration_ms: recoils.append(duration_ms),
    )
    manager.start({"enabled": True, "duration_ms": 40})
    assert manager.process_event("gun_fire", hand="left") is True
    assert manager.events_received == 1
    assert manager.last_event_type == "gun_fire"
    assert triggers
    assert recoils
    assert manager.process_event("player_hit", angle=90.0) is True
    assert manager.process_event("rifle_fire", hand="right", weapon="rifle") is True
    assert len(recoils) >= 2
    manager.stop()
    assert manager.process_event("gun_fire", hand="left") is False


def test_process_event_respects_enabled_events_filter():
    triggers = []
    manager = GunmanContractsManager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    manager.start(enabled_events={"gun_fire": False, "player_hit": True})
    assert manager.process_event("gun_fire", hand="right") is True
    assert triggers == []
    assert manager.process_event("player_hit", angle=0.0) is True
    assert triggers
    manager.stop()


def test_reload_hold_on_slide_lock_and_release():
    holds = []
    manager = GunmanContractsManager(on_recoil_hold=lambda on: holds.append(on))
    manager.start({"enabled": True, "duration_ms": 40, "hold_on_reload": True})
    assert manager.process_event("cock_back", hand="right") is True
    assert holds == []
    assert manager.process_event("slide_lock", hand="right") is True
    assert holds == [True]
    # Mag eject / early FPSReleaseSlide must not end hold if we only emit slide_release
    # from SetSlideBack — cock_forward / slide_release end it.
    assert manager.process_event("mag_eject", hand="right") is True
    assert holds == [True]
    assert manager.process_event("cock_forward", hand="right") is True
    assert holds == [True, False]
    manager.stop()


def test_reload_hold_ends_on_slide_release():
    holds = []
    manager = GunmanContractsManager(on_recoil_hold=lambda on: holds.append(on))
    manager.start({"hold_on_reload": True})
    assert manager.process_event("slide_lock", hand="right") is True
    assert manager.process_event("slide_release", hand="right") is True
    assert holds == [True, False]
    manager.stop()


def test_reload_hold_disabled_by_default():
    holds = []
    manager = GunmanContractsManager(on_recoil_hold=lambda on: holds.append(on))
    manager.start({"enabled": True, "duration_ms": 40})
    assert manager.process_event("slide_lock", hand="right") is True
    assert holds == []
    manager.stop()


def test_heartbeat_start_loops_until_stop():
    triggers = []
    manager = GunmanContractsManager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    manager.start()
    assert manager.process_event("heartbeat_start") is True
    time.sleep(0.15)
    assert len(triggers) >= 2  # immediate pulse on both lower cells
    before = len(triggers)
    assert manager.process_event("heartbeat_stop") is True
    time.sleep(0.2)
    assert len(triggers) == before
    manager.stop()


def test_stop_releases_active_reload_hold():
    holds = []
    manager = GunmanContractsManager(on_recoil_hold=lambda on: holds.append(on))
    manager.start({"hold_on_reload": True})
    assert manager.process_event("slide_lock", hand="right") is True
    assert holds == [True]
    manager.stop()
    assert holds == [True, False]
