# Game Haptics

Use TN Games Third Space Vests with modern games, and experiment with additional
haptic hardware from one Windows app.

## Why we built this

A friend and I bought a couple of TN Games Third Space Vests and wanted to use
them with modern games.

We began by building a screen-capture prototype and a simple interface for
controlling the vest. Thanks to the work of people creating mods for newer
haptic hardware, we have since been able to adapt and expand support for more
games.

More recently, we started building a recoil feedback device and integrating it
into the same application.

## The app

The Game Haptics app provides one place to:

- connect and test a Third Space Vest;
- configure and monitor supported game integrations;
- turn game events and screen-capture signals into haptic feedback; and
- experiment with recoil feedback hardware.

> **App screenshot coming soon**
>
> _Replace this placeholder with a screenshot of the main application._

## Quick start

Game Haptics currently supports **Windows only**.

1. Open the [latest release](https://github.com/RomainFleury/game-haptics/releases/latest).
2. Download the Windows installer.
3. Run the installer, then open **Third Space Vest** from the Start menu.
4. Connect your vest and follow the instructions in the app for your game.

Prefer not to install it? Download the portable `.zip` from the same release,
extract it, and run `Third Space Vest.exe`.

## How it fits together

The app keeps hardware control in one background service, so the UI and game
integrations can work together without competing for the vest connection.

```text
Game mods ──────┐
Screen capture ─┼──► Game Haptics daemon ──► Third Space Vest
App UI ─────────┘                         └─► Recoil feedback device
```

The app helps install or configure game integrations where needed. The daemon
receives their events and translates them into feedback for the connected
hardware.

## Thanks

This project builds on the work of people who created and shared mods for newer
haptic hardware. Their work made it possible to bring support for more games to
the Third Space Vest.

Special thanks to:

- [floh-bhaptics](https://github.com/floh-bhaptics) for creating and openly
  sharing an extensive collection of bHaptics, OWO, and ProTube mods.
- [Astien (`Astienth`)](https://github.com/Astienth) for creating and openly
  sharing bHaptics, ProTube, ProVolver, and other VR mods.

Their broader body of work across many games—not just one particular
integration—gave us examples and foundations that made expanding this project
much easier.

## For developers

Want to run the project from source, understand the architecture, add a game,
or build a release? Start with the [developer guide](DEVELOPERS.md).
