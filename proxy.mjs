#!/usr/bin/env node
/**
 * Compatibility launcher — prefers compiled server/dist for Docker/Linux.
 * Local dev can still use tsx when dist is missing.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(root, "server/dist/index.js");
const tsEntry = path.join(root, "server/src/index.ts");

const useDist = existsSync(distEntry);
const args = useDist
  ? ["--env-file=.env", distEntry]
  : ["--env-file=.env", "--import", "tsx", tsEntry];

const child = spawn("node", args, {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
