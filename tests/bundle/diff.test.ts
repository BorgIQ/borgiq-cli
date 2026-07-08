import { describe, expect, it } from 'vitest';

import { diffCanvas, mergeForPull, toBatchOperations, toCanvasActorMutationData } from '../../src/lib/bundle/diff.js';
import { makeActor, makeDoc } from './fixtures.js';

const actor = (id: string, version: number | undefined, name = id, extra: Record<string, unknown> = {}) => {
  const out = makeActor({ id, type: 'EchoActor', version, name, ...extra });
  if (version === undefined) delete out.version;
  return out;
};

const verdictMap = (entries: ReturnType<typeof diffCanvas>['entries']) =>
  Object.fromEntries(entries.map((entry) => [entry.actorId, entry.verdict]));

describe('diffCanvas', () => {
  it('classifies the sync verdict matrix', () => {
    const local = makeDoc([
      actor('ACTRunchanged', 2, 'Same'),
      actor('ACTRlocaledit', 1, 'Local name'),
      actor('ACTRserveredit', 1, 'Old local'),
      actor('ACTRmissingversion', undefined, 'No version local'),
      actor('ACTRnewlocal', undefined, 'New local'),
      actor('ACTRdeletedserver', 3, 'Deleted on server'),
    ]);
    const server = makeDoc([
      actor('ACTRunchanged', 5, 'Same'),
      actor('ACTRlocaledit', 1, 'Server name'),
      actor('ACTRserveredit', 2, 'New server'),
      actor('ACTRmissingversion', 1, 'Server exists'),
      actor('ACTRserveronly', 4, 'Server only'),
    ]);

    expect(verdictMap(diffCanvas(local, server, {
      localActorVersions: {
        ACTRunchanged: 2,
        ACTRlocaledit: 1,
        ACTRserveredit: 1,
        ACTRdeletedserver: 3,
      },
      serverActorVersions: {
        ACTRunchanged: 5,
        ACTRlocaledit: 1,
        ACTRserveredit: 2,
        ACTRmissingversion: 1,
        ACTRserveronly: 4,
      },
    }).entries)).toEqual({
      ACTRdeletedserver: 'deleted-on-server',
      ACTRlocaledit: 'local-edit',
      ACTRmissingversion: 'version-missing',
      ACTRnewlocal: 'new-local',
      ACTRserveredit: 'server-edit',
      ACTRserveronly: 'server-only',
      ACTRunchanged: 'unchanged',
    });
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

  it('can assume current server edit versions for bundles written before sync metadata existed', () => {
    const local = makeDoc([actor('ACTRlegacy', 1, 'Local name')]);
    const server = makeDoc([actor('ACTRlegacy', 1, 'Server name')]);

    const diff = diffCanvas(local, server, {
      serverActorVersions: { ACTRlegacy: 7 },
      assumeServerVersionsWhenLocalMissing: true,
    });

    expect(diff.entries[0]).toMatchObject({
      actorId: 'ACTRlegacy',
      verdict: 'local-edit',
      bundleVersion: 7,
      serverVersion: 7,
    });
  });
});

describe('toBatchOperations', () => {
  it('orders adds before updates before removes and carries edit versions', () => {
    const local = makeDoc([
      actor('ACTRnewlocal', undefined, 'New local'),
      actor('ACTRlocaledit', 1, 'Local name'),
    ]);
    const server = makeDoc([
      actor('ACTRlocaledit', 1, 'Server name'),
      actor('ACTRserveronly', 4, 'Server only'),
    ]);

    expect(toBatchOperations(diffCanvas(local, server, {
      localActorVersions: { ACTRlocaledit: 1 },
      serverActorVersions: { ACTRlocaledit: 1, ACTRserveronly: 4 },
    }), local, false, 123).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      timestamp: op.timestamp,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'add', actorId: 'ACTRnewlocal', timestamp: 123, editVersion: undefined },
      { type: 'update', actorId: 'ACTRlocaledit', timestamp: 123, editVersion: 1 },
      { type: 'remove', actorId: 'ACTRserveronly', timestamp: 123, editVersion: 4 },
    ]);
  });

  it('turns conflicted actors into updates when forceLocal is set', () => {
    const local = makeDoc([
      actor('ACTRserveredit', 1, 'Local wins'),
      actor('ACTRmissingversion', undefined, 'Local without version'),
    ]);
    const server = makeDoc([
      actor('ACTRserveredit', 2, 'Server changed'),
      actor('ACTRmissingversion', 3, 'Server exists'),
    ]);

    expect(toBatchOperations(diffCanvas(local, server, {
      localActorVersions: { ACTRserveredit: 1 },
      serverActorVersions: { ACTRserveredit: 2, ACTRmissingversion: 3 },
    }), local, true, 456).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      timestamp: op.timestamp,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'update', actorId: 'ACTRmissingversion', timestamp: 456, editVersion: 3 },
      { type: 'update', actorId: 'ACTRserveredit', timestamp: 456, editVersion: 2 },
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
  it('keeps local edits and new local actors while taking server changes', () => {
    const local = makeDoc([
      actor('ACTRlocaledit', 1, 'Local kept'),
      actor('ACTRnewlocal', undefined, 'New local'),
      actor('ACTRdeletedserver', 1, 'Gone remotely'),
    ]);
    const server = makeDoc([
      actor('ACTRlocaledit', 1, 'Server old'),
      actor('ACTRserveronly', 2, 'Server only'),
    ], { name: 'Server canvas' });

    const merged = mergeForPull(local, server, diffCanvas(local, server, {
      localActorVersions: { ACTRlocaledit: 1, ACTRdeletedserver: 1 },
      serverActorVersions: { ACTRlocaledit: 1, ACTRserveronly: 2 },
    }));
    expect(Object.keys(merged.data.actors).sort()).toEqual(['ACTRlocaledit', 'ACTRnewlocal', 'ACTRserveronly']);
    expect(merged.data.actors.ACTRlocaledit.name).toBe('Local kept');
    expect(merged.data.actors.ACTRnewlocal.name).toBe('New local');
    expect(merged.data.actors.ACTRserveronly.name).toBe('Server only');
    expect(merged.metadata.name).toBe('Server canvas');
  });
});
