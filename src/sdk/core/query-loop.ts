/**
 * @module core/query-loop
 * The ReAct query loop — the heart of the Agent-Core SDK.
 * Mirrors CC Rust: crates/query/src/lib.rs run_query_loop()
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  ContentBlock,
  ToolUseBlock,
  StreamEvent,
  UsageInfo,
  LlmProvider,
} from '../types/provider.js';
import { toToolDefinition } from '../types/tool.js';
import type { Tool, ToolContext } from '../types/tool.js';
import type { QueryConfig } from '../types/config.js';
import { CostTracker } from './cost.js';
import { TokenBudget } from './token-budget.js';
import { buildUserMessage, buildToolResultMessage, extractToolUseBlocks } from './messages.js';
import { microCompact, apiCompact, autoCompactIfNeeded, AutoCompactState } from './compact.js';
import { assembleSystemPrompt, splitAtBoundary } from '../prompt/system-prompt.js';
import type { SystemPromptConfig } from '../prompt/system-prompt.js';
import { truncateToolResult } from '../utils/truncate.js';
import { ProviderError, AbortError } from '../utils/errors.js';
import {
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
} from './hooks.js';
import {
  MAX_TOKENS_RECOVERY_LIMIT,
  MAX_TOKENS_RECOVERY_MSG,
  contextWindowForModel,
} from '../prompt/constants.js';

// ---------------------------------------------------------------------------
// SDKMessage — events yielded by the query loop
// ---------------------------------------------------------------------------

export type SDKMessage =
  | { type: 'system'; subtype: 'init'; sessionId: string; tools: string[]; model: string }
  | { type: 'assistant'; message: { role: 'assistant'; content: ContentBlock[] }; uuid: string; usage?: UsageInfo }
  | { type: 'user'; message: { role: 'user'; content: ContentBlock[] }; uuid: string }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'result'; subtype: 'success' | 'error_max_turns' | 'error_max_budget_usd' | 'error'; error?: string; costUsd: number; turns: number; sessionId: string }
  | { type: 'tool_progress'; toolName: string; toolUseId: string; status: 'running' | 'completed' | 'error'; content?: string }
  | { type: 'system'; subtype: 'compact_boundary'; summary: string };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the system prompt string from config. */
function buildSystemPrompt(
  config: QueryConfig,
  tools: Tool[],
): string {
  // If user provided a full string, use it directly
  if (typeof config.systemPrompt === 'string') {
    return config.systemPrompt;
  }

  // Preset mode — assemble from sections
  const promptConfig: SystemPromptConfig = {
    tools,
    cwd: config.cwd,
    platform: typeof process !== 'undefined' ? process.platform : 'linux',
    date: new Date().toISOString().split('T')[0],
    model: config.model,
    customAppend: config.systemPrompt?.append,
    isSDK: true,
  };

  return assembleSystemPrompt(promptConfig);
}

