import { describe, expect, it } from 'vitest';

import { actorContentHash } from '../../src/lib/bundle/diff.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { parseYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleRootDoc } from '../../src/lib/bundle/types.js';
import {
  DENO_DIR,
  DENO_PROJECT,
  EDGE_ID,
  LEGACY_DENO_CODE,
  PYTHON_DIR,
  PYTHON_PROJECT,
  TASK_ID,
  TRIGGER_ID,
  makeActor,
  makeDoc,
  makeLegacyDenoActor,
  makePythonActor,
  makeWiredDoc,
} from './fixtures.js';

const root = (files: Record<string, string>): BundleRootDoc => parseYamlDoc(files['canvas.yaml']) as BundleRootDoc;

const configurationOf = (files: Record<string, string>): Record<string, unknown> =>
  (parseYamlDoc(files[`${DENO_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> }).configuration;

describe('disassemble', () => {
  it('produces canvas.yaml plus one folder per actor at the registry path', () => {
    const { files } = disassemble(makeWiredDoc());
    expect(Object.keys(files).sort()).toEqual([
      `${DENO_DIR}/actor.yaml`,
      `${DENO_DIR}/code/lib/greeting.ts`,
      `${DENO_DIR}/code/main.ts`,
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

  it('externalizes a code actor project tree file by file', () => {
    const deno = disassemble(makeWiredDoc()).files;
    expect(deno[`${DENO_DIR}/code/main.ts`]).toBe(DENO_PROJECT[1].content);
    expect(deno[`${DENO_DIR}/code/lib/greeting.ts`]).toBe(DENO_PROJECT[0].content);
    const denoActor = parseYamlDoc(deno[`${DENO_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(denoActor.configuration.codeDir).toBe('code');
    expect(denoActor.configuration.code).toBeUndefined();

    const py = disassemble(makeDoc([makePythonActor()])).files;
    expect(py[`${PYTHON_DIR}/code/main.py`]).toBe(PYTHON_PROJECT[1].content);
    expect(py[`${PYTHON_DIR}/code/lib/greeting.py`]).toBe(PYTHON_PROJECT[0].content);
  });

  it('leaves a single-string configuration.code where it is, writing no entrypoint file for it', () => {
    // BorgIQ does not run this shape any more, so pulling it must not rebuild a bundle the API
    // would reject on push. The string stays visible in actor.yaml and validate names its file.
    const { files, warnings } = disassemble(makeDoc([makeLegacyDenoActor()]));

    expect(files[`${DENO_DIR}/code/main.ts`]).toBeUndefined();
    const actorDoc = parseYamlDoc(files[`${DENO_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(actorDoc.configuration.codeDir).toBeUndefined();
    expect(actorDoc.configuration.code).toBe(LEGACY_DENO_CODE);
    expect(warnings).toEqual([]);

    const { errors } = validateBundle(files);
    expect(errors.some((error) => error.message.includes(`${'code'}/main.ts`))).toBe(true);
  });

  it('consumes a stray code string beside a file list, so a bundle never carries two sources', () => {
    // A document can still hold both if something wrote the string back; the file list wins.
    const both = disassemble(makeDoc([makeLegacyDenoActor({
      configuration: {
        code: LEGACY_DENO_CODE,
        codeDir: [{ path: 'main.ts', content: 'export default 2;\n' }],
        options: {},
      },
    })]));

    expect(both.files[`${DENO_DIR}/code/main.ts`]).toBe('export default 2;\n');
    expect(configurationOf(both.files).code).toBeUndefined();
    expect(both.warnings[0]).toMatch(/configuration\.code was dropped/);
    expect(validateBundle(both.files).errors).toEqual([]);

    // An empty string beside a file list is still a second source: consumed, but silently -
    // there is nothing there to warn anybody about losing.
    const emptyStray = disassemble(makeDoc([makeLegacyDenoActor({
      configuration: { code: '', codeDir: [{ path: 'main.ts', content: 'export default 2;\n' }], options: {} },
    })]));

    expect(configurationOf(emptyStray.files).code).toBeUndefined();
    expect(emptyStray.warnings).toEqual([]);
    expect(validateBundle(emptyStray.files).errors).toEqual([]);
  });

  it('does not write a project file it would never read back', () => {
    const { files, warnings } = disassemble(makeDoc([makeLegacyDenoActor({
      configuration: {
        codeDir: [
          { path: 'main.ts', content: 'export default 1;\n' },
          { path: '.env', content: 'TOKEN=secret\n' },
        ],
        options: {},
      },
    })]));

    // Writing it would drop it silently on the next push, since the bundle is rebuilt
    // from what the reader collects - and the reader never collects this name.
    expect(files[`${DENO_DIR}/code/.env`]).toBeUndefined();
    expect(files[`${DENO_DIR}/code/main.ts`]).toBe('export default 1;\n');
    expect(warnings[0]).toMatch(/'\.env' is a name the CLI never syncs.*removes it from the actor/s);
    expect(validateBundle(files).errors).toEqual([]);
  });

  it('leaves a project tree inline when a path cannot be written, keeping every file', () => {
    const { files, warnings } = disassemble(makeDoc([makeLegacyDenoActor({
      configuration: {
        codeDir: [{ path: 'main.ts', content: 'a' }, { path: '../escape.ts', content: 'b' }],
        options: {},
      },
    })]));

    expect(Object.keys(files).some((path) => path.includes('/code/'))).toBe(false);
    const actorDoc = parseYamlDoc(files[`${DENO_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(actorDoc.configuration.codeDir).toEqual([
      { path: 'main.ts', content: 'a' },
      { path: '../escape.ts', content: 'b' },
    ]);
    expect(warnings[0]).toMatch(/cannot be written to disk safely/);
  });

  it('refuses a multi-file shape it cannot represent, pointing at the upgrade', () => {
    const doc = makeDoc([makeActor({
      id: TASK_ID,
      type: 'AppTriggerActor',
      configuration: { codeDir: [{ path: 'index.html', content: '<h1>hi</h1>' }], options: {} },
    })]);

    expect(() => disassemble(doc)).toThrow(/multi-file actor code.*upgrade @borgiq\/cli/);
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
    const actorDoc = parseYamlDoc(files[`${DENO_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
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
      DENO_DIR,
      `actors/triggers/webhook/${TRIGGER_ID}`,
    ]);
    expect(doc.exportErrors).toEqual(errors);
    expect(doc.format).toBe('borgiq.canvas.bundle');
    expect(doc.formatVersion).toBe(1);
  });

  it('records content-hash sync baselines', () => {
    const source = makeWiredDoc();
    const doc = root(disassemble(source, {
      actorVersions: {
        [TRIGGER_ID]: 3,
        [TASK_ID]: 2,
      },
    }).files);

    expect(doc.sync?.actors).toEqual({
      [TASK_ID]: { editVersion: 2, contentHash: actorContentHash(source.data.actors[TASK_ID]) },
      [TRIGGER_ID]: { editVersion: 3, contentHash: actorContentHash(source.data.actors[TRIGGER_ID]) },
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
