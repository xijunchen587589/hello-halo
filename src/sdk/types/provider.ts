/**
 * @module types/provider
 * Provider-agnostic request/response types shared across all LLM provider implementations.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// StopReason
// ---------------------------------------------------------------------------

/** The reason a model stopped generating tokens. */
export type StopReason =
  | 'end_turn'
  | 'stop_sequence'
  | 'max_tokens'
  | 'tool_use'
  | 'content_filtered'
  | string; // Provider-specific unknown stop reasons

// ---------------------------------------------------------------------------
// ContentBlock
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface DocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface SignatureBlock {
  type: 'signature';
  signature: string;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | DocumentBlock
  | SignatureBlock;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// SystemPrompt
// ---------------------------------------------------------------------------

export interface SystemPromptBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export type SystemPrompt = string | SystemPromptBlock[];

// ---------------------------------------------------------------------------
// UsageInfo
// ---------------------------------------------------------------------------

export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  web_search_requests?: number;
}

// ---------------------------------------------------------------------------
// ThinkingConfig
// ---------------------------------------------------------------------------

export type ThinkingConfig =
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'adaptive' }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// ToolDefinition
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ProviderRequest
// ---------------------------------------------------------------------------

/** A normalized request that any provider adapter can consume. */
export interface ProviderRequest {
  /** Model identifier (e.g. "claude-sonnet-4-6", "gpt-4o") */
  model: string;
  /** Conversation history */
  messages: Message[];
  /** Optional system / developer prompt */
  systemPrompt?: SystemPrompt;
  /** Tool definitions available to the model for this turn */
  tools?: ToolDefinition[];
  /** Maximum number of tokens to generate */
  maxTokens: number;
  /** Sampling temperature */
  temperature?: number;
  /** Nucleus sampling probability mass */
  topP?: number;
  /** Top-k sampling cutoff */
  topK?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Extended thinking / chain-of-thought configuration */
  thinking?: ThinkingConfig;
  /** Whether to request a streaming response */
  stream: boolean;
  /** Arbitrary provider-specific options */
  providerOptions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ProviderResponse
// ---------------------------------------------------------------------------

/** A normalized response returned by any provider adapter. */
export interface ProviderResponse {
  /** Provider-assigned message / request identifier */
  id: string;
  /** Generated content blocks */
  content: ContentBlock[];
  /** Why the model stopped generating */
  stopReason: StopReason;
  /** Token usage for billing / budget tracking */
  usage: UsageInfo;
  /** The model that produced this response (as reported by the provider) */
  model: string;
}

// ---------------------------------------------------------------------------
// StreamEvent
// ---------------------------------------------------------------------------

/** Events emitted by the provider-agnostic streaming layer. */
export type StreamEvent =
  | { type: 'message_start'; id: string; model: string; usage: UsageInfo }
  | { type: 'content_block_start'; index: number; contentBlock: ContentBlock }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'thinking_delta'; index: number; thinking: string }
  | { type: 'input_json_delta'; index: number; partialJson: string }
  | { type: 'signature_delta'; index: number; signature: string }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; stopReason?: StopReason; usage?: UsageInfo }
  | { type: 'message_stop' }
  | { type: 'error'; errorType: string; message: string }
  | { type: 'reasoning_delta'; index: number; reasoning: string };

// ---------------------------------------------------------------------------
// ProviderCapabilities
// ---------------------------------------------------------------------------

/** Describes the features supported by a provider/model combination. */
export interface ProviderCapabilities {
  /** Supports streaming responses via SSE or websocket */
  streaming: boolean;
  /** Supports function / tool calling */
  toolCalling: boolean;
  /** Supports extended thinking / chain-of-thought tokens */
  thinking: boolean;
  /** Accepts image inputs */
  imageInput: boolean;
  /** Accepts PDF document inputs */
  pdfInput: boolean;
  /** Accepts audio inputs */
  audioInput: boolean;
  /** Accepts video inputs */
  videoInput: boolean;
  /** Supports prompt caching */
  caching: boolean;
  /** Supports JSON-schema-constrained structured output */
  structuredOutput: boolean;
  /** How the provider expects the system prompt to be delivered */
  systemPromptStyle: SystemPromptStyle;
}

/** Where/how a provider expects the system prompt. */
export type SystemPromptStyle =
  | 'top_level'       // Anthropic style: top-level `system` field
  | 'system_message'  // OpenAI style: { role: 'system', content: '...' }
  | 'system_instruction'; // Google Gemini style

// ---------------------------------------------------------------------------
// ProviderStatus
// ---------------------------------------------------------------------------

/** Health status of a provider endpoint. */
export type ProviderStatus =
  | { status: 'healthy' }
  | { status: 'degraded'; reason: string }
  | { status: 'unavailable'; reason: string };

// ---------------------------------------------------------------------------
// AuthMethod
// ---------------------------------------------------------------------------

export type ApiKeyHeader = 'x_api_key' | 'authorization' | string;

export type AuthMethod =
  | { type: 'api_key'; key: string; header: ApiKeyHeader }
  | { type: 'bearer'; token: string }
  | { type: 'aws_credentials'; profile?: string; region: string; bearerToken?: string }
  | { type: 'oauth'; accessToken: string; refreshToken: string; expiresAt: number }
  | { type: 'none' };

// ---------------------------------------------------------------------------
// LlmProvider interface
// ---------------------------------------------------------------------------

/** The core interface every LLM provider adapter must implement. */
export interface LlmProvider {
  /** Unique machine-readable identifier, e.g. "anthropic", "openai" */
  readonly id: string;
  /** Human-readable display name, e.g. "Anthropic", "OpenAI" */
  readonly name: string;
  /** Send a message and receive a complete (non-streaming) response */
  createMessage(request: ProviderRequest): Promise<ProviderResponse>;
  /** Send a message and receive a streaming response */
  createMessageStream(request: ProviderRequest): AsyncGenerator<StreamEvent, void, undefined>;
  /** Return the list of models available through this provider */
  listModels?(): Promise<ProviderModelInfo[]>;
  /** Check whether the provider is authenticated and reachable */
  healthCheck?(): Promise<ProviderStatus>;
  /** Return the static capabilities of this provider */
  capabilities(): ProviderCapabilities;
}

/** Static metadata about a model available through a provider. */
export interface ProviderModelInfo {
  /** Model unique identifier (e.g. "claude-opus-4-5") */
  id: string;
  /** Provider that hosts this model */
  providerId: string;
  /** Human-readable display name */
  name: string;
  /** Total context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per response */
  maxOutputTokens: number;
}
