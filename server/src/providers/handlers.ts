import type { Context } from "hono";
import { getAppContext } from "../app/context.js";
import { log } from "../lib/log.js";
import { upstreamFetch } from "../lib/upstream-fetch.js";
import { clientGone, wireClientCancel } from "../lib/utils.js";
import { normalizeInputToArray, normalizeMessages, conversationHasUrls } from "../translate/messages.js";
import {
  applyEffortTranslation,
  chatCompletionToResponse,
  maybeResolvePreviousResponseChain,
  responsesRequestToChatCompletions,
} from "../translate/responses.js";
import {
  createSseResponse,
  handleStreamingResponse,
  sendResponseAsStream,
} from "../translate/streaming.js";
import { ensureWebFetchHint, ensureWebFetchTool, executeWebFetch } from "../tools/web-fetch.js";
import {
  classifyUpstreamException,
  classifyUpstreamResponse,
  type AccountFailureAttempt,
  type ProviderAccount,
} from "../scheduler/accounts.js";

type FailoverOperation<T> = (
  account: ProviderAccount,
) => Promise<{ ok: true; value: T } | { ok: false; response: Response }>;

function responseFromUpstreamError(response: Response, text: string): Response {
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") || "application/json" },
  });
}

function attemptsErrorResponse(provider: string, attempts: AccountFailureAttempt[], message = "No schedulable provider accounts available"): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "api_error",
        code: "provider_accounts_unavailable",
        provider,
        attempts,
      },
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

export async function withProviderAccountFailover<T>(
  provider: string,
  operation: FailoverOperation<T>,
  clientSignal?: AbortSignal,
): Promise<{ ok: true; value: T; account: ProviderAccount } | { ok: false; response: Response; attempts: AccountFailureAttempt[] }> {
  const ctx = getAppContext();
  const attemptedIds = new Set<string>();
  const attempts: AccountFailureAttempt[] = [];

  while (true) {
    const account = ctx.accountScheduler.select(provider, attemptedIds);
    if (!account) {
      return {
        ok: false,
        response: attemptsErrorResponse(provider, attempts),
        attempts,
      };
    }
    attemptedIds.add(account.id);

    try {
      const result = await operation(account);
      if (result.ok) {
        ctx.accountScheduler.recordSuccess(account);
        return { ok: true, value: result.value, account };
      }

      const text = await result.response.text();
      const classification = classifyUpstreamResponse(result.response.status, text, result.response.headers);
      if (classification.affectsAccount) ctx.accountScheduler.recordFailure(account, classification);
      attempts.push({
        provider,
        id: account.id,
        label: account.label,
        state: classification.state,
        code: classification.code,
        status: classification.status,
        message: classification.message,
      });
      log.warn(
        `[scheduler] ${provider}/${account.label} failed: ${classification.code}${classification.status ? ` HTTP ${classification.status}` : ""} (${classification.message})`,
      );

      if (!classification.retryable) {
        return {
          ok: false,
          response: responseFromUpstreamError(result.response, text),
          attempts,
        };
      }
    } catch (err) {
      if (clientSignal?.aborted) {
        return {
          ok: false,
          response: new Response(
            JSON.stringify({
              error: {
                message: "client aborted request",
                type: "client_error",
                code: "client_aborted",
              },
            }),
            { status: 499, headers: { "Content-Type": "application/json" } },
          ),
          attempts,
        };
      }
      const classification = classifyUpstreamException(err);
      ctx.accountScheduler.recordFailure(account, classification);
      attempts.push({
        provider,
        id: account.id,
        label: account.label,
        state: classification.state,
        code: classification.code,
        message: classification.message,
      });
      log.warn(`[scheduler] ${provider}/${account.label} exception: ${classification.message}`);
    } finally {
      ctx.accountScheduler.release(account);
    }
  }
}

