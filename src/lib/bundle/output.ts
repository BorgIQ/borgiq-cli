import type { BatchActorOperation, BIQCanvasLayout } from '../../client/types.js';

export interface CompactBatchOperation {
  type: BatchActorOperation['type'];
  actorId: string;
  editVersion?: number;
}

export interface CompactAppliedOperation {
  type?: string;
  actorId?: string;
  status?: string;
  editVersion?: number;
  newEditVersion?: number;
}

export interface CompactBatchConflict {
  actorId?: string;
  type?: string;
  reason?: string;
  status?: string;
  editVersion?: number;
  serverVersion?: number;
  attemptedVersion?: number;
  conflictingFields?: unknown[];
}

export interface CompactBatchResult {
  updatedAt?: string;
  appliedOperations?: CompactAppliedOperation[];
  conflicts?: CompactBatchConflict[];
}

export interface CompactLayoutResult {
  id?: string;
  version?: number;
  actorCount: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === 'string' ? record[key] : undefined;

const numberField = (record: Record<string, unknown>, key: string): number | undefined =>
  typeof record[key] === 'number' ? record[key] : undefined;

const unknownArrayField = (record: Record<string, unknown>, key: string): unknown[] | undefined =>
  Array.isArray(record[key]) ? record[key] : undefined;

const dropUndefined = <T extends Record<string, unknown>>(record: T): T => {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return record;
};

export const compactOperations = (operations: BatchActorOperation[]): CompactBatchOperation[] =>
  operations.map((operation) => dropUndefined({
    type: operation.type,
    actorId: operation.actorId,
    editVersion: operation.editVersion,
  }));

const compactAppliedOperation = (value: unknown): CompactAppliedOperation => {
  if (!isRecord(value)) return {};
  return dropUndefined({
    type: stringField(value, 'type'),
    actorId: stringField(value, 'actorId'),
    status: stringField(value, 'status'),
    editVersion: numberField(value, 'editVersion'),
    newEditVersion: numberField(value, 'newEditVersion'),
  });
};

const compactBatchConflict = (value: unknown): CompactBatchConflict => {
  if (!isRecord(value)) return {};
  return dropUndefined({
    actorId: stringField(value, 'actorId'),
    type: stringField(value, 'type'),
    reason: stringField(value, 'reason'),
    status: stringField(value, 'status'),
    editVersion: numberField(value, 'editVersion'),
    serverVersion: numberField(value, 'serverVersion'),
    attemptedVersion: numberField(value, 'attemptedVersion'),
    conflictingFields: unknownArrayField(value, 'conflictingFields'),
  });
};

export const compactBatchResult = (value: unknown): CompactBatchResult | undefined => {
  if (!isRecord(value)) return undefined;

  return dropUndefined({
    updatedAt: stringField(value, 'updatedAt'),
    appliedOperations: unknownArrayField(value, 'appliedOperations')?.map(compactAppliedOperation),
    conflicts: unknownArrayField(value, 'conflicts')?.map(compactBatchConflict),
  });
};

export const compactLayoutResult = (value: unknown): CompactLayoutResult | undefined => {
  if (!isRecord(value)) return undefined;
  const actors = isRecord(value.actors) ? (value.actors as BIQCanvasLayout['actors']) : {};

  return dropUndefined({
    id: stringField(value, 'id'),
    version: numberField(value, 'version'),
    actorCount: Object.keys(actors).length,
  });
};

export const withRaw = <T extends Record<string, unknown>>(value: T, rawEnabled: boolean | undefined, raw: Record<string, unknown>): T & { raw?: Record<string, unknown> } =>
  rawEnabled ? { ...value, raw } : value;
