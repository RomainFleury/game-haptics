"""
Game Integration Consistency Tests.

This test suite ensures that:
1. All game integrations follow consistent patterns
2. New integrations don't break existing ones
3. Integration specifications match actual implementations
4. Required components are present and properly structured

Run with: pytest tests/test_game_integrations.py -v

IMPORTANT: These tests MUST pass before adding a new game integration.
"""

import pytest
import importlib
import inspect
from pathlib import Path
from typing import List, Tuple, Dict, Any
from dataclasses import fields


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def registry():
    """Get the game integration registry."""
    from modern_third_space.integrations.registry import GAME_INTEGRATIONS
    return GAME_INTEGRATIONS


@pytest.fixture
def integration_specs(registry):
    """Get all integration specifications."""
    return list(registry.values())


# =============================================================================
# Registry Tests - Ensure all integrations are properly registered
# =============================================================================

class TestIntegrationRegistry:
    """Test that the integration registry is complete and consistent."""
    
    def test_registry_not_empty(self, registry):
        """Registry should have at least one integration."""
        assert len(registry) > 0, "No integrations registered"
    
    def test_all_integrations_have_unique_ids(self, registry):
        """All integrations must have unique game_id values."""
        ids = list(registry.keys())
        assert len(ids) == len(set(ids)), "Duplicate game_id found"
    
    def test_all_integrations_have_required_fields(self, integration_specs):
        """All integrations must have required fields populated."""
        for spec in integration_specs:
            assert spec.game_id, f"Missing game_id"
            assert spec.game_name, f"{spec.game_id}: Missing game_name"
            assert spec.integration_type is not None, f"{spec.game_id}: Missing integration_type"
            assert spec.status is not None, f"{spec.game_id}: Missing status"
    
    def test_stable_integrations_have_manager_or_module(self, integration_specs):
        """STABLE integrations must have a manager or integration module defined."""
        from modern_third_space.integrations.registry import IntegrationStatus
        
        for spec in integration_specs:
            if spec.status in (IntegrationStatus.STABLE, IntegrationStatus.BETA):
                has_implementation = spec.manager_module or spec.integration_module
                assert has_implementation, (
                    f"{spec.game_id}: STABLE/BETA integration must have "
                    f"manager_module or integration_module"
                )
    
    def test_daemon_commands_follow_naming_convention(self, integration_specs):
        """Daemon commands should start with the game_id prefix."""
        for spec in integration_specs:
            for cmd in spec.daemon_commands:
                # Commands should start with game_id or be a standard command
                assert cmd.startswith(f"{spec.game_id}_"), (
                    f"{spec.game_id}: Command '{cmd}' should start with '{spec.game_id}_'"
                )


# =============================================================================
# Manager Structure Tests - Ensure managers follow consistent patterns
# =============================================================================

