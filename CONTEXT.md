# Comic Free

Comic Free is a local, personal comic-browsing context. It separates durable local reading state from replaceable integrations with remote comic providers.

## Language

**Comic Provider**:
A remote website or endpoint that exposes comic metadata, chapters, and pages.
_Avoid_: Source, website

**Source Plugin**:
An independently installable code module that translates one or more Comic Providers into Comic Free's normalized catalog contract.
_Avoid_: Source, parser module, scraper

**Catalog**:
The normalized collection of comics, chapters, and pages made available by active Source Plugins.
_Avoid_: Source list, provider data

**Library Item**:
A locally retained comic record whose identity and reading state survive Source Plugin or Comic Provider failure.
_Avoid_: Favorite, source manga

**Source Binding**:
The association between a Library Item and a provider-specific comic identifier exposed through a Source Plugin.
_Avoid_: Source ID, manga link

**Local Core**:
The Node.js service that owns Comic Free's local state and stable HTTP interface, translates Suwayomi responses, proxies page images, and manages the Suwayomi child process.
_Avoid_: Backend, server

**Plugin Host**:
The replaceable runtime responsible for loading and executing Source Plugins. The prototype uses Suwayomi as its Plugin Host.
_Avoid_: Source manager, scraper engine

**Reading Progress**:
The locally owned last-read chapter and page for a Library Item. It remains available when its Source Binding cannot currently resolve.
_Avoid_: Remote progress, provider bookmark

**Last Known Snapshot**:
The locally retained title, cover reference, and other minimal display metadata most recently obtained for a Library Item.
_Avoid_: Live metadata, provider cache

**Reading Progress**:
The locally owned last-read chapter and page for a Library Item. It remains available when its Source Binding cannot currently resolve.
_Avoid_: Remote progress, provider bookmark

**Last Known Snapshot**:
The locally retained title, cover reference, and other minimal display metadata most recently obtained for a Library Item.
_Avoid_: Live metadata, provider cache
