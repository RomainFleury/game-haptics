# Feature Ideas

This folder contains markdown files describing feature ideas for the Third Space Vest project.

## How to Use

1. **Create a new feature idea file** - Use a descriptive filename like `feature-name.md`
2. **Describe your idea** - Include:
   - What the feature does
   - Why it's useful
   - How it should work
   - Any technical considerations
3. **Use the cursor prompt** - Load `@.cursor/prompts/new-feature-idea.md` to get help creating an implementation plan

## Feature Idea Template

```markdown
# Feature Name

## Description
Brief description of what this feature does.

## Motivation
Why this feature would be useful.

## User Story
As a [user type], I want [goal] so that [benefit].

## Technical Considerations
- Any technical challenges or requirements
- Dependencies or prerequisites
- Integration points with existing code

## Proposed Solution
How this feature could be implemented.

## Examples
Examples of how the feature would be used.
```

## Existing Feature Ideas

- **`usb-relay-solenoid-recoil/`** — USB LC relay → solenoid mechanical recoil hardware + daemon/UI
- **`generic-screen-health-watcher/`** — Screen ROI detectors for hit/health without game mods
- **`BETTERCAM_FIX_PLAN.md`** — BetterCam capture backend fix plan (retry / multi-ROI)

## Where plans go

Keep implementation plans, checklists, and redesign notes **in this folder** (or under the relevant feature subfolder). Do not add them at the repository root — root stays for README, changelog, onboarding, and build docs.