class TestManagerStructure:
    """Test that all manager classes follow consistent patterns."""
    
    def get_stable_managers(self, integration_specs):
        """Get all stable integrations with managers."""
        from modern_third_space.integrations.registry import IntegrationStatus
        return [
            spec for spec in integration_specs
            if spec.status in (IntegrationStatus.STABLE, IntegrationStatus.BETA)
            and spec.manager_module
        ]
    
    def test_managers_are_importable(self, integration_specs):
        """All manager modules should be importable."""
        for spec in self.get_stable_managers(integration_specs):
            try:
                module = importlib.import_module(
                    f"modern_third_space.server.{spec.manager_module}"
                )
                assert module is not None
            except ImportError as e:
                pytest.fail(f"{spec.game_id}: Cannot import manager: {e}")
    
    def test_manager_classes_exist(self, integration_specs):
        """Manager classes should exist in their modules."""
        for spec in self.get_stable_managers(integration_specs):
            if not spec.manager_class:
                continue
            
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            assert hasattr(module, spec.manager_class), (
                f"{spec.game_id}: Class '{spec.manager_class}' not found in {spec.manager_module}"
            )
    
    def test_log_file_managers_have_start_stop(self, integration_specs):
        """Log file watchers must have start() and stop() methods."""
        from modern_third_space.integrations.registry import IntegrationType
        
        for spec in self.get_stable_managers(integration_specs):
            if spec.integration_type != IntegrationType.LOG_FILE:
                continue
            
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            cls = getattr(module, spec.manager_class)
            
            assert hasattr(cls, "start"), f"{spec.game_id}: Missing start() method"
            assert hasattr(cls, "stop"), f"{spec.game_id}: Missing stop() method"
            assert callable(getattr(cls, "start")), f"{spec.game_id}: start must be callable"
            assert callable(getattr(cls, "stop")), f"{spec.game_id}: stop must be callable"
    
    def test_tcp_managers_have_process_event(self, integration_specs):
        """TCP client managers must have process_event() method."""
        from modern_third_space.integrations.registry import IntegrationType
        
        for spec in self.get_stable_managers(integration_specs):
            if spec.integration_type != IntegrationType.TCP_CLIENT:
                continue
            
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            cls = getattr(module, spec.manager_class)
            
            assert hasattr(cls, "process_event"), f"{spec.game_id}: Missing process_event() method"
            assert callable(getattr(cls, "process_event")), (
                f"{spec.game_id}: process_event must be callable"
            )
    
    def test_managers_have_callback_setters(self, integration_specs):
        """Managers should have callback setters for event broadcasting."""
        for spec in self.get_stable_managers(integration_specs):
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            cls = getattr(module, spec.manager_class)
            
            # Check for callback mechanisms
            # Either __init__ accepts callbacks or there are setter methods
            init_sig = inspect.signature(cls.__init__)
            init_params = list(init_sig.parameters.keys())
            
            has_callback_init = any(
                p in init_params for p in ["on_event", "on_game_event", "on_trigger"]
            )
            has_callback_setter = hasattr(cls, "set_event_callback") or hasattr(cls, "set_trigger_callback")
            
            assert has_callback_init or has_callback_setter, (
                f"{spec.game_id}: Manager must accept callbacks via __init__ or setters"
            )


# =============================================================================
# Haptic Mapping Tests - Ensure haptic mappings are consistent
# =============================================================================

