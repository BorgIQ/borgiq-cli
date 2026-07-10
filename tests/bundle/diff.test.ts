import { describe, expect, it } from 'vitest';

import {
  actorContentHash,
  diffCanvas,
  mergeForPull,
  summarizeDiff,
  toBatchOperations,
  toCanvasActorMutationData,
} from '../../src/lib/bundle/diff.js';
import type { BundleSyncActor, ExportedActor } from '../../src/lib/bundle/types.js';
import { makeActor, makeDoc } from './fixtures.js';

const actor = (id: string, version: number | undefined, name = id, extra: Record<string, unknown> = {}) => {
  const out = makeActor({ id, type: 'EchoActor', version, name, ...extra });
  if (version === undefined) delete out.version;
  return out;
};

const syncState = (source: ExportedActor, editVersion: number): BundleSyncActor => ({
  editVersion,
  contentHash: actorContentHash(source),
});

const verdictMap = (entries: ReturnType<typeof diffCanvas>['entries']) =>
  Object.fromEntries(entries.map((entry) => [entry.actorId, entry.verdict]));

describe('diffCanvas', () => {
  it('classifies the full three-way content and deletion matrix', () => {
    const baseline = {
      ACTRunchanged: actor('ACTRunchanged', 1, 'Same'),
      ACTRlocaledit: actor('ACTRlocaledit', 1, 'Base local'),
      ACTRserveredit: actor('ACTRserveredit', 1, 'Base server'),
      ACTRconcurrent: actor('ACTRconcurrent', 1, 'Base concurrent'),
      ACTRdeletedlocal: actor('ACTRdeletedlocal', 1, 'Delete locally'),
      ACTRdeletedserver: actor('ACTRdeletedserver', 1, 'Delete remotely'),
      ACTRlocaleditdelete: actor('ACTRlocaleditdelete', 1, 'Edit then remote delete'),
      ACTRservereditdelete: actor('ACTRservereditdelete', 1, 'Local delete then remote edit'),
      ACTRdeletedboth: actor('ACTRdeletedboth', 1, 'Deleted both'),
    };
    const local = makeDoc([
      baseline.ACTRunchanged,
      actor('ACTRlocaledit', 1, 'Local changed'),
      baseline.ACTRserveredit,
      actor('ACTRconcurrent', 1, 'Local concurrent'),
      actor('ACTRnewlocal', undefined, 'New local'),
      baseline.ACTRdeletedserver,
      actor('ACTRlocaleditdelete', 1, 'Local changed before delete'),
      actor('ACTRlegacyunknown', 1, 'Legacy local'),
    ]);
    const server = makeDoc([
      baseline.ACTRunchanged,
      baseline.ACTRlocaledit,
      actor('ACTRserveredit', 1, 'Server changed'),
      actor('ACTRconcurrent', 1, 'Server concurrent'),
      actor('ACTRnewserver', 1, 'New server'),
      baseline.ACTRdeletedlocal,
      actor('ACTRservereditdelete', 1, 'Server changed before delete'),
      actor('ACTRlegacyunknown', 1, 'Legacy server'),
    ]);
    const localActorStates = Object.fromEntries(
      Object.entries(baseline).map(([actorId, source]) => [actorId, syncState(source, 1)]),
    );

    const diff = diffCanvas(local, server, {
      localActorStates,
      serverActorVersions: {
        ACTRunchanged: 1,
        ACTRlocaledit: 1,
        ACTRserveredit: 2,
        ACTRconcurrent: 2,
        ACTRnewserver: 1,
        ACTRdeletedlocal: 1,
        ACTRservereditdelete: 2,
        ACTRlegacyunknown: 2,
      },
    });

    expect(verdictMap(diff.entries)).toEqual({
      ACTRconcurrent: 'concurrent-edit',
      ACTRdeletedboth: 'deleted-both',
      ACTRdeletedlocal: 'deleted-local',
      ACTRdeletedserver: 'deleted-on-server',
      ACTRlegacyunknown: 'baseline-missing',
      ACTRlocaledit: 'local-edit',
      ACTRlocaleditdelete: 'local-edit-server-delete',
      ACTRnewlocal: 'new-local',
      ACTRnewserver: 'new-server',
      ACTRserveredit: 'server-edit',
      ACTRservereditdelete: 'local-delete-server-edit',
      ACTRunchanged: 'unchanged',
    });
    expect(diff.pushConflicts.map((entry) => entry.actorId)).toEqual([
      'ACTRconcurrent',
      'ACTRdeletedserver',
      'ACTRlegacyunknown',
      'ACTRlocaleditdelete',
      'ACTRnewserver',
      'ACTRserveredit',
      'ACTRservereditdelete',
    ]);
    expect(diff.pullConflicts.map((entry) => entry.actorId)).toEqual([
      'ACTRconcurrent',
      'ACTRlegacyunknown',
      'ACTRlocaleditdelete',
      'ACTRservereditdelete',
    ]);
    expect(Object.keys(diff.entries[0])).toEqual([
      'actorId',
      'name',
      'verdict',
      'bundleVersion',
      'serverVersion',
    ]);
  });

  it('treats formatting-only object key reordering as unchanged', () => {
    const local = makeDoc([
      actor('ACTRsameformat', 1, 'Same', {
        configuration: { options: { b: 2, a: 1 } },
      }),
    ]);
    const server = makeDoc([
      actor('ACTRsameformat', 1, 'Same', {
        configuration: { options: { a: 1, b: 2 } },
      }),
    ]);

    expect(diffCanvas(local, server).entries[0].verdict).toBe('unchanged');
  });

  it('detects syncable metadata deltas and ignores informational fields', () => {
    const local = makeDoc([], {
      id: 'CNVSlocal',
      slug: 'local-slug',
      imagePath: '/local.png',
      name: 'Local name',
      runtimeSlug: 'runtime-a',
    });
    const server = makeDoc([], {
      id: 'CNVSserver',
      slug: 'server-slug',
      imagePath: '/server.png',
      name: 'Server name',
      runtimeSlug: '',
    });

    expect(diffCanvas(local, server).metadataDelta).toEqual({
      name: 'Local name',
      runtimeSlug: 'runtime-a',
    });
  });

  it('fails closed when a differing actor has no baseline metadata', () => {
    const local = makeDoc([actor('ACTRunknown', 1, 'Local name')]);
    const server = makeDoc([actor('ACTRunknown', 1, 'Server name')]);

    const diff = diffCanvas(local, server, { serverActorVersions: { ACTRunknown: 7 } });

    expect(diff.entries[0].verdict).toBe('baseline-missing');
    expect(diff.pushConflicts).toHaveLength(1);
    expect(diff.pullConflicts).toHaveLength(1);
  });

  it('counts forced conflict operations in the push summary', () => {
    const baseline = actor('ACTRforced', 1, 'Base');
    const local = makeDoc([actor('ACTRforced', 1, 'Local wins')]);
    const server = makeDoc([actor('ACTRforced', 1, 'Server changed')]);
    const diff = diffCanvas(local, server, {
      localActorStates: { ACTRforced: syncState(baseline, 1) },
      serverActorVersions: { ACTRforced: 2 },
    });

    expect(summarizeDiff(diff).updated).toBe(0);
    expect(summarizeDiff(diff, { forceLocal: true }).updated).toBe(1);
  });
});

