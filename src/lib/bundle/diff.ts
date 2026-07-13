import { createHash } from 'node:crypto';

import type { BatchActorOperation } from '../../client/types.js';
import type { BundleSyncActor, CanvasExportDocument, ExportedActor } from './types.js';
import { stringifyYamlDoc } from './yaml.js';

export type ActorVerdict =
  | 'unchanged'
  | 'local-edit'
  | 'server-edit'
  | 'concurrent-edit'
  | 'baseline-missing'
  | 'new-local'
  | 'new-server'
  | 'deleted-local'
  | 'deleted-on-server'
  | 'local-edit-server-delete'
  | 'local-delete-server-edit'
  | 'deleted-both';

export interface ActorDiffEntry {
  actorId: string;
  name: string;
  verdict: ActorVerdict;
  bundleVersion?: number;
  serverVersion?: number;
}

export interface CanvasDiff {
  entries: ActorDiffEntry[];
  /** Conflicts that block either direction. */
  conflicts: ActorDiffEntry[];
  pushConflicts: ActorDiffEntry[];
  pullConflicts: ActorDiffEntry[];
  metadataDelta: Record<string, unknown> | null;
}

export interface CanvasDiffOptions {
  localActorStates?: Record<string, BundleSyncActor>;
  serverActorVersions?: Record<string, number>;
}

export interface DiffSummaryOptions {
  direction?: 'push' | 'pull';
  forceLocal?: boolean;
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
  deletedLocally: number;
  newOnServer: number;
}

const SYNC_METADATA_FIELDS = ['name', 'description', 'tags', 'messageTTLInDays', 'runtimeSlug'] as const;
const CONFIG_YAML_FIELDS = ['credentials', 'inputs', 'vars', 'options', 'outputs', 'error'] as const;
const SCHEMA_YAML_FIELDS = ['inputs', 'outputs'] as const;

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

const actorVersion = (versions: Record<string, number> | undefined, actorId: string): number | undefined =>
  typeof versions?.[actorId] === 'number' ? versions[actorId] : undefined;

const actorName = (local: ExportedActor | undefined, server: ExportedActor | undefined, actorId: string): string =>
  (typeof local?.name === 'string' && local.name.length > 0 ? local.name : undefined)
  ?? (typeof server?.name === 'string' && server.name.length > 0 ? server.name : undefined)
  ?? actorId;

export const canonicalActorForm = (actor: ExportedActor): string => {
  const { version: _version, ...rest } = actor;
  void _version;
  return stringifyYamlDoc(stableValue(rest));
};

export const actorContentHash = (actor: ExportedActor): string =>
  `sha256:${createHash('sha256').update(canonicalActorForm(actor)).digest('hex')}`;

export const actorContentHashes = (doc: CanvasExportDocument): Record<string, string> =>
  Object.fromEntries(
    Object.entries(doc.data.actors)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([actorId, actor]) => [actorId, actorContentHash(actor)]),
  );

const valuesEqual = (a: unknown, b: unknown): boolean =>
  stringifyYamlDoc(stableValue(a)) === stringifyYamlDoc(stableValue(b));

const cloneActor = (actor: Record<string, unknown>): Record<string, unknown> =>
  stableValue(actor) as Record<string, unknown>;