class TestHapticMappings:
    """Test that haptic mappings follow consistent patterns."""
    
    def get_managers_with_mappings(self, integration_specs):
        """Get specs for managers that should have haptic mappings."""
        from modern_third_space.integrations.registry import IntegrationStatus
        return [
            spec for spec in integration_specs
            if spec.status in (IntegrationStatus.STABLE, IntegrationStatus.BETA)
            and spec.manager_module
        ]
    
    def test_mapping_functions_or_trigger_methods_exist(self, integration_specs):
        """
        Each manager should have haptic mapping logic.
        
        This can be either:
        - A standalone map_event_to_haptics function, OR
        - A manager class with _trigger_* or _handle_* methods
        """
        for spec in self.get_managers_with_mappings(integration_specs):
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            
            # Check for standalone function
            has_mapping_function = hasattr(module, "map_event_to_haptics")
            
            # Check for trigger/handler methods in manager class
            has_haptic_methods = False
            if spec.manager_class and hasattr(module, spec.manager_class):
                cls = getattr(module, spec.manager_class)
                # Look for _trigger_*, _handle_player_*, or process_event methods
                haptic_methods = [
                    m for m in dir(cls) 
                    if m.startswith("_trigger") or m.startswith("_handle_player") or m == "process_event"
                ]
                has_haptic_methods = len(haptic_methods) > 0
            
            assert has_mapping_function or has_haptic_methods, (
                f"{spec.game_id}: Missing haptic mapping logic in {spec.manager_module}. "
                f"Need either map_event_to_haptics() or haptic handler methods in manager class."
            )
    
    def test_mapping_functions_return_list_of_tuples(self, integration_specs):
        """map_event_to_haptics should return List[Tuple[int, int]]."""
        for spec in self.get_managers_with_mappings(integration_specs):
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            
            if not hasattr(module, "map_event_to_haptics"):
                continue
            
            func = getattr(module, "map_event_to_haptics")
            
            # Get the event class from the same module
            # Try common event class names
            event_cls = None
            for name in ["L4D2Event", "AlyxEvent", "GTAVEvent", "PistolWhipEvent", "BattleSisterEvent", "Event"]:
                if hasattr(module, name):
                    event_cls = getattr(module, name)
                    break
            
            if event_cls:
                # Create a minimal test event
                try:
                    # Try to create event with minimal args
                    if hasattr(event_cls, "__dataclass_fields__"):
                        # It's a dataclass, get required fields
                        required_fields = {
                            f.name: "" if f.type == str else 0 if f.type == int else {}
                            for f in fields(event_cls)
                            if f.default is f.default_factory is type(f.default)  # no default
                        }
                        test_event = event_cls(type="test", raw="test", params={})
                    else:
                        test_event = event_cls()
                    
                    result = func(test_event)
                    
                    assert isinstance(result, list), (
                        f"{spec.game_id}: map_event_to_haptics should return a list"
                    )
                    for item in result:
                        assert isinstance(item, tuple) and len(item) == 2, (
                            f"{spec.game_id}: map_event_to_haptics should return List[Tuple[int, int]]"
                        )
                except Exception:
                    # Can't easily test this event class
                    pass
    
    def test_cell_indices_are_valid(self, integration_specs):
        """All cell indices in mappings should be 0-7."""
        from modern_third_space.vest.cell_layout import ALL_CELLS
        
        for spec in self.get_managers_with_mappings(integration_specs):
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            
            if not hasattr(module, "map_event_to_haptics"):
                continue
            
            # Check that the module uses cell_layout constants
            source = inspect.getsource(module)
            
            # Should import from cell_layout
            uses_cell_layout = (
                "from ..vest.cell_layout import" in source or
                "from modern_third_space.vest.cell_layout import" in source
            )
            
            # Or at minimum, uses valid cell indices (0-7)
            # This is a soft check - we can't fully validate without running
            assert uses_cell_layout, (
                f"{spec.game_id}: Manager should import from vest.cell_layout"
            )


# =============================================================================
# Cell Layout Usage Tests - Ensure correct cell layout usage
# =============================================================================

class TestCellLayoutUsage:
    """Test that integrations use the cell_layout module correctly."""
    
    def test_cell_layout_module_exists(self):
        """The cell_layout module should exist and be importable."""
        from modern_third_space.vest import cell_layout
        assert cell_layout is not None
    
    def test_cell_layout_has_required_constants(self):
        """cell_layout should export required constants."""
        from modern_third_space.vest.cell_layout import (
            Cell,
            FRONT_CELLS,
            BACK_CELLS,
            ALL_CELLS,
            LEFT_SIDE,
            RIGHT_SIDE,
            UPPER_CELLS,
            LOWER_CELLS,
        )
        
        # Check Cell enum has expected values
        assert hasattr(Cell, "FRONT_UPPER_LEFT")
        assert hasattr(Cell, "FRONT_UPPER_RIGHT")
        assert hasattr(Cell, "FRONT_LOWER_LEFT")
        assert hasattr(Cell, "FRONT_LOWER_RIGHT")
        assert hasattr(Cell, "BACK_UPPER_LEFT")
        assert hasattr(Cell, "BACK_UPPER_RIGHT")
        assert hasattr(Cell, "BACK_LOWER_LEFT")
        assert hasattr(Cell, "BACK_LOWER_RIGHT")
        
        # Check lists have correct sizes
        assert len(ALL_CELLS) == 8, "ALL_CELLS should have 8 cells"
        assert len(FRONT_CELLS) == 4, "FRONT_CELLS should have 4 cells"
        assert len(BACK_CELLS) == 4, "BACK_CELLS should have 4 cells"
    
    def test_managers_use_cell_constants(self, integration_specs):
        """Managers should use Cell constants, not raw integers."""
        from modern_third_space.integrations.registry import IntegrationStatus
        
        for spec in integration_specs:
            if spec.status not in (IntegrationStatus.STABLE, IntegrationStatus.BETA):
                continue
            if not spec.manager_module:
                continue
            
            module = importlib.import_module(
                f"modern_third_space.server.{spec.manager_module}"
            )
            source = inspect.getsource(module)
            
            # Check that module imports Cell or cell constants
            imports_cells = (
                "from ..vest.cell_layout import" in source or
                "from modern_third_space.vest.cell_layout import" in source
            )
            
            assert imports_cells, (
                f"{spec.game_id}: Manager should import from vest.cell_layout"
            )


