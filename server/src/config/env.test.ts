import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvFile } from "./env.js";

describe("parseEnvFile", () => {
  it("decodes JSON quoted env values written by quoteEnvValue", () => {
    const file = path.join(os.tmpdir(), `model-flux-env-${process.pid}-${Date.now()}.env`);
    fs.writeFileSync(file, 'MODEL_ALIASES="gpt-5.5=mimo:mimo-v2-pro\\ngpt-5.4=mimo:mimo-v2-pro"\n');
    try {
      expect(parseEnvFile(file).MODEL_ALIASES).toBe("gpt-5.5=mimo:mimo-v2-pro\ngpt-5.4=mimo:mimo-v2-pro");
    } finally {
      fs.unlinkSync(file);
    }
  });
});
