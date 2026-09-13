# Screen Health UI Redesign - Implementation Plan

## Overview
Redesign the Screen Health integration UI to separate profile selection/management from calibration, making the integration page more independent and the calibration page a true "profile builder".

## Goals
1. **Integration Page**: Display available profiles (presets + local storage), allow selection, and start/stop profiles directly
2. **Settings Page**: List all profiles (presets + local), view details, delete local profiles, and manage general settings (no starting/stopping)
3. **Builder Page**: Create/edit profiles from scratch or from presets, save as new local profiles, export/import JSON (no starting/stopping)
4. **Preview Page**: View/test a profile without editing, see profile details and settings (no starting/stopping, no editing)
5. **Local Storage**: Utilize existing storage system for user-created profiles
6. **Future-Proof**: Design for future online profile source integration and additional settings

## Page Architecture

**Clear separation of concerns:**
- **Integration Page** (`/games/screen_health`): Select profile → Start/Stop daemon
- **Settings Page** (`/games/screen_health/settings`): List profiles → View → Delete (local only) + General settings
- **Builder Page** (`/games/screen_health/builder`): Create/Edit profiles → Save as new
- **Preview Page** (`/games/screen_health/preview/:id`): View profile details → Test (read-only)

**Navigation rules:**
- Builder/Settings pages should be **disabled** when screenhealth daemon is running
- Integration page is always accessible (for stopping)
- Clear workflow: ADD (builder) → SEE (preview) → SETTINGS (list/delete/settings) → USE (integration)

## Routing Map

### Route Definitions

| Route | Purpose | Parameters | Access When Running |
|-------|---------|------------|---------------------|
| `/games/screen_health` | Integration page - Select profile and start/stop daemon | None | ✅ Always accessible |
| `/games/screen_health/settings` | Settings page - List, view, delete profiles + general settings | None | ❌ Disabled when running |
| `/games/screen_health/builder` | Builder page - Create/edit profiles | `?from=:id` (optional) | ❌ Disabled when running |
| `/games/screen_health/preview/:id` | Preview page - View profile details (read-only) | `:id` (profile UUID) | ❌ Disabled when running |

### Route Details

#### `/games/screen_health` (Integration Page)
- **Purpose**: Select profile and start/stop the screen health daemon
- **Features**:
  - Profile selector (presets + local)
  - Start/Stop buttons
  - Status display
  - Navigation to management page (cog button)
- **State**: Profile selection stored in component state (not persisted)
- **Always accessible**: Yes (needed to stop daemon)

#### `/games/screen_health/settings` (Settings Page)
- **Purpose**: List all profiles, manage local profiles, and configure general settings
- **Features**:
  - **Profile Management Section**:
    - Table/list of all profiles (presets + local)
    - View/Preview button → `/preview/:id`
    - Edit button (local only) → `/builder?from=:id`
    - Delete button (local only)
    - Add New Profile button → `/builder`
  - **General Settings Section** (future):
    - General overrides
    - Other screen health settings
- **State**: Profile list fetched on page load
- **Disabled when**: Daemon is running
- **Future-proof**: Designed to accommodate additional settings beyond profile management

#### `/games/screen_health/builder` (Builder Page)
- **Purpose**: Create and edit profiles
- **Query Parameters**:
  - `?from=:id` (optional) - Load specific profile (preset or local) instead of default template
- **Features**:
  - Load minimal template by default (if no `?from` param)
  - Load from preset dropdown
  - Load from local storage dropdown
  - Save to local storage (always creates new)
  - Export/Import JSON
  - Test profile
- **State**: Current draft stored in component state
- **Disabled when**: Daemon is running

#### `/games/screen_health/preview/:id` (Preview Page)
- **Purpose**: View profile details in read-only mode
- **Parameters**:
  - `:id` - Profile UUID (works for both preset and local profiles)
- **Features**:
  - Display profile settings (read-only)
  - Test button
  - Edit button (local only) → `/builder?from=:id`
  - Delete button (local only)
  - Back navigation links
- **State**: Profile fetched by ID on page load
- **Disabled when**: Daemon is running

### Navigation Flow

