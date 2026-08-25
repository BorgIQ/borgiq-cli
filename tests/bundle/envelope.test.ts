import { describe, expect, it } from 'vitest';

import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { actorContentHash } from '../../src/lib/bundle/diff.js';
import { stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { DENO_PROJECT, PYTHON_PROJECT, TASK_ID, makeDenoActor, makeDoc, makePythonActor } from './fixtures.js';

describe('parseExportInput', () => {
  it('accepts a valid API export envelope', () => {
    const doc = makeDoc([]);

    expect(parseExportInput(JSON.stringify({ yaml: stringifyYamlDoc(doc), errors: [] }))).toEqual({
      document: doc,
      exportErrors: [],
    });
  });

  it('rejects an envelope whose errors field drifted from an array', () => {
    const doc = makeDoc([]);

    expect(() => parseExportInput(JSON.stringify({ yaml: stringifyYamlDoc(doc), errors: null })))
      .toThrow(/errors.*array/);
  });

  it('rejects a document without a data.actors object', () => {
    expect(() => parseExportInput(stringifyYamlDoc({ metadata: {}, data: { schemaVersion: '1' } })))
      .toThrow(/data\.actors/);
  });

  it('sorts every project-tree codeDir at the ingest seam, so no phantom local edit appears', () => {
    // A server array in any order must hash like the path-sorted array a bundle rebuilds.
    for (const [make, project] of [[makeDenoActor, DENO_PROJECT], [makePythonActor, PYTHON_PROJECT]] as const) {
      const unordered = makeDoc([make({ configuration: { codeDir: [...project].reverse().map((file) => ({ ...file })), options: {} } })]);
      const canonical = makeDoc([make({ configuration: { codeDir: project.map((file) => ({ ...file })), options: {} } })]);
      expect(actorContentHash(unordered.data.actors[TASK_ID])).not.toBe(actorContentHash(canonical.data.actors[TASK_ID]));

      const parsed = parseExportInput(stringifyYamlDoc(unordered));

      expect(actorContentHash(parsed.document.data.actors[TASK_ID])).toBe(actorContentHash(canonical.data.actors[TASK_ID]));
    }
  });
});
