import { describe, expect, it } from 'vitest';

import {
  baselinesFrom,
  hasReactAppActors,
  patchOptionsFiles,
  planReactAppAssetPull,
  planReactAppAssetPush,
} from '../../src/lib/reactAppAssets.js';
import type { LocalAssetFile, ReactAppAssetBaselines, ServerAsset } from '../../src/lib/reactAppAssets.js';
import type { CanvasExportDocument } from '../../src/lib/bundle/types.js';
import { REACT_APP_ID, makeActor, makeDoc, makeReactAppActor } from './fixtures.js';

const HERO = 'src/assets/hero.png';
const SHA_LOCAL = 'a'.repeat(64);
const SHA_SERVER = 'b'.repeat(64);
const SHA_BASE = 'c'.repeat(64);
const ASSET_ID = 'ASET01hero000000000000000000000';

const docWithEntries = (files: { path: string; content: unknown }[]): CanvasExportDocument =>
  makeDoc([makeReactAppActor({ configuration: { codeDir: [], options: { files } } })]);

const heroEntry = { path: HERO, content: '${{ assets["hero.png"] }}' };

const localFile = (over: Partial<LocalAssetFile> = {}): LocalAssetFile => ({
  actorId: REACT_APP_ID,
  projectPath: HERO,
  bundlePath: `actors/triggers/react-app/${REACT_APP_ID}/code/${HERO}`,
  absPath: `/tmp/${HERO}`,
  sizeInBytes: 10,
  sha256: SHA_LOCAL,
  ...over,
});

const serverAsset = (over: Partial<ServerAsset> = {}): ServerAsset => ({
  id: ASSET_ID,
  key: 'hero.png',
  type: 'file',
  sha256: SHA_SERVER,
  ...over,
});

const baseline = (over: Partial<{ assetId: string; assetKey: string; sha256: string }> = {}): ReactAppAssetBaselines => ({
  [REACT_APP_ID]: { [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256: SHA_BASE, ...over } },
});

