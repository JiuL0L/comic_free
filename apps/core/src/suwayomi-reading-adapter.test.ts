import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReadingAdapterError } from "./reading-adapter.ts";
import {
  SuwayomiReadingAdapter,
  type SuwayomiReadingAdapterOptions,
  type SuwayomiGraphqlTransport,
} from "./suwayomi-reading-adapter.ts";

type RecordedGeneration = Record<"chapters" | "details" | "pages" | "search", unknown>;

const ROOT = path.resolve(import.meta.dirname, "../../..");

function loadGeneration(name: string): RecordedGeneration {
  return JSON.parse(
    readFileSync(
      path.join(ROOT, "tests", "fixtures", "suwayomi", `${name}.json`),
      "utf8",
    ),
  ) as RecordedGeneration;
}

class RecordedTransport implements SuwayomiGraphqlTransport {
  constructor(private readonly generation: RecordedGeneration) {}

  async request(operation: string, variables: Record<string, unknown>): Promise<unknown> {
    const input = variables.input as Record<string, unknown>;
    const idField = operation.includes("ComicFreeDetails") ? "id"
      : operation.includes("ComicFreeChapters") ? "mangaId"
      : operation.includes("ComicFreePages") ? "chapterId" : null;
    if (idField) assert.equal(typeof input[idField], "number", `${idField} must be a GraphQL Int`);
    if (operation.includes("ComicFreeSearch")) return this.generation.search;
    if (operation.includes("ComicFreeDetails")) return this.generation.details;
    if (operation.includes("ComicFreeChapters")) return this.generation.chapters;
    if (operation.includes("ComicFreePages")) return this.generation.pages;
    throw new Error(`Unexpected recorded operation: ${operation}`);
  }
}

function adapter(
  generation: RecordedGeneration,
  overrides: Partial<SuwayomiReadingAdapterOptions> = {},
): SuwayomiReadingAdapter {
  return new SuwayomiReadingAdapter({
    comicProviderKey: "mangadex.org",
    graphql: new RecordedTransport(generation),
    pageFetch: async (input) => {
      const url = String(input);
      return new Response(Buffer.from(`recorded image at ${url}`, "utf8"), {
        headers: { "content-type": "image/jpeg" },
      });
    },
    sourceId: "2499283573021220255",
    sourcePluginKey: "mihon:eu.kanade.tachiyomi.extension.all.mangadex:en",
    sourcePluginName: "MangaDex (English)",
    suwayomiOrigin: "http://127.0.0.1:4568",
    ...overrides,
  });
}

test("recorded Suwayomi generations keep durable provider keys while runtime ids renew", async () => {
  const first = adapter(loadGeneration("reading-generation-1"));
  const second = adapter(loadGeneration("reading-generation-2"));

  const firstResult = (await first.search("Deterministic Adventure"))[0];
  const secondResult = (await second.search("Deterministic Adventure"))[0];
  assert(firstResult);
  assert(secondResult);
  assert.equal(firstResult.comicKey, secondResult.comicKey);
  assert.doesNotMatch(firstResult.comicKey, /(?:101|501)/);

  const firstChapter = (await first.getChapters(firstResult.comicKey))[0];
  const secondChapter = (await second.getChapters(secondResult.comicKey))[0];
  assert(firstChapter);
  assert(secondChapter);
  assert.equal(firstChapter.chapterKey, secondChapter.chapterKey);
  assert.doesNotMatch(firstChapter.chapterKey, /(?:201|601)/);

  const firstResolution = await first.resolveChapter(
    firstResult.comicKey,
    firstChapter.chapterKey,
  );
  const secondResolution = await second.resolveChapter(
    secondResult.comicKey,
    secondChapter.chapterKey,
  );
  assert.match(firstResolution.pageKeys[0] ?? "", /manga\/101\/chapter\/201/);
  assert.match(secondResolution.pageKeys[0] ?? "", /manga\/501\/chapter\/601/);
  assert.equal(firstResolution.chapter.chapterKey, secondResolution.chapter.chapterKey);

  const details = await second.getDetails(secondResult.comicKey);
  assert.equal(details.comicProviderKey, "mangadex.org");
  assert.equal(details.sourcePluginName, "MangaDex (English)");
  assert.doesNotMatch(JSON.stringify(details), /api\/graphql|chapter\/601\/page/);
});

test("Suwayomi browse uses POPULAR pagination and reads covers only through the loopback Plugin Host", async () => {
  const generation = loadGeneration("reading-generation-1");
  const browseInputs: Array<Record<string, unknown>> = [];
  const coverRequests: string[] = [];
  const graphql: SuwayomiGraphqlTransport = {
    async request(operation, variables) {
      if (!operation.includes("ComicFreeBrowse")) {
        return new RecordedTransport(generation).request(operation, variables);
      }
      const input = variables.input as Record<string, unknown>;
      browseInputs.push(input);
      const page = Number(input.page);
      return {
        data: {
          fetchSourceManga: {
            hasNextPage: page === 1,
            mangas: [{ id: page === 1 ? 101 : 102, title: `Popular ${page}`, url: `/popular/${page}`, thumbnailUrl: `https://upstream.invalid/${page}.jpg` }],
          },
        },
      };
    },
  };
  const instance = adapter(generation, {
    graphql,
    pageFetch: async (input) => {
      coverRequests.push(String(input));
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } });
    },
  });

  const first = await instance.browse(1);
  const second = await instance.browse(first.nextPage!);
  assert.deepEqual(browseInputs, [
    { page: 1, source: "2499283573021220255", type: "POPULAR" },
    { page: 2, source: "2499283573021220255", type: "POPULAR" },
  ]);
  assert.equal(first.nextPage, 2);
  assert.equal(second.nextPage, null);

  const cover = await instance.readCover(second.items[0]!.comicKey);
  assert.equal(cover.contentType, "image/jpeg");
  assert.deepEqual(coverRequests, ["http://127.0.0.1:4568/api/v1/manga/102/thumbnail?useCache=true"]);
  assert.doesNotMatch(coverRequests[0]!, /upstream\.invalid/);
});

