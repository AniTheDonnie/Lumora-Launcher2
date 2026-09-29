# LUMORA architecture notes

- Renderer: HTML/CSS/JS with Electron preload isolation.
- Main process: filesystem, Java processes, server processes and web requests.
- Modrinth: public API v2 is used for search.
- CurseForge: integration should use an official API key; do not embed private credentials.
- Microsoft sign-in: implement a desktop public-client flow with PKCE / approved redirect handling. Never collect or store a Microsoft password in LUMORA.

Official documentation:
- https://docs.modrinth.com/api/
- https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications
- https://learn.microsoft.com/en-us/azure/active-directory/develop/scenario-desktop-app-registration
