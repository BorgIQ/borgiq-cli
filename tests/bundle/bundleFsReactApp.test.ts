import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBundleDir, readBundleDirDetailed, writeBundleDir, writeBundleDirIncremental } from '../../src/lib/bundleFs.js';
import { REACT_APP_SDK_FILES, SDK_PLACEHOLDER_DIR } from '../../src/lib/bundle/reactAppSdk.js';

const ACTOR_ID = 'ACTR01reactapp000000000000000';
const PROJECT = `actors/triggers/react-app/${ACTOR_ID}/code`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-react-app-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The bundle's managed text: what a pull would write and a push would read back. */
const MANAGED = {
  'canvas.yaml': 'format: borgiq.canvas.bundle\n',
  [`actors/triggers/react-app/${ACTOR_ID}/actor.yaml`]: 'id: ACTR1\n',
  [`${PROJECT}/package.json`]: '{ "name": "app" }\n',
  [`${PROJECT}/src/App.tsx`]: 'export default () => null\n',
};

/** A 1x1 PNG - real binary, with a NUL byte and invalid UTF-8 sequences. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const writeLocal = (rel: string, content: string | Buffer): string => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

/** Everything a user's local tooling creates that the CLI must never disturb. */
const seedLocalDevState = (): void => {
  writeLocal(`${PROJECT}/src/assets/hero.png`, PNG);
  writeLocal(`${PROJECT}/node_modules/react/index.js`, 'module.exports = {}\n');
  writeLocal(`${PROJECT}/node_modules/.bin/vite`, '#!/bin/sh\n');
  writeLocal(`${PROJECT}/dist/assets/index.js`, 'built\n');
  writeLocal(`${PROJECT}/.vite/deps/react.js`, 'cached\n');
  writeLocal(`${PROJECT}/package-lock.json`, '{ "lockfileVersion": 3 }\n');
  writeLocal(`${PROJECT}/deno.lock`, '{}\n');
  writeLocal(`${PROJECT}/.DS_Store`, 'junk\n');
  writeLocal(`${PROJECT}/.env.local`, 'VITE_KEY=secret\n');
  writeLocal(`${PROJECT}/${SDK_PLACEHOLDER_DIR}/index.js`, 'export const version = "2.0.0"\n');
};

const localDevStateSurvives = (): void => {
  expect(fs.readFileSync(path.join(dir, `${PROJECT}/src/assets/hero.png`))).toEqual(PNG);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/node_modules/react/index.js`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/node_modules/.bin/vite`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/dist/assets/index.js`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/.vite/deps/react.js`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/package-lock.json`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/deno.lock`))).toBe(true);
  expect(fs.existsSync(path.join(dir, `${PROJECT}/.env.local`))).toBe(true);
  expect(fs.readFileSync(path.join(dir, `${PROJECT}/${SDK_PLACEHOLDER_DIR}/index.js`), 'utf-8'))
    .toBe('export const version = "2.0.0"\n');
};

