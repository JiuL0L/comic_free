# Own local state and isolate provider integrations

Comic Free owns Library Items and Source Bindings in its local SQLite database. The browser WebUI talks only to the Comic Free local core, which proxies page images and treats Suwayomi as a replaceable Source Plugin host; this keeps durable reading state independent from provider failures and prevents provider-specific authentication, CORS, and upstream interface details from leaking into the WebUI.
