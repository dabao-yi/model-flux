import { log } from "../lib/log.js";
import { uid } from "../lib/utils.js";
import { normalizeInputToArray, normalizeMessages, type ChatMessage } from "./messages.js";
import type { ResponseStore } from "../store/response-store.js";

export function applyEffortTranslation(
  req: Record<string, unknown>,
  effort: unknown,
  provider: string,
): void {
  if (!effort) return;
  const e = String(effort).toLowerCase().trim();
  if (e === "none") {
    req.thinking = { type: "disabled" };
    return;
  }
  if (e === "minimal") {
    req.reasoning_effort = "low";
    return;
  }
  if (provider === "mimo" && (e === "max" || e === "xhigh")) {
    req.reasoning_effort = "high";
    return;
  }
  req.reasoning_effort = e;
}

export function translateUsage(u: Record<string, unknown> | undefined | null) {
  if (!u) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const details = u as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  return {
    input_tokens: details.prompt_tokens || 0,
    output_tokens: details.completion_tokens || 0,
    total_tokens: details.total_tokens || 0,
    input_tokens_details: { cached_tokens: details.prompt_tokens_details?.cached_tokens || 0 },
    output_tokens_details: { reasoning_tokens: details.completion_tokens_details?.reasoning_tokens || 0 },
  };
}

export function responsesRequestToChatCompletions(
  body: Record<string, unknown>,
  provider: string,
  responseStore: ResponseStore,
  originalPreviousResponseId?: string | null,
): Record<string, unknown> {
  const messages: ChatMessage[] = [];

  if (body.instructions) {
    messages.push({
      role: "user",
      content:
        "[System Instructions] " +
        body.instructions +
        "\n\nNote: Be efficient with tool calls. Avoid repeating the same tool call unnecessarily.",
    });
  }

  const reasoningByCallId = new Map<string, string>();
  if (provider === "deepseek" || provider === "compat") {
    for (const entry of responseStore.values()) {
      if (!entry.reasoningContent) continue;
      for (const out of (entry.output || []) as { type?: string; call_id?: string }[]) {
        if (out.type === "function_call" && out.call_id) {
          reasoningByCallId.set(out.call_id, entry.reasoningContent);
        }
      }
    }
  }

  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    let pendingToolCalls: { id?: string; type: string; function: { name?: string; arguments?: unknown } }[] = [];
    const flushPendingToolCalls = () => {
      if (pendingToolCalls.length === 0) return;
      const msg: ChatMessage = { role: "assistant", content: null, tool_calls: pendingToolCalls };
      for (const tc of pendingToolCalls) {
        const r = reasoningByCallId.get(tc.id!);
        if (r) {
          msg.reasoning_content = r;
          break;
        }
      }
      messages.push(msg);
      pendingToolCalls = [];
    };

    for (const item of body.input as Record<string, unknown>[]) {
      const itemType = (item.type as string) || (item.role ? "message" : undefined);
      if (itemType === "message") {
        const role = item.role === "developer" || item.role === "system" ? "user" : (item.role as string);
        let content: unknown;

        if (typeof item.content === "string") {
          content = item.content;
        } else if (Array.isArray(item.content)) {
          content = (item.content as Record<string, unknown>[]).map((block) => {
            if (block.type === "input_text") return { type: "text", text: block.text };
            if (block.type === "output_text") return { type: "text", text: block.text };
            if (block.type === "input_image") {
              return { type: "image_url", image_url: { url: block.image_url || block.url } };
            }
            return block;
          });
          const arr = content as { type?: string; text?: string }[];
          if (arr.length === 1 && arr[0].type === "text") {
            content = arr[0].text;
          }
        }

        if (pendingToolCalls.length > 0 && role === "assistant") {
          flushPendingToolCalls();
        } else {
          flushPendingToolCalls();
          messages.push({ role, content });
        }
      } else if (itemType === "function_call") {
        pendingToolCalls.push({
          id: (item.call_id || item.id) as string,
          type: "function",
          function: { name: item.name as string, arguments: item.arguments },
        });
      } else if (itemType === "function_call_output") {
        flushPendingToolCalls();
        messages.push({ role: "tool", tool_call_id: item.call_id as string, content: item.output });
      }
    }

    flushPendingToolCalls();
  }

  const merged = normalizeMessages(messages);

  const TOOL_OUTPUT_MAX = 2000;
  const KEEP_RECENT_FULL = 10;
  for (let i = 0; i < Math.max(0, merged.length - KEEP_RECENT_FULL); i++) {
    const msg = merged[i];
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > TOOL_OUTPUT_MAX) {
      msg.content =
        msg.content.slice(0, TOOL_OUTPUT_MAX) +
        "\n...[output truncated, " +
        (msg.content.length - TOOL_OUTPUT_MAX) +
        " chars removed]";
    }
  }

  const MAX_MESSAGES = 55;
  let finalMessages = merged;
  if (merged.length > MAX_MESSAGES) {
    const head = merged.slice(0, 2);
    let tail = merged.slice(-(MAX_MESSAGES - 3));
    while (tail.length > 0 && tail[0].role === "tool") tail.shift();
    finalMessages = [
      ...head,
      {
        role: "user",
        content:
          "[Earlier conversation trimmed. Do not repeat previous statements or tool calls you already made. Continue with the current task. If you have enough information, respond to the user instead of making more tool calls.]",
      },
      ...tail,
    ];
    log.info(`[proxy] trimmed ${merged.length} -> ${finalMessages.length} messages`);
  }

  if (merged.length > MAX_MESSAGES) {
    finalMessages = normalizeMessages(finalMessages);
  }

  const req: Record<string, unknown> = {
    model: body.model,
    messages: finalMessages,
    stream: body.stream || false,
  };

  if (body.temperature != null) req.temperature = body.temperature;
  if (body.top_p != null) req.top_p = body.top_p;
  req.max_tokens = body.max_output_tokens || 16384;

  const tools = body.tools as unknown[] | undefined;
  if (tools?.length) {
    const supported = tools.filter((t) => (t as { type?: string }).type === "function");
    if (supported.length > 0) {
      req.tools = supported.map((t) => {
        const tool = t as { function?: unknown; name?: string; description?: string; parameters?: unknown };
        if (!tool.function) {
          return {
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          };
        }
        return t;
      });
    }
  }

  if (body.tool_choice != null) {
    const tc = body.tool_choice as { name?: string };
    if (typeof body.tool_choice === "object" && tc.name) {
      req.tool_choice = { type: "function", function: { name: tc.name } };
    } else {
      req.tool_choice = body.tool_choice;
    }
  }

  const reasoning = body.reasoning as { effort?: string } | undefined;
  applyEffortTranslation(req, reasoning?.effort, provider);
  if (body.parallel_tool_calls != null) req.parallel_tool_calls = body.parallel_tool_calls;

  if ((provider === "deepseek" || provider === "compat") && (req.thinking as { type?: string })?.type !== "disabled") {
    let chainHadReasoning = false;
    if (originalPreviousResponseId) {
      let cid: string | null | undefined = originalPreviousResponseId;
      const seen = new Set<string>();
      while (cid && !seen.has(cid)) {
        seen.add(cid);
        const s = responseStore.getStored(cid);
        if (s?.reasoningContent) { chainHadReasoning = true; break; }
        cid = s?.previousResponseId ?? undefined;
      }
    }
    const hasAssistantMissingReasoning = (finalMessages as ChatMessage[]).some(
      (m) =>
        m.role === "assistant" &&
        !m.reasoning_content &&
        (Array.isArray(m.tool_calls) && m.tool_calls.length > 0 || chainHadReasoning),
    );
    if (hasAssistantMissingReasoning) {
      req.thinking = { type: "disabled" };
      delete req.reasoning_effort;
      log.info("[proxy] deepseek: assistant message without reasoning_content -> forcing thinking:disabled");
    }
  }

  return req;
}

