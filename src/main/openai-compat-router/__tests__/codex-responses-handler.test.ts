/**
 * Unit tests for Codex Responses compatibility helpers.
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
import {
  anthropicToCodexResponse,
  codexResponsesToAnthropicRequest,
  createCodexStreamBridgeForTest
} from '../server/codex-responses-handler'

describe('Codex Responses compatibility', () => {
  it('converts Codex Responses text input and developer instructions to Anthropic format', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      instructions: 'Runtime instructions',
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Developer policy' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }]
        }
      ],
      stream: true
    })

    expect(request.model).toBe('gpt-5.1-codex-max')
    expect(request.system).toBe('Runtime instructions\n\nDeveloper policy')
    expect(request.stream).toBe(true)
    expect(request.messages).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('converts Codex function calls and outputs into Anthropic tool turns', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      input: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"/tmp/a.txt"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'file body'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } }
          }
        }
      ],
      tool_choice: 'auto',
      reasoning: { effort: 'medium' }
    })

    expect(request.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        strict: undefined
      }
    ])
    expect(request.tool_choice).toEqual({ type: 'auto' })
    expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/tmp/a.txt' } }]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }]
      }
    ])
  })
  it('degrades FREEFORM custom tools to JSON-input function tools with grammar in description', () => {
    const grammar = 'patch: "*** Begin Patch" body "*** End Patch"\nbody: /[^\\0]+/'
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      input: [],
      tools: [
        {
          type: 'custom',
          name: 'apply_patch',
          description: 'Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.',
          format: { type: 'grammar', syntax: 'lark', definition: grammar }
        }
      ]
    })

    expect(request.tools).toHaveLength(1)
    const tool = request.tools![0]
    expect(tool.name).toBe('apply_patch')
    expect(tool.input_schema).toEqual({
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'The entire freeform tool body as a single string.'
        }
      },
      required: ['input'],
      additionalProperties: false
    })
    // Description must preserve the original guidance, mention the JSON
    // envelope contract, and embed the lark grammar so the upstream model
    // has enough context to produce a valid `input` body.
    expect(tool.description).toContain('FREEFORM')
    expect(tool.description).toContain('`input` field')
    expect(tool.description).toContain('Grammar (lark)')
    expect(tool.description).toContain(grammar)
  })

  it('passes JSON-schema custom tools through without wrapping', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      input: [],
      tools: [
        {
          type: 'custom',
          name: 'specialized',
          description: 'Custom tool exposed as JSON',
          parameters: { type: 'object', properties: { id: { type: 'string' } } }
        }
      ]
    })

    expect(request.tools).toEqual([
      {
        name: 'specialized',
        description: 'Custom tool exposed as JSON',
        input_schema: { type: 'object', properties: { id: { type: 'string' } } },
        strict: undefined
      }
    ])
  })

  it('replays custom_tool_call history items by forwarding raw input under the JSON envelope key', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      input: [
        {
          type: 'custom_tool_call',
          id: 'fc_apply_1',
          call_id: 'call_apply_1',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n'
        }
      ]
    })

    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call_apply_1',
          name: 'apply_patch',
          input: { input: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n' }
        }]
      }
    ])
  })

  it('converts Anthropic content blocks back to Codex Responses output items', () => {
    const response = anthropicToCodexResponse({
      id: 'msg_1',
      model: 'provider-model',
      content: [
        { type: 'thinking', thinking: 'reasoning' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', id: 'toolu_1', name: 'write_file', input: { path: 'a.txt' } }
      ],
      usage: { input_tokens: 7, output_tokens: 11 }
    }, 'fallback-model') as any

    expect(response.object).toBe('response')
    expect(response.model).toBe('provider-model')
    expect(response.usage).toEqual({ input_tokens: 7, output_tokens: 11, total_tokens: 18 })
    expect(response.output).toEqual([
      {
        id: expect.stringMatching(/^rs_/),
        type: 'reasoning',
        status: 'completed',
        summary: [{ type: 'output_text', text: 'reasoning' }]
      },
      {
        id: expect.stringMatching(/^msg_/),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'answer' }]
      },
      {
        id: 'toolu_1',
        type: 'function_call',
        status: 'completed',
        name: 'write_file',
        call_id: 'toolu_1',
        arguments: '{"path":"a.txt"}'
      }
    ])
  })

  it('bridges Anthropic text stream into Codex message item events', () => {
    const chunks: string[] = []
    const res = {
      write: (chunk: unknown) => {
        chunks.push(String(chunk))
        return true
      },
      end: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    const bridge = createCodexStreamBridgeForTest(res as any, 'test-model') as any

    bridge.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n')
    bridge.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
    bridge.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n')
    bridge.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
    bridge.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    bridge.end()

    const body = chunks.join('')
    expect(body).toContain('event: response.output_item.added')
    expect(body).toContain('event: response.output_text.delta')
    expect(body).toContain('event: response.output_item.done')
    expect(body).toContain('event: response.completed')
    expect(body).toContain('"type":"message"')
    expect(body).toContain('"text":"你好"')
  })

  it('emits a single message item id consistent across added / delta / done', () => {
    // Regression guard for the duplicate-bubble bug: Codex CLI's parser
    // correlates output_item.added → output_text.delta → output_item.done
    // by the item.id field. If `added` or `done` omits id, Codex creates
    // a separate ghost item that lacks the deltas, then a second item
    // from the deltas — producing two agentMessage items downstream and
    // a doubled bubble in Halo's UI. This test pins the contract: exactly
    // one message id appears, and it is the same id used by every event.
    const chunks: string[] = []
    const res = {
      write: (chunk: unknown) => { chunks.push(String(chunk)); return true },
      end: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    const bridge = createCodexStreamBridgeForTest(res as any, 'test-model') as any

    bridge.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n')
    bridge.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
    bridge.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}\n\n')
    bridge.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n')
    bridge.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
    bridge.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    bridge.end()

    const body = chunks.join('')

    // Parse the SSE stream into individual events for structural assertions.
    const events: Array<{ event: string; data: any }> = []
    for (const part of body.split('\n\n')) {
      const lines = part.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event:'))
      const dataLine = lines.find((l) => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      try {
        events.push({ event: eventLine.slice(7).trim(), data: JSON.parse(dataLine.slice(5).trim()) })
      } catch { /* skip malformed */ }
    }

    const added = events.filter((e) => e.event === 'response.output_item.added')
    const deltas = events.filter((e) => e.event === 'response.output_text.delta')
    const done = events.filter((e) => e.event === 'response.output_item.done')

    // Exactly one message item should be opened and closed.
    expect(added).toHaveLength(1)
    expect(done).toHaveLength(1)
    expect(deltas.length).toBeGreaterThan(0)

    // The id field must be present on the item in added/done — Codex CLI
    // requires this to correlate the events.
    const addedId = added[0]?.data?.item?.id
    const doneId = done[0]?.data?.item?.id
    expect(typeof addedId).toBe('string')
    expect(addedId).toBeTruthy()
    expect(doneId).toBe(addedId)

    // Every delta's item_id must match the same id.
    for (const d of deltas) {
      expect(d.data.item_id).toBe(addedId)
    }
  })
})