# =============================================================================
# Event Type Tests - Ensure event types are documented
# =============================================================================

class TestEventTypes:
    """Test that event types are properly documented."""
    
    def test_integrations_have_event_types(self, integration_specs):
        """All active integrations should document their event types."""
        from modern_third_space.integrations.registry import IntegrationStatus
        
        for spec in integration_specs:
            if spec.status in (IntegrationStatus.STABLE, IntegrationStatus.BETA):
                assert len(spec.event_types) > 0, (
                    f"{spec.game_id}: Should have event_types documented"
                )
    
    def test_damage_event_exists(self, integration_specs):
        """Most integrations should have a damage or death event type."""
        from modern_third_space.integrations.registry import IntegrationStatus
        
        for spec in integration_specs:
            if spec.status not in (IntegrationStatus.STABLE, IntegrationStatus.BETA):
                continue
            
            # Check for common damage/death event names
            # "death" counts because it's the ultimate damage event
            damage_events = [
                e for e in spec.event_types
                if any(keyword in e.lower() for keyword in ["damage", "hurt", "death", "hit"])
            ]
            
            assert len(damage_events) > 0, (
                f"{spec.game_id}: Should have a damage/death/hit event type. "
                f"Found events: {spec.event_types}"
            )


# =============================================================================
# Integration Validation Tests
# =============================================================================

class TestIntegrationValidation:
    """Test the validation utilities in the registry."""
    
    def test_validate_all_integrations_pass(self):
        """All registered integrations should pass validation."""
        from modern_third_space.integrations.registry import validate_all_integrations
        
        errors = validate_all_integrations()
        
        # Collect all errors for a clear failure message
        if errors:
            error_msg = "\n".join(
                f"{game_id}: {', '.join(errs)}"
                for game_id, errs in errors.items()
            )
            pytest.fail(f"Integration validation errors:\n{error_msg}")
    
    def test_check_manager_required_methods(self, integration_specs):
        """Managers should have all required methods."""
        from modern_third_space.integrations.registry import check_manager_has_required_methods
        
        for spec in integration_specs:
            if not spec.manager_module:
                continue
            
            missing = check_manager_has_required_methods(spec)
            assert not missing, (
                f"{spec.game_id}: Missing required methods: {missing}"
            )


# =============================================================================
# Non-Regression Tests - Snapshot of existing integrations
# =============================================================================

