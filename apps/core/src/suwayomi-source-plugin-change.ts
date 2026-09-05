import type {
  PluginHostStatusResponse,
  SourcePluginCatalogEntry,
  SourcePluginChangeRequest,
} from "@comic-free/contracts";

import {
  SourcePluginChangeAdapterError,
  type SourcePluginChangeAdapter,
  type SourcePluginChangeAdapterResult,
} from "./source-plugin-change.ts";

const MAX_GRAPHQL_BYTES = 1024 * 1024;

interface ExtensionStoreNode {
  indexUrl: string;
}

interface ExtensionNode {
  hasUpdate: boolean;
  isInstalled: boolean;
  isObsolete: boolean;
  name: string;
  pkgName: string;
  source?: {
    nodes?: Array<{ id: string | number; lang: string; name: string }>;
  };
  storeIndexUrl: string | null;
  versionName: string;
}

export interface SuwayomiSourcePluginInspection {
  installed: boolean;
  name: string;
  packageName: string;
  providers: SourcePluginChangeAdapterResult["providers"];
  version: string;
}

interface GraphqlEnvelope {
  data?: unknown;
  errors?: unknown[];
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SourcePluginChangeAdapterError(
      "plugin_host_invalid_response",
      `The Plugin Host returned an invalid ${context}.`,
      true,
    );
  }
  return value as Record<string, unknown>;
}