```
Integration Page (/games/screen_health)
  ├─→ [Cog Button] → Settings Page (/settings)
  │     ├─→ [View] → Preview Page (/preview/:id)
  │     ├─→ [Edit] → Builder Page (/builder?from=:id)
  │     └─→ [Add New] → Builder Page (/builder)
  │
  └─→ [Select Profile] → [Start] → (Daemon starts)

Settings Page (/games/screen_health/settings)
  ├─→ [View/Preview] → Preview Page (/preview/:id)
  ├─→ [Edit] → Builder Page (/builder?from=:id)
  ├─→ [Add New] → Builder Page (/builder)
  └─→ [Back] → Integration Page

Builder Page (/games/screen_health/builder)
  ├─→ [Save] → (Profile saved, can navigate back)
  └─→ [Back] → Settings Page or Integration Page

Preview Page (/games/screen_health/preview/:id)
  ├─→ [Edit] → Builder Page (/builder?from=:id) (local only)
  └─→ [Back] → Settings Page or Integration Page
```

### URL Examples

- Integration: `/games/screen_health`
- Settings: `/games/screen_health/settings`
- Builder (default): `/games/screen_health/builder`
- Builder (load preset): `/games/screen_health/builder?from=chivalry2_red_vignette`
- Builder (load local): `/games/screen_health/builder?from=sh_1234567890_abc123`
- Preview (preset): `/games/screen_health/preview/chivalry2_red_vignette`
- Preview (local): `/games/screen_health/preview/sh_1234567890_abc123`

## Current State Analysis

### Existing Infrastructure
- ✅ Local storage system exists in `web/electron/screenHealthStorage.cjs`
  - `listProfiles()` - returns all stored profiles
  - `upsertProfile(profile)` - saves/updates a profile
  - `deleteProfile(profileId)` - deletes a profile
  - `getActiveProfile()` - gets active profile (to be removed - not needed)
- ✅ Presets system: `SCREEN_HEALTH_PRESETS` (bundled, read-only)
- ✅ JSON import/export: `screenHealthLoadProfile()` and `screenHealthExportProfile()`

### Current Issues
- ❌ Profile selection is in calibration page (should be in integration page)
- ❌ Local storage functions not exposed via IPC
- ❌ No UI for managing local profiles
- ❌ Integration page doesn't show available profiles

## Implementation Plan

### Phase 1: Add IPC Handlers for Local Profile Management

**Files to modify:**
- `web/electron/ipc/screenHealthHandlers.cjs`
- `web/electron/preload.cjs`
- `web/src/lib/bridgeApi.ts`
- `web/electron/screenHealthStorage.cjs` (remove `activeProfileId` support)

**New IPC handlers:**
1. `screenHealth:listProfiles`
   - Returns: `{ success: boolean, profiles?: Array<{id, name, profile, createdAt, updatedAt}>, error?: string }`
   - Uses: `storage.listProfiles()`

2. `screenHealth:saveProfile`
   - Parameters: `{ id?: string, name: string, profile: Record<string, any> }`
   - Returns: `{ success: boolean, profile?: {...}, error?: string }`
   - Uses: `storage.upsertProfile()`
   - **Always creates new profile** (never updates existing, even if id provided)
   - Note: IDs are auto-generated and unique, names can be duplicate

3. `screenHealth:deleteProfile`
   - Parameters: `profileId: string`
   - Returns: `{ success: boolean, error?: string }`
   - Uses: `storage.deleteProfile()`

4. `screenHealth:getProfile`
   - Parameters: `profileId: string`
   - Returns: `{ success: boolean, profile?: {...}, error?: string }`
   - Uses: `storage.listProfiles()` and find by id

**Storage cleanup:**
- Remove `activeProfileId` from storage system
- Remove `getActiveProfile()` and `setActiveProfile()` functions
- Profile selection is UI state only (not persisted)
- Currently running profile is tracked by daemon status, not storage

### Phase 2: Create Profile Management Hook

**New file:** `web/src/hooks/screenHealth/useScreenHealthProfiles.ts`

**Functionality:**
- Combines `SCREEN_HEALTH_PRESETS` + local storage profiles into unified list
- Provides unified list of available profiles for select box
- Distinguishes between preset (read-only, "Global" tag) and local (editable, "Local" tag) profiles
- Provides functions: `listProfiles()`, `saveProfile()`, `deleteProfile()`, `getProfile()`
- `saveProfile()` always creates new profile (never updates existing)
- Manages loading state and errors

**Profile types:**
- **Preset**: `{ type: 'preset', preset_id: string, display_name: string, profile: {...} }`
  - Tag: "Global" or "Static"
  - Read-only, bundled with app
- **Local**: `{ type: 'local', id: string, name: string, profile: {...}, createdAt: string, updatedAt: string }`
  - Tag: "Local" or "Custom"
  - User-created, editable, stored locally
  - **ID is unique** (auto-generated by storage)
  - **Name can be duplicate** (UI validation warning on save is sufficient)

### Phase 3: Update Integration Page

