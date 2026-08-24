import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleFileMap } from '../../src/lib/bundle/types.js';
import { DENO_DIR, TASK_ID, TRIGGER_ID, makeDoc, makeLegacyDenoActor, makePythonActor, makeWiredDoc } from './fixtures.js';

const validFiles = (): BundleFileMap => ({ ...disassemble(makeWiredDoc()).files });
const TASK_DIR = DENO_DIR;

const withActorDoc = (files: BundleFileMap, mutate: (configuration: Record<string, unknown>) => void): BundleFileMap => {
  const actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
  mutate(actorDoc.configuration);
  return { ...files, [`${TASK_DIR}/actor.yaml`]: stringifyYamlDoc(actorDoc) };
};

const mutateRoot = (files: BundleFileMap, mutate: (root: Record<string, unknown>) => void): BundleFileMap => {
  const root = parseYamlDoc(files['canvas.yaml']) as Record<string, unknown>;
  mutate(root);
  return { ...files, 'canvas.yaml': stringifyYamlDoc(root) };
};

const messages = (issues: { path: string; message: string }[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');

describe('validateBundle', () => {
  it('accepts a disassembled bundle with no validation findings', () => {
    expect(validateBundle(validFiles())).toEqual({ errors: [], warnings: [] });
  });

  it('rejects a missing or unparseable canvas.yaml', () => {
    expect(validateBundle({}).errors[0].message).toMatch(/canvas\.yaml is missing/);
    expect(validateBundle({ 'canvas.yaml': 'format: [\n' }).errors[0].message).toMatch(/parse/i);
  });

  it('rejects wrong format or formatVersion', () => {
    const badFormat = mutateRoot(validFiles(), (root) => { root.format = 'wrong'; });
    const badVersion = mutateRoot(validFiles(), (root) => { root.formatVersion = 2; });
    expect(messages(validateBundle(badFormat).errors)).toMatch(/Unsupported format/);
    expect(messages(validateBundle(badVersion).errors)).toMatch(/formatVersion/);
  });

  it('rejects malformed or inconsistent sync baselines', () => {
    const missingMap = mutateRoot(validFiles(), (root) => { root.sync = {}; });
    const invalidVersion = mutateRoot(validFiles(), (root) => {
      root.sync = { actors: { [TASK_ID]: { editVersion: 'old', contentHash: `sha256:${'a'.repeat(64)}` } } };
    });
    const invalidHash = mutateRoot(validFiles(), (root) => {
      root.sync = { actors: { [TASK_ID]: { editVersion: 2, contentHash: 'sha256:not-a-digest' } } };
    });

    expect(messages(validateBundle(missingMap).errors)).toMatch(/`sync` must contain `actors` and\/or `reactAppAssets`/);
    expect(messages(validateBundle(invalidVersion).errors)).toMatch(/non-negative integer/);
    expect(messages(validateBundle(invalidHash).errors)).toMatch(/sha256-prefixed/);
  });

  it('rejects path escapes and registry mismatches', () => {
    const escape = mutateRoot(validFiles(), (root) => {
      (root.actors as { path: string }[])[0].path = 'actors/tasks/deno/../../../etc';
    });
    expect(messages(validateBundle(escape).errors)).toMatch(/Unsafe actor path/);

    const mismatch = mutateRoot(validFiles(), (root) => {
      const entry = (root.actors as { id: string; type: string; path: string }[]).find((actor) => actor.type === 'DenoActor');
      entry!.path = `actors/tasks/python/${entry!.id}`;
    });
    expect(messages(validateBundle(mismatch).errors)).toMatch(/expected actors\/tasks\/deno/);
  });

  it('detects duplicate actor ids and missing actor files', () => {
    const duplicate = mutateRoot(validFiles(), (root) => {
      const actors = root.actors as { id: string }[];
      actors.push({ ...actors[0] });
    });
    expect(messages(validateBundle(duplicate).errors)).toMatch(/Duplicate actor id/);

    const missing = validFiles();
    delete missing[`${TASK_DIR}/actor.yaml`];
    expect(messages(validateBundle(missing).errors)).toMatch(/Missing actor\.yaml/);
  });

  it('errors when actor.yaml id or type disagree with the index', () => {
    const files = validFiles();
    const actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as Record<string, unknown>;
    actorDoc.id = 'ACTR01other0000000000000000000';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/does not match/);
  });

  it('rejects unknown actor types with an upgrade hint', () => {
    const files = mutateRoot(validFiles(), (root) => {
      (root.actors as { type: string }[]).find((actor) => actor.type === 'DenoActor')!.type = 'FutureActor';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/Unknown actor type 'FutureActor'.*upgrade/);
  });

  it('enforces the codeDir marker contract', () => {
    let files = withActorDoc(validFiles(), (configuration) => { configuration.codeDir = 'src'; });
    expect(messages(validateBundle(files).errors)).toMatch(/codeDir must be 'code' or an inline list/);

    files = withActorDoc(validFiles(), (configuration) => { delete configuration.codeDir; });
    expect(messages(validateBundle(files).errors)).toMatch(/no configuration\.codeDir/);

    files = withActorDoc(validFiles(), (configuration) => {
      configuration.codeDir = [{ path: 'main.ts', content: 'x' }];
    });
    expect(messages(validateBundle(files).errors)).toMatch(/inline list but code\/ also contains files/);
  });

  it('rejects a project that keeps both an inline code string and project files', () => {
    const files = withActorDoc(validFiles(), (configuration) => { configuration.code = 'inline'; });
    expect(messages(validateBundle(files).errors)).toMatch(/Both configuration\.code and codeDir project files/);
  });

  it('tells a hand-authored inline code string where the source belongs', () => {
    const files = disassemble(makeDoc([makeLegacyDenoActor({ configuration: { options: {} } })])).files;
    const actorFile = `${TASK_DIR}/actor.yaml`;
    const actorDoc = parseYamlDoc(files[actorFile]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.code = 'export default 1;\n';
    files[actorFile] = stringifyYamlDoc(actorDoc);

    expect(messages(validateBundle(files).errors)).toMatch(/Inline configuration\.code is not supported for DenoActor.*code\/main\.ts/s);
  });

  it('requires the entrypoint each code actor runtime imports', () => {
    const files = validFiles();
    delete files[`${TASK_DIR}/code/main.ts`];
    expect(messages(validateBundle(files).errors)).toMatch(/DenoActor needs an entrypoint file at code\/main\.ts\./);

    const python = disassemble(makeDoc([makePythonActor()])).files;
    delete python[`actors/tasks/python/${TASK_ID}/code/main.py`];
    expect(messages(validateBundle(python).errors)).toMatch(/PythonActor needs an entrypoint file at code\/main\.py/);
  });

  it('tells a bundle still on the old entrypoint name how to migrate', () => {
    const files = validFiles();
    files[`${TASK_DIR}/code/mod.ts`] = files[`${TASK_DIR}/code/main.ts`];
    delete files[`${TASK_DIR}/code/main.ts`];

    expect(messages(validateBundle(files).errors)).toMatch(/rename code\/mod\.ts to code\/main\.ts/);
  });

  it('rejects filenames the runtime owns, per language', () => {
    let files = validFiles();
    files[`${TASK_DIR}/code/server.ts`] = '// nope\n';
    expect(messages(validateBundle(files).errors)).toMatch(/'server\.ts' is reserved by the BorgIQ runtime/);

    files = validFiles();
    files[`${TASK_DIR}/code/shared/api.ts`] = '// nope\n';
    expect(messages(validateBundle(files).errors)).toMatch(/reserved by the BorgIQ runtime \('shared\/'\)/);

    // Deno config discovery would prefer a user deno.json over the runtime's own config.
    files = validFiles();
    files[`${TASK_DIR}/code/deno.json`] = '{}\n';
    expect(messages(validateBundle(files).errors)).toMatch(/'deno\.json' is reserved/);

    // Case-insensitive, because a case-insensitive filesystem cannot tell the two apart.
    files = validFiles();
    files[`${TASK_DIR}/code/Handler.ts`] = '// nope\n';
    expect(messages(validateBundle(files).errors)).toMatch(/'Handler\.ts' is reserved by the BorgIQ runtime \('handler\.ts'\)/);

    const python = disassemble(makeDoc([makePythonActor()])).files;
    python[`actors/tasks/python/${TASK_ID}/code/borgiq/errors.py`] = '# nope\n';
    python[`actors/tasks/python/${TASK_ID}/code/pyproject.toml`] = '[project]\n';
    const pythonErrors = messages(validateBundle(python).errors);
    expect(pythonErrors).toMatch(/'borgiq\/errors\.py' is reserved by the BorgIQ runtime \('borgiq\/'\)/);
    expect(pythonErrors).toMatch(/'pyproject\.toml' is reserved/);
  });

  it('accepts a helper file the runtime does not own', () => {
    const files = validFiles();
    files[`${TASK_DIR}/code/lib/deep/util.ts`] = 'export const x = 1;\n';
    expect(validateBundle(files).errors).toEqual([]);
  });

  it('rejects two project paths that differ only in letter case', () => {
    const files = withActorDoc(
      { ...disassemble(makeDoc([makeLegacyDenoActor({ configuration: { options: {} } })])).files },
      (configuration) => {
        configuration.codeDir = [
          { path: 'main.ts', content: 'a' },
          { path: 'lib/Util.ts', content: 'b' },
          { path: 'lib/util.ts', content: 'c' },
        ];
      },
    );

    expect(messages(validateBundle(files).errors)).toMatch(/differ only in letter case/);
  });

  it('rejects a fixed-code actor carrying multi-file code, pointing at the upgrade', () => {
    const app = disassemble(makeDoc([{
      id: TASK_ID,
      type: 'AppTriggerActor',
      version: 1,
      name: 'App',
      msgVar: 'app',
      description: '',
      isActive: true,
      sourcePorts: [{ id: 'SPRTdefault' }],
      continueOnError: false,
      enableLTM: false,
      enableSTM: false,
      configuration: { options: {} },
      schemas: {},
      edges: {},
      position: { x: 0, y: 0 },
    }])).files;
    const actorFile = `actors/triggers/app/${TASK_ID}/actor.yaml`;
    const actorDoc = parseYamlDoc(app[actorFile]) as Record<string, unknown>;
    actorDoc.configuration = { codeDir: [{ path: 'index.html', content: '<h1>hi</h1>' }], options: {} };
    app[actorFile] = stringifyYamlDoc(actorDoc);

    expect(messages(validateBundle(app).errors)).toMatch(/multi-file actor code.*upgrade @borgiq\/cli/);
  });

  it('validates graph referential integrity', () => {
    let files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { edges: { targetActorId: string }[] };
      graph.edges[0].targetActorId = 'ACTR01missing000000000000000000';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/unknown actor/);

    files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { edges: { sourcePortId: string }[] };
      graph.edges[0].sourcePortId = 'SPRTnope';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/sourcePorts/);

    files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { nodes: { actorId: string }[] };
      graph.nodes = graph.nodes.filter((node) => node.actorId !== TRIGGER_ID);
    });
    expect(messages(validateBundle(files).errors)).toMatch(/graph\.nodes/);
  });

  it('validates aiAgentToolActorIds references', () => {
    const files = validFiles();
    const actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.aiAgentToolActorIds = ['ACTR01missing000000000000000000'];
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/aiAgentToolActorIds/);
  });

  it('warns on unreferenced files inside actors and ignores files outside it', () => {
    const files = validFiles();
    files['actors/stray.txt'] = 'hello\n';
    files['AGENTS.md'] = '# docs\n';
    files['.gitignore'] = '.borgiq/\n';
    const { errors, warnings } = validateBundle(files);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([{ path: 'actors/stray.txt', message: 'File is not referenced by canvas.yaml - it will be ignored.' }]);
  });
});
