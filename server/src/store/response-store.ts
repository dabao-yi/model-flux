import { log } from "../lib/log.js";

export interface StoredResponse {
  provider?: string;
  input?: unknown[];
  output?: unknown[];
  previousResponseId?: string | null;
  storedAt: number;
  consecutiveToolCalls?: number;
  breakerFired?: boolean;
  reasoningContent?: string;
}

export interface ResponseStoreConfig {
  storeTtl: number;
  storeMax: number;
}

export function createResponseStore(config: ResponseStoreConfig) {
  const responseStore = new Map<string, StoredResponse>();

  function touchResponse(id: string | null | undefined): StoredResponse | undefined {
    if (!id) return undefined;
    const entry = responseStore.get(id);
    if (!entry) return undefined;
    responseStore.delete(id);
    responseStore.set(id, entry);
    return entry;
  }

  function storeResponse(
    id: string,
    data: Omit<StoredResponse, "storedAt" | "consecutiveToolCalls"> & {
      consecutiveToolCalls?: number;
    },
  ): void {
    if (!id) return;

    if (responseStore.size >= config.storeMax) {
      const now = Date.now();
      for (const [key, val] of responseStore) {
        if (now - val.storedAt > config.storeTtl) responseStore.delete(key);
      }
      if (responseStore.size >= config.storeMax) {
        const oldest = responseStore.keys().next().value;
        if (oldest) responseStore.delete(oldest);
      }
    }

    const output = data.output as { type?: string }[] | undefined;
    const isToolCallOnly =
      Array.isArray(output) && output.length > 0 && output.every((o) => o.type === "function_call");

    let consecutiveToolCalls = 0;
    if (data.previousResponseId) {
      const prev = touchResponse(data.previousResponseId);
      if (prev?.breakerFired) {
        consecutiveToolCalls = 0;
      } else if (isToolCallOnly) {
        consecutiveToolCalls = (prev?.consecutiveToolCalls || 0) + 1;
      }
    }

    responseStore.set(id, { ...data, storedAt: Date.now(), consecutiveToolCalls });
    log.info(
      `[proxy] stored response ${id} (provider=${data.provider || "unknown"}, store size: ${responseStore.size}${consecutiveToolCalls > 0 ? `, consecutive_tc: ${consecutiveToolCalls}` : ""})`,
    );
  }

  function resolveResponseChain(previousResponseId: string | null | undefined): unknown[] {
    const chain: StoredResponse[] = [];
    let currentId = previousResponseId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const stored = touchResponse(currentId);
      if (!stored) {
        log.warn(`[proxy] previous_response_id ${currentId} not found in store`);
        break;
      }
      chain.unshift(stored);
      currentId = stored.previousResponseId ?? undefined;
    }

    const items: unknown[] = [];
    for (const entry of chain) {
      if (Array.isArray(entry.input)) items.push(...entry.input);
      if (Array.isArray(entry.output)) items.push(...entry.output);
    }
    return items;
  }

  function getStored(id: string): StoredResponse | undefined {
    return responseStore.get(id);
  }

  function values(): IterableIterator<StoredResponse> {
    return responseStore.values();
  }

  return {
    touchResponse,
    storeResponse,
    resolveResponseChain,
    getStored,
    values,
    get size() {
      return responseStore.size;
    },
  };
}

export type ResponseStore = ReturnType<typeof createResponseStore>;
