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
// Google's fastest/cheapest 3.5-tier model with function calling.
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

/** Base class for every failure `chat()` can throw. Never carries the API key. */
export class LlmError extends Error {}
// logAuthFailure (lib/auth-errors.ts) prints only the error's name, never its message, so each
// failure mode below gets a distinct name — otherwise every cause (bad key, bad model, quota,
// overload, timeout, a malformed body) logs as the same unhelpful "Error".
export class LlmTimeout extends LlmError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeout";
  }
}
export class LlmNetwork extends LlmError {
  constructor(message: string) {
    super(`LLM request failed: ${message}`);
    this.name = "LlmNetwork";
  }
}
export class LlmHttp extends LlmError {
  constructor(status: number, body: string) {
    super(`LLM request failed with status ${status}: ${body}`);
    this.name = `LlmHttp${status}`;
  }
}
export class LlmBadJson extends LlmError {
  constructor() {
    super("LLM response was not valid JSON");
    this.name = "LlmBadJson";
  }
}
export class LlmNoMessage extends LlmError {
  constructor() {
    super("LLM response is missing choices[0].message");
    this.name = "LlmNoMessage";
  }
}

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
      // Body kept to model/messages/tools/tool_choice:"auto", which Gemini's OpenAI-compatible
      // endpoint accepts; stream/reasoning_effort/parallel_tool_calls are left out as unneeded or
      // unreliable there.
      const body: Record<string, unknown> = { model: config.model, messages };
      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      // A plain AbortController (not AbortSignal.timeout) so the timer is always cleared once the
      // whole call — including reading the body, not just receiving headers — settles, instead of
      // lingering. A stray timer from AbortSignal.timeout has no cancel API and can otherwise
      // outlive this call.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
        } catch (error) {
          // Check our own signal rather than the error's identity: fetch implementations name the
          // abort error differently (AbortError vs TimeoutError), but the signal we made is authoritative.
          if (controller.signal.aborted) throw new LlmTimeout(timeoutMs);
          throw new LlmNetwork(error instanceof Error ? error.message : String(error));
        }
        if (!response.ok) {
          let text = "";
          try {
            text = await response.text();
          } catch {
            // The status is already known; a body that won't read is only fatal when it's why we aborted.
            if (controller.signal.aborted) throw new LlmTimeout(timeoutMs);
          }
          throw new LlmHttp(response.status, text.slice(0, 200));
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          if (controller.signal.aborted) throw new LlmTimeout(timeoutMs);
          throw new LlmBadJson();
        }
        const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
        const message = isRecord(choice) ? choice.message : undefined;
        if (!isRecord(message)) throw new LlmNoMessage();
        return normalizeMessage(message);
      } finally {
        // Cleared only now: a body that stalls after headers arrive is still bounded by this timer,
        // since the same abort signal also cancels the in-flight text()/json() read above.
        clearTimeout(timer);
      }
    },
  };
}
