# Developer guide

This page is the starting point for developing Game Haptics. The application
and packaged releases target Windows.

## Project layout

| Path | Purpose |
| --- | --- |
| [`modern-third-space/`](modern-third-space/) | Python hardware API, daemon, and game integration managers |
| [`web/`](web/) | Electron and React application |
| [`mods/`](mods/) | Game mods bundled with the application |
| [`windows/`](windows/) | Windows setup, development, and release scripts |
| [`legacy-do-not-change/`](legacy-do-not-change/) | Preserved historical driver code; do not modify |
| [`misc-documentations/`](misc-documentations/) | Archived references and research material |

All hardware commands flow through the Python daemon on TCP port 5050. The
Electron UI, game mods, and other integrations are daemon clients; they should
not access the vest directly.

## Run from source on Windows

Install [Node.js LTS](https://nodejs.org/) and
[Python](https://www.python.org/downloads/), then:

1. Run `windows/check-setup.bat` to check prerequisites and install
   dependencies.
2. Run `windows/start-all.bat` to start the daemon and Electron app.

See the [complete Windows development setup](windows/advanced/HOW_TO_RUN_DEV.md)
and [Windows troubleshooting guide](windows/SETUP.md) when you need more
control.

## Technical documentation

- [Python package and daemon](modern-third-space/README.md)
- [Electron and React workspace](web/README.md)
- [Daemon architecture and protocol](docs-external-integrations-ideas/DAEMON_ARCHITECTURE.md)
- [Testing and protocol examples](modern-third-space/TESTING.md)
- [Bundled game mods](mods/README.md)
- [Building Windows releases](BUILD-RELEASE.md)
- [Project history](CHANGELOG.md)

## Common development tasks

### Python daemon

```bash
cd modern-third-space
pip install -e .[dev]
python3 -m modern_third_space.cli daemon start
python3 -m modern_third_space.cli daemon status
python3 -m modern_third_space.cli daemon stop
```

### Electron app

Run Node and Yarn commands from `web/`, never from the repository root:

```bash
cd web
corepack enable
yarn install
yarn dev
```

### Tests

```bash
cd modern-third-space
python3 -m pytest
```

Game integration changes must also pass:

```bash
python3 -m pytest tests/test_game_integrations.py -v
python3 scripts/check_integrations.py
```

## Architecture rules

- Never modify `legacy-do-not-change/`.
- Keep `modern_third_space.vest` isolated from game-specific code.
- Route vest commands through the daemon.
- Register new integrations in
  `modern-third-space/src/modern_third_space/integrations/registry.py`.
- Keep Electron and React work under `web/`.

For detailed repository context and contribution patterns, see
[AI onboarding](AI_ONBOARDING.md) and [the workspace rules](.cursorrules).
