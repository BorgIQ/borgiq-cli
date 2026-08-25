import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  planBundleDirIncrementalWrite,
  readBundleDir,
  readBundleDirDetailed,
  writeBundleDir,
  writeBundleDirIncremental,
} from '../../src/lib/bundleFs.js';

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
  'actors/tasks/deno/ACTR1/code/main.ts': 'export default 1;\n',
};

const writeLocal = (rel: string, content: string | Buffer): void => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
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
    writeBundleDir(dir, next, { force: true });
    expect(readBundleDir(dir)).toEqual(next);
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf-8')).toBe('mine\n');
    expect(fs.existsSync(path.join(dir, '.git', 'HEAD'))).toBe(true);
  });

  it('createIfMissing writes companions once and never overwrites them', () => {
    writeBundleDir(dir, FILES, { createIfMissing: { 'AGENTS.md': 'v1\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
    writeBundleDir(dir, FILES, { force: true, createIfMissing: { 'AGENTS.md': 'v2\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
  });

  it('refuses a non-empty non-bundle directory without force, allows with force', () => {
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x\n');
    expect(() => writeBundleDir(dir, FILES)).toThrow(/--force/);
    writeBundleDir(dir, FILES, { force: true });
    expect(fs.readFileSync(path.join(dir, 'unrelated.txt'), 'utf-8')).toBe('x\n');
    expect(readBundleDir(dir)).toEqual(FILES);
  });

  it('refuses to overwrite an existing bundle without force', () => {
    writeBundleDir(dir, FILES);
    expect(() => writeBundleDir(dir, FILES)).toThrow(/--force/);
  });

  it('overwrites an existing bundle with force', () => {
    writeBundleDir(dir, FILES);
    const next = { 'canvas.yaml': 'format: borgiq.canvas.bundle\n', 'actors/other/echo/ACTR2/actor.yaml': 'id: ACTR2\n' };
    writeBundleDir(dir, next, { force: true });
    expect(readBundleDir(dir)).toEqual(next);
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
      'actors/tasks/deno/ACTR1/code/main.ts',
    ]);
    expect(readBundleDir(dir)).toEqual(next);
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf-8')).toBe('mine\n');
  });
});

describe('code actor project trees', () => {
  const DENO = 'actors/tasks/deno/ACTR1/code';
  const PYTHON = 'actors/tasks/python/ACTR2/code';

  const PYTHON_FILES = {
    ...FILES,
    'actors/tasks/python/ACTR2/actor.yaml': 'id: ACTR2\n',
    [`${PYTHON}/main.py`]: 'def receive():\n    return {}\n',
  };

  /** Everything local tooling leaves in a code actor's project that the CLI must not touch. */
  const seedLocalDevState = (): void => {
    writeLocal(`${DENO}/node_modules/x/index.js`, 'module.exports = {}\n');
    writeLocal(`${DENO}/dist/bundle.js`, 'built\n');
    writeLocal(`${DENO}/deno.lock`, '{}\n');
    writeLocal(`${PYTHON}/.venv/lib/site.py`, 'venv\n');
    writeLocal(`${PYTHON}/lib/__pycache__/greeting.pyc`, 'cached\n');
    writeLocal(`${PYTHON}/uv.lock`, 'lock\n');
    writeLocal(`${PYTHON}/.env`, 'TOKEN=secret\n');
  };

  it('reads the source tree and skips each language\'s local tooling output', () => {
    writeBundleDir(dir, PYTHON_FILES);
    writeLocal(`${DENO}/lib/deep/util.ts`, 'export const x = 1;\n');
    writeLocal(`${PYTHON}/lib/greeting.py`, 'def greeting():\n    return 1\n');
    seedLocalDevState();

    const { files, assets, skipped } = readBundleDirDetailed(dir);

    expect(files[`${DENO}/lib/deep/util.ts`]).toBe('export const x = 1;\n');
    expect(files[`${PYTHON}/lib/greeting.py`]).toBe('def greeting():\n    return 1\n');
    for (const ignored of [
      `${DENO}/node_modules/x/index.js`,
      `${DENO}/dist/bundle.js`,
      `${DENO}/deno.lock`,
      `${PYTHON}/.venv/lib/site.py`,
      `${PYTHON}/lib/__pycache__/greeting.pyc`,
      `${PYTHON}/uv.lock`,
    ]) {
      expect(files[ignored]).toBeUndefined();
    }
    // Assets are a react-app channel; a code actor has none.
    expect(assets).toEqual([]);
    expect(skipped).toContainEqual(expect.objectContaining({
      bundlePath: `${PYTHON}/.env`,
      reason: 'env-warning',
      message: expect.stringContaining('readable by anyone who can open the canvas'),
    }));
  });

  it('skips a binary file with a text-only message instead of corrupting it', () => {
    writeBundleDir(dir, FILES);
    writeLocal(`${DENO}/logo.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));

    const { files, skipped } = readBundleDirDetailed(dir);

    expect(files[`${DENO}/logo.png`]).toBeUndefined();
    expect(skipped).toContainEqual(expect.objectContaining({
      bundlePath: `${DENO}/logo.png`,
      reason: 'binary',
      message: expect.stringContaining('text only'),
    }));
  });

  it('never deletes local tooling output when a source file disappears', () => {
    writeBundleDir(dir, PYTHON_FILES);
    seedLocalDevState();

    const next = { ...PYTHON_FILES };
    delete next[`${PYTHON}/main.py`];
    const plan = writeBundleDirIncremental(dir, next);

    expect(plan.delete).toEqual([`${PYTHON}/main.py`]);
    for (const kept of [
      `${DENO}/node_modules/x/index.js`,
      `${DENO}/deno.lock`,
      `${PYTHON}/.venv/lib/site.py`,
      `${PYTHON}/uv.lock`,
      `${PYTHON}/.env`,
    ]) {
      expect(fs.existsSync(path.join(dir, kept))).toBe(true);
    }
  });
});
