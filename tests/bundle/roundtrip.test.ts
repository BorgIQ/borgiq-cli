import { describe, expect, it } from 'vitest';

import { assembleBundle, BundleValidationError } from '../../src/lib/bundle/assemble.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { CanvasExportDocument } from '../../src/lib/bundle/types.js';
import { EDGE_ID, TASK_ID, TRIGGER_ID, makeActor, makeDoc, makeWiredDoc } from './fixtures.js';

const documents: [string, () => CanvasExportDocument][] = [
  ['wired webhook to deno canvas', makeWiredDoc],
  ['http task', () => makeDoc([makeActor({ id: TASK_ID, type: 'HttpRequestActor', configuration: { options: { method: 'GET', url: 'https://x' } } })])],
  ['python actor', () => makeDoc([makeActor({ id: TASK_ID, type: 'PythonActor', configuration: { code: 'x = 1\n', options: {} } })])],
  ['app actor with inline assets', () => makeDoc([makeActor({ id: TASK_ID, type: 'AppTriggerActor', configuration: { options: { html: '<h1>a</h1>', css: 'h1{}', script: 'let a;', allowInlineScripts: true } } })])],
  ['app actor with BIQFile refs', () => makeDoc([makeActor({ id: TASK_ID, type: 'AppTriggerActor', configuration: { options: { html: { type: 'BIQFile', fileId: 'F1' }, css: { type: 'BIQFile', fileId: 'F2' } } } })])],
  ['schemas and credentials', () => makeDoc([
    makeActor({
      id: TASK_ID,
      type: 'AiActor',
      configuration: {
        connection: { type: 'anthropic', key: 'anthropic-main' },
        credentials: { api: { workspaceKey: 'anthropic-key', source: 'secret' } },
        options: { prompt: 'You are a bot.\n\nBe helpful.\nAlways.\n' },
      },
      schemas: { inputs: { type: 'object', properties: { q: { type: 'string' } } }, outputs: null },
    }),
  ])],
  ['unknown future actor field passes through', () => makeDoc([makeActor({ id: TASK_ID, type: 'EchoActor', futureField: { nested: [1, 2] } })])],
];

describe('round-trip guarantees', () => {
  it.each(documents)('pack(unpack(doc)) deep-equals doc: %s', (_name, make) => {
    const doc = make();
    const { files } = disassemble(doc);
    expect(assembleBundle(files).doc).toEqual(doc);
  });

  it.each(documents)('disassembly is deterministic and unpack(pack(dir)) == dir: %s', (_name, make) => {
    const { files } = disassemble(make());
    expect(disassemble(make()).files).toEqual(files);
    expect(disassemble(assembleBundle(files).doc).files).toEqual(files);
  });

  it('serialized pack output is byte-deterministic', () => {
    const { files } = disassemble(makeWiredDoc());
    expect(stringifyYamlDoc(assembleBundle(files).doc)).toBe(stringifyYamlDoc(assembleBundle({ ...files }).doc));
  });

  it('reattaches edges to the source actor keyed by edge id', () => {
    const { doc } = assembleBundle(disassemble(makeWiredDoc()).files);
    expect(Object.keys(doc.data.actors[TRIGGER_ID].edges ?? {})).toEqual([EDGE_ID]);
    expect(doc.data.actors[TASK_ID].edges).toEqual({});
    expect(doc.data.actors[TASK_ID].position).toEqual({ x: 320, y: 0 });
  });

  it('maps canvas.schemaVersion back to data.schemaVersion and strips it from metadata', () => {
    const { doc } = assembleBundle(disassemble(makeWiredDoc()).files);
    expect(doc.data.schemaVersion).toBe('1');
    expect(doc.metadata.schemaVersion).toBeUndefined();
    expect(doc.metadata.slug).toBe('test-canvas');
  });

  it('throws BundleValidationError carrying all findings on an invalid bundle', () => {
    const { files } = disassemble(makeWiredDoc());
    delete files[`actors/tasks/deno/${TASK_ID}/code/mod.ts`];
    expect(() => assembleBundle(files)).toThrow(BundleValidationError);
  });

  it('surfaces validation warnings as assembly warnings', () => {
    const { files } = disassemble(makeWiredDoc());
    files['actors/stray.txt'] = 'x\n';
    expect(assembleBundle(files).warnings.some((warning) => warning.path === 'actors/stray.txt')).toBe(true);
  });
});
