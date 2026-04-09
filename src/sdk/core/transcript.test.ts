/**
 * Unit tests for transcript read/write utilities.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getTranscriptPath,
  appendToTranscript,
  readTranscriptMessages,
  transcriptExists,
  TranscriptWriter,
  getSubagentDir,
  getSubagentTranscriptPath,
  writeSubagentTranscript,
  listSubagentIds,
  readSubagentMessages,
} from './transcript.js';
import type { Message } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CWD = '/test/project/dir';

let tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
  delete process.env.CLAUDE_CONFIG_DIR;
});

function withTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-transcript-test-'));
  tempDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// getTranscriptPath
// ---------------------------------------------------------------------------

describe('getTranscriptPath', () => {
  it('encodes non-alphanumeric chars in cwd as dashes', () => {
    const p = getTranscriptPath('sess-id', '/Users/fly/my-project');
    expect(p).toContain('-Users-fly-my-project');
    expect(p).toMatch(/sess-id\.jsonl$/);
  });

  it('produces path under projects/<projectDir>', () => {
    const p = getTranscriptPath('sess', '/cwd');
    expect(p).toContain(path.join('projects'));
    expect(p).toMatch(/\.jsonl$/);
  });
});

// ---------------------------------------------------------------------------
// appendToTranscript + readTranscriptMessages round-trip
// ---------------------------------------------------------------------------

describe('appendToTranscript / readTranscriptMessages', () => {
  it('round-trips user and assistant messages via TranscriptWriter', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();

    const writer = new TranscriptWriter(sessionId, TEST_CWD);
    await writer.writeUserMessage({ role: 'user', content: 'Hello' });
    await writer.writeAssistantMessage({ role: 'assistant', content: 'World' });

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).not.toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages![0].role).toBe('user');
    expect(messages![0].content).toBe('Hello');
    expect(messages![1].role).toBe('assistant');
    expect(messages![1].content).toBe('World');
  });

  it('returns null when transcript does not exist', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const result = await readTranscriptMessages(randomUUID(), TEST_CWD);
    expect(result).toBeNull();
  });

  it('skips malformed JSON lines gracefully', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);

    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
    const validEntry = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'valid' },
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    });
    await fs.promises.writeFile(transcriptPath, validEntry + '\n{malformed}\n', 'utf8');

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).toHaveLength(1);
    expect(messages![0].content).toBe('valid');
  });

  it('appendToTranscript creates parent directories automatically', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);

    // Directory should not exist yet
    expect(fs.existsSync(path.dirname(transcriptPath))).toBe(false);

    await appendToTranscript(transcriptPath, {
      type: 'user',
      message: { role: 'user', content: 'test' } as Message,
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    } as Parameters<typeof appendToTranscript>[1]);

    expect(fs.existsSync(transcriptPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// transcriptExists
// ---------------------------------------------------------------------------

describe('transcriptExists', () => {
  it('returns false when no transcript file', () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    expect(transcriptExists(randomUUID(), TEST_CWD)).toBe(false);
  });

  it('returns true after transcript is written', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);
    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.promises.writeFile(transcriptPath, '{}', 'utf8');
    expect(transcriptExists(sessionId, TEST_CWD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TranscriptWriter
// ---------------------------------------------------------------------------

describe('TranscriptWriter', () => {
  it('writes messages in order', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, TEST_CWD);

    await writer.writeUserMessage({ role: 'user', content: 'ping' });
    await writer.writeAssistantMessage({ role: 'assistant', content: 'pong' });

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).toHaveLength(2);
    expect(messages![0].content).toBe('ping');
    expect(messages![1].content).toBe('pong');
  });

  it('exposes the transcript path', () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, TEST_CWD);
    expect(writer.path).toContain(sessionId);
    expect(writer.path).toMatch(/\.jsonl$/);
  });

  it('is a no-op when cwd is empty string', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, '');
    await writer.writeUserMessage({ role: 'user', content: 'test' });
    // No file should be created since enabled=false for empty cwd
    expect(transcriptExists(sessionId, '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sub-agent transcript functions
// ---------------------------------------------------------------------------

describe('sub-agent transcript paths', () => {
  it('getSubagentDir nests under <parentSessionId>/subagents/', () => {
    const parentId = randomUUID();
    const d = getSubagentDir(parentId, TEST_CWD);
    expect(d).toContain(parentId);
    expect(d).toContain('subagents');
    expect(d).toContain('-test-project-dir');
  });

  it('getSubagentTranscriptPath uses agent- prefix and .jsonl suffix', () => {
    const parentId = randomUUID();
    const agentId = `agent-${Date.now()}-abc123`;
    const p = getSubagentTranscriptPath(parentId, agentId, TEST_CWD);
    expect(p).toContain(parentId);
    expect(p).toContain(`agent-${agentId}.jsonl`);
  });
});

describe('writeSubagentTranscript / listSubagentIds / readSubagentMessages', () => {
  it('round-trips sub-agent messages', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const parentId = randomUUID();
    const agentId = `agent-${Date.now()}-xyz`;

    const messages: Record<string, unknown>[] = [
      { type: 'assistant', message: { role: 'assistant', content: 'I will help.' }, uuid: randomUUID() },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }, uuid: randomUUID() },
    ];

    await writeSubagentTranscript(parentId, agentId, TEST_CWD, messages);

    const ids = await listSubagentIds(parentId, TEST_CWD);
    expect(ids).toContain(agentId);

    const read = await readSubagentMessages(parentId, agentId, TEST_CWD);
    expect(read).toHaveLength(2);
    expect(read[0].type).toBe('assistant');
    expect(read[0].session_id).toBe(agentId);
    expect(read[1].type).toBe('user');
  });

  it('listSubagentIds returns empty array when no sub-agents exist', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const ids = await listSubagentIds(randomUUID(), TEST_CWD);
    expect(ids).toEqual([]);
  });

  it('readSubagentMessages returns empty array when transcript missing', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const result = await readSubagentMessages(randomUUID(), 'no-such-agent', TEST_CWD);
    expect(result).toEqual([]);
  });

  it('skips non-message entries (result, system) when reading', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const parentId = randomUUID();
    const agentId = `agent-${Date.now()}-skip`;

    const messages: Record<string, unknown>[] = [
      { type: 'assistant', message: { role: 'assistant', content: 'hello' }, uuid: randomUUID() },
      { type: 'result', message: null, uuid: randomUUID() },    // should be skipped
      { type: 'system', message: null, uuid: randomUUID() },    // should be skipped
    ];

    await writeSubagentTranscript(parentId, agentId, TEST_CWD, messages);

    const read = await readSubagentMessages(parentId, agentId, TEST_CWD);
    expect(read).toHaveLength(1);
    expect(read[0].type).toBe('assistant');
  });

  it('pagination with limit and offset works', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const parentId = randomUUID();
    const agentId = `agent-${Date.now()}-page`;

    const messages: Record<string, unknown>[] = [
      { type: 'assistant', message: { role: 'assistant', content: 'msg1' }, uuid: randomUUID() },
      { type: 'user', message: { role: 'user', content: 'msg2' }, uuid: randomUUID() },
      { type: 'assistant', message: { role: 'assistant', content: 'msg3' }, uuid: randomUUID() },
    ];
    await writeSubagentTranscript(parentId, agentId, TEST_CWD, messages);

    const page = await readSubagentMessages(parentId, agentId, TEST_CWD, { limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
    expect((page[0].message as Record<string, unknown>).content).toBe('msg2');
    expect((page[1].message as Record<string, unknown>).content).toBe('msg3');
  });

  it('writeSubagentTranscript is no-op for empty message list', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const parentId = randomUUID();
    const agentId = `agent-noop`;
    await writeSubagentTranscript(parentId, agentId, TEST_CWD, []);
    const ids = await listSubagentIds(parentId, TEST_CWD);
    expect(ids).not.toContain(agentId);
  });

  it('multiple sub-agents under same parent are all listed', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const parentId = randomUUID();
    const agentA = `agent-${Date.now()}-a`;
    const agentB = `agent-${Date.now()}-b`;

    const msg: Record<string, unknown>[] = [
      { type: 'assistant', message: { role: 'assistant', content: 'hi' }, uuid: randomUUID() },
    ];
    await writeSubagentTranscript(parentId, agentA, TEST_CWD, msg);
    await writeSubagentTranscript(parentId, agentB, TEST_CWD, msg);

    const ids = await listSubagentIds(parentId, TEST_CWD);
    expect(ids).toContain(agentA);
    expect(ids).toContain(agentB);
    expect(ids).toHaveLength(2);
  });
});