describe('toBatchOperations', () => {
  it('orders adds before updates before removes and carries edit versions', () => {
    const baselineEdit = actor('ACTRlocaledit', 1, 'Server name');
    const baselineDelete = actor('ACTRdeletedlocal', 1, 'Delete me');
    const local = makeDoc([
      actor('ACTRnewlocal', undefined, 'New local'),
      actor('ACTRlocaledit', 1, 'Local name'),
    ]);
    const server = makeDoc([baselineEdit, baselineDelete]);

    expect(toBatchOperations(diffCanvas(local, server, {
      localActorStates: {
        ACTRlocaledit: syncState(baselineEdit, 1),
        ACTRdeletedlocal: syncState(baselineDelete, 4),
      },
      serverActorVersions: { ACTRlocaledit: 1, ACTRdeletedlocal: 4 },
    }), local, false, 123).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      timestamp: op.timestamp,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'add', actorId: 'ACTRnewlocal', timestamp: 123, editVersion: undefined },
      { type: 'update', actorId: 'ACTRlocaledit', timestamp: 123, editVersion: 1 },
      { type: 'remove', actorId: 'ACTRdeletedlocal', timestamp: 123, editVersion: 4 },
    ]);
  });

  it('projects local state into update, add, and remove operations with forceLocal', () => {
    const updateBase = actor('ACTRupdate', 1, 'Update base');
    const addBase = actor('ACTRadd', 1, 'Add base');
    const local = makeDoc([
      actor('ACTRupdate', 1, 'Local update'),
      actor('ACTRadd', 1, 'Local resurrection'),
    ]);
    const server = makeDoc([
      actor('ACTRupdate', 1, 'Server update'),
      actor('ACTRremove', 1, 'New server actor'),
    ]);

    expect(toBatchOperations(diffCanvas(local, server, {
      localActorStates: {
        ACTRupdate: syncState(updateBase, 1),
        ACTRadd: syncState(addBase, 1),
      },
      serverActorVersions: { ACTRupdate: 2, ACTRremove: 1 },
    }), local, true, 456).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'add', actorId: 'ACTRadd', editVersion: undefined },
      { type: 'update', actorId: 'ACTRupdate', editVersion: 2 },
      { type: 'remove', actorId: 'ACTRremove', editVersion: 1 },
    ]);
  });

  it('serializes actor mutation data into the CanvasActor API shape', () => {
    const source = actor('ACTRmutation', 1, 'Mutation', {
      configuration: {
        code: 'export default async function receive() { return {}; }\n',
        webhook: { triggerKey: '01key' },
        inputs: { message: '${{msg.message}}' },
        options: { allowNet: true, nested: { a: 1 } },
      },
      schemas: {
        inputs: { type: 'object' },
        passthrough: { stays: 'object' },
      },
    });

    const data = toCanvasActorMutationData(source);
    const configuration = data.configuration as Record<string, unknown>;
    const schemas = data.schemas as Record<string, unknown>;

    expect(typeof configuration.options).toBe('string');
    expect(typeof configuration.inputs).toBe('string');
    expect(configuration.options).toContain('allowNet: true');
    expect(configuration.webhook).toEqual({ triggerKey: '01key' });
    expect(typeof schemas.inputs).toBe('string');
    expect(schemas.passthrough).toEqual({ stays: 'object' });
    expect(source.configuration?.options).toEqual({ allowNet: true, nested: { a: 1 } });
  });
});

