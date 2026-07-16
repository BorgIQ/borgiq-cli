import { describe, expect, it } from 'vitest';

import { assembleBundle } from '../../src/lib/bundle/assemble.js';
import { actorContentHash } from '../../src/lib/bundle/diff.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { normalizeReactAppExport } from '../../src/lib/bundle/reactApp.js';
import type { BundleFileMap, ExportedActor } from '../../src/lib/bundle/types.js';
import { stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { REACT_APP_DIR, REACT_APP_ID, REACT_APP_PROJECT, makeDoc, makeReactAppActor } from './fixtures.js';

const codePath = (projectPath: string): string => `${REACT_APP_DIR}/code/${projectPath}`;
const actorYaml = (files: BundleFileMap): Record<string, unknown> =>
  (assembleBundle(files).doc.data.actors[REACT_APP_ID].configuration ?? {});

describe('disassemble: react-app project tree', () => {
  it('externalizes the codeDir array to real files and leaves the marker behind', () => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor()]));

    expect(files[codePath('src/App.tsx')]).toBe('export default function App() {\n  return <h1>hi</h1>\n}\n');
    expect(files[codePath('index.html')]).toBe('<!doctype html>\n<div id="root"></div>\n');
    expect(Object.keys(files).filter((path) => path.startsWith(`${REACT_APP_DIR}/code/`)).sort())
      .toEqual(REACT_APP_PROJECT.map((file) => codePath(file.path)).sort());
    expect(stringifyYamlDoc(disassemble(makeDoc([makeReactAppActor()])).files[`${REACT_APP_DIR}/actor.yaml`]))
      .toContain('codeDir: code');
    expect(warnings).toEqual([]);
  });

  it('keeps options.files inline as the source of truth', () => {
    const files = [{ path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' }];
    const { files: bundle } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [], options: { files } },
    })]));

    expect(bundle[`${REACT_APP_DIR}/actor.yaml`]).toContain('${{ assets["hero.png"] }}');
    expect(bundle[codePath('src/assets/hero.png')]).toBeUndefined();
  });

  it('leaves the whole array inline when a path cannot be written to disk', () => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [{ path: '../escape.ts', content: 'x' }, { path: 'src/App.tsx', content: 'y' }] },
    })]));

    expect(Object.keys(files).some((path) => path.startsWith(`${REACT_APP_DIR}/code/`))).toBe(false);
    expect(warnings[0]).toMatch(/left inline .* '\.\.\/escape\.ts' cannot be written to disk safely/);
    expect(files[`${REACT_APP_DIR}/actor.yaml`]).toContain('../escape.ts');
  });

  it('leaves the whole array inline when two paths differ only in letter case', () => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [{ path: 'src/App.tsx', content: 'a' }, { path: 'src/app.tsx', content: 'b' }] },
    })]));

    expect(Object.keys(files).some((path) => path.startsWith(`${REACT_APP_DIR}/code/`))).toBe(false);
    expect(warnings[0]).toMatch(/differ only in letter case/);
  });

  it('reports every blocking problem but writes nothing partial', () => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [{ path: '/abs.ts', content: 'a' }, { path: 'ok.ts', content: 'b' }, 'not-an-entry'] },
    })]));

    expect(files[codePath('ok.ts')]).toBeUndefined();
    expect(warnings[0]).toMatch(/and 1 more problem/);
  });

  it('warns but still materializes a source file that sits in the asset directory', () => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [{ path: 'src/assets/react.svg', content: '<svg/>' }] },
    })]));

    expect(files[codePath('src/assets/react.svg')]).toBe('<svg/>');
    expect(warnings[0]).toMatch(/next push uploads it as an asset/);
  });

  it('does not treat a non-project actor type as a project tree', () => {
    const { files } = disassemble(makeDoc([makeReactAppActor({ type: 'DenoActor', id: REACT_APP_ID, configuration: { code: 'x' } })]));
    expect(files[`actors/tasks/deno/${REACT_APP_ID}/code/mod.ts`]).toBe('x');
  });
});