/** Execute a single tool, with error recovery. */
async function executeTool(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: ToolContext,
  toolResultBudget: number,
): Promise<{ content: string; isError: boolean }> {
  try {
    const result = await tool.execute(input, ctx);
    const content = truncateToolResult(result.content, toolResultBudget);
    return { content, isError: result.isError };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Tool execution error: ${message}`,
      isError: true,
    };
  }
}

/** Check if the abort signal has been triggered. */
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError();
  }
}

/** Build tool context from query config and session state. */
function buildToolContext(
  config: QueryConfig,
  sessionId: string,
  costTracker: CostTracker,
  currentTurn: number,
): ToolContext {
  return {
    sessionId,
    cwd: config.cwd,
    abortSignal: config.abortSignal,
    costTracker,
    currentTurn,
    env: config.env as Record<string, string | undefined>,
  };
}

/** Find a tool by name. */
function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}

/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Stream accumulator — collects stream events into a complete response
// ---------------------------------------------------------------------------

interface AccumulatedResponse {
  content: ContentBlock[];
  usage: UsageInfo;
  stopReason: string;
  id: string;
  model: string;
}

async function accumulateStream(
  stream: AsyncGenerator<StreamEvent, void, undefined>,
  signal: AbortSignal,
  onEvent?: (event: StreamEvent) => void,
): Promise<AccumulatedResponse> {
  const textChunks: string[] = [];
  // tool_call_blocks: index -> { id, name, jsonParts }
  const toolCallBlocks = new Map<number, { id: string; name: string; jsonParts: string[] }>();
  let thinkingChunks: string[] = [];
  let thinkingIndex = -1;
  const usage: UsageInfo = { input_tokens: 0, output_tokens: 0 };
  let stopReason = 'end_turn';
  let msgId = '';
  let msgModel = '';

  for await (const event of stream) {
    if (signal.aborted) {
      throw new AbortError();
    }

    onEvent?.(event);

    switch (event.type) {
      case 'message_start':
        msgId = event.id;
        msgModel = event.model;
        usage.input_tokens = event.usage.input_tokens;
        usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        break;

      case 'content_block_start':
        if (event.contentBlock.type === 'tool_use') {
          const tb = event.contentBlock as ToolUseBlock;
          toolCallBlocks.set(event.index, { id: tb.id, name: tb.name, jsonParts: [] });
        } else if (event.contentBlock.type === 'thinking') {
          thinkingIndex = event.index;
          thinkingChunks = [];
        }
        break;

      case 'text_delta':
        textChunks.push(event.text);
        break;

      case 'thinking_delta':
        if (event.index === thinkingIndex) {
          thinkingChunks.push(event.thinking);
        }
        break;

      case 'input_json_delta': {
        const tc = toolCallBlocks.get(event.index);
        if (tc) {
          tc.jsonParts.push(event.partialJson);
        }
        break;
      }

      case 'message_delta':
        if (event.stopReason) {
          stopReason = event.stopReason;
        }
        if (event.usage) {
          usage.output_tokens = event.usage.output_tokens ?? usage.output_tokens;
        }
        break;

      case 'content_block_stop':
        break;

      case 'message_stop':
        break;

      case 'error':
        throw new ProviderError(event.message, {
          retryable: event.errorType === 'overloaded_error',
        });
    }
  }

  // Build content blocks
  const content: ContentBlock[] = [];

  // Thinking block (if any)
  if (thinkingChunks.length > 0) {
    content.push({ type: 'thinking', thinking: thinkingChunks.join('') });
  }

  // Text block
  const combinedText = textChunks.join('');
  if (combinedText) {
    content.push({ type: 'text', text: combinedText });
  }

  // Tool use blocks (sorted by index for determinism)
  const sortedIndices = [...toolCallBlocks.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const tc = toolCallBlocks.get(idx)!;
    let input: Record<string, unknown> = {};
    const jsonStr = tc.jsonParts.join('');
    if (jsonStr) {
      try {
        input = JSON.parse(jsonStr);
      } catch {
        input = {};
      }
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
  }

  return { content, usage, stopReason, id: msgId || randomUUID(), model: msgModel };
}

// ---------------------------------------------------------------------------
// queryLoop — the main ReAct loop
// ---------------------------------------------------------------------------

/**
 * The main agentic query loop.
 *
 * Implements the ReAct pattern:
 * 1. Send messages to LLM
 * 2. If response contains tool_use blocks, execute tools
 * 3. Feed tool results back to LLM
 * 4. Repeat until end_turn, max_turns, or max_budget
 *
 * Yields SDKMessage events for each step.
 */
export async function* queryLoop(
  config: QueryConfig,
  provider: LlmProvider,
  tools: Tool[],
  initialPrompt: string | Message[],
  options?: { onProgress?: (msg: SDKMessage) => void },
): AsyncGenerator<SDKMessage, void, undefined> {
  const sessionId = randomUUID();
  const costTracker = new CostTracker(config.model);
  const compactState = new AutoCompactState();
  const tokenBudget = new TokenBudget(config.model, config.maxTokens);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(config, tools);

  // Build tool definitions for the API
  const toolDefs = tools.map(toToolDefinition);

  // Initialize messages
  const messages: Message[] = [];
  if (typeof initialPrompt === 'string') {
    messages.push(buildUserMessage(initialPrompt));
  } else {
    messages.push(...initialPrompt);
  }

  // Yield init event
  const initMsg: SDKMessage = {
    type: 'system',
    subtype: 'init',
    sessionId,
    tools: tools.map((t) => t.name),
    model: config.model,
  };
  yield initMsg;
  options?.onProgress?.(initMsg);

  let turn = 0;
  let maxTokensRecoveryCount = 0;
  let effectiveModel = config.model;
  let usedFallback = false;
  let retriesLeft = 2;

  while (true) {
    turn++;

    // Check abort
    checkAbort(config.abortSignal);

    // Check max turns
    if (turn > config.maxTurns) {
      const resultMsg: SDKMessage = {
        type: 'result',
        subtype: 'error_max_turns',
        error: `Max turns exceeded: ${turn - 1} turns completed, limit is ${config.maxTurns}`,
        costUsd: costTracker.totalCostUsd,
        turns: turn - 1,
        sessionId,
      };
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Check budget
    if (costTracker.isOverBudget(config.maxBudgetUsd)) {
      const resultMsg: SDKMessage = {
        type: 'result',
        subtype: 'error_max_budget_usd',
        error: `Budget exceeded: $${costTracker.totalCostUsd.toFixed(4)} spent, limit is $${config.maxBudgetUsd.toFixed(4)}`,
        costUsd: costTracker.totalCostUsd,
        turns: turn - 1,
        sessionId,
      };
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Tier 1: Micro-compact — truncate old tool results
    if (config.toolResultBudget > 0) {
      const { messages: budgeted, truncatedCount } = microCompact(messages, config.toolResultBudget);
      if (truncatedCount > 0) {
        messages.length = 0;
        messages.push(...budgeted);
      }
    }

    // Tier 2: API-compact — strip oldest messages if over MAX_INPUT_TOKENS
    const apiCompacted = apiCompact(messages);
    if (apiCompacted) {
      messages.length = 0;
      messages.push(...apiCompacted);
    }

    // Build the provider request
    const [cacheablePart, dynamicPart] = splitAtBoundary(systemPrompt);
    const fullSystemPrompt = dynamicPart
      ? [
          { type: 'text' as const, text: cacheablePart, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: dynamicPart },
        ]
      : systemPrompt;

    // Stream LLM response
    let accumulated: AccumulatedResponse;
    const pendingStreamEvents: SDKMessage[] = [];
    try {
      const streamEventEmitter = config.includePartialMessages
        ? (event: StreamEvent) => {
            const streamMsg: SDKMessage = { type: 'stream_event', event };
            pendingStreamEvents.push(streamMsg);
            options?.onProgress?.(streamMsg);
          }
        : undefined;

      const stream = provider.createMessageStream({
        model: effectiveModel,
        messages: [...messages],
        systemPrompt: fullSystemPrompt,
        tools: toolDefs,
        maxTokens: config.maxTokens,
        thinking: config.thinking,
        stream: true,
      });

      accumulated = await accumulateStream(stream, config.abortSignal, streamEventEmitter);

      // Reset retry counter on success
      retriesLeft = 2;
    } catch (err: unknown) {
      // Handle retryable errors
      if (err instanceof ProviderError && err.retryable) {
        // Try fallback model
        if (!usedFallback && config.fallbackModel) {
          effectiveModel = config.fallbackModel;
          usedFallback = true;
          turn--;
          continue;
        }
        // Retry with backoff
        if (retriesLeft > 0) {
          retriesLeft--;
          await sleep(1000 * (3 - retriesLeft));
          turn--;
          continue;
        }
      }

      // Handle abort
      if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
        const resultMsg: SDKMessage = {
          type: 'result',
          subtype: 'error',
          error: 'Operation was aborted',
          costUsd: costTracker.totalCostUsd,
          turns: turn - 1,
          sessionId,
        };
        yield resultMsg;
        options?.onProgress?.(resultMsg);
        return;
      }

      // Unrecoverable error
      const errorMessage = err instanceof Error ? err.message : String(err);
      const resultMsg: SDKMessage = {
        type: 'result',
        subtype: 'error',
        error: errorMessage,
        costUsd: costTracker.totalCostUsd,
        turns: turn - 1,
        sessionId,
      };
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Track costs
    costTracker.add(accumulated.usage, effectiveModel);
    tokenBudget.updateFromUsage(accumulated.usage.input_tokens);

    // Yield collected stream events from the generator
    for (const streamMsg of pendingStreamEvents) {
      yield streamMsg;
    }

    // Build and push assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: accumulated.content,
    };
    messages.push(assistantMessage);

    // Yield the assistant message
    const assistantUuid = randomUUID();
    const assistantMsg: SDKMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: accumulated.content },
      uuid: assistantUuid,
      usage: accumulated.usage,
    };
    yield assistantMsg;
    options?.onProgress?.(assistantMsg);

    // Tier 3: Auto-compact (full compact) — LLM-based summarization if needed
    if (shouldTriggerAutoCompact(accumulated.usage.input_tokens, config.model)) {
      const compactResult = await autoCompactIfNeeded(
        messages,
        accumulated.usage.input_tokens,
        config.model,
        provider,
        systemPrompt,
        compactState,
      );
      if (compactResult) {
        messages.length = 0;
        messages.push(...compactResult.messages);
        const compactMsg: SDKMessage = {
          type: 'system',
          subtype: 'compact_boundary',
          summary: compactResult.summary,
        };
        yield compactMsg;
        options?.onProgress?.(compactMsg);
      }
    }

    // Extract tool use blocks
    const toolUseBlocks = extractToolUseBlocks(assistantMessage);

    // Check termination: no tool calls means the model is done
    if (toolUseBlocks.length === 0) {
      // Handle max_tokens recovery (model hit output limit)
      if (accumulated.stopReason === 'max_tokens') {
        if (maxTokensRecoveryCount < MAX_TOKENS_RECOVERY_LIMIT) {
          maxTokensRecoveryCount++;
          messages.push(buildUserMessage(MAX_TOKENS_RECOVERY_MSG));
          continue;
        }
      }

      // Success — model completed its turn
      const resultMsg: SDKMessage = {
        type: 'result',
        subtype: 'success',
        costUsd: costTracker.totalCostUsd,
        turns: turn,
        sessionId,
      };
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Reset max_tokens recovery counter when tools are being called
    maxTokensRecoveryCount = 0;

    // Execute tools in parallel, collecting progress messages for yielding
    const toolCtx = buildToolContext(config, sessionId, costTracker, turn);
    const pendingToolProgress: SDKMessage[] = [];

    const toolResultPromises = toolUseBlocks.map(async (toolUse) => {
      const tool = findTool(tools, toolUse.name);

      // Emit tool_progress: running
      const runningMsg: SDKMessage = {
        type: 'tool_progress',
        toolName: toolUse.name,
        toolUseId: toolUse.id,
        status: 'running',
      };
      pendingToolProgress.push(runningMsg);
      options?.onProgress?.(runningMsg);

      if (!tool) {
        const errorContent = `Tool "${toolUse.name}" not found. Available tools: ${tools.map((t) => t.name).join(', ')}`;
        const doneMsg: SDKMessage = {
          type: 'tool_progress',
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          status: 'error',
          content: errorContent,
        };
        pendingToolProgress.push(doneMsg);
        options?.onProgress?.(doneMsg);
        return { toolUseId: toolUse.id, content: errorContent, isError: true };
      }

      // --- PreToolUse hooks ---
      const preHookResult = await runPreToolUseHooks(
        config.hooks,
        toolUse.name,
        toolUse.input,
        toolUse.id,
        sessionId,
        config.cwd,
        config.abortSignal,
      );

      // Hook can deny tool execution
      if (preHookResult.decision === 'deny') {
        const reason = preHookResult.decisionReason || 'Denied by PreToolUse hook';
        const doneMsg: SDKMessage = {
          type: 'tool_progress',
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          status: 'error',
          content: reason,
        };
        pendingToolProgress.push(doneMsg);
        options?.onProgress?.(doneMsg);
        return { toolUseId: toolUse.id, content: reason, isError: true };
      }

      // Hook can modify tool input
      if (preHookResult.updatedInput) {
        Object.assign(toolUse.input, preHookResult.updatedInput);
      }

      // Check canUseTool permission callback (after hooks, so hooks can modify input first)
      if (config.canUseTool) {
        try {
          const permResult = await config.canUseTool(toolUse.name, toolUse.input, {
            signal: config.abortSignal,
            toolUseID: toolUse.id,
          });
          if (permResult.behavior === 'deny') {
            const deniedContent = `Permission denied: ${permResult.message}`;
            const doneMsg: SDKMessage = {
              type: 'tool_progress',
              toolName: toolUse.name,
              toolUseId: toolUse.id,
              status: 'error',
              content: deniedContent,
            };
            pendingToolProgress.push(doneMsg);
            options?.onProgress?.(doneMsg);
            return { toolUseId: toolUse.id, content: deniedContent, isError: true };
          }
          // Apply updated input if provided
          if (permResult.updatedInput) {
            Object.assign(toolUse.input, permResult.updatedInput);
          }
        } catch (permErr: unknown) {
          const errMsg = permErr instanceof Error ? permErr.message : String(permErr);
          return { toolUseId: toolUse.id, content: `Permission check error: ${errMsg}`, isError: true };
        }
      }

      const result = await executeTool(tool, toolUse.input, toolCtx, config.toolResultBudget);

      // --- PostToolUse / PostToolUseFailure hooks ---
      if (result.isError) {
        await runPostToolUseFailureHooks(
          config.hooks,
          toolUse.name,
          toolUse.input,
          result.content,
          toolUse.id,
          sessionId,
          config.cwd,
          config.abortSignal,
        );
      } else {
        const postResult = await runPostToolUseHooks(
          config.hooks,
          toolUse.name,
          toolUse.input,
          result.content,
          toolUse.id,
          sessionId,
          config.cwd,
          config.abortSignal,
        );

        // PostToolUse hooks can append additional context
        if (postResult.additionalContext) {
          result.content += `\n\n${postResult.additionalContext}`;
        }
      }

      // Prepend additional context from PreToolUse hooks (if any)
      if (preHookResult.additionalContext) {
        result.content = `${preHookResult.additionalContext}\n\n${result.content}`;
      }

      const completedMsg: SDKMessage = {
        type: 'tool_progress',
        toolName: toolUse.name,
        toolUseId: toolUse.id,
        status: result.isError ? 'error' : 'completed',
        content: result.content,
      };
      pendingToolProgress.push(completedMsg);
      options?.onProgress?.(completedMsg);

      return { toolUseId: toolUse.id, content: result.content, isError: result.isError };
    });

    const toolResults = await Promise.all(toolResultPromises);

    // Yield all collected tool_progress messages from the generator
    for (const progressMsg of pendingToolProgress) {
      yield progressMsg;
    }

    // Build tool result message and add to conversation
    const toolResultMessage = buildToolResultMessage(toolResults);
    messages.push(toolResultMessage);

    // Yield user message (tool results)
    const userUuid = randomUUID();
    const userMsg: SDKMessage = {
      type: 'user',
      message: toolResultMessage as { role: 'user'; content: ContentBlock[] },
      uuid: userUuid,
    };
    yield userMsg;
    options?.onProgress?.(userMsg);

    // Continue to next turn
  }
}

/** Check if auto-compact should be triggered. */
function shouldTriggerAutoCompact(inputTokens: number, model: string): boolean {
  const window = contextWindowForModel(model);
  return inputTokens >= Math.floor(window * 0.9);
}
