import { describe, expect, it } from "vitest";
import { createResponseStore } from "../store/response-store.js";

describe("createResponseStore", () => {
  it("stores and retrieves entries", () => {
    const store = createResponseStore({ storeTtl: 60_000, storeMax: 10 });
    store.storeResponse("id-1", { provider: "mimo", input: [], output: [] });
    expect(store.getStored("id-1")?.provider).toBe("mimo");
  });

  it("evicts oldest when over capacity", () => {
    const store = createResponseStore({ storeTtl: 60_000, storeMax: 2 });
    store.storeResponse("a", { provider: "mimo", input: [], output: [] });
    store.storeResponse("b", { provider: "mimo", input: [], output: [] });
    store.storeResponse("c", { provider: "mimo", input: [], output: [] });
    expect(store.getStored("a")).toBeUndefined();
    expect(store.getStored("c")).toBeDefined();
  });
});
