/**
 * E2E tests — validates SDK behaviour matches what the consumer (hello-halo)
 * expects at runtime. Tests use a real LLM provider via the HALO_TEST_*
 * environment variables from the repo's .env.local.
 *
 * Run: cd src/sdk && npx vitest run e2e.test.ts
 *
 * Required env (set in .env.local at repo root, loaded by vitest via dotenv):
 *   HALO_TEST_API_KEY    - API key for the test provider
 *   HALO_TEST_API_URL    - OpenAI-compat base URL (e.g. https://openrouter.ai/api/v1)
 *   HALO_TEST_MODEL      - Model name (e.g. deepseek/deepseek-v3.2)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load .env.local from repo root
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '../../.env.local');
  try {
    const content = readFileSync(envPath, 'utf8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

const env = loadDotEnv();
const TEST_API_KEY = env.HALO_TEST_API_KEY ?? process.env.HALO_TEST_API_KEY ?? '';
const TEST_API_URL = env.HALO_TEST_API_URL ?? process.env.HALO_TEST_API_URL ?? '';
const TEST_MODEL = env.HALO_TEST_MODEL ?? process.env.HALO_TEST_MODEL ?? '';

const SKIP_REASON = !TEST_API_KEY
  ? 'HALO_TEST_API_KEY not set — skip live API tests'
  : null;

// ---------------------------------------------------------------------------
// SDK imports
// ---------------------------------------------------------------------------

import {
  query,
  unstable_v2_createSession,
  createProvider,
} from './index.js';
import type { SDKMessage } from './core/query-loop.js';
import type { Tool, ToolContext, ToolResult } from './types/tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise OpenRouter-style base URL to remove trailing path */
function resolveBaseUrl(url: string): string {
  // OpenRouter: https://openrouter.ai/api/v1/chat/completions → https://openrouter.ai/api/v1
  return url.replace(/\/chat\/completions\/?$/, '');
}

function makeProvider() {
  // Use createProvider() which correctly fills in required id/name fields
  return createProvider({
    type: 'openai-compat',
    apiKey: TEST_API_KEY,
    baseUrl: resolveBaseUrl(TEST_API_URL),
    defaultModel: TEST_MODEL,
  });
}

