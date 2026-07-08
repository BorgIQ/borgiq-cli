import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { parseYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleRootDoc } from '../../src/lib/bundle/types.js';
import { EDGE_ID, TASK_ID, TRIGGER_ID, makeActor, makeDoc, makeWiredDoc } from './fixtures.js';

const root = (files: Record<string, string>): BundleRootDoc => parseYamlDoc(files['canvas.yaml']) as BundleRootDoc;

describe('disassemble', () => {
  it('produces canvas.yaml plus one folder per actor at the registry path', () => {
    const { files } = disassemble(makeWiredDoc());
    expect(Object.keys(files).sort()).toEqual([
      `actors/tasks/deno/${TASK_ID}/actor.yaml`,
      `actors/tasks/deno/${TASK_ID}/code/mod.ts`,
      `actors/triggers/webhook/${TRIGGER_ID}/actor.yaml`,
      'canvas.yaml',
    ]);
  });

  it('lifts edges and positions into the root graph and strips them from actor.yaml', () => {
    const { files } = disassemble(makeWiredDoc());
    const doc = root(files);
    expect(doc.graph.nodes).toEqual([
      { actorId: TASK_ID, position: { x: 320, y: 0 } },
      { actorId: TRIGGER_ID, position: { x: 0, y: 0 } },
    ]);
    expect(doc.graph.edges).toHaveLength(1);
    expect(doc.graph.edges[0].id).toBe(EDGE_ID);
    const actorDoc = parseYamlDoc(files[`actors/triggers/webhook/${TRIGGER_ID}/actor.yaml`]) as Record<string, unknown>;
    expect(actorDoc.edges).toBeUndefined();
    expect(actorDoc.position).toBeUndefined();
  });

  it('externalizes code-heavy actors', () => {
    const deno = disassemble(makeWiredDoc()).files;
    expect(deno[`actors/tasks/deno/${TASK_ID}/code/mod.ts`]).toContain('export default');
    const denoActor = parseYamlDoc(deno[`actors/tasks/deno/${TASK_ID}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(denoActor.configuration.codeDir).toBe('code');
    expect(denoActor.configuration.code).toBeUndefined();

    const pyDoc = makeDoc([makeActor({ id: TASK_ID, type: 'PythonActor', configuration: { code: 'x = 1\n', options: {} } })]);
    const py = disassemble(pyDoc).files;
    expect(py[`actors/tasks/python/${TASK_ID}/code/mod.py`]).toBe('x = 1\n');
  });

  it('splits app inline strings but leaves BIQFile references inline', () => {
    const doc = makeDoc([
      makeActor({
        id: TASK_ID,
        type: 'AppTriggerActor',
        configuration: {
          options: { html: '<h1>hi</h1>', css: { type: 'BIQFile', fileId: 'FILE1' }, allowInlineScripts: true },
        },
      }),
    ]);
    const { files } = disassemble(doc);
    const dir = `actors/triggers/app/${TASK_ID}`;
    expect(files[`${dir}/code/index.html`]).toBe('<h1>hi</h1>');
    expect(files[`${dir}/code/styles.css`]).toBeUndefined();
    const actorDoc = parseYamlDoc(files[`${dir}/actor.yaml`]) as { configuration: { options: Record<string, unknown>; codeDir?: string } };
    expect(actorDoc.configuration.codeDir).toBe('code');
    expect(actorDoc.configuration.options.html).toBeUndefined();
    expect(actorDoc.configuration.options.css).toEqual({ type: 'BIQFile', fileId: 'FILE1' });
  });

  it('emits no code dir when a code-capable actor has no code', () => {
    const doc = makeDoc([makeActor({ id: TASK_ID, type: 'DenoActor', configuration: { options: {} } })]);
    const { files } = disassemble(doc);
    expect(Object.keys(files).some((path) => path.includes('/code/'))).toBe(false);
    const actorDoc = parseYamlDoc(files[`actors/tasks/deno/${TASK_ID}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(actorDoc.configuration.codeDir).toBeUndefined();
  });

  it('walks dependencies from runtimeSlug, connection.key, and credentials source', () => {
    const doc = makeDoc([
      makeActor({
        id: TASK_ID,
        type: 'HttpRequestActor',
        runtimeSlug: 'edge',
        configuration: {
          connection: { type: 'github', key: 'github-main' },
          credentials: {
            token: { workspaceKey: 'gh-token', source: 'secret' },
            slack: { workspaceKey: 'slack-prod', source: 'connection' },
          },
          options: {},
        },
      }),
    ]);
    expect(root(disassemble(doc).files).dependencies).toEqual({
      runtimes: ['edge'],
      connections: [
        { workspaceKey: 'github-main', referencedBy: [TASK_ID] },
        { workspaceKey: 'slack-prod', referencedBy: [TASK_ID] },
      ],
      secrets: [{ workspaceKey: 'gh-token', referencedBy: [TASK_ID] }],
    });
  });

  it('records the actor index sorted by path and carries exportErrors', () => {
    const errors = [{ actorId: TASK_ID, field: 'options', error: 'bad yaml' }];
    const doc = root(disassemble(makeWiredDoc(), { exportErrors: errors }).files);
    expect(doc.actors.map((actor) => actor.path)).toEqual([
      `actors/tasks/deno/${TASK_ID}`,
      `actors/triggers/webhook/${TRIGGER_ID}`,
    ]);
    expect(doc.exportErrors).toEqual(errors);
    expect(doc.format).toBe('borgiq.canvas.bundle');
    expect(doc.formatVersion).toBe(1);
  });

  it('records sync actor edit versions when supplied', () => {
    const doc = root(disassemble(makeWiredDoc(), {
      actorVersions: {
        [TRIGGER_ID]: 3,
        [TASK_ID]: 2,
      },
    }).files);

    expect(doc.sync?.actorVersions).toEqual({
      [TASK_ID]: 2,
      [TRIGGER_ID]: 3,
    });
  });

  it('warns on DeprecatedAiAgent and setup-sensitive triggers', () => {
    const { files, warnings } = disassemble(
      makeDoc([
        makeActor({ id: TASK_ID, type: 'DeprecatedAiAgent' }),
        makeActor({ id: TRIGGER_ID, type: 'ScheduledTriggerActor' }),
      ]),
    );
    expect(warnings.some((warning) => warning.includes('DeprecatedAiAgent'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('verify its trigger URL/key, schedule, or external caller configuration'))).toBe(true);
    expect(root(files).warnings).toEqual(warnings);
  });

  it('throws on unknown actor types with an upgrade hint', () => {
    const doc = makeDoc([makeActor({ id: TASK_ID, type: 'FutureActor' })]);
    expect(() => disassemble(doc)).toThrow(/Unknown actor type 'FutureActor'.*upgrade/);
  });

  it('is deterministic', () => {
    expect(disassemble(makeWiredDoc()).files).toEqual(disassemble(makeWiredDoc()).files);
  });
});

describe('parseExportInput', () => {
  it('detects the {yaml, errors} JSON envelope from canvases export', () => {
    const envelope = JSON.stringify({ yaml: 'metadata:\n  slug: x\ndata:\n  schemaVersion: "1"\n  actors: {}\n', errors: [{ actorId: 'A' }] });
    const result = parseExportInput(envelope);
    expect(result.document.metadata.slug).toBe('x');
    expect(result.exportErrors).toEqual([{ actorId: 'A' }]);
  });

  it('parses a raw YAML export document with no errors channel', () => {
    const result = parseExportInput('metadata:\n  slug: y\ndata:\n  schemaVersion: "1"\n  actors: {}\n');
    expect(result.document.metadata.slug).toBe('y');
    expect(result.exportErrors).toEqual([]);
  });
});
