// A client for OpenAI-compatible Chat Completions with tools, Gemini by default. Server-only.
// STUB: types and llmConfig are final; the LLM client task implements createLlm.

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
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class LlmError extends Error {}

/** LLM_API_KEY is required; LLM_BASE_URL and LLM_MODEL default to Gemini. Null without a key. */
export function llmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, baseUrl: env.LLM_BASE_URL?.trim() || GEMINI_BASE_URL, model: env.LLM_MODEL?.trim() || DEFAULT_MODEL };
}

export function createLlm(config: LlmConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): Llm {
  void config; void fetchImpl; void timeoutMs;
  throw new Error("createLlm is not implemented yet");
}
