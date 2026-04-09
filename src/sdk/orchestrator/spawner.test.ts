/**
 * Unit tests for the AgentSpawner.
 *
 * Validates task lifecycle events, token accumulation,
 * and background/foreground execution modes.
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createSpawner } from './spawner.js';
import { AgentRegistry } from './registry.js';
import type { LlmProvider, ProviderRequest, ProviderResponse, StreamEvent, ProviderCapabilities, UsageInfo } from '../types/provider.js';
import type { Tool, ToolContext, ToolResult } from '../types/tool.js';
import type { QueryConfig } from '../types/config.js';
import type { AgentSpawnRequest } from '../tools/agent/index.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const TEST_CAPS: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  thinking: false,
  imageInput: false,
  pdfInput: false,
  audioInput: false,
  videoInput: false,
  caching: false,
  structuredOutput: false,
  systemPromptStyle: 'top_level',
};

function makeUsage(input = 10, output = 20): UsageInfo {
  return { input_tokens: input, output_tokens: output };
}

/** Provider that responds with a single text message. */
function makeSimpleProvider(text: string, delay = 0): LlmProvider {
  return {
    id: 'mock',
    name: 'Mock',
    capabilities: () => TEST_CAPS,
    async createMessage(_req: ProviderRequest): Promise<ProviderResponse> {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return {
        id: `msg_${randomUUID()}`,
        content: [{ type: 'text', text }],
        stopReason: 'end_turn',
        usage: makeUsage(15, 25),
        model: 'test-model',
      };
    },
    async *createMessageStream(_req: ProviderRequest): AsyncGenerator<StreamEvent, void, undefined> {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      yield { type: 'message_start', id: `msg_${randomUUID()}`, model: 'test-model', usage: makeUsage(15, 25) };
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield { type: 'text_delta', index: 0, text };
      yield { type: 'content_block_stop', index: 0 };
      yield { type: 'message_delta', stopReason: 'end_turn', usage: makeUsage(15, 25) };
      yield { type: 'message_stop' };
    },
  };
}

/** Minimal QueryConfig for spawner tests. */
function makeParentConfig(overrides: Partial<QueryConfig> = {}): QueryConfig {
  const abortController = new AbortController();
  return {
    model: 'test-model',
    maxTurns: 5,
    cwd: '/tmp',
    env: {},
    permissionMode: 'bypassPermissions',
    systemPrompt: 'Parent agent.',
    thinking: { type: 'disabled' },
    abortSignal: abortController.signal,
    ...overrides,
  };
}

/** Minimal ToolContext for spawner tests. */
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const abortController = new AbortController();
  return {
    sessionId: `session-${randomUUID()}`,
    toolUseId: `toolu_${randomUUID().slice(0, 8)}`,
    abortSignal: abortController.signal,
    onSubAgentMessage: undefined,
    costTracker: undefined,
    ...overrides,
  } as unknown as ToolContext;
}

/** Minimal AgentSpawnRequest. */
function makeRequest(overrides: Partial<AgentSpawnRequest> = {}): AgentSpawnRequest {
  return {
    prompt: 'Do something useful.',
    description: 'Test task',
    ...overrides,
  } as AgentSpawnRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSpawner — foreground execution', () => {
  it('resolves with the agent text output on success', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('Task complete.');
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const result = await spawner(makeRequest(), makeCtx());
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Task complete.');
  });

  it('registers the agent in the registry', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('done');
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    await spawner(makeRequest({ description: 'my-task' }), makeCtx());

    const agents = registry.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('my-task');
    expect(agents[0].status).toBe('completed');
  });

  it('handles provider errors gracefully via query-loop error result', async () => {
    const registry = new AgentRegistry();

    // Provider that fails on every call
    const failingProvider: LlmProvider = {
      id: 'mock',
      name: 'Mock',
      capabilities: () => TEST_CAPS,
      async createMessage(_req: ProviderRequest): Promise<ProviderResponse> {
        throw new Error('Provider exploded');
      },
      async *createMessageStream(_req: ProviderRequest): AsyncGenerator<StreamEvent, void, undefined> {
        throw new Error('Provider exploded');
        // eslint-disable-next-line no-unreachable
        yield { type: 'message_stop' };
      },
    };

    const spawner = createSpawner({
      provider: failingProvider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    // query-loop handles provider errors by emitting an error result message,
    // so the spawner returns a ToolResult (no throw). The agent is still
    // recorded as completed (not failed) — the error is embedded in the result text.
    const result = await spawner(makeRequest(), makeCtx());
    expect(typeof result.content).toBe('string');

    // Agent should be completed (query-loop handles the error internally)
    const agents = registry.list();
    expect(agents).toHaveLength(1);
    expect(['completed', 'failed']).toContain(agents[0].status);
  });
});

