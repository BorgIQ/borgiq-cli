import { describe, expect, it } from 'vitest';

import { compactBatchResult, compactLayoutResult, compactOperations, withRaw } from '../../src/lib/bundle/output.js';
import type { BatchActorOperation } from '../../src/client/types.js';

describe('bundle compact output helpers', () => {
  it('omits actor mutation data and timestamps from operation summaries', () => {
    const operations: BatchActorOperation[] = [
      {
        type: 'update',
        actorId: 'ACTR01actor',
        timestamp: 123,
        editVersion: 7,
        data: {
          configuration: {
            code: 'export default async function receive() { return "secret"; }',
            options: 'allowNet: true',
          },
        },
      },
      {
        type: 'remove',
        actorId: 'ACTR01deleted',
        timestamp: 123,
      },
    ];

    const compact = compactOperations(operations);

    expect(compact).toEqual([
      { type: 'update', actorId: 'ACTR01actor', editVersion: 7 },
      { type: 'remove', actorId: 'ACTR01deleted' },
    ]);
    expect(JSON.stringify(compact)).not.toContain('data');
    expect(JSON.stringify(compact)).not.toContain('timestamp');
    expect(JSON.stringify(compact)).not.toContain('secret');
  });

  it('omits actorData and mergedData from batch API results', () => {
    const compact = compactBatchResult({
      updatedAt: '2026-07-09T12:00:00.000Z',
      appliedOperations: [
        {
          type: 'update',
          actorId: 'ACTR01actor',
          status: 'applied',
          newEditVersion: 8,
          actorData: {
            configuration: {
              code: 'full actor code',
            },
          },
        },
      ],
      conflicts: [
        {
          actorId: 'ACTR01conflict',
          reason: 'editVersionMismatch',
          serverVersion: 9,
          attemptedVersion: 8,
          conflictingFields: ['configuration.options'],
          mergedData: {
            configuration: {
              options: 'prompt: full prompt',
            },
          },
        },
      ],
    });

    expect(compact).toEqual({
      updatedAt: '2026-07-09T12:00:00.000Z',
      appliedOperations: [
        {
          type: 'update',
          actorId: 'ACTR01actor',
          status: 'applied',
          newEditVersion: 8,
        },
      ],
      conflicts: [
        {
          actorId: 'ACTR01conflict',
          reason: 'editVersionMismatch',
          serverVersion: 9,
          attemptedVersion: 8,
          conflictingFields: ['configuration.options'],
        },
      ],
    });
    expect(JSON.stringify(compact)).not.toContain('actorData');
    expect(JSON.stringify(compact)).not.toContain('mergedData');
    expect(JSON.stringify(compact)).not.toContain('full actor code');
    expect(JSON.stringify(compact)).not.toContain('full prompt');
  });

  it('summarizes layout output by actor count', () => {
    expect(compactLayoutResult({
      id: 'CNVS01canvas',
      version: 12,
      actors: {
        ACTR01a: { x: 0, y: 0 },
        ACTR01b: { x: 200, y: 0 },
      },
    })).toEqual({
      id: 'CNVS01canvas',
      version: 12,
      actorCount: 2,
    });
  });

  it('keeps raw payloads only when explicitly requested', () => {
    expect(withRaw({ mode: 'sync' }, false, { operations: [{ data: { code: 'debug' } }] })).toEqual({ mode: 'sync' });
    expect(withRaw({ mode: 'sync' }, true, { operations: [{ data: { code: 'debug' } }] })).toEqual({
      mode: 'sync',
      raw: {
        operations: [{ data: { code: 'debug' } }],
      },
    });
  });
});