const stringifyObjectFields = (obj: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> => {
  const out = { ...obj };
  for (const field of fields) {
    if (out[field] !== undefined && typeof out[field] !== 'string') {
      out[field] = stringifyYamlDoc(out[field]);
    }
  }
  return out;
};

/**
 * The bundle format keeps exported actors in editable object form. The actor
 * mutation endpoint expects CanvasActor shape, where selected configuration
 * and schema fields are YAML strings.
 */
export const toCanvasActorMutationData = (actor: Record<string, unknown>): Record<string, unknown> => {
  const data = cloneActor(actor);
  if (isRecord(data.configuration)) {
    data.configuration = stringifyObjectFields(data.configuration, CONFIG_YAML_FIELDS);
  }
  if (isRecord(data.schemas)) {
    data.schemas = stringifyObjectFields(data.schemas, SCHEMA_YAML_FIELDS);
  }
  return data;
};

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

export const diffCanvas = (local: CanvasExportDocument, server: CanvasExportDocument, options: CanvasDiffOptions = {}): CanvasDiff => {
  const actorIds = [...new Set([
    ...Object.keys(local.data.actors),
    ...Object.keys(server.data.actors),
    ...Object.keys(options.localActorStates ?? {}),
  ])].sort(compareStrings);
  const entries: ActorDiffEntry[] = actorIds.map((actorId) => {
    const localActor = local.data.actors[actorId];
    const serverActor = server.data.actors[actorId];
    const baseline = options.localActorStates?.[actorId];
    const baselineHash = baseline?.contentHash;
    const localHash = localActor ? actorContentHash(localActor) : undefined;
    const serverHash = serverActor ? actorContentHash(serverActor) : undefined;
    const serverVersion = actorVersion(options.serverActorVersions, actorId);
    const bundleVersion = baseline?.editVersion;
    let verdict: ActorVerdict;

    if (localActor && serverActor) {
      if (localHash === serverHash) {
        verdict = 'unchanged';
      } else if (baselineHash !== undefined) {
        const localChanged = localHash !== baselineHash;
        const serverChanged = serverHash !== baselineHash;
        if (!localChanged && serverChanged) {
          verdict = 'server-edit';
        } else if (localChanged && !serverChanged && serverVersion !== undefined) {
          verdict = 'local-edit';
        } else if (localChanged && serverChanged) {
          verdict = 'concurrent-edit';
        } else {
          verdict = 'baseline-missing';
        }
      } else {
        verdict = 'baseline-missing';
      }
    } else if (localActor) {
      if (baselineHash === undefined) {
        verdict = 'new-local';
      } else {
        verdict = localHash === baselineHash ? 'deleted-on-server' : 'local-edit-server-delete';
      }
    } else if (serverActor) {
      if (baselineHash === undefined) {
        verdict = 'new-server';
      } else {
        verdict = serverHash === baselineHash && serverVersion !== undefined ? 'deleted-local' : 'local-delete-server-edit';
      }
    } else {
      verdict = 'deleted-both';
    }

    return {
      actorId,
      name: actorName(localActor, serverActor, actorId),
      verdict,
      bundleVersion,
      serverVersion,
    };
  });

  const conflicts = entries.filter((entry) =>
    entry.verdict === 'concurrent-edit'
    || entry.verdict === 'baseline-missing'
    || entry.verdict === 'local-edit-server-delete'
    || entry.verdict === 'local-delete-server-edit');
  const pushConflicts = entries.filter((entry) =>
    conflicts.includes(entry)
    || entry.verdict === 'server-edit'
    || entry.verdict === 'new-server'
    || entry.verdict === 'deleted-on-server');
  return {
    entries,
    conflicts,
    pushConflicts,
    pullConflicts: conflicts,
    metadataDelta: metadataDelta(local, server),
  };
};

export const summarizeDiff = (diff: CanvasDiff, options: DiffSummaryOptions = {}): DiffSummary => {
  const forceLocal = options.forceLocal ?? false;
  const direction = options.direction ?? 'push';
  const summary: DiffSummary = {
    added: 0,
    updated: 0,
    removed: 0,
    conflicts: (direction === 'push' ? diff.pushConflicts : diff.pullConflicts).length,
    unchanged: 0,
    localKept: 0,
    serverChanged: 0,
    deletedOnServer: 0,
    deletedLocally: 0,
    newOnServer: 0,
  };

  for (const entry of diff.entries) {
    switch (entry.verdict) {
      case 'new-local':
        summary.added += 1;
        summary.localKept += 1;
        break;
      case 'local-edit':
        summary.updated += 1;
        summary.localKept += 1;
        break;
      case 'server-edit':
        summary.serverChanged += 1;
        if (forceLocal) summary.updated += 1;
        break;
      case 'concurrent-edit':
      case 'baseline-missing':
        if (forceLocal) summary.updated += 1;
        break;
      case 'local-edit-server-delete':
        if (forceLocal) summary.added += 1;
        break;
      case 'local-delete-server-edit':
        if (forceLocal) summary.removed += 1;
        break;
      case 'new-server':
        summary.newOnServer += 1;
        summary.serverChanged += 1;
        if (forceLocal) summary.removed += 1;
        break;
      case 'deleted-local':
        summary.deletedLocally += 1;
        summary.removed += 1;
        summary.localKept += 1;
        break;
      case 'deleted-on-server':
        summary.deletedOnServer += 1;
        summary.serverChanged += 1;
        if (forceLocal) summary.added += 1;
        break;
      case 'unchanged':
      case 'deleted-both':
        summary.unchanged += 1;
        break;
      default:
        assertNever(entry.verdict);
    }
  }

  return summary;
};

export const toBatchOperations = (
  diff: CanvasDiff,
  local: CanvasExportDocument,
  forceLocal: boolean,
  timestamp: number,
): BatchActorOperation[] => {
  const adds: BatchActorOperation[] = [];
  const updates: BatchActorOperation[] = [];
  const removes: BatchActorOperation[] = [];

  for (const entry of diff.entries) {
    const localActor = local.data.actors[entry.actorId] as Record<string, unknown> | undefined;
    switch (entry.verdict) {
      case 'new-local':
        if (localActor) adds.push({ type: 'add', actorId: entry.actorId, timestamp, data: toCanvasActorMutationData(localActor) });
        break;
      case 'local-edit':
        if (localActor) updates.push({ type: 'update', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion, data: toCanvasActorMutationData(localActor) });
        break;
      case 'server-edit':
      case 'concurrent-edit':
      case 'baseline-missing':
        if (!forceLocal) break;
        if (localActor) {
          updates.push({ type: 'update', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion, data: toCanvasActorMutationData(localActor) });
        }
        break;
      case 'local-edit-server-delete':
      case 'deleted-on-server':
        if (forceLocal && localActor) {
          adds.push({ type: 'add', actorId: entry.actorId, timestamp, data: toCanvasActorMutationData(localActor) });
        }
        break;
      case 'local-delete-server-edit':
      case 'new-server':
        if (forceLocal) {
          removes.push({ type: 'remove', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion });
        }
        break;
      case 'deleted-local':
        removes.push({ type: 'remove', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion });
        break;
      case 'unchanged':
      case 'deleted-both':
        break;
      default:
        assertNever(entry.verdict);
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
    switch (entry.verdict) {
      case 'local-edit':
      case 'new-local':
        if (localActor) actors[entry.actorId] = localActor;
        break;
      case 'unchanged':
      case 'server-edit':
      case 'new-server':
        if (serverActor) actors[entry.actorId] = serverActor;
        break;
      case 'deleted-local':
      case 'deleted-on-server':
      case 'deleted-both':
        break;
      case 'concurrent-edit':
      case 'baseline-missing':
      case 'local-edit-server-delete':
      case 'local-delete-server-edit':
        throw new Error(`Cannot merge unresolved actor ${entry.actorId} (${entry.verdict}).`);
      default:
        assertNever(entry.verdict);
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

const assertNever = (value: never): never => {
  throw new Error(`Unhandled actor verdict: ${String(value)}`);
};