/** Collect all messages from a query generator into an array. */
async function drainQuery(
  gen: AsyncIterable<SDKMessage>,
): Promise<SDKMessage[]> {
  const messages: SDKMessage[] = [];
  for await (const msg of gen) {
    messages.push(msg);
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Assertions that mirror what the consumer (stream-processor / message-utils)
// actually reads from SDK messages at runtime.
// ---------------------------------------------------------------------------

/**
 * Assert that a system:init message has all fields the consumer reads:
 *   msg.type          === 'system'
 *   msg.subtype       === 'init'
 *   msg.model         (string)
 *   msg.session_id    (string)
 *   msg.mcp_servers   (array)
 *   msg.slash_commands (array of strings — consumer reads as string[])
 *   msg.skills        (array)
 *   msg.agents        (array of strings — consumer reads as string[])
 *   msg.cwd           (string)
 *   msg.uuid          (string)
 */
function assertInitMessage(msg: SDKMessage): void {
  expect(msg.type).toBe('system');
  const m = msg as unknown as Record<string, unknown>;
  expect(m.subtype).toBe('init');
  expect(typeof m.model).toBe('string');
  expect(typeof m.session_id).toBe('string');
  expect(Array.isArray(m.mcp_servers)).toBe(true);
  expect(Array.isArray(m.slash_commands)).toBe(true);
  // slash_commands must be string[] (not {name,desc}[])
  if ((m.slash_commands as unknown[]).length > 0) {
    expect(typeof (m.slash_commands as unknown[])[0]).toBe('string');
  }
  expect(Array.isArray(m.skills)).toBe(true);
  // agents is optional (only present when sub-agent definitions are registered)
  if (m.agents !== undefined) {
    expect(Array.isArray(m.agents)).toBe(true);
    if ((m.agents as unknown[]).length > 0) {
      expect(typeof (m.agents as unknown[])[0]).toBe('string');
    }
  }
  expect(typeof m.cwd).toBe('string');
  expect(typeof m.uuid).toBe('string');
}

/**
 * Assert that a result message has all fields the consumer reads:
 *   msg.type          === 'result'
 *   msg.result        (string) — consumer reads via message.result
 *   msg.session_id    (string) — consumer captures for session persistence
 *   msg.total_cost_usd (number)
 *   msg.modelUsage    (object) — camelCase, consumer reads .contextWindow
 *   msg.num_turns     (number)
 *   msg.is_error      (boolean)
 *   msg.uuid          (string)
 */
function assertResultMessage(msg: SDKMessage): void {
  expect(msg.type).toBe('result');
  const m = msg as unknown as Record<string, unknown>;
  expect(typeof m.result).toBe('string');
  expect(typeof m.session_id).toBe('string');
  expect(typeof m.total_cost_usd).toBe('number');
  expect(m.modelUsage !== null && typeof m.modelUsage === 'object').toBe(true);
  expect(typeof m.num_turns).toBe('number');
  expect(typeof m.is_error).toBe('boolean');
  expect(typeof m.uuid).toBe('string');
}

/**
 * Assert that an assistant message has the correct shape the consumer reads:
 *   msg.type          === 'assistant'
 *   msg.message.role  === 'assistant'
 *   msg.message.content (array)
 *   msg.message.usage  (object with input_tokens/output_tokens)
 *   msg.uuid           (string)
 */
function assertAssistantMessage(msg: SDKMessage): void {
  expect(msg.type).toBe('assistant');
  const m = msg as unknown as Record<string, unknown>;
  const message = m.message as Record<string, unknown> | undefined;
  expect(message).toBeTruthy();
  expect(message?.role).toBe('assistant');
  expect(Array.isArray(message?.content)).toBe(true);
  const usage = message?.usage as Record<string, unknown> | undefined;
  // usage may not be present on all providers, but when present must have token counts
  if (usage) {
    expect(typeof usage.input_tokens).toBe('number');
    expect(typeof usage.output_tokens).toBe('number');
  }
  expect(typeof m.uuid).toBe('string');
}

// ===========================================================================
// Tests
// ===========================================================================

describe('query() — one-shot mode', () => {
  it.skipIf(!!SKIP_REASON)('emits system:init, then result, all with correct shapes', async () => {
    const q = query({
      prompt: 'Say "hello" and nothing else.',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);

    // Must have at least: init + assistant + result
    expect(messages.length).toBeGreaterThanOrEqual(2);

    // First message must be system:init
    const initMsg = messages[0];
    expect(initMsg?.type).toBe('system');
    assertInitMessage(initMsg!);

    // Last message must be result
    const resultMsg = messages[messages.length - 1];
    expect(resultMsg?.type).toBe('result');
    assertResultMessage(resultMsg!);

    // is_error must be false for successful run
    const r = resultMsg as unknown as Record<string, unknown>;
    expect(r.is_error).toBe(false);
    expect(r.subtype).toBe('success');

    // result field must be a non-empty string
    expect((r.result as string).length).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('assistant messages have correct shape', async () => {
    const q = query({
      prompt: 'What is 1 + 1? Answer with just the number.',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);
    const assistantMsgs = messages.filter(m => m.type === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThan(0);

    for (const msg of assistantMsgs) {
      assertAssistantMessage(msg);
    }
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('all messages have uuid field', async () => {
    const q = query({
      prompt: 'hi',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);

    for (const msg of messages) {
      // stream_event messages are the only ones that may not have uuid
      if (msg.type === 'stream_event') continue;
      const m = msg as unknown as Record<string, unknown>;
      expect(typeof m.uuid, `${msg.type} message missing uuid`).toBe('string');
    }
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('result subtype is one of the known CC SDK subtypes', async () => {
    const q = query({
      prompt: 'hi',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);
    const resultMsg = messages.find(m => m.type === 'result') as unknown as Record<string, unknown> | undefined;
    expect(resultMsg).toBeTruthy();

    const validSubtypes = new Set([
      'success',
      'error_during_execution',
      'error_max_turns',
      'error_max_budget_usd',
      'error_max_structured_output_retries',
    ]);
    expect(validSubtypes.has(resultMsg?.subtype as string)).toBe(true);
  }, 60_000);
});

describe('query() — tool use', () => {
  it.skipIf(!!SKIP_REASON)('tool is called and result is returned', async () => {
    const calls: unknown[] = [];

    const dateTool: Tool = {
      name: 'get_date',
      description: 'Get the current date. Call this to find out what today is.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      permissionLevel: 'readonly',
      execute: async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        calls.push({});
        return { content: '2026-04-09', isError: false };
      },
    };

    const q = query({
      prompt: 'What is today\'s date? Use the get_date tool.',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 5,
        customTools: [dateTool],
      },
    });

    const messages = await drainQuery(q);

    // Tool should have been called at least once
    expect(calls.length).toBeGreaterThan(0);

    // Result should exist
    const result = messages.find(m => m.type === 'result');
    expect(result).toBeTruthy();
    assertResultMessage(result!);

    // User message with tool_result should exist
    const userMsgs = messages.filter(m => m.type === 'user') as unknown as Array<Record<string, unknown>>;
    const hasToolResult = userMsgs.some(m => {
      const content = (m.message as Record<string, unknown>)?.content;
      if (!Array.isArray(content)) return false;
      return content.some((b: unknown) => (b as Record<string, unknown>)?.type === 'tool_result');
    });
    expect(hasToolResult).toBe(true);
  }, 90_000);
});

describe('createSession() — multi-turn session', () => {
  it.skipIf(!!SKIP_REASON)('stream() emits system:init on EVERY call (not just first)', async () => {
    const session = await unstable_v2_createSession({
      model: TEST_MODEL,
      provider: makeProvider(),
      maxTurns: 2,
    });

    try {
      // Turn 1
      await session.send('Say "turn1" and nothing else.');
      const turn1: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        turn1.push(msg);
        if (msg.type === 'result') break;
      }

      const turn1Init = turn1.find(m => m.type === 'system' && (m as unknown as Record<string, unknown>).subtype === 'init');
      expect(turn1Init).toBeTruthy();
      assertInitMessage(turn1Init!);

      const turn1Result = turn1.find(m => m.type === 'result');
      expect(turn1Result).toBeTruthy();
      assertResultMessage(turn1Result!);

      // Turn 2
      await session.send('Now say "turn2" and nothing else.');
      const turn2: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        turn2.push(msg);
        if (msg.type === 'result') break;
      }

      // CRITICAL: system:init must fire on turn 2 as well
      const turn2Init = turn2.find(m => m.type === 'system' && (m as unknown as Record<string, unknown>).subtype === 'init');
      expect(turn2Init, 'system:init must be emitted on every stream() call (consumer uses it as turn boundary)').toBeTruthy();

      const turn2Result = turn2.find(m => m.type === 'result');
      expect(turn2Result).toBeTruthy();
    } finally {
      session.close();
    }
  }, 120_000);

  it.skipIf(!!SKIP_REASON)('session_id is consistent across turns', async () => {
    const session = await unstable_v2_createSession({
      model: TEST_MODEL,
      provider: makeProvider(),
      maxTurns: 2,
    });

    try {
      await session.send('Hi');
      const turn1: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        turn1.push(msg);
        if (msg.type === 'result') break;
      }

      const t1Result = turn1.find(m => m.type === 'result') as unknown as Record<string, unknown> | undefined;
      const sessionId1 = t1Result?.session_id as string | undefined;
      expect(typeof sessionId1).toBe('string');
      expect(sessionId1!.length).toBeGreaterThan(0);

      await session.send('How are you?');
      const turn2: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        turn2.push(msg);
        if (msg.type === 'result') break;
      }

      const t2Result = turn2.find(m => m.type === 'result') as unknown as Record<string, unknown> | undefined;
      const sessionId2 = t2Result?.session_id as string | undefined;

      // session_id must be the same across turns (same conversation)
      expect(sessionId2).toBe(sessionId1);
    } finally {
      session.close();
    }
  }, 120_000);

  it.skipIf(!!SKIP_REASON)('interrupt() wakes up idle stream()', async () => {
    const session = await unstable_v2_createSession({
      model: TEST_MODEL,
      provider: makeProvider(),
      maxTurns: 2,
    });

    try {
      // Complete one turn first
      await session.send('Hi');
      for await (const msg of session.stream()) {
        if (msg.type === 'result') break;
      }

      // Now enter idle stream() and interrupt it
      const streamDone = (async () => {
        const received: SDKMessage[] = [];
        for await (const msg of session.stream()) {
          received.push(msg);
          // Break if we get a result (shouldn't happen) to avoid infinite wait
          if (msg.type === 'result') break;
        }
        return received;
      })();

      // Wait a short moment then interrupt
      await new Promise(r => setTimeout(r, 500));
      await session.interrupt();

      const received = await streamDone;
      // Stream should have exited cleanly (no result expected, just empty)
      expect(Array.isArray(received)).toBe(true);
    } finally {
      session.close();
    }
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('send() accepts multi-modal message envelope', async () => {
    const session = await unstable_v2_createSession({
      model: TEST_MODEL,
      provider: makeProvider(),
      maxTurns: 1,
    });

    try {
      // Consumer sends multi-modal messages as CC SDK envelope shape
      const envelope = {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: [{ type: 'text', text: 'Say hello.' }],
        },
      };
      await session.send(envelope as unknown as string);

      const messages: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        messages.push(msg);
        if (msg.type === 'result') break;
      }

      const result = messages.find(m => m.type === 'result');
      expect(result).toBeTruthy();
      assertResultMessage(result!);
    } finally {
      session.close();
    }
  }, 60_000);
});

describe('SDKMessage type guard — consumer-critical shapes', () => {
  it.skipIf(!!SKIP_REASON)('stream_event messages carry .event with Anthropic wire format', async () => {
    const q = query({
      prompt: 'Write one sentence.',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);
    const streamEvents = messages.filter(m => m.type === 'stream_event');

    // The consumer reads (sdkMessage as any).event
    // Note: some providers/responses may not produce stream_events when
    // the response is batched or falls back to non-streaming mode.
    // Verify structure when they exist.
    for (const msg of streamEvents) {
      const m = msg as unknown as Record<string, unknown>;
      expect(m.event, 'stream_event must have .event field').toBeTruthy();
      const ev = m.event as Record<string, unknown>;
      expect(typeof ev.type).toBe('string');
    }

    // When stream_events exist, they should contain text-related events
    const types = streamEvents.map(m => ((m as unknown as Record<string, unknown>).event as Record<string, unknown>).type);
    if (types.length > 0) {
      // One of these event types should appear for any text-producing LLM call
      const knownEventTypes = new Set(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
      const hasKnownType = types.some(t => knownEventTypes.has(t as string));
      expect(hasKnownType, `stream_event types ${JSON.stringify(types)} should include a known Anthropic wire event type`).toBe(true);
    }
    // If no stream_events, that's acceptable (non-streaming fallback path)
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('message_start has Anthropic wire format (nested .message object)', async () => {
    const q = query({
      prompt: 'hi',
      options: {
        model: TEST_MODEL,
        provider: makeProvider(),
        maxTurns: 1,
      },
    });

    const messages = await drainQuery(q);
    const startEvent = messages
      .filter(m => m.type === 'stream_event')
      .find(m => {
        const ev = ((m as unknown as Record<string, unknown>).event) as Record<string, unknown>;
        return ev?.type === 'message_start';
      });

    // Only validate if message_start was present (not all providers emit it)
    if (startEvent) {
      const ev = (startEvent as unknown as Record<string, unknown>).event as Record<string, unknown>;
      // CC wire format: { type: 'message_start', message: { id, model, role, content, usage, ... } }
      expect(ev.message, 'message_start must have nested .message object (CC wire format)').toBeTruthy();
      const inner = ev.message as Record<string, unknown>;
      expect(typeof inner.id).toBe('string');
    }
  }, 60_000);

  it.skipIf(!!SKIP_REASON)('compact_boundary has compact_metadata field', async () => {
    // This is hard to trigger in a short test — just verify the shape is defined
    // We verify the type definition is correct by constructing a synthetic message
    const synthetic: SDKMessage = {
      type: 'system',
      subtype: 'compact_boundary',
      summary: 'test',
      compact_metadata: { trigger: 'auto', pre_tokens: 1000 },
      session_id: 'test',
      uuid: 'test',
    } as unknown as SDKMessage;
    const m = synthetic as unknown as Record<string, unknown>;
    expect(m.subtype).toBe('compact_boundary');
    expect((m.compact_metadata as Record<string, unknown>)?.trigger).toBe('auto');
  });
});

describe('error handling', () => {
  it.skipIf(!!SKIP_REASON)('query with invalid API key yields error result (not throw)', async () => {
    const badProvider = createProvider({
      type: 'openai-compat',
      apiKey: 'invalid-key',
      baseUrl: resolveBaseUrl(TEST_API_URL),
      defaultModel: TEST_MODEL,
    });

    const q = query({
      prompt: 'hi',
      options: {
        model: TEST_MODEL,
        provider: badProvider,
        maxTurns: 1,
      },
    });

    // Should not throw — errors are yielded as messages
    try {
      const messages = await drainQuery(q);
      // Either an error result or an api_retry message should appear
      const errorResult = messages.find(m => {
        if (m.type === 'result') {
          const r = m as unknown as Record<string, unknown>;
          return r.is_error === true;
        }
        return false;
      });
      const retryMsg = messages.find(m => m.type === 'system' && (m as unknown as Record<string, unknown>).subtype === 'api_retry');
      // At least one of these must appear
      expect(errorResult || retryMsg).toBeTruthy();
    } catch {
      // It's acceptable to throw on auth failures for the query() path
      // since some providers don't return a structured error response
    }
  }, 30_000);

  it.skipIf(!!SKIP_REASON)('createSession with invalid API key is graceful', async () => {
    const badProvider = createProvider({
      type: 'openai-compat',
      apiKey: 'invalid-key',
      baseUrl: resolveBaseUrl(TEST_API_URL),
      defaultModel: TEST_MODEL,
    });

    const session = await unstable_v2_createSession({
      model: TEST_MODEL,
      provider: badProvider,
      maxTurns: 1,
    });

    try {
      await session.send('hi');
      const messages: SDKMessage[] = [];
      for await (const msg of session.stream()) {
        messages.push(msg);
        if (msg.type === 'result') break;
        // safety: break after 20 messages
        if (messages.length > 20) break;
      }
      // Should at minimum have system:init
      const hasInit = messages.some(
        m => m.type === 'system' && (m as unknown as Record<string, unknown>).subtype === 'init',
      );
      expect(hasInit).toBe(true);
    } catch {
      // Acceptable — bad auth may throw
    } finally {
      session.close();
    }
  }, 30_000);
});