export async function runWebFetchLoop(opts: {
  baseRequest: Record<string, unknown>;
  initialMessages: unknown[];
  upstreamUrl: string;
  upstreamKey: string;
  prefix?: string;
  signal?: AbortSignal;
}): Promise<{ ok: true; response: Record<string, unknown> } | { ok: false; errorRes: Response }> {
  const ctx = getAppContext();
  let loopMessages = [...opts.initialMessages];
  let finalCcResponse: Record<string, unknown> | null = null;
  let fetchLoopCount = 0;
  const fetchCache = new Map<string, string>();
  let prevFetchUrls = "";
  const tag = opts.prefix ? `${opts.prefix}: ` : "";

  for (let loop = 0; loop <= ctx.maxFetchLoops; loop++) {
    const loopReq = { ...opts.baseRequest, messages: loopMessages, stream: false };
    const upstreamRes = await upstreamFetch(
      opts.upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.upstreamKey}`,
        },
        body: JSON.stringify(loopReq),
        signal: opts.signal,
      },
      ctx.upstreamTimeout,
    );

    if (!upstreamRes.ok) {
      return { ok: false, errorRes: upstreamRes };
    }

    const ccResponse = (await upstreamRes.json()) as Record<string, unknown>;
    const choices = ccResponse.choices as { message?: Record<string, unknown>; finish_reason?: string }[] | undefined;
    const msg = choices?.[0]?.message;
    const toolCalls = (msg?.tool_calls || []) as { id?: string; function?: { name?: string; arguments?: string } }[];
    const webFetchCalls = toolCalls.filter((tc) => tc.function?.name === "web_fetch");
    const currentFetchUrls = webFetchCalls
      .map((tc) => {
        try {
          return JSON.parse(tc.function!.arguments!).url;
        } catch {
          return "";
        }
      })
      .sort()
      .join("|");
    const isStuckLoop = webFetchCalls.length > 0 && currentFetchUrls === prevFetchUrls;

    if (webFetchCalls.length === 0 || loop === ctx.maxFetchLoops || isStuckLoop) {
      if (isStuckLoop) {
        log.warn(`[proxy] ${tag}web_fetch loop stuck — model re-requested same URL(s), breaking early at loop ${loop + 1}`);
      }
      if (loop === ctx.maxFetchLoops && webFetchCalls.length > 0) {
        log.warn(`[proxy] ${tag}web_fetch MAX_FETCH_LOOPS (${ctx.maxFetchLoops}) exhausted — stripping remaining fetches`);
      }
      if (msg?.tool_calls) {
        const remaining = toolCalls.filter((tc) => tc.function?.name !== "web_fetch");
        msg.tool_calls = remaining;
        if ((msg.tool_calls as unknown[]).length === 0) {
          delete msg.tool_calls;
          if (choices![0].finish_reason === "tool_calls") {
            choices![0].finish_reason = "stop";
          }
        }
      }
      finalCcResponse = ccResponse;
      fetchLoopCount = loop;
      break;
    }

    prevFetchUrls = currentFetchUrls;
    log.info(`[proxy] ${tag}executing ${webFetchCalls.length} web_fetch call(s) (loop ${loop + 1}/${ctx.maxFetchLoops})`);
    const results = await Promise.all(
      webFetchCalls.map(async (tc) => {
        const fetchUrl = (() => {
          try {
            return JSON.parse(tc.function!.arguments!).url;
          } catch {
            return "unknown";
          }
        })();
        if (fetchCache.has(fetchUrl)) {
          log.info(`[proxy] ${tag}web_fetch ${fetchUrl} -> ${fetchCache.get(fetchUrl)!.length} chars (cached)`);
          return { role: "tool", tool_call_id: tc.id, content: fetchCache.get(fetchUrl) };
        }
        const content = await executeWebFetch(tc.function!.arguments, ctx.webFetchConfig);
        fetchCache.set(fetchUrl, content);
        log.info(`[proxy] ${tag}web_fetch ${fetchUrl} -> ${content.length} chars`);
        return { role: "tool", tool_call_id: tc.id, content };
      }),
    );

    loopMessages = [
      ...loopMessages,
      { role: "assistant", content: null, tool_calls: webFetchCalls },
      ...results,
    ];
  }

  if (fetchLoopCount > 0) {
    log.info(`[proxy] ${tag}web_fetch resolved after ${fetchLoopCount} loop(s)`);
  }
  return { ok: true, response: finalCcResponse! };
}

export async function handleOaiCompatResponses(
  c: Context,
  provider: string,
  body: Record<string, unknown>,
  originalInput: unknown[],
): Promise<Response> {
  const ctx = getAppContext();
  const cfg = ctx.oaiCompatProviders[provider];
  if (!cfg || !cfg.key) {
    return c.json(
      { error: { message: `${cfg?.envKey || provider.toUpperCase() + "_API_KEY"} is not configured` } },
      400,
    );
  }

  const originalPreviousResponseId = (body.previous_response_id as string) || null;
  maybeResolvePreviousResponseChain(body, provider, ctx.responseStore);

  if (originalPreviousResponseId) {
    const prevStored = ctx.responseStore.touchResponse(originalPreviousResponseId);
    const consecutiveTc = prevStored?.consecutiveToolCalls || 0;
    if (consecutiveTc >= ctx.maxConsecutiveToolCalls) {
      log.warn(
        `[proxy] CIRCUIT BREAKER: ${consecutiveTc} consecutive tool-call-only responses detected — injecting stop-loop nudge`,
      );
      const nudge = {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `[SYSTEM: You have made ${consecutiveTc} consecutive tool calls without responding to the user. You MUST now stop making tool calls and provide a text response summarizing your progress, findings, and any remaining work. Do NOT make any more tool calls in this response.]`,
          },
        ],
      };
      const currentInput = normalizeInputToArray(body.input);
      body.input = [...currentInput, nudge];
    } else if (consecutiveTc >= Math.floor(ctx.maxConsecutiveToolCalls * 0.75)) {
      log.warn(
        `[proxy] tool-call loop warning: ${consecutiveTc}/${ctx.maxConsecutiveToolCalls} consecutive tool-call responses`,
      );
    }
  }

  const chatReq = responsesRequestToChatCompletions(body, provider, ctx.responseStore);
  chatReq.model = ctx.resolveUpstreamModel(provider, chatReq.model as string);
  const isStream = !!chatReq.stream;

  const upstreamUrl = `${cfg.base}/chat/completions`;
  const routeLabel = `${provider}(${chatReq.model})`;

  let hardBreakerFired = false;
  if (originalPreviousResponseId) {
    const prevStored = ctx.responseStore.touchResponse(originalPreviousResponseId);
    const consecutiveTc = prevStored?.consecutiveToolCalls || 0;
    if (consecutiveTc >= ctx.maxConsecutiveToolCalls + 3) {
      log.warn("[proxy] HARD CIRCUIT BREAKER: stripping all tools to force text response");
      delete chatReq.tools;
      delete chatReq.tool_choice;
      hardBreakerFired = true;
    }
  }

  const messages = chatReq.messages as { role: string; tool_calls?: unknown; content?: unknown }[];
  const hasConversationUrls = conversationHasUrls(messages);
  if (hasConversationUrls) {
    chatReq.tools = ensureWebFetchTool(chatReq.tools as unknown[]);
    chatReq.messages = ensureWebFetchHint(messages);
  }

  log.info(
    `[proxy] ${routeLabel} | stream=${isStream} | messages=${(chatReq.messages as unknown[]).length}${hasConversationUrls ? " | web_fetch_injected" : ""} | roles=[${(chatReq.messages as { role: string; tool_calls?: unknown }[]).map((m) => m.role + (m.tool_calls ? "(tc)" : "")).join(",")}]`,
  );

  if (hasConversationUrls) {
    const result = await withProviderAccountFailover(provider, async (account) => {
      const loopResult = await runWebFetchLoop({
        baseRequest: chatReq,
        initialMessages: chatReq.messages as unknown[],
        upstreamUrl,
        upstreamKey: account.key,
        signal: c.req.raw.signal,
      });
      if (!loopResult.ok) return { ok: false, response: loopResult.errorRes };
      return { ok: true, value: loopResult.response };
    }, c.req.raw.signal);
    if (!result.ok) return result.response;
    const responsesResponse = chatCompletionToResponse(
      result.value,
      body.model as string,
      originalPreviousResponseId,
      body.metadata,
    );
    const choiceMsg = (result.value.choices as { message?: { reasoning_content?: string } }[])?.[0]?.message;
    ctx.responseStore.storeResponse(responsesResponse.id as string, {
      provider,
      input: originalInput,
      output: responsesResponse.output as unknown[],
      previousResponseId: originalPreviousResponseId,
      breakerFired: hardBreakerFired,
      reasoningContent: choiceMsg?.reasoning_content || "",
    });

    if (isStream) {
      return createSseResponse(
        (write) => sendResponseAsStream(responsesResponse as Record<string, unknown>, write, c.req.raw.signal),
        c.req.raw.signal,
      );
    }
    return c.json(responsesResponse);
  }

  const upstreamResult = await withProviderAccountFailover(
    provider,
    async (account) => {
      const response = await upstreamFetch(
        upstreamUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.key}`,
          },
          body: JSON.stringify(chatReq),
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

  if (isStream) {
    return createSseResponse(async (write, signal) => {
      const { responseId, output, reasoningContent } = await handleStreamingResponse(
        upstreamRes,
        write,
        signal,
        body.model as string,
        originalPreviousResponseId,
        body.metadata,
      );
      ctx.responseStore.storeResponse(responseId, {
        provider,
        input: originalInput,
        output: output as unknown[],
        previousResponseId: originalPreviousResponseId,
        breakerFired: hardBreakerFired,
        reasoningContent: reasoningContent || "",
      });
    }, c.req.raw.signal);
  }

  const ccResponse = (await upstreamRes.json()) as Record<string, unknown>;
  const responsesResponse = chatCompletionToResponse(
    ccResponse,
    body.model as string,
    originalPreviousResponseId,
    body.metadata,
  );
  const nonStreamReasoning =
    ((ccResponse.choices as { message?: { reasoning_content?: string } }[])?.[0]?.message?.reasoning_content) || "";
  ctx.responseStore.storeResponse(responsesResponse.id as string, {
    provider,
    input: originalInput,
    output: responsesResponse.output as unknown[],
    reasoningContent: nonStreamReasoning,
    previousResponseId: originalPreviousResponseId,
    breakerFired: hardBreakerFired,
  });
  return c.json(responsesResponse);
}

