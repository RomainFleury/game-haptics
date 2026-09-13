# Screen Health UI Redesign - Questions & Answers

This document tracks questions and answers that arise during planning and implementation.

---

## Q1: When saving a profile from the builder, should it always create a new profile, or update if editing an existing local profile?

**Status:** ✅ Answered

**Context:** When a user loads a local profile into the builder and makes changes, should saving:
- Option A: Always create a new profile (user must manually delete old one)
- Option B: Update the existing profile if it was loaded from local storage
- Option C: Ask the user (update vs save as new)

**Answer:** **Option A** - Always create a new profile. The user can then manually delete the old one if they want. This keeps the workflow simple and prevents accidental overwrites.

---

## Q2: Should presets be copyable to local storage (to create editable versions)?

**Status:** ✅ Answered

**Context:** Since presets are read-only, should users be able to:
- Option A: Copy a preset to local storage to create an editable version
- Option B: Only load presets into builder, then save as new local profile
- Option C: Presets remain read-only, users must create from scratch or load JSON

**Answer:** **Yes** - Users can start a new profile from any available preset, whether it comes from local presets or built-in presets. This is the core workflow: select a preset as a starting point, then customize and save as a new local profile.

---

## Q3: Should the integration page show presets and local profiles in separate sections, or combined?

**Status:** ✅ Answered

**Context:** How should profiles be displayed on the integration page:
- Option A: Combined list with visual indicators (badges/icons) for preset vs local
- Option B: Two separate sections: "Presets" and "My Profiles"
- Option C: Tabs: "Presets" tab and "My Profiles" tab

**Answer:** **Option A** - Combined list in a select box. Use small tags/labels to indicate "global/static" (presets) vs "local/custom" (user-created profiles). This provides a unified view while clearly distinguishing the source.

---

## Q4: How should we handle profile selection state between pages?

**Status:** ✅ Answered (partially)

**Context:** When a profile is selected on the integration page:
- Should it persist when navigating to builder page?
- Should builder page show which profile is being edited?
- Should there be a way to "edit" a selected profile from integration page?

**Answer:** **Cog/gear button** links to the profile builder page. The builder page is independent - users can load any profile (preset or local) into the builder to customize. The integration page focuses on selecting and starting profiles, while the builder page focuses on creating/editing profiles. Navigation between pages doesn't need to preserve selection state - each page has its own purpose.

---

## Q5: What happens when a user deletes a profile that's currently running?

**Status:** ✅ Answered

**Context:** If a profile is active (daemon is running with it):
- Should deletion be prevented?
- Should daemon be stopped automatically?
- Should user be warned?

**Answer:** **Management/builder pages are disabled when daemon is running**. Since profile management happens on a separate page from starting/stopping, and that page is disabled during runtime, users cannot delete a running profile. The integration page (where starting/stopping happens) doesn't have delete functionality, so this scenario is prevented by design. If needed, we can add a check to prevent deletion of the currently running profile as an additional safeguard.

---

## Q6: Should local profiles have a "source" field to track if they came from a preset?

**Status:** ✅ Answered

**Context:** For tracking/organization:
- Should we store which preset a local profile was based on?
- Would this help with future features (updates, templates)?

**Answer:** **No, source tracking is not needed**. It doesn't matter where a profile came from (preset, local, JSON, or scratch). Profiles are independent once created, and tracking source would add unnecessary complexity.

---

## Q7: How should profile names be validated/handled?

**Status:** ✅ Answered

**Context:**
- Can multiple profiles have the same name?
- Should names be unique?
- What character limits/restrictions?

**Answer:** **Names can be duplicate, IDs are unique**. Profile IDs are automatically generated and unique (handled by storage system). Profile names can be duplicate - a simple UI validation check on save (warning if duplicate name exists) is sufficient. Users can clean up duplicate names themselves if needed. No strict enforcement required.

---

## Q8: Should there be a way to duplicate/clone profiles?

**Status:** ✅ Answered

**Context:** Users might want to:
- Create variations of existing profiles
- Test changes without modifying original

**Answer:** **Yes, via the builder page**. Users can see the list of existing presets (built-in and local) and start from one. Loading a preset or local profile into the builder is effectively duplicating/cloning it, then they can customize and save as a new profile. This covers the use case without needing a separate "duplicate" button.

---

## Q9: What should happen to the "activeProfileId" in storage?

**Status:** ✅ Answered

**Context:** The storage system has `activeProfileId`:
- Should this track the currently running profile?
- Should it track the last selected profile on integration page?
- Should it be removed if we manage selection in UI state?

**Answer:** **Remove `activeProfileId` from storage**. It's not needed since we don't track selection between pages. Profile selection is only needed in the ScreenHealthIntegration page for starting the daemon, but it doesn't need to be persisted in local storage - it's just UI state. The currently running profile is tracked by the daemon status, not storage.

---

## Q10: Should the builder page allow creating profiles from scratch, or only from existing sources?

**Status:** ✅ Answered

**Context:**
- Can users start with a blank profile?
- Or must they always start from preset, local, or JSON?

**Answer:** **Default example loaded on entry, user can select preset**. When the user enters the builder page, a default example profile is automatically loaded. The user can then:
- **Load from Preset**: Select any preset (built-in or local) to replace the default
- **Load from Local**: Load an existing local profile for editing
- **Load from JSON**: Import external profile
- Work with the default example as-is

This provides a good starting point while still allowing flexibility to choose a different starting profile.

---

## Q11: Should management and builder be separate pages?

**Status:** ✅ Answered

**Context:** Should profile management (list, delete) and profile building (create, edit) be on the same page or separate?

**Answer:** **Separate pages** for clear separation of concerns:
- **Management Page**: List profiles → View → Delete (no editing, no starting)
- **Builder Page**: Create/Edit profiles → Save (no starting, no list management)
- **Preview Page**: View profile details → Test (read-only, no editing)
- **Integration Page**: Select → Start/Stop (no management, no editing)

This makes the workflow clear: ADD (builder) → SEE (preview) → MANAGE (list/delete) → USE (integration).

---

## Notes

- Questions will be answered as we discuss and clarify requirements
- Once answered, questions will be marked with ✅ and moved to "Answered" section if needed
- Implementation decisions will be reflected in the plan document
