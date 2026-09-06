import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FixtureReadingAdapter,
  ReadingAdapterError,
  type ReadingAdapter,
} from "./reading-adapter.ts";

async function exerciseCatalog(adapter: ReadingAdapter): Promise<void> {
  const results = await adapter.search("adventure");
  assert.equal(results.length, 1);
  const result = results[0];
  assert(result);
  assert.equal(result.sourcePluginName, "Comic Free Fixture Reader");

  const details = await adapter.getDetails(result.comicKey);
  assert.equal(details.comicProviderKey, "fixture.provider");
  const chapters = await adapter.getChapters(result.comicKey);
  assert.deepEqual(chapters.map((chapter) => chapter.chapterKey), ["chapter/one", "chapter/two"]);

  const resolution = await adapter.resolveChapter(
    result.comicKey,
    chapters[0]?.chapterKey ?? "",
  );
  assert.equal(resolution.pageKeys.length, 3);
  assert.deepEqual(resolution.pageKeys, ["page/one", "page/two", "page/three"]);
}

test("fixture implements the replaceable reading catalog interface", async () => {
  await exerciseCatalog(new FixtureReadingAdapter());
});

test("a second fixture chapter resolves independently for cross-chapter resume", async () => {
  const adapter = new FixtureReadingAdapter();
  const resolution = await adapter.resolveChapter("comic/deterministic-adventure", "chapter/two");
  assert.equal(resolution.chapter.chapterKey, "chapter/two");
  assert.equal(resolution.pageKeys.length, 3);
  const page = await adapter.readPage(resolution.pageKeys[0]!);
  assert.match(page.bytes.toString("utf8"), /CHAPTER TWO/);
});
test("fixture returns recognizable, stable, non-transparent image bytes", async () => {
  const adapter = new FixtureReadingAdapter();
  const page = await adapter.readPage("page/two");
  const text = page.bytes.toString("utf8");

  assert.equal(page.contentType, "image/svg+xml; charset=utf-8");
  assert.match(text, /width="800" height="1200"/);
  assert.match(text, /PAGE TWO/);
  assert.match(text, /fill="#f5b942"/);
  assert.equal(
    createHash("sha256").update(page.bytes).digest("hex"),
    "3eafebf9fa45b1d48b81c87bb85c55987b6d51ea34a5399c58bbe797c7311e9f",
  );
});

test("fixture exposes deterministic empty and retryable failure states", async () => {
  const adapter = new FixtureReadingAdapter();
  assert.deepEqual(await adapter.search("no matches"), []);
  await assert.rejects(
    adapter.search("retryable failure"),
    (error: unknown) =>
      error instanceof ReadingAdapterError &&
      error.code === "comic_provider_unreachable" &&
      error.retryable,
  );
});