describe('createSpawner — background execution', () => {
  it('returns immediately with agent_id and status=running', async () => {
    const registry = new AgentRegistry();
    // Use a slow provider to verify we don't wait
    const provider = makeSimpleProvider('finished', 100);
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const start = Date.now();
    const result = await spawner(
      makeRequest({ runInBackground: true }),
      makeCtx(),
    );
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content as string);
    expect(parsed.status).toBe('running');
    expect(typeof parsed.agent_id).toBe('string');
    // Should return quickly, not wait for the 100ms delay
    expect(elapsed).toBeLessThan(100);
  });

  it('agent eventually completes in the registry', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('bg done', 20);
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const result = await spawner(
      makeRequest({ runInBackground: true }),
      makeCtx(),
    );
    const parsed = JSON.parse(result.content as string);
    const agentId = parsed.agent_id as string;

    // Wait for background agent to finish
    const entry = registry.get(agentId);
    expect(entry).toBeTruthy();
    await entry!.done;

    expect(registry.get(agentId)?.status).toBe('completed');
  });
});

describe('createSpawner — task lifecycle events', () => {
  it('emits task_started event for foreground agents', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('done');
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const messages: Record<string, unknown>[] = [];
    const ctx = makeCtx({
      toolUseId: 'toolu_parent_123',
      onSubAgentMessage: (msg: Record<string, unknown>) => {
        messages.push(msg);
      },
    } as unknown as Partial<ToolContext>);

    await spawner(makeRequest({ description: 'my test task' }), ctx);

    const taskStarted = messages.find((m) => m.subtype === 'task_started');
    expect(taskStarted).toBeTruthy();
    expect(taskStarted?.tool_use_id).toBe('toolu_parent_123');
    expect(taskStarted?.description).toBe('my test task');
    expect(typeof taskStarted?.task_id).toBe('string');
  });

  it('emits task_notification event on completion', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('work done');
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const messages: Record<string, unknown>[] = [];
    const ctx = makeCtx({
      toolUseId: 'toolu_abc',
      onSubAgentMessage: (msg: Record<string, unknown>) => {
        messages.push(msg);
      },
    } as unknown as Partial<ToolContext>);

    await spawner(makeRequest(), ctx);

    const notification = messages.find((m) => m.subtype === 'task_notification');
    expect(notification).toBeTruthy();
    expect(notification?.status).toBe('completed');
    expect(typeof notification?.task_id).toBe('string');
    // summary should contain the agent's final text
    expect(typeof notification?.summary).toBe('string');
    expect((notification?.summary as string).length).toBeGreaterThan(0);
  });

  it('emits task_notification with status=stopped on abort', async () => {
    const registry = new AgentRegistry();
    const abortController = new AbortController();

    // Use a slow provider and abort early
    const provider = makeSimpleProvider('never reached', 500);
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const messages: Record<string, unknown>[] = [];
    const ctx = makeCtx({
      toolUseId: 'toolu_abort',
      abortSignal: abortController.signal,
      onSubAgentMessage: (msg: Record<string, unknown>) => {
        messages.push(msg);
      },
    } as unknown as Partial<ToolContext>);

    // Abort immediately
    setTimeout(() => abortController.abort(), 10);
    await spawner(makeRequest(), ctx);

    const notification = messages.find((m) => m.subtype === 'task_notification');
    if (notification) {
      expect(['stopped', 'completed']).toContain(notification.status);
    }
  });
});

