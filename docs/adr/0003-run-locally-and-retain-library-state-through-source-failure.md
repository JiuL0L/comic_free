# Run locally and retain library state through source failure

The prototype binds its unauthenticated Local Core only to `127.0.0.1:3210`, manages a user-specified Suwayomi JAR on an internal port, and persists SQLite, Suwayomi state, and logs under Git-ignored `.local-data/`; Source Plugin or Comic Provider failure changes a Source Binding to unavailable but never deletes its Library Item, Last Known Snapshot, or Reading Progress, while live-provider checks remain optional because network and upstream behavior are outside Comic Free's control.
