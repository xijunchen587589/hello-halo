/**
 * Model Capabilities — Vision Support Detection
 *
 * Maintains a blacklist of known non-vision models and provides a unified
 * query function for checking vision support. Used by InputArea to block
 * image input for models that don't support it.
 *
 * Resolution order:
 *   1. Explicit ModelOption.supportsVision (provider-declared) — highest priority
 *   2. Vision keyword whitelist (e.g. "-vl", "vision", "omni")
 *   3. Non-vision pattern blacklist (e.g. "deepseek", "glm-4")
 *   4. Default: true (unknown models pass through, no false blocking)
 */

import type { ModelOption } from '../types/ai-sources'

/**
 * Known non-vision model patterns (blacklist).
 * Matched via modelId.toLowerCase().includes(pattern).
 */
const NON_VISION_PATTERNS: string[] = [
  // DeepSeek family
  'deepseek',
  // GLM family (glm-4v is rescued by VISION_KEYWORDS)
  'glm-4', 'glm-5', 'chatglm',
  // Meta Llama (text-only variants)
  'llama-2', 'llama-3.1', 'llama-3.3', 'codellama',
  // Mistral family
  'mixtral', 'mistral-large', 'mistral-medium', 'mistral-nemo', 'codestral',
  // Qwen text/code variants
  'qwen-coder', 'qwen2.5-coder', 'qwen3-coder', 'qwen-math', 'qwq',
  // Microsoft Phi family
  'phi-2', 'phi-3-mini', 'phi-3-small', 'phi-3-medium', 'phi-4-mini',
  // Google Gemma
  'gemma-2', 'codegemma',
  // NVIDIA
  'nemotron',
  // MiniMax
  'minimax', 'abab',
  // Other known text-only models
  'command-r', 'dbrx', 'olmo', 'starcoder',
  'solar', 'mercury', 'lfm', 'palmyra', 'internlm', 'baichuan',
]

/**
 * Keywords that indicate vision support — takes priority over blacklist.
 * Prevents false positives (e.g. "glm-4v" matched by "glm-4" pattern).
 */
const VISION_KEYWORDS: string[] = [
  'vision', '-vl', 'pixtral', 'paligemma', 'cogvlm',
  'glm-4v', 'glm-ocr', 'multimodal', 'omni',
]

/**
 * Infer vision support from model ID using blacklist/whitelist patterns.
 */
function inferVisionSupport(modelId: string): boolean {
  const lower = modelId.toLowerCase()

  // Vision keywords take priority — rescue false positives
  if (VISION_KEYWORDS.some(kw => lower.includes(kw))) return true

  // Check blacklist
  if (NON_VISION_PATTERNS.some(p => lower.includes(p))) return false

  // Unknown models default to vision-capable (no false blocking)
  return true
}

/**
 * Check if a model supports vision (image) input.
 *
 * Resolution order:
 *   1. Explicit ModelOption.supportsVision (provider or user set) — highest priority
 *   2. Blacklist/keyword inference from model ID
 *   3. Default true (unknown models pass through)
 */
export function supportsVision(model: ModelOption): boolean {
  if (model.supportsVision !== undefined) return model.supportsVision
  return inferVisionSupport(model.id)
}
