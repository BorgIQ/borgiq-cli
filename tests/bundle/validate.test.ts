import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleFileMap } from '../../src/lib/bundle/types.js';
import { TASK_ID, TRIGGER_ID, makeWiredDoc } from './fixtures.js';

const validFiles = (): BundleFileMap => ({ ...disassemble(makeWiredDoc()).files });
const TASK_DIR = `actors/tasks/deno/${TASK_ID}`;

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

  it('rejects malformed sync version markers instead of silently disabling conflict checks', () => {
    const missingMap = mutateRoot(validFiles(), (root) => { root.sync = {}; });
    const invalidVersion = mutateRoot(validFiles(), (root) => {
      root.sync = { actorVersions: { [TASK_ID]: 'old' } };
    });

    expect(messages(validateBundle(missingMap).errors)).toMatch(/sync\.actorVersions.*mapping/);
    expect(messages(validateBundle(invalidVersion).errors)).toMatch(/non-negative integer/);
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

  it('enforces the codeDir contract', () => {
    let files = validFiles();
    let actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.codeDir = 'src';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/codeDir must be 'code'/);

    files = validFiles();
    actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.code = 'inline';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/[Bb]oth codeDir and inline code/);

    files = validFiles();
    delete files[`${TASK_DIR}/code/mod.ts`];
    expect(messages(validateBundle(files).errors)).toMatch(/mod\.ts/);

    files = validFiles();
    files[`${TASK_DIR}/code/helper.ts`] = 'export const x = 1;\n';
    expect(messages(validateBundle(files).errors)).toMatch(/multi-file actor code is not yet supported/);

    files = validFiles();
    files[`${TASK_DIR}/code/server.ts`] = '// nope\n';
    expect(messages(validateBundle(files).errors)).toMatch(/runtime-owned/);

    files = validFiles();
    actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    delete actorDoc.configuration.codeDir;
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/no configuration\.codeDir/);
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