**File:** `web/src/pages/integrations/ScreenHealthIntegrationPage.tsx`

**Changes:**
1. Add profile selector
   - **Combined select box** showing all available profiles (presets + local)
   - Small tags/labels to indicate:
     - "Global" or "Static" for presets (read-only, bundled)
     - "Local" or "Custom" for user-created profiles
   - Display profile name with tag
   - Allow selecting any available profile
   - Show currently selected profile
   - Store selection in component state (or context if needed)
   - Place in Controls section or as a separate section above controls
   - **Note**: Profile list refreshes on page load (fetching is cheap - local storage + constant presets)
   - **Empty state**: Always shows at least presets (no special empty state needed)

2. Add navigation buttons
   - **Cog/gear icon button** in the Controls section
   - Links to `/games/screen_health/settings` (settings page)
   - Use standard gear/cog SVG icon (consistent with other icon buttons)
   - Text: "Settings" or icon-only with tooltip
   - Styled as secondary button (slate-600/80) to distinguish from primary Start/Stop
   - Positioned alongside Start/Stop buttons
   - **Disabled when daemon is running** (show tooltip: "Stop screen health to access settings")

3. Update start functionality
   - `onStart` should use selected profile
   - Get profile data based on selection (preset or local)
   - Pass profile to `screenHealthStart()`

4. Show active profile in status
   - Display which profile is currently running (from daemon status)
   - Highlight selected vs running profile

5. Remove/update configuration panel
   - Remove the old configuration panel with link
   - Update setup guide to reference "Profile Builder" button instead

### Phase 4: Create Settings Page

**New file:** `web/src/pages/integrations/ScreenHealthSettingsPage.tsx`

**Functionality:**
- **Profile Management Section**:
  - Display list of all profiles (presets + local) in a table/list
  - Show profile name, type (preset/local), last updated (for local)
  - For each profile:
    - **View/Preview** button → opens preview page
    - **Delete** button (only for local profiles, disabled if running)
    - **Edit** button (only for local profiles) → opens builder with profile loaded
  - **Add New Profile** button → opens builder (loads minimal template)
  - Refresh button to reload profile list
  - **Note**: Profile list refreshes automatically when navigating back to this page (no complex sync needed)
- **General Settings Section** (placeholder for future):
  - Reserved for future settings like general overrides
  - Can be expanded as needed
- **Disabled when daemon is running** (show message: "Stop screen health to access settings")

### Phase 5: Update Builder Page

**File:** `web/src/pages/integrations/ScreenHealthCalibrationPage.tsx` → Rename/Refactor to `ScreenHealthBuilderPage.tsx`

**Changes:**
- Route: `/games/screen_health/builder` with optional query param `?from=:id`
- Rename to emphasize "Builder" purpose
- **Disabled when daemon is running** (show message: "Stop screen health to edit profiles")
- Remove Start button (starting happens on integration page only)
- Focus on: Create → Edit → Save → Export
- **Default**: Load minimal template profile on page entry
- **URL param**: If `?from=:id` is present, load that profile instead (preset or local)

**File:** `web/src/pages/integrations/screenHealth/ScreenHealthConfigurationPanel.tsx`

**Changes:**
1. Modify `PresetProfilesSection` or replace with profile loader
   - Change from "select for starting" to "load as starting point for editing"
   - **Default behavior**: Load a **minimal template profile** when builder page opens
   - Allow loading any preset (built-in or local) into the builder to replace default
   - Support URL parameter: `/builder?from=:id` to load a specific profile (preset or local)
   - This enables the workflow: minimal template loaded → optionally select preset → customize → save as new local profile
   - Show which profile is currently loaded (minimal template, preset, or local)

2. Add profile creation/editing section
   - **Default**: A default example profile is automatically loaded when builder page opens
   - **Load from Preset**: Dropdown to load any preset (built-in or local) as starting point
     - Replaces the default example with selected preset
     - This effectively duplicates/clones the profile for editing
   - **Load from Local Storage**: Dropdown/button to load a saved local profile for editing
     - Replaces the default example with selected local profile
     - This effectively duplicates/clones the local profile for editing
   - **Save to Local Storage**: Button to save current draft as **new** local profile
     - **Always creates a new profile** (user can manually delete old one if needed)
     - Works for profiles from presets, local storage, JSON files, or scratch
     - **UI validation**: Warn user if profile name already exists (but allow save)
     - IDs are unique (auto-generated), names can be duplicate
   - **Load from JSON**: Keep existing functionality
   - **Export to JSON**: Keep existing functionality

