import { log } from "../lib/log.js";

export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export function normalizeMessages(
  messages: ChatMessage[],
  { coerceStrings = false }: { coerceStrings?: boolean } = {},
): ChatMessage[] {
  const work = [...messages];
  const fixed: ChatMessage[] = [];

  for (let i = 0; i < work.length; i++) {
    const msg = work[i];
    if (msg === null || msg === undefined) continue;
    if (msg.role === "assistant" && msg.tool_calls) {
      fixed.push(msg);
      const callIds = new Set(msg.tool_calls.map((tc) => tc.id));
      for (let j = i + 1; j < work.length; j++) {
        if (work[j]?.role === "tool" && callIds.has(work[j]!.tool_call_id!)) {
          fixed.push(work[j]!);
          work[j] = null as unknown as ChatMessage;
        }
      }
    } else if (msg.role === "tool") {
      const lastTc = [...fixed].reverse().find((m) => m.role === "assistant" && m.tool_calls);
      if (lastTc) {
        let insertIdx = fixed.indexOf(lastTc) + 1;
        while (insertIdx < fixed.length && fixed[insertIdx].role === "tool") insertIdx++;
        fixed.splice(insertIdx, 0, msg);
        work[i] = null as unknown as ChatMessage;
      }
    } else {
      fixed.push(msg);
    }
  }

  const merged: ChatMessage[] = [];
  for (const msg of fixed) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.role === msg.role &&
      msg.role === "user" &&
      typeof prev.content === "string" &&
      typeof msg.content === "string"
    ) {
      prev.content += "\n\n" + msg.content;
    } else if (
      prev &&
      prev.role === msg.role &&
      msg.role === "assistant" &&
      !prev.tool_calls &&
      !msg.tool_calls &&
      typeof prev.content === "string" &&
      typeof msg.content === "string"
    ) {
      prev.content += "\n\n" + msg.content;
    } else if (
      prev &&
      prev.role === "assistant" &&
      msg.role === "assistant" &&
      !prev.tool_calls &&
      msg.tool_calls
    ) {
      merged[merged.length - 1] = msg;
    } else if (prev && prev.role === "assistant" && msg.role === "assistant" && prev.tool_calls && !msg.tool_calls) {
      /* drop */
    } else {
      merged.push(msg);
    }
  }

  const validated: ChatMessage[] = [];
  for (const msg of merged) {
    if (msg.role === "tool") {
      const prev = validated[validated.length - 1];
      if (prev && (prev.role === "tool" || (prev.role === "assistant" && prev.tool_calls))) {
        validated.push(msg);
      }
    } else {
      validated.push(msg);
    }
  }

  if (coerceStrings) {
    for (const msg of validated) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (!tc.function) continue;
          const args = tc.function.arguments;
          if (args === undefined || args === null || args === "") {
            tc.function.arguments = "{}";
          } else if (typeof args !== "string") {
            tc.function.arguments = JSON.stringify(args);
          } else {
            try {
              JSON.parse(args);
            } catch {
              log.warn(
                `[proxy] invalid tool_call arguments for ${tc.function.name} (id: ${tc.id}), wrapping as JSON`,
              );
              tc.function.arguments = JSON.stringify({ input: args });
            }
          }
        }
      }
      if (msg.role === "tool" && typeof msg.content !== "string") {
        msg.content = JSON.stringify(msg.content);
      }
    }
  }

  return validated;
}

export function normalizeInputToArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }];
  }
  return [];
}

export function contentHasUrl(content: unknown): boolean {
  if (typeof content === "string") return /https?:\/\//.test(content);
  if (Array.isArray(content)) {
    return content.some((part) => {
      if (typeof part === "string") return /https?:\/\//.test(part);
      const p = part as Record<string, unknown>;
      if (p && typeof p.text === "string") return /https?:\/\//.test(p.text);
      if (p && typeof p.url === "string") return /https?:\/\//.test(p.url);
      if (p && typeof p.image_url === "string") return /https?:\/\//.test(p.image_url);
      const img = p?.image_url as { url?: string } | undefined;
      if (img?.url && typeof img.url === "string") return /https?:\/\//.test(img.url);
      return false;
    });
  }
  return false;
}

export function conversationHasUrls(messages: { content?: unknown }[]): boolean {
  return messages.some((message) => contentHasUrl(message?.content));
}
