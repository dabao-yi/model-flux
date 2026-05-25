import { describe, expect, it } from "vitest";
import { parseKeyPool, parseKeyPoolAll } from "../lib/utils.js";
import { parseModelAliases, pickProxyKeyForProvider, resolveProviderForModel } from "../routing/models.js";

describe("parseKeyPoolAll", () => {
  it("parses primary and pool entries", () => {
    const rows = parseKeyPoolAll("sk-primary", "sk-pool|label1|enabled");
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe("sk-primary");
    expect(rows[1].label).toBe("label1");
  });

  it("deduplicates keys", () => {
    const rows = parseKeyPoolAll("sk-a", "sk-a|dup");
    expect(rows).toHaveLength(1);
  });

  it("parses per-key Base URL from pool entries", () => {
    const rows = parseKeyPoolAll(
      "sk-primary",
      "sk-backup|backup|enabled|https://backup.example/v1,sk-off|off|disabled|https://off.example/v1",
      "https://default.example/v1",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].base_url).toBe("https://default.example/v1");
    expect(rows[1].base_url).toBe("https://backup.example/v1");
    expect(rows[2].enabled).toBe(false);
    expect(rows[2].base_url).toBe("https://off.example/v1");
  });

});

describe("parseKeyPool", () => {
  it("filters disabled keys", () => {
    const rows = parseKeyPool("sk-on", "sk-off|x|disabled");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("sk-on");
  });
});

describe("parseModelAliases", () => {
  const enabled = new Set(["deepseek", "mimo"]);
  const providerModels = {
    deepseek: ["deepseek-v4-pro"],
    mimo: ["mimo-v2-pro"],
    openai: [],
    compat: [],
  };

  it("parses explicit provider mapping", () => {
    const aliases = parseModelAliases("gpt-5.5=mimo:mimo-v2-pro", enabled, providerModels, [], "");
    expect(aliases).toHaveLength(1);
    expect(aliases[0].provider).toBe("mimo");
    expect(aliases[0].upstream_model).toBe("mimo-v2-pro");
  });

  it("skips duplicate from names", () => {
    const aliases = parseModelAliases("a=mimo:x\na=deepseek:y", enabled, providerModels, [], "");
    expect(aliases).toHaveLength(1);
  });

  it("parses env values that store newlines as literal backslash-n", () => {
    const aliases = parseModelAliases(
      "gpt-5.5=mimo:mimo-v2-pro\\ngpt-5.4=mimo:mimo-v2-pro",
      enabled,
      providerModels,
      [],
      "",
    );
    expect(aliases).toHaveLength(2);
    expect(aliases[0].upstream_model).toBe("mimo-v2-pro");
    expect(aliases[1].from).toBe("gpt-5.4");
  });

  it("repairs repeatedly escaped newline separators from older admin saves", () => {
    const aliases = parseModelAliases(
      "gpt-5.5=mimo:mimo-v2-pro\\\\\\\\ngpt-5.4=mimo:mimo-v2-pro",
      enabled,
      providerModels,
      [],
      "",
    );
    expect(aliases).toHaveLength(2);
    expect(aliases[0].upstream_model).toBe("mimo-v2-pro");
    expect(aliases[1].from).toBe("gpt-5.4");
  });
});

describe("resolveProviderForModel", () => {
  const explicit = new Map([["deepseek-v4-pro", "deepseek"]]);
  const enabled = new Set(["deepseek", "mimo"]);

  it("uses explicit model map", () => {
    expect(
      resolveProviderForModel("deepseek-v4-pro", explicit, enabled, ["gpt-"], () => "deepseek"),
    ).toBe("deepseek");
  });

  it("uses name hints", () => {
    expect(
      resolveProviderForModel("custom-mimo-model", explicit, enabled, ["gpt-"], () => "deepseek"),
    ).toBe("mimo");
  });

  it("falls back to default provider", () => {
    expect(
      resolveProviderForModel("unknown-model", explicit, enabled, ["gpt-"], () => "deepseek"),
    ).toBe("deepseek");
  });
});

describe("pickProxyKeyForProvider", () => {
  it("uses a global proxy key for internal admin tests", () => {
    const table = new Map([["sk-modelflux", "*"]]);
    expect(pickProxyKeyForProvider("mimo", true, "sk-modelflux", table)).toEqual({
      key: "sk-modelflux",
      lock: "*",
      auth_enabled: true,
    });
  });

  it("selects a provider-locked key when the primary key is for another provider", () => {
    const table = new Map([
      ["sk-deepseek", "deepseek"],
      ["sk-mimo", "mimo"],
    ]);
    expect(pickProxyKeyForProvider("mimo", true, "sk-deepseek", table)).toEqual({
      key: "sk-mimo",
      lock: "mimo",
      auth_enabled: true,
    });
  });
});
