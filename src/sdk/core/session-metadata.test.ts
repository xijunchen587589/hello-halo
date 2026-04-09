/**
 * Unit tests for session metadata sidecar (renameSession / tagSession).
 *
 * Uses a temp directory for CLAUDE_CONFIG_DIR so tests don't pollute the
 * user's real session store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Dynamic import of the tested functions to allow env override before load
// ---------------------------------------------------------------------------

// Import after setting env so getClaudeConfigDir picks up our temp dir.
// We import directly (not via the re-export chain) so we don't need the full
// SDK to be bootable.
import {
  renameSession,
  tagSession,
  getSessionInfo,
  listSessions,
} from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir = '';
let savedConfigDir: string | undefined;

/** Create a minimal (empty) transcript file so the session is "visible". */
async function createFakeTranscript(cwd: string, sessionId: string): Promise<void> {
  // Mirror the path logic from transcript.ts
  const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(tmpDir, 'projects', projectDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), '', 'utf-8');
}

beforeEach(async () => {
  // Create a fresh temp directory and redirect CLAUDE_CONFIG_DIR
  tmpDir = await mkdtemp(join(tmpdir(), 'sdk-meta-test-'));
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
});

afterEach(async () => {
  // Restore env and remove temp directory
  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renameSession', () => {
  it('writes a custom title to the metadata sidecar', async () => {
    const cwd = '/test/project';
    const sessionId = 'aaaaaaaa-0000-0000-0000-000000000001';
    await createFakeTranscript(cwd, sessionId);

    await renameSession(sessionId, 'My Custom Title', { cwd });

    const info = await getSessionInfo(sessionId, { cwd });
    expect(info).toBeDefined();
    expect(info?.customTitle).toBe('My Custom Title');
  });

  it('overwrites an existing title', async () => {
    const cwd = '/test/project';
    const sessionId = 'aaaaaaaa-0000-0000-0000-000000000002';
    await createFakeTranscript(cwd, sessionId);

    await renameSession(sessionId, 'First Title', { cwd });
    await renameSession(sessionId, 'Updated Title', { cwd });

    const info = await getSessionInfo(sessionId, { cwd });
    expect(info?.customTitle).toBe('Updated Title');
  });

  it('does not throw when transcript does not exist', async () => {
    // No transcript created — renameSession should be silent
    await expect(
      renameSession('nonexistent-session', 'Title', { cwd: '/missing' }),
    ).resolves.toBeUndefined();
  });
});

describe('tagSession', () => {
  it('writes a tag to the metadata sidecar', async () => {
    const cwd = '/test/project';
    const sessionId = 'bbbbbbbb-0000-0000-0000-000000000001';
    await createFakeTranscript(cwd, sessionId);

    await tagSession(sessionId, 'important', { cwd });

    const info = await getSessionInfo(sessionId, { cwd });
    expect(info?.tag).toBe('important');
  });

  it('clears the tag when null is passed', async () => {
    const cwd = '/test/project';
    const sessionId = 'bbbbbbbb-0000-0000-0000-000000000002';
    await createFakeTranscript(cwd, sessionId);

    await tagSession(sessionId, 'to-remove', { cwd });
    await tagSession(sessionId, null, { cwd });

    const info = await getSessionInfo(sessionId, { cwd });
    expect(info?.tag).toBeUndefined();
  });

  it('title and tag can coexist in the sidecar', async () => {
    const cwd = '/test/project';
    const sessionId = 'bbbbbbbb-0000-0000-0000-000000000003';
    await createFakeTranscript(cwd, sessionId);

    await renameSession(sessionId, 'My Session', { cwd });
    await tagSession(sessionId, 'wip', { cwd });

    const info = await getSessionInfo(sessionId, { cwd });
    expect(info?.customTitle).toBe('My Session');
    expect(info?.tag).toBe('wip');
  });
});

describe('listSessions with metadata', () => {
  it('includes customTitle from sidecar in listing', async () => {
    const cwd = '/test/project';
    const s1 = 'cccccccc-0000-0000-0000-000000000001';
    const s2 = 'cccccccc-0000-0000-0000-000000000002';
    await createFakeTranscript(cwd, s1);
    await createFakeTranscript(cwd, s2);

    await renameSession(s1, 'Session One', { cwd });
    await tagSession(s2, 'archived', { cwd });

    const sessions = await listSessions({ cwd });
    const info1 = sessions.find(s => s.sessionId === s1);
    const info2 = sessions.find(s => s.sessionId === s2);

    expect(info1?.customTitle).toBe('Session One');
    expect(info1?.tag).toBeUndefined();
    expect(info2?.customTitle).toBeUndefined();
    expect(info2?.tag).toBe('archived');
  });
});
