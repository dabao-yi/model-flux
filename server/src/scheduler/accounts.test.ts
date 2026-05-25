import { describe, expect, it } from "vitest";
import {
  classifyUpstreamException,
  classifyUpstreamResponse,
  createAccountScheduler,
  type AccountFailureClassification,
} from "./accounts.js";
import type { KeyPoolRow } from "../lib/utils.js";

function row(id: string, label = id, enabled = true): KeyPoolRow {
  return { id, label, enabled, key: `sk-${id}`, source: "pool", base_url: `https://${id}.example/v1` };
}

function failure(partial: Partial<AccountFailureClassification> = {}): AccountFailureClassification {
  return {
    code: "temporary_error",
    state: "temporary_error",
    message: "boom",
    retryable: true,
    affectsAccount: true,
    cooldownMs: 50,
    ...partial,
  };
}

describe("AccountScheduler", () => {
  it("selects only healthy enabled accounts", () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [row("a"), row("b")]);
    s.recordFailure("mimo", "a", failure({ state: "insufficient_balance", code: "insufficient_balance", cooldownMs: 60_000 }));
    const selected = s.select("mimo");
    expect(selected?.id).toBe("b");
    s.release(selected);
  });

  it("uses least-load then least-recently-used ordering", () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [row("a"), row("b")]);
    const first = s.select("mimo");
    const second = s.select("mimo");
    expect(first?.id).toBe("a");
    expect(second?.id).toBe("b");
    s.release(first);
    const third = s.select("mimo", new Set([second!.id]));
    expect(third?.id).toBe("a");
    s.release(second);
    s.release(third);
  });

  it("prefers higher priority accounts when load is equal", () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [
      { ...row("a"), priority: 0 },
      { ...row("b"), priority: 8 },
    ]);
    const selected = s.select("mimo");
    expect(selected?.id).toBe("b");
    s.release(selected);
  });

  it("moves cooled down accounts into probing", async () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [row("a")]);
    const selected = s.select("mimo")!;
    s.recordFailure(selected, failure({ cooldownMs: 5 }));
    s.release(selected);
    expect(s.select("mimo")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const due = s.dueProbeAccounts();
    expect(due[0]?.id).toBe("a");
    expect(s.snapshot("mimo").mimo[0].state).toBe("probing");
  });

  it("never auto probes manually disabled accounts", async () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [row("a")]);
    s.setEnabled("mimo", "a", false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(s.dueProbeAccounts()).toHaveLength(0);
    expect(s.select("mimo")).toBeNull();
  });

  it("keeps per-account Base URL in runtime snapshots", () => {
    const s = createAccountScheduler();
    s.syncProvider("mimo", [row("a")]);
    const selected = s.select("mimo");
    expect(selected?.base_url).toBe("https://a.example/v1");
    s.release(selected);
    expect(s.snapshot("mimo").mimo[0].base_url).toBe("https://a.example/v1");
  });

});

describe("upstream error classification", () => {
  it("classifies account-level HTTP errors", () => {
    expect(classifyUpstreamResponse(401, "bad key").code).toBe("auth_error");
    expect(classifyUpstreamResponse(402, "balance").code).toBe("insufficient_balance");
    expect(classifyUpstreamResponse(429, "slow down").code).toBe("rate_limited");
    expect(classifyUpstreamResponse(502, "bad gateway").code).toBe("temporary_error");
  });

  it("does not mark bad request as account health failure", () => {
    const c = classifyUpstreamResponse(400, "bad request");
    expect(c.retryable).toBe(false);
    expect(c.affectsAccount).toBe(false);
  });

  it("classifies timeout/network exceptions as temporary", () => {
    const c = classifyUpstreamException(new Error("fetch failed: socket hang up"));
    expect(c.code).toBe("temporary_error");
    expect(c.retryable).toBe(true);
  });
});
