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

export interface CanvasDiffOptions {
  localActorVersions?: Record<string, number>;
  serverActorVersions?: Record<string, number>;
  assumeServerVersionsWhenLocalMissing?: boolean;
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
  const actorIds = [...new Set([...Object.keys(local.data.actors), ...Object.keys(server.data.actors)])].sort(compareStrings);
  const hasLocalActorVersions = options.localActorVersions !== undefined;
  const entries: ActorDiffEntry[] = actorIds.map((actorId) => {
    const localActor = local.data.actors[actorId];
    const serverActor = server.data.actors[actorId];
    const serverVersion = actorVersion(options.serverActorVersions, actorId);
    const bundleVersion = actorVersion(options.localActorVersions, actorId)
      ?? (!hasLocalActorVersions && options.assumeServerVersionsWhenLocalMissing ? serverVersion : undefined);
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

export const summarizeDiff = (diff: CanvasDiff, forceLocal = false): DiffSummary => {
  const summary: DiffSummary = {
    added: 0,
    updated: 0,
    removed: 0,
    conflicts: diff.conflicts.length,
    unchanged: 0,
    localKept: 0,
    serverChanged: 0,
    deletedOnServer: 0,
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
      case 'version-missing':
        if (forceLocal) summary.updated += 1;
        break;
      case 'server-only':
        summary.removed += 1;
        break;
      case 'deleted-on-server':
        summary.deletedOnServer += 1;
        break;
      case 'unchanged':
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
      case 'version-missing':
        if (forceLocal && localActor) {
          updates.push({ type: 'update', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion, data: toCanvasActorMutationData(localActor) });
        }
        break;
      case 'server-only':
        removes.push({ type: 'remove', actorId: entry.actorId, timestamp, editVersion: entry.serverVersion });
        break;
      case 'unchanged':
      case 'deleted-on-server':
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
      case 'version-missing':
      case 'server-only':
        if (serverActor) actors[entry.actorId] = serverActor;
        break;
      case 'deleted-on-server':
        break;
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
