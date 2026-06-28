/**
 * B1 (FIX3): Serializes a resolved effect result into non-empty tool content.
 *
 * Web effects return structured shapes like `{ results }`, `{ content }`, and
 * `{ bundle }` — not `{ text }`. Without this serializer, `readText()` returns
 * "" for all of them and the next LLM call sees an empty tool message.
 *
 * Usage: call `toolContentFromEffectResult(result)` after a web/plan/script/
 * extension effect resolves successfully (ok:true). If it returns ok:false, do
 * NOT store a tool message — emit an audit event instead.
 */

export type ToolContentSerializationResult =
  | { ok: true; content: string }
  | {
      ok: false;
      kind: 'empty_effect_result' | 'unsupported_effect_result';
      message: string;
    };

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Convert a resolved effect result to a non-empty string suitable for a tool
 * message. Returns `{ ok: false }` when the result is empty or unrecognized —
 * callers must NOT store empty content in that case.
 */
export function toolContentFromEffectResult(
  result: unknown,
): ToolContentSerializationResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      ok: false,
      kind: 'unsupported_effect_result',
      message: 'Effect result must be an object.',
    };
  }

  const r = result as Record<string, unknown>;

  // Plain text field — used by tool calls and some plan outputs.
  if (typeof r.text === 'string') {
    const text = nonEmpty(r.text);
    if (text) return { ok: true, content: text };
  }

  // Web search results: { results: [...] }
  if (Array.isArray(r.results)) {
    return {
      ok: true,
      content: compactJson({ type: 'web_search_results', results: r.results }),
    };
  }

  // Single page content: { content: { text, title, ... } }
  if (
    r.content !== null &&
    typeof r.content === 'object' &&
    !Array.isArray(r.content)
  ) {
    return {
      ok: true,
      content: compactJson({ type: 'web_page_content', content: r.content }),
    };
  }

  // Multiple page contents: { contents: [...] }
  if (Array.isArray(r.contents)) {
    return {
      ok: true,
      content: compactJson({
        type: 'web_pages_content',
        contents: r.contents,
      }),
    };
  }

  // Research bundle: { bundle: { pages, failures, ... } }
  if (
    r.bundle !== null &&
    typeof r.bundle === 'object' &&
    !Array.isArray(r.bundle)
  ) {
    return {
      ok: true,
      content: compactJson({
        type: 'web_research_bundle',
        bundle: r.bundle,
      }),
    };
  }

  // Extension response: { response: { ... } }
  if (
    r.response !== null &&
    typeof r.response === 'object' &&
    !Array.isArray(r.response)
  ) {
    return {
      ok: true,
      content: compactJson({
        type: 'extension_response',
        response: r.response,
      }),
    };
  }

  // Plan outputs: { outputs: [...] }
  if (Array.isArray(r.outputs)) {
    return {
      ok: true,
      content: compactJson({ type: 'plan_outputs', outputs: r.outputs }),
    };
  }

  // Script result value: { value: ... }
  if ('value' in r) {
    return {
      ok: true,
      content: compactJson({ type: 'script_result', value: r.value }),
    };
  }

  return {
    ok: false,
    kind: 'empty_effect_result',
    message:
      'Effect resolved successfully but did not contain usable tool content.',
  };
}