export async function handleOaiCompatChatCompletions(
  c: Context,
  provider: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const ctx = getAppContext();
  const cfg = ctx.oaiCompatProviders[provider];
  if (!cfg || !cfg.key) {
    return c.json(
      { error: { message: `${cfg?.envKey || provider.toUpperCase() + "_API_KEY"} is not configured` } },
      400,
    );
  }

  body.model = ctx.resolveUpstreamModel(provider, body.model as string);
  const isStream = !!body.stream;

  const validated = normalizeMessages((body.messages || []) as Parameters<typeof normalizeMessages>[0], {
    coerceStrings: true,
  });
  body.messages = validated;
  if (!body.max_tokens) body.max_tokens = 16384;

  const ccEffort = body.reasoning_effort || (body.reasoning as { effort?: string } | undefined)?.effort;
  if (ccEffort) {
    delete body.reasoning_effort;
    delete body.reasoning;
    applyEffortTranslation(body, ccEffort, provider);
  }

  const ccHasUrls = conversationHasUrls(validated);

  if (ccHasUrls) {
    body.tools = ensureWebFetchTool(body.tools as unknown[]);
    body.messages = ensureWebFetchHint(body.messages as { role?: string; content?: unknown }[]);
  }

  log.info(
    `[proxy] chat/completions ${provider}(${body.model}) | stream=${isStream} | messages=${(body.messages as unknown[]).length}${ccHasUrls ? " | web_fetch_injected" : ""} | roles=[${(body.messages as { role: string; tool_calls?: unknown }[]).map((m) => m.role + (m.tool_calls ? "(tc)" : "")).join(",")}]`,
  );

  if (ccHasUrls) {
    const result = await withProviderAccountFailover(provider, async (account) => {
      const loopResult = await runWebFetchLoop({
        baseRequest: body,
        initialMessages: body.messages as unknown[],
        upstreamUrl: `${cfg.base}/chat/completions`,
        upstreamKey: account.key,
        prefix: "cc",
        signal: c.req.raw.signal,
      });
      if (!loopResult.ok) return { ok: false, response: loopResult.errorRes };
      return { ok: true, value: loopResult.response };
    }, c.req.raw.signal);
    if (!result.ok) return result.response;
    const finalCcResponse = result.value;

    if (isStream) {
      return createSseResponse(async (write) => {
        const msg = (finalCcResponse.choices as { message?: Record<string, unknown> }[])?.[0]?.message;
        if (msg?.tool_calls) {
          const tcs = msg.tool_calls as { id?: string; function: { name: string; arguments: string } }[];
          for (let i = 0; i < tcs.length; i++) {
            const tc = tcs[i];
            await write.write(
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] } }] })}\n\n`,
            );
            await write.write(
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] } }] })}\n\n`,
            );
          }
        }
        if (msg?.content) {
          await write.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: msg.content } }] })}\n\n`,
          );
        }
        const fr = (finalCcResponse.choices as { finish_reason?: string }[])?.[0]?.finish_reason;
        await write.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: fr }], usage: finalCcResponse.usage })}\n\n`,
        );
        await write.write("data: [DONE]\n\n");
        write.end();
      }, c.req.raw.signal);
    }

    return c.json(finalCcResponse);
  }

  const upstreamResult = await withProviderAccountFailover(
    provider,
    async (account) => {
      const response = await upstreamFetch(
        `${cfg.base}/chat/completions`,
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

  if (isStream) {
    const teardown = wireClientCancel(c.req.raw.signal, upstreamRes);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!upstreamRes.body) return;
          for await (const chunk of upstreamRes.body) {
            if (clientGone(c.req.raw.signal)) break;
            controller.enqueue(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk)));
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
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const data = await upstreamRes.json();
  return c.json(data);
}