describe('push verdicts', () => {
  const plan = (over: Partial<Parameters<typeof planReactAppAssetPush>[0]> = {}) =>
    planReactAppAssetPush({
      doc: docWithEntries([heroEntry]),
      localAssets: [localFile()],
      baselines: baseline(),
      serverAssets: [serverAsset()],
      ...over,
    });

  it('local == server: unchanged, and still refreshes the baseline', () => {
    const result = plan({ serverAssets: [serverAsset({ sha256: SHA_LOCAL })] });
    expect(result.actions).toEqual([
      { kind: 'unchanged', actorId: REACT_APP_ID, projectPath: HERO, key: 'hero.png', assetId: ASSET_ID, sha256: SHA_LOCAL },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it('only local changed: update in place under the same key', () => {
    const result = plan({ baselines: baseline({ sha256: SHA_SERVER }) });
    expect(result.actions[0]).toMatchObject({ kind: 'update', assetId: ASSET_ID, key: 'hero.png' });
  });

  it('server moved since the baseline: conflict, fail closed', () => {
    const result = plan();
    expect(result.actions[0]).toMatchObject({ kind: 'conflict', detail: 'changed locally and in the workspace' });
    expect(result.conflicts).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/also changed in the workspace/);
  });

  it('no baseline and contents differ: conflict rather than a guess', () => {
    const result = plan({ baselines: {} });
    expect(result.actions[0]).toMatchObject({ kind: 'conflict', detail: 'no baseline; both sides may have changed' });
  });

  it('--force-local downgrades a conflict to an update', () => {
    const result = plan({ forceLocal: true });
    expect(result.actions[0]).toMatchObject({ kind: 'update', assetId: ASSET_ID });
    expect(result.conflicts).toEqual([]);
  });

  it('asset gone from the workspace: recreate under the same key', () => {
    const result = plan({ serverAssets: [] });
    expect(result.actions[0]).toMatchObject({ kind: 'upload-new', key: 'hero.png', hasEntry: true });
  });

  it('falls back to the key when the baselined id is gone', () => {
    const result = plan({ serverAssets: [serverAsset({ id: 'ASET01other00000000000000000000', sha256: SHA_LOCAL })] });
    expect(result.actions[0]).toMatchObject({ kind: 'unchanged', assetId: 'ASET01other00000000000000000000' });
  });

  it('local file with no entry: upload-new keyed by file name', () => {
    const result = plan({ doc: docWithEntries([]), baselines: {}, serverAssets: [] });
    expect(result.actions[0]).toMatchObject({ kind: 'upload-new', key: 'hero.png', hasEntry: false });
    expect(result.errors).toEqual([]);
  });

  it('key taken by identical content: adopt, which makes a retried push converge', () => {
    const result = plan({ doc: docWithEntries([]), baselines: {}, serverAssets: [serverAsset({ sha256: SHA_LOCAL })] });
    expect(result.actions[0]).toMatchObject({ kind: 'adopt', assetId: ASSET_ID, key: 'hero.png', hasEntry: false });
    expect(result.errors).toEqual([]);
  });

  it('key taken by different content: error naming both ways out', () => {
    const result = plan({ doc: docWithEntries([]), baselines: {}, serverAssets: [serverAsset()] });
    expect(result.actions[0]).toMatchObject({ kind: 'skip' });
    expect(result.errors[0]).toMatch(/already exists with different content/);
    expect(result.errors[0]).toMatch(/Rename the local file/);
  });

  it('local file deleted with a baseline: drop the entry, keep the asset', () => {
    const result = plan({ localAssets: [] });
    expect(result.actions).toEqual([{ kind: 'remove-entry', actorId: REACT_APP_ID, projectPath: HERO, key: 'hero.png' }]);
  });

  it('entry never materialized here: skip, so a hand-authored entry is not clobbered', () => {
    const result = plan({ localAssets: [], baselines: {} });
    expect(result.actions[0]).toMatchObject({ kind: 'skip', detail: expect.stringMatching(/run 'borgiq bundle pull' first/) });
  });

  it('ignores unmanaged entries entirely', () => {
    const result = plan({
      doc: docWithEntries([
        { path: 'src/assets/notes.txt', content: 'inline text' },
        { path: 'src/assets/logo.svg', content: { id: 'FILE1' } },
        { path: 'public/robots.txt', content: '${{ assets["robots.txt"] }}' },
      ]),
      localAssets: [],
      baselines: {},
    });
    expect(result.actions).toEqual([]);
  });

  it('makes no plan for a canvas with no react-app actors', () => {
    const doc = makeDoc([makeActor({ id: 'ACTR01deno0000000000000000000', type: 'DenoActor', configuration: { code: 'x' } })]);
    expect(hasReactAppActors(doc)).toBe(false);
    expect(planReactAppAssetPush({ doc, localAssets: [], baselines: {}, serverAssets: [] }).actions).toEqual([]);
  });
});

describe('pull verdicts', () => {
  const plan = (over: Partial<Parameters<typeof planReactAppAssetPull>[0]> = {}) =>
    planReactAppAssetPull({
      doc: docWithEntries([heroEntry]),
      localAssets: [localFile()],
      baselines: baseline(),
      serverAssets: [serverAsset()],
      ...over,
    });

  it('entry with no local file: download', () => {
    const result = plan({ localAssets: [] });
    expect(result.actions[0]).toMatchObject({
      kind: 'download',
      assetId: ASSET_ID,
      bundlePath: `actors/triggers/react-app/${REACT_APP_ID}/code/${HERO}`,
    });
  });

  it('local == server: unchanged', () => {
    expect(plan({ serverAssets: [serverAsset({ sha256: SHA_LOCAL })] }).actions[0]).toMatchObject({ kind: 'unchanged' });
  });

  it('only the server changed: fast-forward download', () => {
    const result = plan({ baselines: baseline({ sha256: SHA_LOCAL }) });
    expect(result.actions[0]).toMatchObject({ kind: 'download' });
  });

  it('only the local changed: keep it for the next push', () => {
    const result = plan({ baselines: baseline({ sha256: SHA_SERVER }) });
    expect(result.actions[0]).toMatchObject({ kind: 'keep-local', sha256: SHA_LOCAL });
  });

  it('both changed: conflict', () => {
    const result = plan();
    expect(result.actions[0]).toMatchObject({ kind: 'conflict' });
    expect(result.conflicts).toHaveLength(1);
  });

  it('--replace downgrades a conflict to a download', () => {
    const result = plan({ replace: true });
    expect(result.actions[0]).toMatchObject({ kind: 'download' });
    expect(result.conflicts).toEqual([]);
  });

  it('reference removed server-side and the local file is untouched: delete it', () => {
    const result = plan({ doc: docWithEntries([]), localAssets: [localFile({ sha256: SHA_BASE })] });
    expect(result.actions).toEqual([{
      kind: 'delete-local',
      actorId: REACT_APP_ID,
      projectPath: HERO,
      bundlePath: `actors/triggers/react-app/${REACT_APP_ID}/code/${HERO}`,
    }]);
  });

  it('reference removed server-side but the local file has changes: keep and warn', () => {
    const result = plan({ doc: docWithEntries([]) });
    expect(result.actions).toEqual([]);
    expect(result.warnings[0]).toMatch(/no longer referenced by the actor, but the local file has changes - kept/);
  });

  it('asset missing from the workspace: warn and skip', () => {
    const result = plan({ serverAssets: [] });
    expect(result.actions[0]).toMatchObject({ kind: 'skip', detail: 'asset not found in workspace' });
    expect(result.warnings[0]).toMatch(/no longer exists in this workspace/);
  });
});

describe('patchOptionsFiles', () => {
  it('appends an entry for a newly uploaded asset', () => {
    const doc = docWithEntries([]);
    const plan = planReactAppAssetPush({ doc, localAssets: [localFile()], baselines: {}, serverAssets: [] });

    patchOptionsFiles(doc, plan);

    expect((doc.data.actors[REACT_APP_ID].configuration!.options as { files: unknown[] }).files).toEqual([heroEntry]);
  });

  it('writes the bracket form even for a dot-form key', () => {
    const doc = docWithEntries([]);
    const local = localFile({ projectPath: 'src/assets/logo.svg', sha256: SHA_LOCAL });
    const plan = planReactAppAssetPush({ doc, localAssets: [local], baselines: {}, serverAssets: [] });

    patchOptionsFiles(doc, plan);

    expect((doc.data.actors[REACT_APP_ID].configuration!.options as { files: { content: string }[] }).files[0].content)
      .toBe('${{ assets["logo.svg"] }}');
  });

  it('removes a deleted asset entry and preserves the order of the rest', () => {
    const other = { path: 'src/assets/logo.svg', content: '${{ assets["logo.svg"] }}' };
    const inline = { path: 'public/robots.txt', content: 'User-agent: *' };
    const doc = docWithEntries([inline, heroEntry, other]);
    const plan = planReactAppAssetPush({
      doc,
      localAssets: [localFile({ projectPath: 'src/assets/logo.svg' })],
      baselines: {
        [REACT_APP_ID]: {
          [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256: SHA_BASE },
          'src/assets/logo.svg': { assetId: 'ASET01logo000000000000000000000', assetKey: 'logo.svg', sha256: SHA_LOCAL },
        },
      },
      serverAssets: [serverAsset({ id: 'ASET01logo000000000000000000000', key: 'logo.svg', sha256: SHA_LOCAL })],
    });

    patchOptionsFiles(doc, plan);

    expect((doc.data.actors[REACT_APP_ID].configuration!.options as { files: unknown[] }).files).toEqual([inline, other]);
  });

  it('leaves a document with nothing to patch untouched', () => {
    const doc = docWithEntries([heroEntry]);
    const before = JSON.stringify(doc);
    patchOptionsFiles(doc, planReactAppAssetPush({
      doc,
      localAssets: [localFile()],
      baselines: baseline(),
      serverAssets: [serverAsset({ sha256: SHA_LOCAL })],
    }));
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('baselinesFrom', () => {
  it('groups synced assets by actor and path', () => {
    expect(baselinesFrom([
      { actorId: REACT_APP_ID, projectPath: HERO, assetId: ASSET_ID, assetKey: 'hero.png', sha256: SHA_LOCAL },
      { actorId: REACT_APP_ID, projectPath: 'src/assets/logo.svg', assetId: 'ASET2', assetKey: 'logo.svg', sha256: SHA_SERVER },
    ])).toEqual({
      [REACT_APP_ID]: {
        [HERO]: { assetId: ASSET_ID, assetKey: 'hero.png', sha256: SHA_LOCAL },
        'src/assets/logo.svg': { assetId: 'ASET2', assetKey: 'logo.svg', sha256: SHA_SERVER },
      },
    });
  });
});