3. Update `ProfileActionsController`
   - Add "Save to Local" button
   - Add "Load from Preset" dropdown
   - Add "Load from Local" dropdown
   - Add "Start from Scratch" button
   - Keep existing Export/Test buttons
   - **Remove Start button** (starting happens on integration page)

4. Track profile source (for display/info purposes)
   - Know if current draft is from default example, preset, local storage, or JSON file
   - Display source information to user
   - **Note**: Save always creates new profile regardless of source

### Phase 6: Create Preview Page

**New file:** `web/src/pages/integrations/ScreenHealthPreviewPage.tsx`

**Functionality:**
- Route: `/games/screen_health/preview/:id` (ID is unique UUID, works for both preset and local)
- Display profile details in read-only mode
- Show all profile settings (detector type, ROIs, thresholds, etc.)
- **Test** button to run one evaluation pass (same as builder test)
- **Edit** button → opens builder with profile loaded (only for local profiles)
- **Delete** button → deletes profile (only for local profiles, disabled if running)
- **Back to Settings** or **Back to Integration** links
- **Disabled when daemon is running** (show message: "Stop screen health to preview profiles")

### Phase 5: Profile Data Flow

**Profile Sources:**
1. **Preset** (bundled, read-only)
   - Selected on integration page → used to start daemon
   - Can be loaded into builder as starting point
   - When saved from builder → creates new local profile (preset remains unchanged)

2. **Local Storage** (user-created, editable)
   - Created from builder → saved to storage (always creates new, never updates)
   - Selected on integration page → used to start daemon
   - Loaded in builder → can be edited and saved as **new** local profile
   - User can manually delete old versions

3. **JSON File** (external, one-time)
   - Loaded in builder → can be edited
   - Can be saved to local storage (creates new local profile)
   - Can be exported back to JSON

4. **Default Example** (built-in template)
   - Automatically loaded when builder page opens
   - Provides a starting point for new profiles
   - Can be replaced by selecting a preset or loading from local/JSON

**State Management:**
- Integration page: Manages selected profile for starting (UI state only, not persisted)
- Builder page: Manages current draft being edited (UI state only)
- Local storage: Persistent storage of user profiles (no activeProfileId)
- Daemon status: Tracks currently running profile (from daemon, not storage)

## Data Structure

### Preset Profile
```typescript
{
  preset_id: string;
  display_name: string;
  profile: {
    schema_version: number;
    name: string;
    meta?: {...};
    capture: {...};
    detectors: [...];
  };
}
```

### Local Storage Profile
```typescript
{
  id: string;              // Generated ID (e.g., "sh_1234567890_abc123")
  name: string;            // User-friendly name
  profile: {               // Daemon profile JSON
    schema_version: number;
    name: string;
    meta?: {...};
    capture: {...};
    detectors: [...];
  };
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}
```

### Unified Profile (for UI)
```typescript
{
  type: 'preset' | 'local';
  id: string;              // preset_id or local id
  name: string;            // display_name or name
  profile: {...};          // The actual daemon profile
  createdAt?: string;      // Only for local
  updatedAt?: string;       // Only for local
}
```

## Implementation Details

**Daemon Compatibility:**
- ✅ **No daemon-side changes needed**
- Daemon accepts profile JSON via `screenHealthStart(profile)` regardless of source
- Profile structure remains the same (preset or local both use same schema)
- Only UI layer changes - daemon API unchanged

**Default Template:**
- Builder page loads a **minimal template profile** by default
- Provides a starting point for new profile creation

**Routing:**
- Preview: `/games/screen_health/preview/:id` (ID is unique UUID, works for preset or local)
- Builder: `/games/screen_health/builder?from=:id` (optional, loads specific profile)

**Refresh Strategy:**
- Profile lists refresh on page navigation (no complex sync)
- Fetching is cheap (local storage + constant presets)
- No need for real-time updates or complex state management

**Empty States:**
- Always have at least presets available
- No special empty state handling needed
- Local profiles are optional additions

## Open Questions

See `SCREENHEALTH_UI_REDESIGN_QA.md` for accumulated questions and answers.

## Implementation Order

1. ✅ Phase 1: IPC handlers (foundation)
2. ✅ Phase 2: Profile management hook (data layer)
3. ✅ Phase 3: Integration page updates (user-facing)
4. ✅ Phase 4: Settings page (new)
5. ✅ Phase 5: Builder page updates (refactor existing)
6. ✅ Phase 6: Preview page (new)
7. ✅ Phase 7: Testing and refinement

## Future Enhancements

- Online profile source integration
- Profile sharing/import from URL
- Profile versioning
- Profile templates/categories
- Profile search/filtering
