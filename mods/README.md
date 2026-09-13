# Bundled Game Mods

This directory contains pre-built game mod files that are bundled with the Third Space Vest application. Users can download these directly from the app UI without needing to visit external sites.

## Directory Structure

```
mods/
├── alyx/                  # Half-Life: Alyx scripts
│   └── (Lua scripts from NexusMods)
├── l4d2/                  # Left 4 Dead 2 VScripts (in misc-documentations/)
│   └── (Copied from misc-documentations during build)
├── pistolwhip/            # Pistol Whip MelonLoader README (build DLL from pistolwhip-mod/)
│   └── README.md
├── battlesister/          # Battle Sister MelonLoader README (build DLL from battlesister-mod/)
│   └── README.md
└── gunmancontracts/       # Gunman Contracts MelonLoader README (build DLL from gunmancontracts-mod/)
    └── README.md
```

## Building Mods

Currently, no mods require building in this directory. The mods here are either:
- Pre-built files from external sources (Alyx scripts from NexusMods)
- Copied from `misc-documentations/` during the build process (L4D2 scripts)

For archived/untested mods, see `misc-documentations/archived-untested-mods/`.

## CI/CD Building

For automated builds, see `.github/workflows/build-mods.yml.example`.

The workflow:
1. Checks out game dependencies from cache/artifacts
2. Builds each mod with MSBuild
3. Copies DLLs to `mods/` directory
4. Commits or uploads as release artifacts

## Adding Pre-built Mods Manually

If you need to add mods manually:

1. Place the mod files in the appropriate folder under `mods/`
2. The release build will bundle these automatically

## Version Tracking

Each mod should have a version file (`version.txt`) containing:
```
1.0.0
Built: 2024-12-08
Commit: abc1234
```

This helps users know which version they're downloading.
