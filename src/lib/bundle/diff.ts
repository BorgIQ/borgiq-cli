import type { BatchActorOperation } from '../../client/types.js';
import type { CanvasExportDocument, ExportedActor } from './types.js';
import { stringifyYamlDoc } from './yaml.js';

export type ActorVerdict =
  | 'unchanged'
  | 'local-edit'
  | 'server-edit'
  | 'version-missing'
  | 'new-local'
  | 'deleted-on-server'
  | 'server-only';

export interface ActorDiffEntry {
  actorId: string;
  name: string;
  verdict: ActorVerdict;
  bundleVersion?: number;
  serverVersion?: number;
}

export interface CanvasDiff {
  entries: ActorDiffEntry[];
  conflicts: ActorDiffEntry[];
  metadataDelta: Record<string, unknown> | null;
}

export interface DiffSummary {
  added: number;
  updated: number;
  removed: number;
  conflicts: number;
  unchanged: number;
  localKept: number;
  serverChanged: number;
  deletedOnServer: number;
}

const SYNC_METADATA_FIELDS = ['name', 'description', 'tags', 'messageTTLInDays', 'runtimeSlug'] as const;

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareStrings)) {
    const child = value[key];
    if (child !== undefined) out[key] = stableValue(child);
  }
  return out;
};

const actorVersion = (actor: ExportedActor | undefined): number | undefined =>
  typeof actor?.version === 'number' ? actor.version : undefined;

const actorName = (local: ExportedActor | undefined, server: ExportedActor | undefined, actorId: string): string =>
  (typeof local?.name === 'string' && local.name.length > 0 ? local.name : undefined)
  ?? (typeof server?.name === 'string' && server.name.length > 0 ? server.name : undefined)
  ?? actorId;

export const canonicalActorForm = (actor: ExportedActor): string => {
  const { version: _version, ...rest } = actor;
  void _version;
  return stringifyYamlDoc(stableValue(rest));
};

const valuesEqual = (a: unknown, b: unknown): boolean =>
  stringifyYamlDoc(stableValue(a)) === stringifyYamlDoc(stableValue(b));

const metadataDelta = (local: CanvasExportDocument, server: CanvasExportDocument): Record<string, unknown> | null => {
  const delta: Record<string, unknown> = {};
  for (const field of SYNC_METADATA_FIELDS) {
    const localValue = local.metadata[field];
    const serverValue = server.metadata[field];
    if (localValue !== undefined && !valuesEqual(localValue, serverValue)) {
      delta[field] = localValue;
    }
  }
  return Object.keys(delta).length > 0 ? delta : null;
};

export const diffCanvas = (local: CanvasExportDocument, server: CanvasExportDocument): CanvasDiff => {
  const actorIds = [...new Set([...Object.keys(local.data.actors), ...Object.keys(server.data.actors)])].sort(compareStrings);
  const entries: ActorDiffEntry[] = actorIds.map((actorId) => {
    const localActor = local.data.actors[actorId];
    const serverActor = server.data.actors[actorId];
    const bundleVersion = actorVersion(localActor);
    const serverVersion = actorVersion(serverActor);
    let verdict: ActorVerdict;

    if (localActor && serverActor) {
      if (canonicalActorForm(localActor) === canonicalActorForm(serverActor)) {
        verdict = 'unchanged';
      } else if (bundleVersion === undefined) {
        verdict = 'version-missing';
      } else if (bundleVersion === serverVersion) {
        verdict = 'local-edit';
      } else {
        verdict = 'server-edit';
      }
    } else if (localActor) {
      verdict = bundleVersion === undefined ? 'new-local' : 'deleted-on-server';
    } else {
      verdict = 'server-only';
    }

    return {
      actorId,
      name: actorName(localActor, serverActor, actorId),
      verdict,
      bundleVersion,
      serverVersion,
    };
  });

  const conflicts = entries.filter((entry) => entry.verdict === 'server-edit' || entry.verdict === 'version-missing');
  return { entries, conflicts, metadataDelta: metadataDelta(local, server) };
};

export const summarizeDiff = (diff: CanvasDiff): DiffSummary => ({
  added: diff.entries.filter((entry) => entry.verdict === 'new-local').length,
  updated: diff.entries.filter((entry) => entry.verdict === 'local-edit').length,
  removed: diff.entries.filter((entry) => entry.verdict === 'server-only').length,
  conflicts: diff.conflicts.length,
  unchanged: diff.entries.filter((entry) => entry.verdict === 'unchanged').length,
  localKept: diff.entries.filter((entry) => entry.verdict === 'new-local' || entry.verdict === 'local-edit').length,
  serverChanged: diff.entries.filter((entry) => entry.verdict === 'server-edit').length,
  deletedOnServer: diff.entries.filter((entry) => entry.verdict === 'deleted-on-server').length,
});

export const toBatchOperations = (
  diff: CanvasDiff,
  local: CanvasExportDocument,
  forceLocal: boolean,
): BatchActorOperation[] => {
  const adds: BatchActorOperation[] = [];
  const updates: BatchActorOperation[] = [];
  const removes: BatchActorOperation[] = [];

  for (const entry of diff.entries) {
    const localActor = local.data.actors[entry.actorId] as Record<string, unknown> | undefined;
    if (entry.verdict === 'new-local' && localActor) {
      adds.push({ type: 'add', actorId: entry.actorId, data: localActor });
    } else if (entry.verdict === 'local-edit' && localActor) {
      updates.push({ type: 'update', actorId: entry.actorId, editVersion: entry.serverVersion, data: localActor });
    } else if ((entry.verdict === 'server-edit' || entry.verdict === 'version-missing') && forceLocal && localActor) {
      updates.push({ type: 'update', actorId: entry.actorId, editVersion: entry.serverVersion, data: localActor });
    } else if (entry.verdict === 'server-only') {
      removes.push({ type: 'remove', actorId: entry.actorId, editVersion: entry.serverVersion });
    }
  }

  return [...adds, ...updates, ...removes];
};

export const mergeForPull = (
  local: CanvasExportDocument,
  server: CanvasExportDocument,
  diff: CanvasDiff,
): CanvasExportDocument => {
  const actors: Record<string, ExportedActor> = {};
  for (const entry of diff.entries) {
    const localActor = local.data.actors[entry.actorId];
    const serverActor = server.data.actors[entry.actorId];
    if ((entry.verdict === 'local-edit' || entry.verdict === 'new-local') && localActor) {
      actors[entry.actorId] = localActor;
    } else if (serverActor) {
      actors[entry.actorId] = serverActor;
    }
  }

  return {
    metadata: server.metadata,
    data: {
      schemaVersion: server.data.schemaVersion,
      actors,
    },
  };
};
