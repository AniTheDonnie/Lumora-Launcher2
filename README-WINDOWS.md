# LUMORA Launcher v0.3 — Minecraft Engine Build

This build moves LUMORA from a UI prototype toward a real playable Windows launcher.

## Added

- Electron Windows desktop app
- Microsoft account device-code login using `prismarine-auth`
- Minecraft profile/entitlement retrieval
- Vanilla Minecraft installation/launch engine using Minecraft Launcher Core
- Per-instance Minecraft directories
- RAM settings
- Java detection
- Live Minecraft process/log events
- Modrinth API search
- `.mrpack` import with:
  - `modrinth.index.json` validation
  - client environment filtering
  - HTTPS file downloads
  - SHA/file layout preparation
  - overrides and client-overrides extraction
  - loader/version detection
- Local server profiles and `server.jar` runner
- Restore point from the previous LUMORA UI build

## Important limitation

This is an engine development build, not a claim that every Minecraft loader and every CurseForge pack is already production-complete. Vanilla launch is wired through the launcher core; `.mrpack` contents are installed, while loader-specific provisioning (especially Forge/NeoForge) still needs the dedicated installer adapters. CurseForge browsing/installation also needs an official CurseForge API key.

Do not distribute Minecraft game files with LUMORA. The launcher downloads game files for an account that is entitled to play them.

## Run

1. Install Node.js LTS.
2. Extract the folder.
3. Run `SETUP-WINDOWS.bat`.
4. Run LUMORA.
5. Use Microsoft Login.
6. Create a Vanilla instance.
7. Press PLAY.

The first launch can take time because required game files are downloaded.

## Build EXE

Run `BUILD-WINDOWS.bat`. The output goes into `dist/`.

## Sources used for the engine design

Modrinth's current API and modpack specification:
https://docs.modrinth.com/api/
https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack

Minecraft's official launcher documentation:
https://www.minecraft.net/en-us/download

Microsoft account authentication is handled through the Microsoft/Xbox/Minecraft authentication chain; the project never asks the user for their Microsoft password.
