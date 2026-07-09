import { describe, expect, it } from 'vitest';

import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { makeDoc } from './fixtures.js';

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
});
