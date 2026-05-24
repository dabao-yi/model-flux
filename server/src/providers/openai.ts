import type { Context } from "hono";
import { log } from "../lib/log.js";
import { upstreamFetch } from "../lib/upstream-fetch.js";
import { clientGone, wireClientCancel } from "../lib/utils.js";
import { getAppContext } from "../app/context.js";
import { normalizeInputToArray } from "../translate/messages.js";
import {
  createSseResponse,
  pipeResponsesStreamAndCapture,
} from "../translate/streaming.js";
import { withProviderAccountFailover } from "./handlers.js";

export async function sendUpstreamError(upstreamRes: Response, c: Context): Promise<Response> {
  const errText = await upstreamRes.text();
  log.error(`[proxy] upstream error: ${upstreamRes.status} ${errText}`);
  return new Response(errText, {
    status: upstreamRes.status,
    headers: { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" },
  });
}

async function pipeRawStream(upstreamRes: Response, signal: AbortSignal): Promise<Response> {
  const teardown = wireClientCancel(signal, upstreamRes);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        if (!upstreamRes.body) return;
        for await (const chunk of upstreamRes.body) {
          if (clientGone(signal)) break;
          const bytes = chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk));
          controller.enqueue(bytes);
        }
      } finally {
        teardown();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(stream, {
    status: upstreamRes.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function forwardOpenAIResponses(
  c: Context,
  body: Record<string, unknown>,
  originalInput: unknown[],
  originalPreviousResponseId: string | null,
): Promise<Response> {
  const ctx = getAppContext();
  const eff = (body.reasoning as { effort?: string } | undefined)?.effort;
  if (eff) {
    const e = String(eff).toLowerCase().trim();
    if (e === "none") delete body.reasoning;
    else if (e === "xhigh") body.reasoning = { ...(body.reasoning as object), effort: "high" };
  }

  const upstreamResult = await withProviderAccountFailover(
    "openai",
    async (account) => {
      const response = await upstreamFetch(
        `${ctx.openaiBase}/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.key}`,
          },
          body: JSON.stringify(body),
          signal: c.req.raw.signal,
        },
        ctx.upstreamTimeout,
      );
      if (!response.ok) return { ok: false, response };
      return { ok: true, value: response };
    },
    c.req.raw.signal,
  );
  if (!upstreamResult.ok) return upstreamResult.response;
  const upstreamRes = upstreamResult.value;

  if (body.stream) {
    return createSseResponse(async (write, signal) => {
      await pipeResponsesStreamAndCapture(upstreamRes, write, signal, (completedResponse) => {
        if (completedResponse?.id && Array.isArray(completedResponse.output)) {
          ctx.responseStore.storeResponse(completedResponse.id as string, {
            provider: "openai",
            input: originalInput,
            output: completedResponse.output as unknown[],
            previousResponseId: originalPreviousResponseId,
          });
        }
      });
    }, c.req.raw.signal);
  }

  const response = (await upstreamRes.json()) as Record<string, unknown>;
  if (response?.id && Array.isArray(response.output)) {
    ctx.responseStore.storeResponse(response.id as string, {
      provider: "openai",
      input: originalInput,
      output: response.output as unknown[],
      previousResponseId: originalPreviousResponseId,
    });
  }
  return c.json(response, upstreamRes.status as 200);
}

export async function forwardOpenAIChatCompletions(
  c: Context,
  body: Record<string, unknown>,
): Promise<Response> {
  const ctx = getAppContext();
  const eff = body.reasoning_effort || (body.reasoning as { effort?: string } | undefined)?.effort;
  if (eff) {
    const e = String(eff).toLowerCase().trim();
    delete body.reasoning_effort;
    delete body.reasoning;
    if (e === "none") {
      /* drop */
    } else if (e === "xhigh") {
      body.reasoning_effort = "high";
    } else {
      body.reasoning_effort = e;
    }
  }

  const upstreamResult = await withProviderAccountFailover(
    "openai",
    async (account) => {
      const response = await upstreamFetch(
        `${ctx.openaiBase}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.key}`,
          },
          body: JSON.stringify(body),
          signal: c.req.raw.signal,
        },
        ctx.upstreamTimeout,
      );
      if (!response.ok) return { ok: false, response };
      return { ok: true, value: response };
    },
    c.req.raw.signal,
  );
  if (!upstreamResult.ok) return upstreamResult.response;
  const upstreamRes = upstreamResult.value;

  if (body.stream) {
    return pipeRawStream(upstreamRes, c.req.raw.signal);
  }

  const response = await upstreamRes.json();
  return c.json(response, upstreamRes.status as 200);
}
