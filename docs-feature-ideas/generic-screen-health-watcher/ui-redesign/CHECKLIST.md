# Screen Health UI Redesign - Implementation Checklist

This document tracks the implementation progress for the Screen Health UI redesign.

## Phase 1: Add IPC Handlers for Local Profile Management ✅

### Storage Cleanup
- [x] Remove `activeProfileId` from `screenHealthStorage.cjs`
- [x] Remove `getActiveProfile()` function from storage
- [x] Remove `setActiveProfile()` function from storage
- [x] Update `loadState()` to not include `activeProfileId`
- [x] Update `saveState()` to not save `activeProfileId`
- [x] Update `upsertProfile()` to not set `activeProfileId` automatically

### IPC Handlers
- [x] Add `screenHealth:listProfiles` handler in `screenHealthHandlers.cjs`
- [x] Add `screenHealth:saveProfile` handler (always creates new, never updates)
- [x] Add `screenHealth:deleteProfile` handler
- [x] Add `screenHealth:getProfile` handler

### Preload & Bridge API
- [x] Add IPC methods to `preload.cjs`
- [x] Add TypeScript types to `bridgeApi.ts`
- [x] Add function exports to `bridgeApi.ts`

## Phase 2: Create Profile Management Hook ✅

- [x] Create `useScreenHealthProfiles.ts` hook
- [x] Implement profile list combining presets + local storage
- [x] Implement unified profile type with `type: 'preset' | 'local'`
- [x] Add `listProfiles()` function
- [x] Add `saveProfile()` function (always creates new)
- [x] Add `deleteProfile()` function
- [x] Add `getProfile()` function
- [x] Add loading state management
- [x] Add error state management

## Phase 3: Update Integration Page ✅

- [x] Add profile selector dropdown/select box
- [x] Implement profile list display with tags (Global/Local)
- [x] Add profile selection state management
- [x] Update `onStart` to use selected profile
- [x] Update profile data extraction (preset vs local)
- [x] Add cog/gear button linking to settings page
- [x] Disable cog button when daemon is running
- [x] Show active/running profile in status
- [x] Remove old configuration panel
- [x] Update setup guide text

## Phase 4: Create Settings Page ✅

- [x] Create `ScreenHealthSettingsPage.tsx`
- [x] Add route registration in router
- [x] Implement profile list display (presets + local)
- [x] Add View/Preview button → preview page
- [x] Add Edit button (local only) → builder with `?from=:id`
- [x] Add Delete button (local only, disabled if running)
- [x] Add "Add New Profile" button → builder
- [x] Add refresh functionality
- [x] Add disabled state when daemon is running
- [x] Add placeholder section for future general settings

## Phase 5: Update Builder Page ✅

### File Rename/Refactor
- [x] Keep `ScreenHealthCalibrationPage.tsx` (used for builder route)
- [x] Update route to `/builder`
- [x] Update route registration
- [x] Update imports/references

### Builder Page Updates
- [x] Add disabled state when daemon is running
- [x] Remove Start button from builder
- [x] Update page title/description to "Profile Builder"
- [x] Implement minimal template loading on page entry
- [x] Implement URL parameter `?from=:id` handling
- [x] Update `PresetProfilesSection` to work with unified profiles
- [x] Add "Load from Preset" dropdown
- [x] Add "Load from Local" dropdown
- [x] Add "Save to Local" button
- [x] Add duplicate name validation (warning only)
- [x] Remove Start button from `ProfileActionsController`
- [x] Update profile source tracking

## Phase 6: Create Preview Page ✅

- [x] Create `ScreenHealthPreviewPage.tsx`
- [x] Add route registration `/preview/:id`
- [x] Implement profile fetching by ID (preset or local)
- [x] Display profile details in read-only mode
- [x] Add Test button
- [x] Add Edit button (local only) → builder with `?from=:id`
- [x] Add Delete button (local only, disabled if running)
- [x] Add back navigation links
- [x] Add disabled state when daemon is running

## Phase 7: Testing & Refinement

- [ ] Test profile selection on integration page
- [ ] Test profile starting with preset
- [ ] Test profile starting with local profile
- [ ] Test settings page profile list
- [ ] Test profile deletion
- [ ] Test builder page default template loading
- [ ] Test builder page `?from=:id` parameter
- [ ] Test profile saving (creates new)
- [ ] Test duplicate name warning
- [ ] Test preview page for presets
- [ ] Test preview page for local profiles
- [ ] Test disabled states when daemon is running
- [ ] Test navigation between pages
- [ ] Verify no daemon-side changes needed

## Notes

- Git commits can be made at any logical checkpoint
- Each phase can be committed separately or combined as appropriate
- Test as you go to catch issues early