describe('readBundleDirDetailed: react-app channel classification', () => {
  it('collects asset files without ever reading their bytes into the map', () => {
    writeBundleDir(dir, MANAGED);
    const abs = writeLocal(`${PROJECT}/src/assets/hero.png`, PNG);
    writeLocal(`${PROJECT}/src/assets/icons/logo.svg`, '<svg/>\n');

    const { files, assets } = readBundleDirDetailed(dir);

    expect(files).toEqual(MANAGED);
    expect(assets).toEqual([
      { actorId: ACTOR_ID, projectPath: 'src/assets/hero.png', bundlePath: `${PROJECT}/src/assets/hero.png`, absPath: abs, sizeInBytes: PNG.length },
      { actorId: ACTOR_ID, projectPath: 'src/assets/icons/logo.svg', bundlePath: `${PROJECT}/src/assets/icons/logo.svg`, absPath: path.join(dir, `${PROJECT}/src/assets/icons/logo.svg`), sizeInBytes: 7 },
    ]);
  });

  it('skips a binary outside the asset directory with guidance, and keeps it out of the map', () => {
    writeBundleDir(dir, MANAGED);
    writeLocal(`${PROJECT}/public/favicon.ico`, PNG);

    const { files, skipped } = readBundleDirDetailed(dir);

    expect(files).toEqual(MANAGED);
    expect(skipped).toEqual([
      { bundlePath: `${PROJECT}/public/favicon.ico`, reason: 'binary', message: expect.stringMatching(/not UTF-8 text and is ignored - move it under/) },
    ]);
  });

  it('skips ignored files, and reports env files with a warning', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();

    const { files, skipped } = readBundleDirDetailed(dir);
    const byPath = Object.fromEntries(skipped.map((entry) => [entry.bundlePath, entry]));

    expect(files).toEqual(MANAGED);
    expect(byPath[`${PROJECT}/package-lock.json`].reason).toBe('ignored');
    expect(byPath[`${PROJECT}/deno.lock`].reason).toBe('ignored');
    expect(byPath[`${PROJECT}/.DS_Store`].reason).toBe('ignored');
    expect(byPath[`${PROJECT}/.env.local`]).toEqual({
      bundlePath: `${PROJECT}/.env.local`,
      reason: 'env-warning',
      message: expect.stringMatching(/VITE_\*/),
    });
  });

  it('never descends into ignored directories', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();

    const { files, skipped } = readBundleDirDetailed(dir);
    const touched = [...Object.keys(files), ...skipped.map((entry) => entry.bundlePath)];

    expect(touched.some((rel) => rel.includes('/node_modules/'))).toBe(false);
    expect(touched.some((rel) => rel.includes('/dist/'))).toBe(false);
    expect(touched.some((rel) => rel.includes('/.vite/'))).toBe(false);
    expect(touched.some((rel) => rel.includes(SDK_PLACEHOLDER_DIR))).toBe(false);
  });

  it('accepts valid UTF-8 source verbatim and treats invalid bytes as binary', () => {
    writeBundleDir(dir, MANAGED);
    writeLocal(`${PROJECT}/src/emoji.tsx`, 'export const label = "héllo 🎉"\n');
    writeLocal(`${PROJECT}/src/broken.tsx`, Buffer.from([0x69, 0x6d, 0x70, 0xff, 0xfe, 0x0a]));
    writeLocal(`${PROJECT}/src/nul.tsx`, Buffer.from('const a = 1;\0\n', 'utf-8'));

    const { files, skipped } = readBundleDirDetailed(dir);

    expect(files[`${PROJECT}/src/emoji.tsx`]).toBe('export const label = "héllo 🎉"\n');
    expect(skipped.map((entry) => entry.bundlePath).sort())
      .toEqual([`${PROJECT}/src/broken.tsx`, `${PROJECT}/src/nul.tsx`]);
  });

  it('classifies only react-app project paths, leaving other actors untouched', () => {
    writeBundleDir(dir, { ...MANAGED, 'actors/tasks/deno/ACTR2/code/mod.ts': 'export default 1\n' });
    writeLocal('actors/tasks/deno/ACTR2/code/node_modules/x/index.js', 'x\n');

    const { files } = readBundleDirDetailed(dir);

    expect(files['actors/tasks/deno/ACTR2/code/mod.ts']).toBe('export default 1\n');
    expect(files['actors/tasks/deno/ACTR2/code/node_modules/x/index.js']).toBe('x\n');
  });

  it('readBundleDir stays a thin wrapper over the same classification', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();
    expect(readBundleDir(dir)).toEqual(readBundleDirDetailed(dir).files);
    expect(readBundleDir(dir)).toEqual(MANAGED);
  });
});

