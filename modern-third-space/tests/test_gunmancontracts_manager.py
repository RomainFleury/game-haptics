"""Unit tests for Gunman Contracts haptic mapping and TCP event handling."""

from modern_third_space.server.gunmancontracts_manager import (
    GunmanContractsEvent,
    GunmanContractsManager,
    cells_for_hit_angle,
    map_event_to_haptics,
)
from modern_third_space.vest.cell_layout import LEFT_ARM, LEFT_SIDE, RIGHT_ARM, Cell


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


def test_heartbeat_both_front_lower():
    event = GunmanContractsEvent(type="heartbeat")
    commands = map_event_to_haptics(event)
    assert set(commands) == {
        (Cell.FRONT_LOWER_LEFT, 2),
        (Cell.FRONT_LOWER_RIGHT, 2),
    }


def test_unknown_event_maps_to_nothing():
    event = GunmanContractsEvent(type="not_a_real_event")
    assert map_event_to_haptics(event) == []


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