describe('mergeForPull', () => {
  it('fast-forwards server changes while keeping local edits, additions, and deletions', () => {
    const localEditBase = actor('ACTRlocaledit', 1, 'Local base');
    const localDeleteBase = actor('ACTRlocaldelete', 1, 'Delete locally');
    const serverEditBase = actor('ACTRserveredit', 1, 'Server base');
    const serverDeleteBase = actor('ACTRserverdelete', 1, 'Delete remotely');
    const local = makeDoc([
      actor('ACTRlocaledit', 1, 'Local kept'),
      actor('ACTRnewlocal', undefined, 'New local'),
      serverEditBase,
      serverDeleteBase,
    ]);
    const server = makeDoc([
      localEditBase,
      localDeleteBase,
      actor('ACTRserveredit', 1, 'Server changed'),
      actor('ACTRnewserver', 1, 'New server'),
    ], { name: 'Server canvas' });

    const diff = diffCanvas(local, server, {
      localActorStates: {
        ACTRlocaledit: syncState(localEditBase, 1),
        ACTRlocaldelete: syncState(localDeleteBase, 1),
        ACTRserveredit: syncState(serverEditBase, 1),
        ACTRserverdelete: syncState(serverDeleteBase, 1),
      },
      serverActorVersions: {
        ACTRlocaledit: 1,
        ACTRlocaldelete: 1,
        ACTRserveredit: 2,
        ACTRnewserver: 1,
      },
    });
    expect(diff.pullConflicts).toHaveLength(0);

    const merged = mergeForPull(local, server, diff);
    expect(Object.keys(merged.data.actors).sort()).toEqual([
      'ACTRlocaledit',
      'ACTRnewlocal',
      'ACTRnewserver',
      'ACTRserveredit',
    ]);
    expect(merged.data.actors.ACTRlocaledit.name).toBe('Local kept');
    expect(merged.data.actors.ACTRnewlocal.name).toBe('New local');
    expect(merged.data.actors.ACTRserveredit.name).toBe('Server changed');
    expect(merged.data.actors.ACTRnewserver.name).toBe('New server');
    expect(merged.metadata.name).toBe('Server canvas');
  });
});
