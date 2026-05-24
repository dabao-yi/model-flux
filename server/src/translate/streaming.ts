import { clientGone, uid, wireClientCancel } from "../lib/utils.js";
import { translateUsage } from "./responses.js";

export function buildStreamingResponseEvents(
  responseId: string,
  model: string,
  previousResponseId: string | null | undefined,
  metadata: unknown,
) {
  const baseResponse = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "in_progress",
    model,
    output: [],
    previous_response_id: previousResponseId || null,
    metadata: metadata || {},
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };

  return {
    created: () =>
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: baseResponse })}\n\n`,
    inProgress: () =>
      `event: response.in_progress\ndata: ${JSON.stringify({ type: "response.in_progress", response: baseResponse })}\n\n`,
    outputItemAdded: (index: number, item: unknown) =>
      `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: index, item })}\n\n`,
    contentPartAdded: (outIdx: number, contentIdx: number, part: unknown) =>
      `event: response.content_part.added\ndata: ${JSON.stringify({ type: "response.content_part.added", output_index: outIdx, content_index: contentIdx, part })}\n\n`,
    textDelta: (outIdx: number, contentIdx: number, delta: string) =>
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", output_index: outIdx, content_index: contentIdx, delta })}\n\n`,
    textDone: (outIdx: number, contentIdx: number, text: string) =>
      `event: response.output_text.done\ndata: ${JSON.stringify({ type: "response.output_text.done", output_index: outIdx, content_index: contentIdx, text })}\n\n`,
    contentPartDone: (outIdx: number, contentIdx: number, part: unknown) =>
      `event: response.content_part.done\ndata: ${JSON.stringify({ type: "response.content_part.done", output_index: outIdx, content_index: contentIdx, part })}\n\n`,
    outputItemDone: (outIdx: number, item: unknown) =>
      `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: outIdx, item })}\n\n`,
    fnCallArgsDelta: (outIdx: number, callId: string, delta: string) =>
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: outIdx, call_id: callId, delta })}\n\n`,
    fnCallArgsDone: (outIdx: number, callId: string, args: string) =>
      `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done", output_index: outIdx, call_id: callId, arguments: args })}\n\n`,
    completed: (response: unknown) =>
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
  };
}

export type StreamWriter = { write: (chunk: string) => Promise<void>; end: () => void };