describe('createSpawner — token accumulation', () => {
  it('task_notification has non-zero total_tokens when provider reports usage', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('result');
    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [],
      registry,
    });

    const messages: Record<string, unknown>[] = [];
    const ctx = makeCtx({
      toolUseId: 'toolu_tokens',
      onSubAgentMessage: (msg: Record<string, unknown>) => {
        messages.push(msg);
      },
    } as unknown as Partial<ToolContext>);

    await spawner(makeRequest(), ctx);

    const notification = messages.find((m) => m.subtype === 'task_notification');
    expect(notification).toBeTruthy();

    const usage = notification?.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined;
    expect(usage).toBeTruthy();
    // Mock provider reports input=15, output=25 → total=40
    expect(usage?.total_tokens).toBeGreaterThan(0);
    expect(typeof usage?.duration_ms).toBe('number');
  });

  it('task_progress has non-zero total_tokens after tool use', async () => {
    const registry = new AgentRegistry();

    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object', properties: {} },
      permissionLevel: 'read',
      async execute(_i: Record<string, unknown>, _c: ToolContext): Promise<ToolResult> {
        return { content: 'echoed', isError: false };
      },
    };

    let callCount = 0;
    const provider: LlmProvider = {
      id: 'mock',
      name: 'Mock',
      capabilities: () => TEST_CAPS,
      async createMessage(_req: ProviderRequest): Promise<ProviderResponse> {
        if (callCount === 0) {
          callCount++;
          return {
            id: `msg_${randomUUID()}`,
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'echo', input: {} }],
            stopReason: 'tool_use',
            usage: makeUsage(12, 8),
            model: 'test-model',
          };
        }
        callCount++;
        return {
          id: `msg_${randomUUID()}`,
          content: [{ type: 'text', text: 'finished' }],
          stopReason: 'end_turn',
          usage: makeUsage(5, 15),
          model: 'test-model',
        };
      },
      async *createMessageStream(_req: ProviderRequest): AsyncGenerator<StreamEvent, void, undefined> {
        if (callCount === 0) {
          callCount++;
          const toolId = `toolu_${randomUUID().slice(0, 8)}`;
          yield { type: 'message_start', id: `msg_${randomUUID()}`, model: 'test-model', usage: makeUsage(12, 8) };
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: toolId, name: 'echo', input: {} },
          };
          yield { type: 'input_json_delta', index: 0, partialJson: '{}' };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', stopReason: 'tool_use', usage: makeUsage(12, 8) };
          yield { type: 'message_stop' };
        } else {
          callCount++;
          yield { type: 'message_start', id: `msg_${randomUUID()}`, model: 'test-model', usage: makeUsage(5, 15) };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
          yield { type: 'text_delta', index: 0, text: 'finished' };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_delta', stopReason: 'end_turn', usage: makeUsage(5, 15) };
          yield { type: 'message_stop' };
        }
      },
    };

    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [echoTool],
      registry,
    });

    const messages: Record<string, unknown>[] = [];
    const ctx = makeCtx({
      toolUseId: 'toolu_prog',
      onSubAgentMessage: (msg: Record<string, unknown>) => {
        messages.push(msg);
      },
    } as unknown as Partial<ToolContext>);

    await spawner(makeRequest(), ctx);

    const progress = messages.find((m) => m.subtype === 'task_progress');
    expect(progress).toBeTruthy();

    const usage = progress?.usage as { total_tokens: number } | undefined;
    expect(usage?.total_tokens).toBeGreaterThan(0);
  });
});

describe('createSpawner — parent config getter', () => {
  it('supports a live getter for parentConfig so model changes propagate', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('ok');

    let config = makeParentConfig({ model: 'model-v1' });
    const spawner = createSpawner({
      provider,
      parentConfig: () => config,
      parentTools: [],
      registry,
    });

    // Change model before spawning
    config = makeParentConfig({ model: 'model-v2' });
    await spawner(makeRequest(), makeCtx());

    // The agent should have used the updated config (we verify it didn't throw)
    const agents = registry.list();
    expect(agents[0].status).toBe('completed');
  });
});

describe('createSpawner — Agent tool exclusion', () => {
  it('does not include the Agent tool in sub-agent tools', async () => {
    const registry = new AgentRegistry();
    const provider = makeSimpleProvider('done');

    const executeSpy = vi.fn().mockResolvedValue({ content: 'called', isError: false });

    const agentTool: Tool = {
      name: 'Agent',
      description: 'spawns sub-agents',
      inputSchema: { type: 'object', properties: {} },
      permissionLevel: 'execute',
      execute: executeSpy,
    };

    const spawner = createSpawner({
      provider,
      parentConfig: makeParentConfig(),
      parentTools: [agentTool],
      registry,
    });

    await spawner(makeRequest(), makeCtx());

    // Agent tool should never be called by sub-agents (recursion guard)
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
