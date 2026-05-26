/**
 * Tests for AnthropicStreamHandler and BaseStreamHandler empty-text-block repair.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/halo-test',
    getName: () => 'Halo',
    getVersion: () => '1.0.0-test'
  },
  session: {
    defaultSession: {
      resolveProxy: vi.fn(async () => 'DIRECT')
    },
    fromPartition: vi.fn(() => ({ setProxy: vi.fn(async () => undefined) }))
  }
}))

import { Readable } from 'node:stream'
import { streamAnthropicPassthrough } from '../stream/anthropic-stream'

/** Build a mock Express response that captures written chunks */
function createMockRes() {
  const chunks: string[] = []
  const res = {
    write: (chunk: unknown) => { chunks.push(String(chunk)); return true },
    end: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  }
  return { res: res as any, chunks }
}

/** Convert SSE text lines into a ReadableStream (simulates upstream body) */
function sseToStream(lines: string): ReadableStream {
  const encoded = new TextEncoder().encode(lines)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded)
      controller.close()
    }
  })
}

/** Parse captured SSE chunks into typed events */
function parseSSEEvents(chunks: string[]): Array<{ event: string; data: any }> {
  const body = chunks.join('')
  const events: Array<{ event: string; data: any }> = []
  for (const part of body.split('\n\n')) {
    const lines = part.split('\n')
    const eventLine = lines.find(l => l.startsWith('event:'))
    const dataLine = lines.find(l => l.startsWith('data:'))
    if (!eventLine || !dataLine) continue
    try {
      events.push({
        event: eventLine.slice(7).trim(),
        data: JSON.parse(dataLine.slice(5).trim())
      })
    } catch { /* skip malformed */ }
  }
  return events
}

describe('AnthropicStreamHandler', () => {
  it('passes through a normal thinking + text response', async () => {
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me think"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"hello world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":20}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'test-model')

    const events = parseSSEEvents(chunks)
    const textDeltas = events.filter(e =>
      e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta'
    )
    expect(textDeltas).toHaveLength(1)
    expect(textDeltas[0].data.delta.text).toBe('hello world')

    const thinkingDeltas = events.filter(e =>
      e.event === 'content_block_delta' && e.data.delta?.type === 'thinking_delta'
    )
    expect(thinkingDeltas).toHaveLength(1)
    expect(thinkingDeltas[0].data.delta.thinking).toBe('let me think')
  })

  it('repairs thinking-only response with empty text block (GLM bug)', async () => {
    // GLM-4.7 bug: thinking has content, text block opened but no text_delta sent
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"glm-4.7","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":100,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"full answer in thinking"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":50}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'glm-4.7')

    const events = parseSSEEvents(chunks)

    // Should have injected a placeholder text block
    const textDeltas = events.filter(e =>
      e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta'
    )
    expect(textDeltas.length).toBeGreaterThanOrEqual(1)
    // The placeholder text should be a space
    expect(textDeltas[textDeltas.length - 1].data.delta.text).toBe(' ')

    // message_delta should still be present with end_turn
    const msgDelta = events.find(e => e.event === 'message_delta')
    expect(msgDelta?.data.delta.stop_reason).toBe('end_turn')
  })

  it('repairs completely empty response (no blocks at all)', async () => {
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'test-model')

    const events = parseSSEEvents(chunks)

    // Should have injected an empty text block (start + stop, no delta)
    const textBlockStarts = events.filter(e =>
      e.event === 'content_block_start' && e.data.content_block?.type === 'text'
    )
    expect(textBlockStarts).toHaveLength(1)

    const msgDelta = events.find(e => e.event === 'message_delta')
    expect(msgDelta?.data.delta.stop_reason).toBe('end_turn')
  })

  it('does not inject placeholder when text has actual content', async () => {
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"real answer"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'test-model')

    const events = parseSSEEvents(chunks)
    const textDeltas = events.filter(e =>
      e.event === 'content_block_delta' && e.data.delta?.type === 'text_delta'
    )
    // Only the original delta, no placeholder injected
    expect(textDeltas).toHaveLength(1)
    expect(textDeltas[0].data.delta.text).toBe('real answer')
  })

  it('does not inject placeholder when response has tool calls', async () => {
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":10}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'test-model')

    const events = parseSSEEvents(chunks)

    // No text blocks should be injected — tool calls are the response
    const textBlockStarts = events.filter(e =>
      e.event === 'content_block_start' && e.data.content_block?.type === 'text'
    )
    expect(textBlockStarts).toHaveLength(0)
  })

  it('handles thinking-only response without text block (no text block opened)', async () => {
    // Edge case: model sends thinking but never opens a text block at all
    const { res, chunks } = createMockRes()
    const upstream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"deep thought"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ].join('')

    await streamAnthropicPassthrough(sseToStream(upstream), res, 'test-model')

    const events = parseSSEEvents(chunks)

    // thinking block is a valid terminal type per SDK, but since hasThinkingBlock
    // is true and hasTextBlock is false, the case 2 branch won't trigger.
    // Case 1 won't trigger either (hasThinkingBlock is true).
    // This is correct — the SDK accepts thinking as a valid terminal block.
    const msgDelta = events.find(e => e.event === 'message_delta')
    expect(msgDelta?.data.delta.stop_reason).toBe('end_turn')
  })
})