describe('local dev state survives every write (R2)', () => {
  it('an incremental pull-style write never deletes assets, ignored files, or the SDK stub', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();

    // A pull where the server dropped a source file: its deletion must not take anything else.
    const next = { ...MANAGED };
    delete next[`${PROJECT}/src/App.tsx`];
    const plan = writeBundleDirIncremental(dir, next);

    expect(plan.delete).toEqual([`${PROJECT}/src/App.tsx`]);
    localDevStateSurvives();
  });

  it('a --replace write never deletes assets, ignored files, or the SDK stub', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();

    const next = {
      'canvas.yaml': 'format: borgiq.canvas.bundle\n',
      [`actors/triggers/react-app/${ACTOR_ID}/actor.yaml`]: 'id: ACTR1\n',
      [`${PROJECT}/package.json`]: '{ "name": "renamed" }\n',
    };
    writeBundleDir(dir, next, { force: true });

    expect(readBundleDir(dir)).toEqual(next);
    expect(fs.existsSync(path.join(dir, `${PROJECT}/src/App.tsx`))).toBe(false);
    localDevStateSurvives();
  });

  it('keeps the working directory of an actor the canvas no longer has, and says so', () => {
    writeBundleDir(dir, MANAGED);
    seedLocalDevState();

    const next = { 'canvas.yaml': 'format: borgiq.canvas.bundle\n' };
    const { leftover } = writeBundleDir(dir, next, { force: true });

    expect(leftover).toEqual([`actors/triggers/react-app/${ACTOR_ID}`]);
    localDevStateSurvives();
  });

  it('prunes emptied directories but stops at one holding local dev state', () => {
    writeBundleDir(dir, { ...MANAGED, 'actors/tasks/deno/ACTR2/code/mod.ts': 'export default 1\n' });
    seedLocalDevState();

    writeBundleDir(dir, { 'canvas.yaml': 'format: borgiq.canvas.bundle\n' }, { force: true });

    expect(fs.existsSync(path.join(dir, 'actors/tasks/deno'))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${PROJECT}/node_modules`))).toBe(true);
  });

  it('a re-pull rewrites source without touching an asset of the same name', () => {
    writeBundleDir(dir, MANAGED);
    writeLocal(`${PROJECT}/src/assets/hero.png`, PNG);

    writeBundleDirIncremental(dir, { ...MANAGED, [`${PROJECT}/src/App.tsx`]: 'export default () => <img />\n' });

    expect(fs.readFileSync(path.join(dir, `${PROJECT}/src/assets/hero.png`))).toEqual(PNG);
    expect(readBundleDir(dir)[`${PROJECT}/src/App.tsx`]).toBe('export default () => <img />\n');
  });
});

describe('SDK placeholder', () => {
  it('materializes write-once through createIfMissing and is never read back', () => {
    const companions = Object.fromEntries(
      Object.entries(REACT_APP_SDK_FILES).map(([name, content]) => [`${PROJECT}/${SDK_PLACEHOLDER_DIR}/${name}`, content]),
    );
    writeBundleDir(dir, MANAGED, { createIfMissing: companions });

    const packageJson = path.join(dir, `${PROJECT}/${SDK_PLACEHOLDER_DIR}/package.json`);
    expect(JSON.parse(fs.readFileSync(packageJson, 'utf-8')).name).toBe('@borgiq/actors');
    expect(readBundleDir(dir)).toEqual(MANAGED);

    // A user edit survives a later write, and the stub is not re-created over it.
    fs.writeFileSync(packageJson, '{ "name": "mine" }\n');
    writeBundleDirIncremental(dir, MANAGED, { createIfMissing: companions });
    expect(fs.readFileSync(packageJson, 'utf-8')).toBe('{ "name": "mine" }\n');
  });

  it('ships a resolvable @borgiq/actors package', () => {
    const manifest = JSON.parse(REACT_APP_SDK_FILES['package.json']);
    expect(manifest.name).toBe('@borgiq/actors');
    expect(manifest.main).toBe('./index.js');
    expect(manifest.types).toBe('./index.d.ts');
    expect(manifest.peerDependencies.react).toBeDefined();
    for (const entry of ['index.js', 'index.d.ts', 'generated.js', 'generated.d.ts']) {
      expect(REACT_APP_SDK_FILES[entry]).toBeTruthy();
    }
    expect(REACT_APP_SDK_FILES['index.js']).toContain('export function useEndpoint');
    expect(REACT_APP_SDK_FILES['index.d.ts']).toContain('export declare function useEndpoint');
  });
});