describe('assemble: react-app project tree', () => {
  it('rebuilds the array from code/ sorted by path, whatever order the map has', () => {
    const { files } = disassemble(makeDoc([makeReactAppActor()]));
    const shuffled = Object.fromEntries(Object.entries(files).reverse());

    const codeDir = actorYaml(shuffled).codeDir as { path: string }[];
    expect(codeDir.map((file) => file.path)).toEqual(['index.html', 'package.json', 'src/App.tsx', 'src/main.tsx', 'vite.config.ts']);
    expect(codeDir).toEqual(REACT_APP_PROJECT);
  });

  it('passes an inline array through verbatim when there is no code/ tree', () => {
    const inline = [{ path: 'b.ts', content: 'b' }, { path: 'a.ts', content: 'a' }];
    const { files } = disassemble(makeDoc([makeReactAppActor({
      configuration: { codeDir: [{ path: '../unsafe.ts', content: 'x' }] },
    })]));
    const withInline = { ...files, [`${REACT_APP_DIR}/actor.yaml`]: stringifyYamlDoc({
      id: REACT_APP_ID,
      type: 'ReactAppTriggerActor',
      sourcePorts: [],
      configuration: { codeDir: inline },
    }) };

    expect(actorYaml(withInline).codeDir).toEqual(inline);
  });

  it('rebuilds an empty array for a marker with no files', () => {
    const { files } = disassemble(makeDoc([makeReactAppActor({ configuration: { codeDir: [] } })]));
    expect(actorYaml(files).codeDir).toEqual([]);
  });
});

describe('react-app hash stability', () => {
  const hashOf = (actor: ExportedActor): string => actorContentHash(actor);

  it('disassemble -> assemble hashes equal to the normalized server document', () => {
    const server = makeDoc([makeReactAppActor()]);
    const { files } = disassemble(server);

    expect(hashOf(assembleBundle(files).doc.data.actors[REACT_APP_ID])).toBe(hashOf(server.data.actors[REACT_APP_ID]));
  });

  it('an unordered server array normalizes to the same hash a pulled bundle produces', () => {
    const unordered = makeDoc([makeReactAppActor({
      configuration: {
        codeDir: [...REACT_APP_PROJECT].reverse().map((file) => ({ ...file })),
        options: { files: [], endpoints: [] },
      },
    })]);
    const canonical = makeDoc([makeReactAppActor()]);

    expect(hashOf(unordered.data.actors[REACT_APP_ID])).not.toBe(hashOf(canonical.data.actors[REACT_APP_ID]));

    normalizeReactAppExport(unordered);
    const { files } = disassemble(unordered);

    expect(hashOf(unordered.data.actors[REACT_APP_ID])).toBe(hashOf(canonical.data.actors[REACT_APP_ID]));
    expect(hashOf(assembleBundle(files).doc.data.actors[REACT_APP_ID])).toBe(hashOf(canonical.data.actors[REACT_APP_ID]));
  });

  it('normalizes at the envelope seam, so a pulled canvas never shows a phantom local edit', () => {
    const unordered = makeDoc([makeReactAppActor({
      configuration: {
        codeDir: [...REACT_APP_PROJECT].reverse().map((file) => ({ ...file })),
        options: { files: [], endpoints: [] },
      },
    })]);

    const fromRawYaml = parseExportInput(stringifyYamlDoc(unordered));
    const fromEnvelope = parseExportInput(JSON.stringify({ yaml: stringifyYamlDoc(unordered), errors: [] }));
    const canonicalHash = hashOf(makeDoc([makeReactAppActor()]).data.actors[REACT_APP_ID]);

    expect(hashOf(fromRawYaml.document.data.actors[REACT_APP_ID])).toBe(canonicalHash);
    expect(hashOf(fromEnvelope.document.data.actors[REACT_APP_ID])).toBe(canonicalHash);
  });
});