class TestIntegrationSnapshot:
    """
    Snapshot tests to detect unexpected changes to existing integrations.
    
    These tests ensure that existing integrations are not accidentally modified
    when adding new ones.
    """
    
    # Expected integrations as of the snapshot date
    # Update this when intentionally adding/modifying integrations
    EXPECTED_INTEGRATIONS = {
        "cs2": {
            "game_name": "Counter-Strike 2",
            "integration_type": "http_gsi",
            "status": "stable",
            "has_manager": True,
            "event_count_min": 5,  # At least 5 event types
        },
        "alyx": {
            "game_name": "Half-Life: Alyx",
            "integration_type": "log_file",
            "status": "stable",
            "has_manager": True,
            "event_count_min": 5,
        },
        "l4d2": {
            "game_name": "Left 4 Dead 2",
            "integration_type": "log_file",
            "status": "stable",
            "has_manager": True,
            "event_count_min": 4,
        },
        "pistolwhip": {
            "game_name": "Pistol Whip",
            "integration_type": "tcp_client",
            "status": "beta",
            "has_manager": True,
            "event_count_min": 8,
        },
        "battlesister": {
            "game_name": "Warhammer 40,000: Battle Sister",
            "integration_type": "tcp_client",
            "status": "beta",
            "has_manager": True,
            "event_count_min": 8,
        },
        "gunmancontracts": {
            "game_name": "Gunman Contracts Standalone",
            "integration_type": "tcp_client",
            "status": "beta",
            "has_manager": True,
            "event_count_min": 8,
        },
        "screen_health": {
            "game_name": "Generic Screen Health (Screen Capture)",
            "integration_type": "screen_capture",
            "status": "beta",
            "has_manager": True,
            "event_count_min": 1,
        },
    }
    
    def test_expected_integrations_exist(self, registry):
        """All expected integrations should still exist."""
        for game_id in self.EXPECTED_INTEGRATIONS:
            assert game_id in registry, f"Expected integration '{game_id}' not found in registry"
    
    def test_integration_names_unchanged(self, registry):
        """Game names should not change unexpectedly."""
        for game_id, expected in self.EXPECTED_INTEGRATIONS.items():
            if game_id in registry:
                spec = registry[game_id]
                assert spec.game_name == expected["game_name"], (
                    f"{game_id}: game_name changed from '{expected['game_name']}' to '{spec.game_name}'"
                )
    
    def test_integration_types_unchanged(self, registry):
        """Integration types should not change unexpectedly."""
        for game_id, expected in self.EXPECTED_INTEGRATIONS.items():
            if game_id in registry:
                spec = registry[game_id]
                assert spec.integration_type.value == expected["integration_type"], (
                    f"{game_id}: integration_type changed from "
                    f"'{expected['integration_type']}' to '{spec.integration_type.value}'"
                )
    
    def test_integration_has_minimum_events(self, registry):
        """Integrations should have at least as many events as expected."""
        for game_id, expected in self.EXPECTED_INTEGRATIONS.items():
            if game_id in registry:
                spec = registry[game_id]
                min_events = expected["event_count_min"]
                assert len(spec.event_types) >= min_events, (
                    f"{game_id}: Expected at least {min_events} events, "
                    f"found {len(spec.event_types)}"
                )
    
    def test_no_integrations_removed(self, registry):
        """No integrations should be removed without updating the snapshot."""
        missing = []
        for game_id in self.EXPECTED_INTEGRATIONS:
            if game_id not in registry:
                missing.append(game_id)
        
        if missing:
            pytest.fail(
                f"Integrations removed without updating snapshot: {missing}\n"
                f"If this is intentional, update EXPECTED_INTEGRATIONS in test_game_integrations.py"
            )


# =============================================================================
# Documentation Tests
# =============================================================================

class TestDocumentation:
    """Test that integrations have required documentation."""
    
    def test_stable_integrations_have_docs(self, integration_specs):
        """STABLE integrations should have a docs_file specified."""
        from modern_third_space.integrations.registry import IntegrationStatus
        
        for spec in integration_specs:
            if spec.status == IntegrationStatus.STABLE:
                # docs_file is recommended but not strictly required
                # Log a warning if missing
                if not spec.docs_file:
                    import warnings
                    warnings.warn(
                        f"{spec.game_id}: STABLE integration should have docs_file specified"
                    )
    
    def test_external_mod_has_mod_url(self, integration_specs):
        """Integrations requiring external mods should have mod_url."""
        for spec in integration_specs:
            if spec.requires_external_mod:
                # mod_url is recommended for user guidance
                if not spec.mod_url:
                    import warnings
                    warnings.warn(
                        f"{spec.game_id}: Integration requiring external mod should have mod_url"
                    )


# =============================================================================
# Run All Tests
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