async function sendCompletion(
  write: (chunk: string) => Promise<void>,
  events: ReturnType<typeof buildStreamingResponseEvents>,
  responseId: string,
  model: string,
  fullText: string,
  toolCalls: Map<number, { id: string; callId: string; name: string; arguments: string; outputIdx?: number }>,
  outputIndex: number,
  textOutputIdx: number,
  finishReason: string | null,
  usage: unknown,
  previousResponseId: string | null | undefined,
  metadata: unknown,
) {
  for (const [idx, tc] of toolCalls) {
    const tcIdx = tc.outputIdx != null ? tc.outputIdx : outputIndex + idx;
    await write(events.fnCallArgsDone(tcIdx, tc.callId, tc.arguments));
    await write(
      events.outputItemDone(tcIdx, {
        type: "function_call",
        id: tc.id,
        call_id: tc.callId,
        name: tc.name,
        arguments: tc.arguments,
        status: "completed",
      }),
    );
  }

  const msgOutIdx = textOutputIdx >= 0 ? textOutputIdx : outputIndex + toolCalls.size;
  const trimmed = fullText.trim();
  if (trimmed) {
    const donePart = { type: "output_text", text: trimmed, annotations: [] };
    await write(events.textDone(msgOutIdx, 0, trimmed));
    await write(events.contentPartDone(msgOutIdx, 0, donePart));
    await write(
      events.outputItemDone(msgOutIdx, {
        type: "message",
        id: `msg_${uid()}`,
        status: "completed",
        role: "assistant",
        content: [donePart],
      }),
    );
  }

  const outputItems: { sortIdx: number; item: Record<string, unknown> }[] = [];
  for (const [idx, tc] of toolCalls) {
    const tcIdx = tc.outputIdx != null ? tc.outputIdx : outputIndex + idx;
    outputItems.push({
      sortIdx: tcIdx,
      item: {
        type: "function_call",
        id: tc.id,
        call_id: tc.callId,
        name: tc.name,
        arguments: tc.arguments,
        status: "completed",
      },
    });
  }
  if (trimmed) {
    outputItems.push({
      sortIdx: msgOutIdx,
      item: {
        type: "message",
        id: `msg_${uid()}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: trimmed, annotations: [] }],
      },
    });
  }
  outputItems.sort((a, b) => a.sortIdx - b.sortIdx);
  const finalOutput = outputItems.map((o) => o.item);

  let status = "completed";
  let incompleteDetails: { reason: string } | null = null;
  if (finishReason === "length") {
    status = "incomplete";
    incompleteDetails = { reason: "max_output_tokens" };
  }

  const finalResponse = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output: finalOutput,
    previous_response_id: previousResponseId || null,
    metadata: metadata || {},
    usage: translateUsage(usage as Record<string, unknown>),
    incomplete_details: incompleteDetails,
  };

  await write(events.completed(finalResponse));
  return finalOutput;
}

export async function handleStreamingResponse(
  upstreamRes: Response,
  write: StreamWriter,
  signal: AbortSignal | undefined,
  model: string,
  previousResponseId: string | null | undefined,
  metadata: unknown,
): Promise<{ responseId: string; output: Record<string, unknown>[]; reasoningContent: string }> {
  const teardown = wireClientCancel(signal, upstreamRes);
  const responseId = `resp_${uid()}`;
  const events = buildStreamingResponseEvents(responseId, model, previousResponseId, metadata);
  await write.write(events.created());
  await write.write(events.inProgress());

  let fullText = "";
  let reasoningContent = "";
  let inThink = false;
  let messageStarted = false;
  let completionSent = false;
  const toolCalls = new Map<
    number,
    { id: string; callId: string; name: string; arguments: string; outputIdx?: number }
  >();
  let outputIndex = 0;
  let textOutputIdx = -1;
  let buffer = "";
  let streamOutput: Record<string, unknown>[] | null = null;
  const decoder = new TextDecoder();

  try {
    if (!upstreamRes.body) throw new Error("upstream response has no body");
    for await (const chunk of upstreamRes.body) {
      if (clientGone(signal)) break;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          if (!completionSent) {
            completionSent = true;
            streamOutput = await sendCompletion(
              write.write.bind(write),
              events,
              responseId,
              model,
              fullText,
              toolCalls,
              outputIndex,
              textOutputIdx,
              null,
              null,
              previousResponseId,
              metadata,
            );
          }
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const choices = parsed.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined;
        const delta = choices?.[0]?.delta;
        const finishReason = choices?.[0]?.finish_reason;
        if (!delta && !finishReason) continue;

        const deltaToolCalls = delta?.tool_calls as
          | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
          | undefined;
        if (deltaToolCalls) {
          for (const tc of deltaToolCalls) {
            const idx = tc.index ?? 0;
            const tcOutIdx = messageStarted && textOutputIdx === 0 ? outputIndex + idx + 1 : outputIndex + idx;
            if (!toolCalls.has(idx)) {
              const callId = tc.id || `call_${uid()}`;
              const fcId = `fc_${uid()}`;
              toolCalls.set(idx, {
                id: fcId,
                callId,
                name: tc.function?.name || "",
                arguments: "",
                outputIdx: tcOutIdx,
              });
              await write.write(
                events.outputItemAdded(tcOutIdx, {
                  type: "function_call",
                  id: fcId,
                  call_id: callId,
                  name: tc.function?.name || "",
                  arguments: "",
                  status: "in_progress",
                }),
              );
            }
            if (tc.function?.arguments) {
              const tcData = toolCalls.get(idx)!;
              tcData.arguments += tc.function.arguments;
              await write.write(events.fnCallArgsDelta(tcData.outputIdx!, tcData.callId, tc.function.arguments));
            }
          }
          if (finishReason && !completionSent) {
            completionSent = true;
            streamOutput = await sendCompletion(
              write.write.bind(write),
              events,
              responseId,
              model,
              fullText,
              toolCalls,
              outputIndex,
              textOutputIdx,
              finishReason,
              parsed.usage,
              previousResponseId,
              metadata,
            );
          }
          continue;
        }

        if (typeof delta?.reasoning_content === "string") {
          reasoningContent += delta.reasoning_content;
          continue;
        }

        if (delta?.content) {
          let text = delta.content as string;
          if (text.includes("<think>")) {
            inThink = true;
            text = text.replace(/<think>/g, "");
          }
          if (text.includes("</think>")) {
            inThink = false;
            text = text.replace(/<\/think>/g, "");
          }
          if (inThink || !text) continue;

          if (!messageStarted) {
            messageStarted = true;
            textOutputIdx = outputIndex + toolCalls.size;
            await write.write(
              events.outputItemAdded(textOutputIdx, {
                type: "message",
                id: `msg_${uid()}`,
                status: "in_progress",
                role: "assistant",
                content: [],
              }),
            );
            await write.write(
              events.contentPartAdded(textOutputIdx, 0, { type: "output_text", text: "", annotations: [] }),
            );
          }

          fullText += text;
          await write.write(events.textDelta(textOutputIdx, 0, text));
        }

        if (finishReason && !completionSent) {
          completionSent = true;
          streamOutput = await sendCompletion(
            write.write.bind(write),
            events,
            responseId,
            model,
            fullText,
            toolCalls,
            outputIndex,
            textOutputIdx,
            finishReason,
            parsed.usage,
            previousResponseId,
            metadata,
          );
        }
      }
    }
  } finally {
    teardown();
  }

  if (clientGone(signal)) {
    const { log } = await import("../lib/log.js");
    log.warn(`[proxy] client disconnected mid-stream (${responseId})`);
    write.end();
    return { responseId, output: streamOutput || [], reasoningContent };
  }

  if (!completionSent) {
    completionSent = true;
    const wasGenerating = fullText.length > 0 || toolCalls.size > 0;
    const fallbackReason = wasGenerating ? "length" : "stop";
    const { log } = await import("../lib/log.js");
    log.warn(`[proxy] stream ended without finish_reason (wasGenerating=${wasGenerating}, reason=${fallbackReason})`);
    streamOutput = await sendCompletion(
      write.write.bind(write),
      events,
      responseId,
      model,
      fullText,
      toolCalls,
      outputIndex,
      textOutputIdx,
      fallbackReason,
      null,
      previousResponseId,
      metadata,
    );
  }

  write.end();
  return { responseId, output: streamOutput || [], reasoningContent };
}

export async function sendResponseAsStream(
  response: Record<string, unknown>,
  write: StreamWriter,
  signal?: AbortSignal,
): Promise<void> {
  const events = buildStreamingResponseEvents(
    response.id as string,
    response.model as string,
    response.previous_response_id as string | null,
    response.metadata,
  );
  await write.write(events.created());
  await write.write(events.inProgress());

  const output = response.output as Record<string, unknown>[];
  for (let i = 0; i < output.length; i++) {
    if (clientGone(signal)) break;
    const item = output[i];
    if (item.type === "function_call") {
      await write.write(events.outputItemAdded(i, { ...item, status: "in_progress", arguments: "" }));
      await write.write(events.fnCallArgsDelta(i, item.call_id as string, item.arguments as string));
      await write.write(events.fnCallArgsDone(i, item.call_id as string, item.arguments as string));
      await write.write(events.outputItemDone(i, item));
    } else if (item.type === "message") {
      await write.write(events.outputItemAdded(i, { ...item, status: "in_progress", content: [] }));
      const content = item.content as { type?: string; text?: string }[];
      for (let ci = 0; ci < content.length; ci++) {
        const part = content[ci];
        if (part.type === "output_text") {
          await write.write(events.contentPartAdded(i, ci, { type: "output_text", text: "", annotations: [] }));
          const text = part.text || "";
          for (let c = 0; c < text.length; c += 80) {
            if (clientGone(signal)) break;
            await write.write(events.textDelta(i, ci, text.slice(c, c + 80)));
          }
          await write.write(events.textDone(i, ci, text));
          await write.write(events.contentPartDone(i, ci, part));
        }
      }
      await write.write(events.outputItemDone(i, item));
    }
  }

  await write.write(events.completed(response));
  write.end();
}

export function createSseResponse(
  handler: (write: StreamWriter, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const writer: StreamWriter = {
        async write(chunk: string) {
          if (clientGone(signal)) return;
          controller.enqueue(encoder.encode(chunk));
        },
        end() {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        },
      };
      try {
        await handler(writer, signal);
      } catch (err) {
        try {
          controller.error(err);
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

export async function pipeResponsesStreamAndCapture(
  upstreamRes: Response,
  write: StreamWriter,
  signal: AbortSignal | undefined,
  onCompleted: (completedResponse: Record<string, unknown>) => void,
): Promise<void> {
  const teardown = wireClientCancel(signal, upstreamRes);
  let buffer = "";
  const decoder = new TextDecoder();

  const handleBlock = (block: string) => {
    const lines = block.split("\n");
    let eventType = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }

    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") return;

    try {
      const parsed = JSON.parse(data) as { type?: string; response?: Record<string, unknown> };
      if (eventType === "response.completed" || parsed.type === "response.completed") {
        onCompleted(parsed.response || (parsed as unknown as Record<string, unknown>));
      }
    } catch {
      /* ignore */
    }
  };

  try {
    if (!upstreamRes.body) return;
    for await (const chunk of upstreamRes.body) {
      if (clientGone(signal)) break;
      const text = decoder.decode(chunk, { stream: true });
      await write.write(text);
      buffer += text.replace(/\r\n/g, "\n");

      let splitIdx: number;
      while ((splitIdx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, splitIdx);
        buffer = buffer.slice(splitIdx + 2);
        handleBlock(block);
      }
    }

    if (buffer.trim()) handleBlock(buffer);
  } finally {
    teardown();
  }
  write.end();
}
