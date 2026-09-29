# LUMORA Windows Cloud Build

1. Create a GitHub repository.
2. Upload this project's files.
3. Open **Actions**.
4. Select **Build LUMORA Windows**.
5. Click **Run workflow**.
6. Open the completed run.
7. Download **LUMORA-Windows-EXE**.

The build runs on a Windows GitHub runner, so Node.js does not need to be installed on your PC.

The resulting EXE is unsigned, so Windows may display a security warning. Do not disable Windows security to bypass it.

This packages the current LUMORA development build; it does not guarantee that every Minecraft feature has been fully tested.
