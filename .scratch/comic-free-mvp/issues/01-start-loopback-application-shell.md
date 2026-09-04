# 01: Start the loopback application shell

**What to build:** Give the local reader one documented command that starts the Browser WebUI and Local Core, waits for readiness, and presents a useful browser-visible startup state instead of a blank page.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Before downloading or executing any new third-party dependency, name its package source and purpose and obtain the user's explicit permission.
- [ ] One root development command starts the Browser WebUI and Local Core and prints the browser URL.
- [ ] The Local Core binds only to `127.0.0.1:3210` and fails rather than falling back to a LAN-visible address.
- [ ] The Browser WebUI calls only the Local Core REST/JSON boundary and visibly distinguishes starting, ready, and failed states.
- [ ] A versioned health response is runtime-validated through the shared Comic Free contracts.
- [ ] Startup reports occupied-port and Local Core early-exit failures with actionable, non-sensitive details.
- [ ] The root verification command type-checks the workspace and proves the health journey through the browser-facing seam.
- [ ] Ordinary shutdown releases the Local Core port, and verification leaves the working tree free of runtime data.
