import { describe, expect, it } from 'vitest';

import { diffCanvas, mergeForPull, toBatchOperations } from '../../src/lib/bundle/diff.js';
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

    expect(verdictMap(diffCanvas(local, server).entries)).toEqual({
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

    expect(toBatchOperations(diffCanvas(local, server), local, false).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'add', actorId: 'ACTRnewlocal', editVersion: undefined },
      { type: 'update', actorId: 'ACTRlocaledit', editVersion: 1 },
      { type: 'remove', actorId: 'ACTRserveronly', editVersion: 4 },
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

    expect(toBatchOperations(diffCanvas(local, server), local, true).map((op) => ({
      type: op.type,
      actorId: op.actorId,
      editVersion: op.editVersion,
    }))).toEqual([
      { type: 'update', actorId: 'ACTRmissingversion', editVersion: 3 },
      { type: 'update', actorId: 'ACTRserveredit', editVersion: 2 },
    ]);
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

    const merged = mergeForPull(local, server, diffCanvas(local, server));
    expect(Object.keys(merged.data.actors).sort()).toEqual(['ACTRlocaledit', 'ACTRnewlocal', 'ACTRserveronly']);
    expect(merged.data.actors.ACTRlocaledit.name).toBe('Local kept');
    expect(merged.data.actors.ACTRnewlocal.name).toBe('New local');
    expect(merged.data.actors.ACTRserveronly.name).toBe('Server only');
    expect(merged.metadata.name).toBe('Server canvas');
  });
});
