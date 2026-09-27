// A client for OpenAI-compatible Chat Completions with tools, Gemini by default. Server-only.

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
/** The model's message exactly as the API returned it, extra provider fields included, so it can be sent back unchanged. */
export type AssistantMessage = { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } & Record<string, unknown>;
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type LlmConfig = { baseUrl: string; apiKey: string; model: string };
/** One model call with the conversation so far and the tools it may use. Throws LlmError on HTTP errors, timeouts or malformed responses. */
export type Llm = { chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<AssistantMessage> };

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
// Google's fastest/cheapest 3.5-tier model with function calling — matches llm.md §1's recommendation.
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class LlmError extends Error {}

/** LLM_API_KEY is required; LLM_BASE_URL and LLM_MODEL default to Gemini. Null without a key. */
export function llmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: env.LLM_BASE_URL?.trim() || GEMINI_BASE_URL, model: env.LLM_MODEL?.trim() || DEFAULT_MODEL };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function normalizeToolCall(call: unknown, index: number): ToolCall {
  const source: Record<string, unknown> = isRecord(call) ? call : {};
  const fn: Record<string, unknown> = isRecord(source.function) ? source.function : {};
  const args = fn.arguments;
  return {
    ...source,
    id: typeof source.id === "string" ? source.id : `call_${index}`,
    function: { ...fn, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
  } as ToolCall;
}

/** choices[0].message, spread as received, with content defaulted to null and tool call ids/arguments normalized. */
function normalizeMessage(message: Record<string, unknown>): AssistantMessage {
  const toolCalls = message.tool_calls;
  return {
    ...message,
    role: "assistant",
    content: (message.content as string | null | undefined) ?? null,
    ...(Array.isArray(toolCalls) ? { tool_calls: toolCalls.map((call, index) => normalizeToolCall(call, index)) } : {}),
  } as AssistantMessage;
}

export function createLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): Llm {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async chat(messages, tools) {
      // Body kept to what llm.md §1/§5 confirm Gemini's compat layer honors — model/messages/tools/tool_choice:"auto" — skipping stream/reasoning_effort/parallel_tool_calls as unneeded or unreliable there.
      const body: Record<string, unknown> = { model: config.model, messages };
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      // A plain AbortController (not AbortSignal.timeout) so the timer is always cleared once the
      // request settles, instead of lingering — a stray timer from AbortSignal.timeout has no
      // cancel API and can otherwise outlive this call.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
      } catch (error) {
        // Check our own signal rather than the error's identity: fetch implementations name the
        // abort error differently (AbortError vs TimeoutError), but the signal we made is authoritative.
        if (controller.signal.aborted) throw new LlmError(`LLM request timed out after ${timeoutMs}ms`);
        throw new LlmError(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new LlmError(`LLM request failed with status ${response.status}: ${text.slice(0, 200)}`);
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new LlmError("LLM response was not valid JSON");
      }
      const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
      const message = isRecord(choice) ? choice.message : undefined;
      if (!isRecord(message)) throw new LlmError("LLM response is missing choices[0].message");
      return normalizeMessage(message);
    },
  };
}