export function chatCompletionToResponse(
  cc: Record<string, unknown>,
  model: string,
  previousResponseId: string | null | undefined,
  metadata: unknown,
) {
  const responseId = `resp_${uid()}`;
  const output: Record<string, unknown>[] = [];
  const choices = cc.choices as { message?: Record<string, unknown>; finish_reason?: string }[] | undefined;
  const choice = choices?.[0];

  if (!choice) {
    return {
      id: responseId,
      object: "response",
      created_at: (cc.created as number) || Math.floor(Date.now() / 1000),
      status: "completed",
      model: model || cc.model,
      output: [],
      usage: translateUsage(cc.usage as Record<string, unknown>),
    };
  }

  const msg = choice.message!;

  const toolCalls = msg.tool_calls as { id?: string; function: { name: string; arguments: string } }[] | undefined;
  if (toolCalls?.length) {
    for (const tc of toolCalls) {
      output.push({
        type: "function_call",
        id: `fc_${uid()}`,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed",
      });
    }
  }

  let text = (msg.content as string) || "";
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
  if (text) {
    output.push({
      type: "message",
      id: `msg_${uid()}`,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }

  if (msg.refusal) {
    let msgItem = output.find((o) => o.type === "message") as Record<string, unknown> | undefined;
    if (!msgItem) {
      msgItem = {
        type: "message",
        id: `msg_${uid()}`,
        status: "completed",
        role: "assistant",
        content: [],
      };
      output.push(msgItem);
    }
    (msgItem.content as unknown[]).push({ type: "refusal", refusal: msg.refusal });
  }

  let status = "completed";
  let incompleteDetails: { reason: string } | null = null;
  if (choice.finish_reason === "length") {
    status = "incomplete";
    incompleteDetails = { reason: "max_output_tokens" };
  } else if (choice.finish_reason === "content_filter") {
    status = "incomplete";
    incompleteDetails = { reason: "content_filter" };
  }

  return {
    id: responseId,
    object: "response",
    created_at: (cc.created as number) || Math.floor(Date.now() / 1000),
    status,
    model: model || cc.model,
    output,
    previous_response_id: previousResponseId || null,
    metadata: metadata || {},
    usage: translateUsage(cc.usage as Record<string, unknown>),
    incomplete_details: incompleteDetails,
  };
}

export function maybeResolvePreviousResponseChain(
  body: Record<string, unknown>,
  targetProvider: string,
  responseStore: ResponseStore,
): void {
  if (!body.previous_response_id) return;

  const previous = responseStore.getStored(body.previous_response_id as string);
  if (!previous) {
    if (targetProvider === "deepseek") {
      log.warn(
        `[proxy] previous_response_id ${body.previous_response_id} missing; DeepSeek request will continue without restored history`,
      );
    }
    return;
  }

  const needsLocalResolution = targetProvider === "deepseek" || previous.provider !== targetProvider;
  if (!needsLocalResolution) return;

  const chainItems = responseStore.resolveResponseChain(body.previous_response_id as string);
  if (chainItems.length === 0) return;

  const currentInput = normalizeInputToArray(body.input);
  body.input = [...chainItems, ...currentInput];
  delete body.previous_response_id;
  log.info(
    `[proxy] locally resolved previous_response_id across provider boundary -> ${targetProvider} (${chainItems.length} items prepended)`,
  );
}
