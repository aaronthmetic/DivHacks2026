import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLlm, llmConfig, LlmError, LlmTimeout, LlmHttp, LlmNetwork, LlmBadJson, LlmNoMessage,
  GEMINI_BASE_URL, DEFAULT_MODEL, type ChatMessage, type ToolDefinition,
} from "../lib/llm";

const messages: ChatMessage[] = [{ role: "user", content: "Hi" }];
const tools: ToolDefinition[] = [{ type: "function", function: { name: "propose_time", description: "Propose a time", parameters: { type: "object", properties: {} } } }];

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response;
  }) as typeof fetch;
  return { fn, calls };
}

/** Asserts the promise rejects with an LlmError (any subclass) and hands the error to `check`. */
async function rejectsWithLlmError(promise: Promise<unknown>, check?: (error: LlmError) => void) {
  try {
    await promise;
    assert.fail("expected an LlmError");
  } catch (error) {
    assert.ok(error instanceof LlmError, `expected an LlmError, got ${error}`);
    check?.(error as LlmError);
  }
}

test("chat POSTs to chat/completions with the right URL, headers and a tools-free body", async () => {
  const { fn, calls } = fakeFetch(jsonResponse(200, { choices: [{ message: { role: "assistant", content: "hi" } }] }));
  const llm = createLlm({ baseUrl: "https://example.test/v1", apiKey: "secret-key", model: "test-model" }, fn);
  await llm.chat(messages, []);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer secret-key");
  assert.equal(headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body, { model: "test-model", messages });
  assert.equal("tools" in body, false);
  assert.equal("tool_choice" in body, false);
});

test("chat includes tools and tool_choice:auto only when tools are offered", async () => {
  const { fn, calls } = fakeFetch(jsonResponse(200, { choices: [{ message: { role: "assistant", content: "hi" } }] }));
  // Trailing slash on baseUrl (Gemini's default shape) must not produce a double slash.
  const llm = createLlm({ baseUrl: "https://example.test/v1/", apiKey: "k", model: "m" }, fn);
  await llm.chat(messages, tools);

  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.tools, tools);
  assert.equal(body.tool_choice, "auto");
});

test("a baseUrl without a trailing slash still resolves the right path", async () => {
  const { fn, calls } = fakeFetch(jsonResponse(200, { choices: [{ message: { content: "hi" } }] }));
  const llm = createLlm({ baseUrl: "https://example.test/v1", apiKey: "k", model: "m" }, fn);
  await llm.chat(messages, []);
  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
});

test("a plain text reply comes back as the message content", async () => {
  const { fn } = fakeFetch(jsonResponse(200, { choices: [{ message: { role: "assistant", content: "Sure thing!" } }] }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, []);
  assert.equal(result.content, "Sure thing!");
  assert.equal(result.tool_calls, undefined);
});

test("content defaults to null when the provider omits it", async () => {
  const { fn } = fakeFetch(jsonResponse(200, { choices: [{ message: { role: "assistant" } }] }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, []);
  assert.equal(result.content, null);
});

test("a tool call with string arguments passes through untouched", async () => {
  const { fn } = fakeFetch(jsonResponse(200, {
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_abc", type: "function", function: { name: "propose_time", arguments: "{\"code\":\"AB12\"}" } }] } }],
  }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, tools);
  assert.equal(result.tool_calls?.[0].id, "call_abc");
  assert.equal(result.tool_calls?.[0].function.arguments, "{\"code\":\"AB12\"}");
});

test("a tool call with object arguments is JSON-stringified", async () => {
  const { fn } = fakeFetch(jsonResponse(200, {
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "propose_time", arguments: { code: "AB12" } } }] } }],
  }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, tools);
  assert.equal(result.tool_calls?.[0].function.arguments, JSON.stringify({ code: "AB12" }));
});

test("a missing tool call id gets call_<index>", async () => {
  const { fn } = fakeFetch(jsonResponse(200, {
    choices: [{
      message: {
        role: "assistant", content: null,
        tool_calls: [
          { type: "function", function: { name: "a", arguments: "{}" } },
          { type: "function", function: { name: "b", arguments: "{}" } },
        ],
      },
    }],
  }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, tools);
  assert.equal(result.tool_calls?.[0].id, "call_0");
  assert.equal(result.tool_calls?.[1].id, "call_1");
});

test("provider-specific extra fields round-trip unchanged", async () => {
  const { fn } = fakeFetch(jsonResponse(200, {
    choices: [{
      message: {
        role: "assistant", content: "ok", thought_signature: "abc123",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" }, index: 0, extra: "x" }],
      },
    }],
  }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  const result = await llm.chat(messages, tools);
  assert.equal((result as Record<string, unknown>).thought_signature, "abc123");
  const call = result.tool_calls?.[0] as unknown as Record<string, unknown>;
  assert.equal(call.extra, "x");
  assert.equal(call.index, 0);
});

test("non-2xx responses (400/429/500) throw a distinctly-named LlmHttp<status> but never the API key", async () => {
  for (const status of [400, 429, 500]) {
    const { fn } = fakeFetch(new Response("rate limited or bad request, details from the provider", { status }));
    const llm = createLlm({ baseUrl: "https://example.test", apiKey: "super-secret-key", model: "m" }, fn);
    await rejectsWithLlmError(llm.chat(messages, []), (error) => {
      assert.ok(error instanceof LlmHttp, `expected an LlmHttp, got ${error}`);
      assert.equal(error.name, `LlmHttp${status}`);
      assert.match(error.message, new RegExp(String(status)));
      assert.ok(!error.message.includes("super-secret-key"), `message leaked the API key: ${error.message}`);
    });
  }
});

test("a non-2xx response body is capped at 200 characters", async () => {
  const longBody = "x".repeat(500);
  const { fn } = fakeFetch(new Response(longBody, { status: 500 }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  await rejectsWithLlmError(llm.chat(messages, []), (error) => {
    const included = error.message.slice(error.message.indexOf("x"));
    assert.equal(included.length, 200);
  });
});

test("aborts after timeoutMs and throws a distinctly-named LlmTimeout", async () => {
  const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("The operation timed out.", "TimeoutError"));
      // Under load the signal can already be aborted before this listener attaches; a future-only
      // "abort" listener would then wait forever, so check the already-aborted case too.
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort);
    });
  }) as typeof fetch;
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn, 20);
  await rejectsWithLlmError(llm.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmTimeout, `expected an LlmTimeout, got ${error}`);
    assert.equal(error.name, "LlmTimeout");
    assert.match(error.message, /timed out/i);
  });
});

