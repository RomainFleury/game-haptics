"""Unit tests for Titanfall 2 VR vest mapping and solenoid recoil."""

from modern_third_space.server.titanfall2_manager import (
    DEFAULT_ENABLED_EVENTS,
    Titanfall2Event,
    Titanfall2Manager,
    canonical_event_type,
    cells_for_hit_angle,
    map_event_to_haptics,
    normalize_enabled_events,
)
from modern_third_space.vest.cell_layout import (
    ALL_CELLS,
    LEFT_ARM,
    LEFT_SIDE,
    LOWER_CELLS,
    RIGHT_ARM,
    RIGHT_SIDE,
    UPPER_CELLS,
    Cell,
)


def test_pistol_recoil_left_arm():
    event = Titanfall2Event(type="recoil_pistol", params={"hand": "left"})
    commands = map_event_to_haptics(event)
    assert [cell for cell, _speed in commands] == list(LEFT_ARM)
    assert all(speed == 5 for _cell, speed in commands)


def test_rifle_recoil_right_arm_stronger_than_pistol():
    event = Titanfall2Event(type="recoil_rifle", params={"hand": "right"})
    commands = map_event_to_haptics(event)
    assert [cell for cell, _speed in commands] == list(RIGHT_ARM)
    assert all(speed == 6 for _cell, speed in commands)


def test_shotgun_recoil_uses_side():
    event = Titanfall2Event(type="recoil_shotgun", params={"hand": "left"})
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LEFT_SIDE)
    assert all(speed == 8 for _cell, speed in map_event_to_haptics(event))


def test_unknown_hand_defaults_to_right():
    event = Titanfall2Event(type="recoil_pistol")
    cells = [cell for cell, _speed in map_event_to_haptics(event)]
    assert cells == list(RIGHT_ARM)


def test_titan_shot_uses_upper_body():
    event = Titanfall2Event(type="recoil_titan")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(UPPER_CELLS)


def test_titan_rockets_use_all_cells():
    event = Titanfall2Event(type="recoil_titan_rockets")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(ALL_CELLS)


def test_impact_left_angle():
    event = Titanfall2Event(type="impact", params={"angle": 90.0})
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LEFT_SIDE)


def test_cells_for_hit_angle_back():
    assert set(cells_for_hit_angle(180.0)) == {Cell.BACK_UPPER_LEFT, Cell.BACK_UPPER_RIGHT}


def test_explosion_intensity_scales_speed():
    event = Titanfall2Event(type="explosion", params={"angle": 0.0, "intensity": 0.5})
    commands = map_event_to_haptics(event)
    assert commands
    assert all(speed == 4 for _cell, speed in commands)


def test_charge_zero_intensity_is_silent():
    event = Titanfall2Event(type="charge", params={"hand": "right", "intensity": 0.0})
    assert map_event_to_haptics(event) == []


def test_charge_fraction_uses_weapon_arm():
    event = Titanfall2Event(type="charge", params={"hand": "left", "intensity": 1.0})
    cells = [cell for cell, speed in map_event_to_haptics(event)]
    assert cells == list(LEFT_ARM)


def test_player_killed_all_cells():
    event = Titanfall2Event(type="player_killed")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(ALL_CELLS)


def test_heartbeat_front_lower():
    event = Titanfall2Event(type="heartbeat")
    assert set(map_event_to_haptics(event)) == {
        (Cell.FRONT_LOWER_LEFT, 2),
        (Cell.FRONT_LOWER_RIGHT, 2),
    }


def test_healing_uses_lower_cells():
    event = Titanfall2Event(type="healing")
    cells = {cell for cell, _speed in map_event_to_haptics(event)}
    assert cells == set(LOWER_CELLS)


def test_canonical_protube_groups():
    assert canonical_event_type("gun_fire", "full") == "recoil_shotgun"
    assert canonical_event_type("gun_fire", "heavy") == "recoil_heavy"
    assert canonical_event_type("gun_fire", "pistol") == "recoil_pistol"
    assert canonical_event_type("PT_Kick", "rifle") == "recoil_rifle"
    assert canonical_event_type("recoil_pistol_r") == "recoil_pistol"
    assert canonical_event_type("titan_rockets") == "recoil_titan_rockets"
    assert canonical_event_type("player_death") == "player_killed"


def test_normalize_enabled_events_defaults_all_on():
    assert normalize_enabled_events(None) == DEFAULT_ENABLED_EVENTS
    partial = normalize_enabled_events({"recoil_pistol": False})
    assert partial["recoil_pistol"] is False
    assert partial["impact"] is True


def test_process_event_ignored_until_started():
    triggers = []
    manager = Titanfall2Manager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    assert manager.process_event("recoil_pistol", hand="right") is False
    assert triggers == []
    assert manager.events_received == 0


def test_process_event_vest_and_solenoid():
    triggers = []
    recoils = []
    manager = Titanfall2Manager(
        on_trigger=lambda cell, speed: triggers.append((cell, speed)),
        on_recoil=lambda duration_ms: recoils.append(duration_ms),
    )
    manager.start({"enabled": True, "duration_ms": 40})
    assert manager.process_event("gun_fire", group="full", hand="left", weapon="mp_weapon_mastiff") is True
    assert manager.last_event_type == "recoil_shotgun"
    assert {cell for cell, _speed in triggers} == set(LEFT_SIDE)
    assert recoils and recoils[0] >= 70

    assert manager.process_event("impact", angle=270.0) is True
    assert {cell for cell, _speed in triggers} >= set(RIGHT_SIDE)
    assert len(recoils) == 1  # hits do not kick the gun

    assert manager.process_event("recoil_titan_rockets") is True
    assert recoils[-1] >= 90
    manager.stop()
    assert manager.process_event("recoil_pistol", hand="right") is False


def test_charge_does_not_pulse_solenoid():
    recoils = []
    triggers = []
    manager = Titanfall2Manager(
        on_trigger=lambda cell, speed: triggers.append((cell, speed)),
        on_recoil=lambda duration_ms: recoils.append(duration_ms),
    )
    manager.start()
    assert manager.process_event("charge", hand="right", intensity=0.4) is True
    assert triggers
    assert recoils == []
    manager.stop()


def test_disabled_event_skips_haptics():
    triggers = []
    manager = Titanfall2Manager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    manager.start(enabled_events={"recoil_pistol": False, "impact": True})
    assert manager.process_event("recoil_pistol", hand="right") is True
    assert triggers == []
    assert manager.process_event("impact", angle=0.0) is True
    assert triggers
    manager.stop()


def test_side_suffix_sets_hand():
    triggers = []
    manager = Titanfall2Manager(on_trigger=lambda cell, speed: triggers.append((cell, speed)))
    manager.start()
    assert manager.process_event("recoil_rifle_l") is True
    assert [cell for cell, _speed in triggers] == list(LEFT_ARM)
    manager.stop()
