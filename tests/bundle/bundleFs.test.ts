import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { planBundleDirIncrementalWrite, readBundleDir, writeBundleDir, writeBundleDirIncremental } from '../../src/lib/bundleFs.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const FILES = {
  'canvas.yaml': 'format: borgiq.canvas.bundle\n',
  'actors/tasks/deno/ACTR1/actor.yaml': 'id: ACTR1\n',
  'actors/tasks/deno/ACTR1/code/mod.ts': 'export default 1;\n',
};

describe('writeBundleDir and readBundleDir', () => {
  it('round-trips a file map through disk', () => {
    writeBundleDir(dir, FILES);
    expect(readBundleDir(dir)).toEqual(FILES);
  });

  it('readBundleDir rejects a directory without canvas.yaml', () => {
    expect(() => readBundleDir(dir)).toThrow(/not a canvas bundle/);
  });

  it('rewrites managed paths only', () => {
    writeBundleDir(dir, FILES);
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'mine\n');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref\n');

    const next = { 'canvas.yaml': 'format: borgiq.canvas.bundle\n', 'actors/other/echo/ACTR2/actor.yaml': 'id: ACTR2\n' };
    writeBundleDir(dir, next);
    expect(readBundleDir(dir)).toEqual(next);
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf-8')).toBe('mine\n');
    expect(fs.existsSync(path.join(dir, '.git', 'HEAD'))).toBe(true);
  });

  it('createIfMissing writes companions once and never overwrites them', () => {
    writeBundleDir(dir, FILES, { createIfMissing: { 'AGENTS.md': 'v1\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
    writeBundleDir(dir, FILES, { createIfMissing: { 'AGENTS.md': 'v2\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
  });

  it('refuses a non-empty non-bundle directory without force, allows with force', () => {
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x\n');
    expect(() => writeBundleDir(dir, FILES)).toThrow(/--force/);
    writeBundleDir(dir, FILES, { force: true });
    expect(fs.readFileSync(path.join(dir, 'unrelated.txt'), 'utf-8')).toBe('x\n');
    expect(readBundleDir(dir)).toEqual(FILES);
  });

  it('overwrites an existing bundle without force', () => {
    writeBundleDir(dir, FILES);
    expect(() => writeBundleDir(dir, FILES)).not.toThrow();
  });

  it('rejects file-map paths that escape the target directory', () => {
    expect(() => writeBundleDir(dir, { 'canvas.yaml': 'x\n', '../escape.txt': 'x\n' })).toThrow(/escape/i);
  });

  it('incremental writes leave identical files untouched', async () => {
    writeBundleDir(dir, FILES);
    const actorPath = path.join(dir, 'actors/tasks/deno/ACTR1/actor.yaml');
    const before = fs.statSync(actorPath).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(planBundleDirIncrementalWrite(dir, FILES)).toEqual({ write: [], delete: [] });
    expect(writeBundleDirIncremental(dir, FILES)).toEqual({ write: [], delete: [] });
    expect(fs.statSync(actorPath).mtimeMs).toBe(before);
  });

  it('incremental writes delete vanished actor files and preserve unmanaged paths', () => {
    writeBundleDir(dir, FILES);
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'mine\n');
    const next = {
      'canvas.yaml': 'format: borgiq.canvas.bundle\n',
      'actors/other/echo/ACTR2/actor.yaml': 'id: ACTR2\n',
    };

    const plan = writeBundleDirIncremental(dir, next);
    expect(plan.write).toEqual(['actors/other/echo/ACTR2/actor.yaml']);
    expect(plan.delete).toEqual([
      'actors/tasks/deno/ACTR1/actor.yaml',
      'actors/tasks/deno/ACTR1/code/mod.ts',
    ]);
    expect(readBundleDir(dir)).toEqual(next);
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf-8')).toBe('mine\n');
  });
});