test("Suwayomi GraphQL errors become stable adapter errors without payload leakage", async () => {
  const failing = adapter({
    chapters: {},
    details: {},
    pages: {},
    search: {
      data: null,
      errors: [{ message: "provider secret detail", path: ["fetchSourceManga"] }],
    },
  });

  await assert.rejects(
    failing.search("anything"),
    (error: unknown) =>
      error instanceof ReadingAdapterError &&
      error.code === "comic_provider_unreachable" &&
      error.retryable &&
      !error.message.includes("provider secret detail"),
  );
});

test("chapter navigation follows ascending known chapter numbers and preserves unknown catalog order", async () => {
  const generation = loadGeneration("reading-generation-1");
  const chapters = [
    { id: 203, name: "Finale", url: "/chapter/finale", chapterNumber: 12 },
    { id: 202, name: "Interlude", url: "/chapter/interlude", chapterNumber: 2.5 },
    { id: 201, name: "Opening", url: "/chapter/opening", chapterNumber: 1 },
  ];
  const known = adapter({ ...generation, chapters: { data: { fetchChapters: { chapters } } } });
  const comic = (await known.search("adventure"))[0]!;
  assert.deepEqual((await known.getChapters(comic.comicKey)).map(chapter => chapter.label), ["Opening", "Interlude", "Finale"]);

  const unknown = adapter({ ...generation, chapters: { data: { fetchChapters: {
    chapters: chapters.map(chapter => ({ ...chapter, chapterNumber: -1 })),
  } } } });
  assert.deepEqual((await unknown.getChapters(comic.comicKey)).map(chapter => chapter.label), ["Finale", "Interlude", "Opening"]);
});

test("Suwayomi page reads preserve exact image bytes and reject unsafe responses", async () => {
  const generation = loadGeneration("reading-generation-1");
  const expected = Buffer.from([0xff, 0xd8, 0x43, 0x46, 0xff, 0xd9]);
  const successful = adapter(generation, {
    pageFetch: async () =>
      new Response(expected, { headers: { "content-type": "image/jpeg" } }),
  });
  const page = await successful.readPage("/api/v1/manga/101/chapter/201/page/0");
  assert.equal(page.contentType, "image/jpeg");
  assert.deepEqual(page.bytes, expected);

  await assert.rejects(
    successful.readPage("https://provider.example.invalid/page.jpg"),
    (error: unknown) =>
      error instanceof ReadingAdapterError && error.code === "unsafe_page_reference",
  );

  const nonImage = adapter(generation, {
    pageFetch: async () =>
      new Response("not an image", { headers: { "content-type": "text/html" } }),
  });
  await assert.rejects(
    nonImage.readPage("/api/v1/manga/101/chapter/201/page/0"),
    (error: unknown) =>
      error instanceof ReadingAdapterError && error.code === "invalid_page_type",
  );

  const oversized = adapter(generation, {
    maxPageBytes: 4,
    pageFetch: async () =>
      new Response(Buffer.alloc(5), {
        headers: { "content-length": "5", "content-type": "image/png" },
      }),
  });
  await assert.rejects(
    oversized.readPage("/api/v1/manga/101/chapter/201/page/0"),
    (error: unknown) =>
      error instanceof ReadingAdapterError &&
      error.code === "page_too_large" &&
      /4-byte/.test(error.message),
  );
});

test("Suwayomi page reads apply a bounded timeout", async () => {
  const timedOut = adapter(loadGeneration("reading-generation-1"), {
    requestTimeoutMs: 5,
    pageFetch: async (_input, init) => {
      if (!init?.signal) throw new Error("Expected a bounded page request signal.");
      await new Promise<void>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
      throw new Error("unreachable");
    },
  });

  await assert.rejects(
    timedOut.readPage("/api/v1/manga/101/chapter/201/page/0"),
    (error: unknown) =>
      error instanceof ReadingAdapterError &&
      error.code === "page_timeout" &&
      error.retryable &&
      /timed out/i.test(error.message),
  );

  const stalledBody = adapter(loadGeneration("reading-generation-1"), {
    requestTimeoutMs: 5,
    pageFetch: async (_input, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(init.signal?.reason),
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      ),
  });
  await assert.rejects(
    stalledBody.readPage("/api/v1/manga/101/chapter/201/page/0"),
    (error: unknown) =>
      error instanceof ReadingAdapterError && error.code === "page_timeout",
  );
});


test("rejects invalid Suwayomi runtime IDs before issuing dependent requests", async () => {
  for (const id of ["101", "", 0, -1, 1.5, 2_147_483_648, null]) {
    const generation = loadGeneration("reading-generation-1");
    generation.search = { data: { fetchSourceManga: { mangas: [{
      id, title: "Invalid ID", url: "/title/invalid-id",
    }] } } };
    await assert.rejects(adapter(generation).search("Invalid ID"),
      (error: unknown) => error instanceof ReadingAdapterError && error.code === "unknown");
  }
});

test("a single image HTTP or network failure is not a provider-wide outage", async () => {
  for (const pageFetch of [async () => new Response('', {status: 503}), async () => { throw new TypeError('fetch failed'); }]) {
    const instance = adapter(loadGeneration("reading-generation-1"), {pageFetch});
    await assert.rejects(instance.readPage("/api/v1/manga/101/chapter/201/page/0"), (error: unknown) => error instanceof ReadingAdapterError && error.code === "page_fetch_failed");
  }
});
