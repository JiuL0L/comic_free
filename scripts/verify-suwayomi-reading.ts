import { createHash } from "node:crypto";

import {
  CORE_HEALTH_URL,
  LOCAL_CORE_ORIGIN,
  READER_SESSIONS_PATH,
  READING_PROVIDERS_PATH,
  catalogSearchUrl,
  comicChaptersUrl,
  comicDetailsUrl,
  parseApiErrorResponse,
  parseCatalogChaptersResponse,
  parseCatalogSearchResponse,
  parseComicDetailsResponse,
  parseHealthResponse,
  parseReaderSessionResponse,
  parseReadingProvidersResponse,
} from "@comic-free/contracts";

const query = process.env.COMIC_FREE_SUWAYOMI_READING_QUERY?.trim();

if (!query) {
  throw new Error(
    "Set COMIC_FREE_SUWAYOMI_READING_QUERY to an approved live search term before running this opt-in check.",
  );
}

async function json(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const error = parseApiErrorResponse(value).error;
    throw new Error(`${error.code}: ${error.message}`);
  }
  return value;
}

parseHealthResponse(await json(CORE_HEALTH_URL));
const providers = parseReadingProvidersResponse(
  await json(`${LOCAL_CORE_ORIGIN}${READING_PROVIDERS_PATH}`),
);
const pluginKey = process.env.COMIC_FREE_SUWAYOMI_SOURCE_PLUGIN_KEY?.trim();
const providerKey = process.env.COMIC_FREE_SUWAYOMI_COMIC_PROVIDER_KEY?.trim();
const choices = providers.items.filter(provider => provider.available && provider.sourcePluginKey !== "fixture:reader" && (!pluginKey || provider.sourcePluginKey === pluginKey) && (!providerKey || provider.comicProviderKey === providerKey));
if (providers.state === "error" || choices.length !== 1) throw new Error("Select exactly one approved installed Comic Provider using COMIC_FREE_SUWAYOMI_SOURCE_PLUGIN_KEY and COMIC_FREE_SUWAYOMI_COMIC_PROVIDER_KEY from the reading providers list. These select this smoke check only; the application discovers its own routes.");
const source = choices[0]!;

const result = parseCatalogSearchResponse(
  await json(catalogSearchUrl(source.sourcePluginKey, query, source.comicProviderKey)),
).items[0];
if (!result) throw new Error("The configured Source Plugin returned no search result.");

const [details, chapters] = await Promise.all([
  json(comicDetailsUrl(source.sourcePluginKey, result.comicKey)).then(parseComicDetailsResponse),
  json(comicChaptersUrl(source.sourcePluginKey, result.comicKey)).then(parseCatalogChaptersResponse),
]);
const chapter = chapters.items[0];
if (!chapter) throw new Error("The selected comic returned no chapters.");

const session = parseReaderSessionResponse(
  await json(`${LOCAL_CORE_ORIGIN}${READER_SESSIONS_PATH}`, {
    body: JSON.stringify({
      chapterKey: chapter.chapterKey,
      comicKey: result.comicKey,
      sourcePluginKey: source.sourcePluginKey,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }),
).session;

const page = await fetch(session.pageUrl, { signal: AbortSignal.timeout(60_000) });
if (!page.ok) throw new Error(`The Local Core page proxy returned HTTP ${page.status}.`);
const contentType = page.headers.get("content-type") ?? "";
if (!contentType.toLowerCase().startsWith("image/")) {
  throw new Error(`The Local Core page proxy returned non-image content: ${contentType}.`);
}
const bytes = Buffer.from(await page.arrayBuffer());
if (bytes.length === 0) throw new Error("The Local Core page proxy returned an empty image.");

console.log(
  JSON.stringify(
    {
      byteCount: bytes.length,
      chapter: session.chapterLabel,
      comicProviderKey: details.comic.comicProviderKey,
      contentType,
      pageCount: session.pageCount,
      pageSha256: createHash("sha256").update(bytes).digest("hex"),
      sourcePlugin: session.sourcePluginName,
      title: session.title,
    },
    null,
    2,
  ),
);
