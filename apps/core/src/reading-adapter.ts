import {
  FIXTURE_SOURCE_PLUGIN,
  type CatalogSearchItem,
  type ComicDetailsResponse,
  type SourceBindingReasonCode,
} from "@comic-free/contracts";

export const FIXTURE_COMIC_KEY = "comic/deterministic-adventure";
export const FIXTURE_CHAPTER_KEY = "chapter/one";

export interface ReadingChapter {
  chapterKey: string;
  label: string;
}
export interface ResolvedChapter {
  chapter: ReadingChapter;
  comic: ComicDetailsResponse["comic"];
  pageKeys: string[];
}

export interface ReadingPage {
  bytes: Buffer;
  contentType: string;
}

export interface ReadingAdapter {
  readonly comicProviderKey?: string;
  readonly sourcePlugin: {
    key: string;
    name: string;
  };
  getChapters: (comicKey: string) => Promise<ReadingChapter[]>;
  getDetails: (comicKey: string) => Promise<ComicDetailsResponse["comic"]>;
  readPage: (pageKey: string, signal?: AbortSignal) => Promise<ReadingPage>;
  resolveChapter: (comicKey: string, chapterKey: string) => Promise<ResolvedChapter>;
  search: (query: string) => Promise<CatalogSearchItem[]>;
}

type ReadingAdapterErrorCode =
  | SourceBindingReasonCode
  | "catalog_item_not_found"
  | "chapter_not_found"
  | "invalid_page_type"
  | "page_not_found"
  | "page_fetch_failed"
  | "page_timeout"
  | "page_too_large"
  | "unsafe_page_reference";

export class ReadingAdapterError extends Error {
  constructor(
    readonly code: ReadingAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ReadingAdapterError";
  }
}

const COMIC: ComicDetailsResponse["comic"] = Object.freeze({
  comicKey: FIXTURE_COMIC_KEY,
  comicProviderKey: "fixture.provider",
  coverRef: "fixture-cover/deterministic-adventure",
  description:
    "A local three-page adventure used to prove reading and retention without a network.",
  sourcePluginKey: FIXTURE_SOURCE_PLUGIN.key,
  sourcePluginName: FIXTURE_SOURCE_PLUGIN.name,
  title: "Deterministic Adventure",
});

const CHAPTER: ReadingChapter = Object.freeze({
  chapterKey: FIXTURE_CHAPTER_KEY,
  label: "Chapter 1 · The Local Beginning",
});

const PAGE_KEYS = ["page/one", "page/two", "page/three"] as const;

function createPage(label: string, background: string, accent: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">` +
      `<rect width="800" height="1200" fill="${background}"/>` +
      `<path d="M80 180H720V1020H80Z" fill="${accent}" stroke="#17211b" stroke-width="18"/>` +
      `<circle cx="400" cy="465" r="190" fill="#f7f3e8" stroke="#17211b" stroke-width="18"/>` +
      `<path d="M260 485L350 575L555 350" fill="none" stroke="#17211b" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<text x="400" y="800" text-anchor="middle" font-family="sans-serif" font-size="76" font-weight="700" fill="#17211b">${label}</text>` +
      `<text x="400" y="875" text-anchor="middle" font-family="monospace" font-size="30" fill="#17211b">COMIC FREE FIXTURE</text>` +
      `</svg>`,
    "utf8",
  );
}

const PAGES: Readonly<Record<(typeof PAGE_KEYS)[number], Buffer>> = Object.freeze({
  "page/one": createPage("PAGE ONE", "#f3ead3", "#8fc9a3"),
  "page/two": createPage("PAGE TWO", "#f5b942", "#f7f3e8"),
  "page/three": createPage("PAGE THREE", "#8fb7d6", "#f3ead3"),
});

export class FixtureReadingAdapter implements ReadingAdapter {
  readonly sourcePlugin = FIXTURE_SOURCE_PLUGIN;
  readonly comicProviderKey = "fixture.provider";

  async search(query: string): Promise<CatalogSearchItem[]> {
    const normalized = query.trim().toLowerCase();
    if (normalized.includes("retryable failure")) {
      throw new ReadingAdapterError(
        "comic_provider_unreachable",
        "The deterministic Comic Provider is temporarily unavailable.",
        true,
      );
    }
    if (
      !normalized.includes("adventure") &&
      !normalized.includes("deterministic") &&
      !normalized.includes("fixture")
    ) {
      return [];
    }
    return [
      {
        comicKey: COMIC.comicKey,
        coverRef: COMIC.coverRef,
        sourcePluginKey: COMIC.sourcePluginKey,
        sourcePluginName: COMIC.sourcePluginName,
        title: COMIC.title,
      },
    ];
  }

  async getDetails(comicKey: string): Promise<ComicDetailsResponse["comic"]> {
    if (comicKey !== COMIC.comicKey) {
      throw new ReadingAdapterError(
        "catalog_item_not_found",
        "The requested catalog comic does not exist.",
        false,
      );
    }
    return { ...COMIC };
  }

  async getChapters(comicKey: string): Promise<ReadingChapter[]> {
    await this.getDetails(comicKey);
    return [{ ...CHAPTER }];
  }

  async resolveChapter(comicKey: string, chapterKey: string): Promise<ResolvedChapter> {
    const comic = await this.getDetails(comicKey);
    if (chapterKey !== CHAPTER.chapterKey) {
      throw new ReadingAdapterError(
        "chapter_not_found",
        "The requested chapter does not exist.",
        false,
      );
    }
    return {
      chapter: { ...CHAPTER },
      comic,
      pageKeys: [...PAGE_KEYS],
    };
  }

  async readPage(pageKey: string): Promise<ReadingPage> {
    const bytes = PAGES[pageKey as keyof typeof PAGES];
    if (!bytes) {
      throw new ReadingAdapterError(
        "page_not_found",
        "The requested page does not exist.",
        false,
      );
    }
    return {
      bytes: Buffer.from(bytes),
      contentType: "image/svg+xml; charset=utf-8",
    };
  }
}