// Known issue 2 / spec I2 / llm M1 / correctness M2: a fetch impl that resolves its headers
// promptly but then stalls forever reading the body must still be bounded by the same timeout —
// the abort timer has to stay armed until the body read settles, not just until headers arrive.
test("the timeout also covers reading the body, not just receiving headers", { timeout: 2_000 }, async () => {
  const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return {
      ok: true,
      status: 200,
      // Never resolves on its own; only rejects once the same request's signal aborts.
      json: () => new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation timed out.", "TimeoutError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort);
      }),
      text: () => new Promise(() => {}),
    } as unknown as Response;
  }) as typeof fetch;
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn, 20);
  await rejectsWithLlmError(llm.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmTimeout, `expected an LlmTimeout, got ${error}`);
    assert.equal(error.name, "LlmTimeout");
    assert.match(error.message, /timed out/i);
  });
});

test("a network failure unrelated to the timeout throws a distinctly-named LlmNetwork", async () => {
  const fn = (async () => {
    throw new Error("getaddrinfo ENOTFOUND example.test");
  }) as unknown as typeof fetch;
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  await rejectsWithLlmError(llm.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmNetwork, `expected an LlmNetwork, got ${error}`);
    assert.equal(error.name, "LlmNetwork");
    assert.match(error.message, /ENOTFOUND/);
  });
});

test("malformed JSON in the response throws a distinctly-named LlmBadJson", async () => {
  const { fn } = fakeFetch(new Response("not json{{{", { status: 200 }));
  const llm = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, fn);
  await rejectsWithLlmError(llm.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmBadJson, `expected an LlmBadJson, got ${error}`);
    assert.equal(error.name, "LlmBadJson");
  });
});

test("a response missing choices[0].message throws a distinctly-named LlmNoMessage", async () => {
  const { fn: emptyChoices } = fakeFetch(jsonResponse(200, { choices: [] }));
  const llmA = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, emptyChoices);
  await rejectsWithLlmError(llmA.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmNoMessage, `expected an LlmNoMessage, got ${error}`);
    assert.equal(error.name, "LlmNoMessage");
  });

  const { fn: noChoices } = fakeFetch(jsonResponse(200, {}));
  const llmB = createLlm({ baseUrl: "https://example.test", apiKey: "k", model: "m" }, noChoices);
  await rejectsWithLlmError(llmB.chat(messages, []), (error) => {
    assert.ok(error instanceof LlmNoMessage, `expected an LlmNoMessage, got ${error}`);
    assert.equal(error.name, "LlmNoMessage");
  });
});

test("llmConfig is null without an API key", () => {
  assert.equal(llmConfig({}), null);
  assert.equal(llmConfig({ LLM_API_KEY: "" }), null);
  assert.equal(llmConfig({ LLM_API_KEY: "   " }), null);
});

test("llmConfig trims the key and defaults to Gemini", () => {
  assert.deepEqual(llmConfig({ LLM_API_KEY: "  key123  " }), { apiKey: "key123", baseUrl: GEMINI_BASE_URL, model: DEFAULT_MODEL });
});

test("llmConfig honors overrides, trimmed", () => {
  const config = llmConfig({ LLM_API_KEY: "key123", LLM_BASE_URL: "  https://api.x.ai/v1  ", LLM_MODEL: "  grok-4.3  " });
  assert.deepEqual(config, { apiKey: "key123", baseUrl: "https://api.x.ai/v1", model: "grok-4.3" });
});

test("llmConfig falls back to Gemini defaults when overrides are blank", () => {
  const config = llmConfig({ LLM_API_KEY: "key123", LLM_BASE_URL: "   ", LLM_MODEL: "" });
  assert.deepEqual(config, { apiKey: "key123", baseUrl: GEMINI_BASE_URL, model: DEFAULT_MODEL });
});