function requireExtension(value: unknown): ExtensionNode {
  const extension = requireRecord(value, "Source Plugin response");
  for (const field of ["name", "pkgName", "versionName"] as const) {
    if (typeof extension[field] !== "string" || extension[field].trim() === "") {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_invalid_response",
        `The Plugin Host returned an invalid Source Plugin ${field}.`,
        true,
      );
    }
  }
  if (
    typeof extension.isInstalled !== "boolean" ||
    typeof extension.isObsolete !== "boolean" ||
    typeof extension.hasUpdate !== "boolean"
  ) {
    throw new SourcePluginChangeAdapterError(
      "plugin_host_invalid_response",
      "The Plugin Host returned invalid Source Plugin state flags.",
      true,
    );
  }
  return extension as unknown as ExtensionNode;
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GRAPHQL_BYTES) {
    throw new SourcePluginChangeAdapterError(
      "plugin_host_response_too_large",
      "The Plugin Host response exceeded the 1 MiB limit.",
      true,
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_GRAPHQL_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SourcePluginChangeAdapterError(
        "plugin_host_response_too_large",
        "The Plugin Host response exceeded the 1 MiB limit.",
        true,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function parseComicProviders(
  extension: ExtensionNode,
): SourcePluginChangeAdapterResult["providers"] {
  const source = extension.source && requireRecord(extension.source, "Comic Provider list");
  const nodes = source && Array.isArray(source.nodes) ? source.nodes : [];
  return nodes.map((candidate, index) => {
    const provider = requireRecord(candidate, `Comic Provider ${index}`);
    if (
      (typeof provider.id !== "string" && typeof provider.id !== "number") ||
      typeof provider.name !== "string" ||
      provider.name.trim() === "" ||
      typeof provider.lang !== "string" ||
      provider.lang.trim() === ""
    ) {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_invalid_response",
        "The Plugin Host returned an invalid Comic Provider.",
        true,
      );
    }
    return {
      key: String(provider.id),
      language: provider.lang,
      name: provider.name,
    };
  });
}

function requireComicProviders(
  extension: ExtensionNode,
): SourcePluginChangeAdapterResult["providers"] {
  const providers = parseComicProviders(extension);
  if (providers.length === 0) {
    throw new SourcePluginChangeAdapterError(
      "source_plugin_has_no_providers",
      "The installed Source Plugin did not expose any Comic Providers.",
      true,
      409,
    );
  }
  return providers;
}

export class SuwayomiSourcePluginChangeAdapter implements SourcePluginChangeAdapter {
  readonly #pluginHostStatus: () => PluginHostStatusResponse;

  constructor(pluginHostStatus: () => PluginHostStatusResponse) {
    this.#pluginHostStatus = pluginHostStatus;
  }

  async #graphql(
    query: string,
    variables: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const status = this.#pluginHostStatus();
    if (status.state !== "ready" || status.internalPort === null) {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_unavailable",
        "The approved Plugin Host must be ready before changing a Source Plugin.",
        true,
        503,
      );
    }
    const response = await fetch(
      `http://127.0.0.1:${status.internalPort}/api/graphql`,
      {
        body: JSON.stringify({ query, variables }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal,
      },
    );
    const text = await readLimitedText(response);
    let envelope: GraphqlEnvelope;
    try {
      envelope = JSON.parse(text) as GraphqlEnvelope;
    } catch {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_invalid_response",
        "The Plugin Host returned invalid JSON.",
        true,
      );
    }
    if (!response.ok || (Array.isArray(envelope.errors) && envelope.errors.length > 0)) {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_rejected_change",
        "The Plugin Host rejected the Source Plugin change.",
        response.status >= 500,
        response.ok ? 502 : response.status,
      );
    }
    return requireRecord(envelope.data, "GraphQL data");
  }

  async #prepareApprovedExtension(
    request: SourcePluginChangeRequest,
    signal: AbortSignal,
  ): Promise<ExtensionNode> {
    const storesData = await this.#graphql(
      `query ComicFreeExtensionStores {
        extensionStores { nodes { indexUrl name } totalCount }
      }`,
      {},
      signal,
    );
    const stores = requireRecord(storesData.extensionStores, "extension store list");
    const nodes = Array.isArray(stores.nodes) ? stores.nodes : [];
    const storeExists = nodes.some(
      (candidate) =>
        requireRecord(candidate, "extension store").indexUrl === request.source.storeUrl,
    );
    if (!storeExists) {
      await this.#graphql(
        `mutation ComicFreeAddExtensionStore($input: AddExtensionStoreInput!) {
          addExtensionStore(input: $input) { extensionStore { indexUrl name } }
        }`,
        { input: { indexUrl: request.source.storeUrl } },
        signal,
      );
    }

    const fetchedData = await this.#graphql(
      `mutation ComicFreeFetchExtensions($input: FetchExtensionsInput!) {
        fetchExtensions(input: $input) {
          extensionStores { indexUrl name }
          extensions {
            name pkgName versionName isInstalled isObsolete hasUpdate storeIndexUrl
            source { nodes { id name lang } totalCount }
          }
        }
      }`,
      { input: {} },
      signal,
    );
    const fetched = requireRecord(fetchedData.fetchExtensions, "fetched extension catalog");
    if (!Array.isArray(fetched.extensions)) {
      throw new SourcePluginChangeAdapterError(
        "plugin_host_invalid_response",
        "The Plugin Host did not return a Source Plugin catalog.",
        true,
      );
    }
    const targetValue = fetched.extensions.find((candidate) => {
      const extension = requireRecord(candidate, "Source Plugin catalog entry");
      return extension.pkgName === request.source.packageName;
    });
    if (!targetValue) {
      throw new SourcePluginChangeAdapterError(
        "source_plugin_not_found",
        "The approved Source Plugin was not found in the selected extension store.",
        false,
        404,
      );
    }
    const target = requireExtension(targetValue);
    if (target.storeIndexUrl !== request.source.storeUrl) {
      throw new SourcePluginChangeAdapterError(
        "source_plugin_store_mismatch",
        "The Source Plugin package did not belong to the approved extension store.",
        false,
        409,
      );
    }
    if (
      request.action !== "disable" &&
      target.versionName !== request.source.expectedVersion
    ) {
      throw new SourcePluginChangeAdapterError(
        "source_plugin_version_mismatch",
        "The extension store version did not match the explicitly approved version.",
        false,
        409,
      );
    }
    return target;
  }

  async inspect(
    request: SourcePluginChangeRequest,
    signal: AbortSignal,
  ): Promise<SuwayomiSourcePluginInspection> {
    const extension = await this.#prepareApprovedExtension(request, signal);
    return {
      installed: extension.isInstalled,
      name: extension.name,
      packageName: extension.pkgName,
      providers: parseComicProviders(extension),
      version: extension.versionName,
    };
  }

  async change(
    request: SourcePluginChangeRequest,
    signal: AbortSignal,
    currentPlugin?: SourcePluginCatalogEntry | null,
  ): Promise<SourcePluginChangeAdapterResult> {
    if (request.action === "disable") {
      if (!currentPlugin) {
        throw new SourcePluginChangeAdapterError(
          "source_plugin_not_found",
          "Comic Free has no approved local Source Plugin record to disable.",
          false,
          404,
        );
      }
      return {
        name: currentPlugin.name,
        pluginKey: currentPlugin.pluginKey,
        providers: currentPlugin.providers,
        reasonCode: "disabled",
        restartRequired: false,
        status: "disabled",
        version: currentPlugin.version,
      };
    }
    const approvedExtension = await this.#prepareApprovedExtension(request, signal);
    if (request.action === "restore" && approvedExtension.isInstalled) {
      return {
        name: approvedExtension.name,
        pluginKey: approvedExtension.pkgName,
        providers: requireComicProviders(approvedExtension),
        reasonCode: null,
        restartRequired: false,
        status: "healthy",
        version: approvedExtension.versionName,
      };
    }
    const patch =
      request.action === "update" ? { update: true } : { install: true };
    const changedData = await this.#graphql(
      `mutation ComicFreeUpdateExtension($input: UpdateExtensionInput!) {
        updateExtension(input: $input) {
          extension {
            name pkgName versionName isInstalled isObsolete hasUpdate storeIndexUrl
            source { nodes { id name lang } totalCount }
          }
        }
      }`,
      { input: { id: request.source.packageName, patch } },
      signal,
    );
    const payload = requireRecord(changedData.updateExtension, "Source Plugin change payload");
    const extension = requireExtension(payload.extension);
    if (!extension.isInstalled) {
      throw new SourcePluginChangeAdapterError(
        "source_plugin_change_not_applied",
        "The Plugin Host did not apply the requested Source Plugin state.",
        true,
        409,
      );
    }
    return {
      name: extension.name,
      pluginKey: extension.pkgName,
      providers: requireComicProviders(extension),
      reasonCode: null,
      restartRequired: false,
      status: "healthy",
      version: extension.versionName,
    };
  }
}
