/**
 * Shared SSE transport+parse loop for the AI streaming services
 * (mealPlanService, mealSwapService, dayRegenerationService).
 *
 * Captures ONLY the byte-identical mechanics shared by all three:
 *   resp.body guard → reader/decoder/textBuffer loop → per-line SSE parse
 *   (strip \r, skip ":"/blank/non-"data: " lines, "[DONE]" → done,
 *    JSON.parse, parsed.error → onError, choices[0].delta.content → onDelta,
 *    catch → console.warn) → final decoder flush + final-buffer re-scan.
 *
 * Each caller keeps its OWN fetch, resp.ok guard, headers, pre/post logging,
 * Sentry tags, abort handling, and "stream ended without [DONE]" reporting.
 * Per-site differences are passed as params/callbacks — nothing site-specific
 * lives here.
 */

export interface StreamSSEResult {
  /** True once "[DONE]" was observed. Caller interprets this to decide
   *  whether the stream completed (and whether to fire its own incomplete
   *  reporting). */
  streamDone: boolean;
  /** True if onError was fired for an in-stream `parsed.error` payload (the
   *  caller should treat this as a terminal error and stop). */
  errored: boolean;
  /** The decoder/buffer residue left after the loop ended. mealPlanService
   *  surfaces a slice of this in its "stream ended without [DONE]" Sentry
   *  diagnostic; the other callers ignore it. */
  remainingBuffer: string;
}

export async function streamSSE(
  resp: Response,
  opts: {
    /** Log prefix for malformed-event console.warn: "SSE" / "SSE swap" / "SSE regen-day". */
    warnTag: string;
    onDelta: (text: string) => void;
    onError: (error: string) => void;
    /** Fired once on the first content delta — only mealPlanService uses this
     *  for TTFT timing; the others omit it. */
    onFirstToken?: () => void;
    /** mealPlanService sets streamDone=true when it sees "[DONE]" in the final
     *  flush; swap/regen-day `continue` past it WITHOUT flipping streamDone.
     *  Defaults to false to preserve swap/regen-day semantics. */
    finalFlushSetsDone?: boolean;
  },
): Promise<StreamSSEResult> {
  const { warnTag, onDelta, onError, onFirstToken, finalFlushSetsDone = false } = opts;

  if (!resp.body) {
    onError("No response stream");
    return { streamDone: false, errored: true, remainingBuffer: "" };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;
  let firstTokenSeen = false;

  // `trackFirst` mirrors the original services exactly: the MAIN loop tracks
  // first-token timing; the FINAL flush emits a bare onDelta (mealPlanService's
  // final flush never touched firstTokenMs).
  const emitContent = (content: string, trackFirst: boolean) => {
    if (trackFirst && !firstTokenSeen) {
      firstTokenSeen = true;
      onFirstToken?.();
    }
    onDelta(content);
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        streamDone = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) {
          onError(parsed.error.message || "AI service error");
          return { streamDone, errored: true, remainingBuffer: textBuffer };
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) emitContent(content, true);
      } catch {
        // Skip malformed SSE events rather than blocking the stream.
        // Pushing the line back would cause an infinite loop if the data
        // is genuinely corrupt rather than merely split across chunks.
        console.warn(`[${warnTag}] Skipping malformed event:`, jsonStr.slice(0, 120));
      }
    }
  }

  // Flush any remaining bytes from the decoder (e.g. split multi-byte chars)
  textBuffer += decoder.decode();

  // Final flush
  if (textBuffer.trim()) {
    for (let raw of textBuffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") {
        if (finalFlushSetsDone) streamDone = true;
        continue;
      }
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.error) {
          onError(parsed.error.message || "AI service error");
          return { streamDone, errored: true, remainingBuffer: textBuffer };
        }
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) emitContent(content, false);
      } catch {
        /* ignore malformed final chunk */
      }
    }
  }

  return { streamDone, errored: false, remainingBuffer: textBuffer };
}
