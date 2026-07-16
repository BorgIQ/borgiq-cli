import { describe, expect, it } from 'vitest';

import {
  MAX_CODE_DIR_FILES,
  MAX_OPTIONS_FILES,
  assetExpression,
  assetKeyForFileName,
  isIgnoredProjectDir,
  isIgnoredProjectPath,
  isReactAppAssetPath,
  managedAssetEntries,
  normalizeReactAppExport,
  optionsFileEntries,
  parseAssetExpression,
  reactAppCodePrefix,
  splitReactAppCodePath,
  unmanagedAssetDirEntries,
} from '../../src/lib/bundle/reactApp.js';
import { REACT_APP_ID, makeActor, makeDoc, makeReactAppActor } from './fixtures.js';

describe('react-app path helpers', () => {
  it('maps actor ids to their project prefix and back', () => {
    expect(reactAppCodePrefix(REACT_APP_ID)).toBe(`actors/triggers/react-app/${REACT_APP_ID}/code/`);
    expect(splitReactAppCodePath(`actors/triggers/react-app/${REACT_APP_ID}/code/src/App.tsx`))
      .toEqual({ actorId: REACT_APP_ID, projectPath: 'src/App.tsx' });
  });

  it('ignores paths outside a react-app project tree', () => {
    expect(splitReactAppCodePath(`actors/tasks/deno/${REACT_APP_ID}/code/mod.ts`)).toBeUndefined();
    expect(splitReactAppCodePath(`actors/triggers/react-app/${REACT_APP_ID}/actor.yaml`)).toBeUndefined();
    expect(splitReactAppCodePath(`actors/triggers/react-app/${REACT_APP_ID}/code/`)).toBeUndefined();
    expect(splitReactAppCodePath('canvas.yaml')).toBeUndefined();
  });

  it('recognizes the asset directory only for files inside it', () => {
    expect(isReactAppAssetPath('src/assets/hero.png')).toBe(true);
    expect(isReactAppAssetPath('src/assets/icons/logo.svg')).toBe(true);
    expect(isReactAppAssetPath('src/assets')).toBe(false);
    expect(isReactAppAssetPath('src/assets/')).toBe(false);
    expect(isReactAppAssetPath('public/vite.svg')).toBe(false);
    expect(isReactAppAssetPath('src/App.tsx')).toBe(false);
  });
});

describe('isIgnoredProjectPath', () => {
  it('ignores tooling directories at any depth', () => {
    expect(isIgnoredProjectPath('node_modules/react/index.js').ignored).toBe(true);
    expect(isIgnoredProjectPath('packages/ui/node_modules/react/index.js').ignored).toBe(true);
    expect(isIgnoredProjectPath('dist/assets/index.js').ignored).toBe(true);
    expect(isIgnoredProjectPath('.vite/deps/react.js').ignored).toBe(true);
    expect(isIgnoredProjectPath('__borgiq_sdk_placeholder__/index.js').ignored).toBe(true);
  });

  it('ignores lockfiles and editor droppings', () => {
    for (const name of ['deno.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', '.DS_Store']) {
      expect(isIgnoredProjectPath(name).ignored).toBe(true);
    }
    expect(isIgnoredProjectPath('src/.DS_Store').ignored).toBe(true);
  });

  it('ignores env files with a warning that points elsewhere', () => {
    const verdict = isIgnoredProjectPath('.env.production');
    expect(verdict.ignored).toBe(true);
    expect(verdict.warn).toMatch(/VITE_\*/);
    expect(isIgnoredProjectPath('.env').warn).toBeDefined();
  });

  it('keeps real source files', () => {
    for (const path of ['src/App.tsx', 'package.json', 'index.html', 'src/assets/hero.png', 'public/vite.svg']) {
      expect(isIgnoredProjectPath(path)).toEqual({ ignored: false });
    }
  });

  it('exposes the directory names a walker must not descend into', () => {
    expect(isIgnoredProjectDir('node_modules')).toBe(true);
    expect(isIgnoredProjectDir('src')).toBe(false);
  });
});

describe('asset expressions', () => {
  it('reads the bracket form the CLI and editor write', () => {
    expect(parseAssetExpression('${{ assets["hero.png"] }}')).toBe('hero.png');
    expect(parseAssetExpression('${{assets["hero.png"]}}')).toBe('hero.png');
    expect(parseAssetExpression("${{ assets['hero.png'] }}")).toBe('hero.png');
    expect(parseAssetExpression('  ${{ assets["a b/c.png"] }}  ')).toBe('a b/c.png');
  });

  it('tolerates the hand-authored dot form', () => {
    expect(parseAssetExpression('${{ assets.hero }}')).toBe('hero');
    expect(parseAssetExpression('${{assets._logo2}}')).toBe('_logo2');
  });

  it('rejects anything that is not a bare asset reference', () => {
    expect(parseAssetExpression('hello')).toBeUndefined();
    expect(parseAssetExpression('')).toBeUndefined();
    expect(parseAssetExpression('${{ assets[""] }}')).toBeUndefined();
    expect(parseAssetExpression('${{ secrets["hero.png"] }}')).toBeUndefined();
    expect(parseAssetExpression('prefix ${{ assets["hero.png"] }}')).toBeUndefined();
    expect(parseAssetExpression({ id: 'FILE1' })).toBeUndefined();
    expect(parseAssetExpression(undefined)).toBeUndefined();
  });

  it('always writes the bracket form, which round-trips dot-form keys too', () => {
    expect(assetExpression('hero.png')).toBe('${{ assets["hero.png"] }}');
    expect(parseAssetExpression(assetExpression('hero.png'))).toBe('hero.png');
    expect(parseAssetExpression(assetExpression(parseAssetExpression('${{ assets.hero }}')!))).toBe('hero');
  });

  it('keys new uploads by file name', () => {
    expect(assetKeyForFileName('hero.png')).toBe('hero.png');
  });
});

describe('options.files classification', () => {
  const configurationWith = (files: unknown): Record<string, unknown> => ({ options: { files } });

  it('treats an asset-directory path with an asset reference as managed', () => {
    const configuration = configurationWith([
      { path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' },
      { path: 'src/assets/logo.svg', content: '${{ assets.logo }}' },
    ]);
    expect(managedAssetEntries(configuration)).toEqual([
      { index: 0, path: 'src/assets/hero.png', key: 'hero.png' },
      { index: 1, path: 'src/assets/logo.svg', key: 'logo' },
    ]);
  });

  it('leaves inline text, file handles, and non-asset paths unmanaged', () => {
    const configuration = configurationWith([
      { path: 'src/assets/notes.txt', content: 'inline text' },
      { path: 'src/assets/logo.svg', content: { id: 'FILE01', name: 'logo.svg' } },
      { path: 'public/robots.txt', content: '${{ assets["robots.txt"] }}' },
    ]);
    expect(managedAssetEntries(configuration)).toEqual([]);
    expect(unmanagedAssetDirEntries(configuration).map((entry) => entry.path))
      .toEqual(['src/assets/notes.txt', 'src/assets/logo.svg']);
  });

  it('preserves the authored index, which push uses to patch entries in place', () => {
    const configuration = configurationWith([
      { path: 'public/robots.txt', content: 'inline' },
      { path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' },
    ]);
    expect(managedAssetEntries(configuration)).toEqual([{ index: 1, path: 'src/assets/hero.png', key: 'hero.png' }]);
  });

  it('survives every malformed shape', () => {
    expect(optionsFileEntries(undefined)).toEqual([]);
    expect(optionsFileEntries({})).toEqual([]);
    expect(optionsFileEntries({ options: { files: 'nope' } })).toEqual([]);
    expect(optionsFileEntries({ options: { files: [null, 42, { content: 'no path' }] } })).toEqual([]);
    expect(managedAssetEntries({ options: { files: [{ path: 'src/assets/a.png' }] } })).toEqual([]);
  });
});

describe('normalizeReactAppExport', () => {
  it('sorts every react-app codeDir array by path', () => {
    const doc = makeDoc([
      makeReactAppActor({
        configuration: {
          codeDir: [
            { path: 'src/main.tsx', content: 'main' },
            { path: 'index.html', content: 'html' },
            { path: 'src/App.tsx', content: 'app' },
          ],
        },
      }),
    ]);

    normalizeReactAppExport(doc);

    const codeDir = doc.data.actors[REACT_APP_ID].configuration!.codeDir as { path: string }[];
    expect(codeDir.map((file) => file.path)).toEqual(['index.html', 'src/App.tsx', 'src/main.tsx']);
  });

  it('never reorders options.files, where a later overlay wins', () => {
    const files = [
      { path: 'src/assets/z.png', content: '${{ assets["z.png"] }}' },
      { path: 'src/assets/a.png', content: '${{ assets["a.png"] }}' },
    ];
    const doc = makeDoc([makeReactAppActor({ configuration: { codeDir: [], options: { files } } })]);

    normalizeReactAppExport(doc);

    expect(doc.data.actors[REACT_APP_ID].configuration!.options).toEqual({ files });
  });

  it('leaves other actor types and malformed codeDir values alone', () => {
    const doc = makeDoc([
      makeActor({ id: 'ACTR01deno0000000000000000000', type: 'DenoActor', configuration: { code: 'x' } }),
      makeReactAppActor({ configuration: { codeDir: 'code' } }),
    ]);
    const malformed = makeDoc([
      makeReactAppActor({ configuration: { codeDir: [{ path: 'b' }, { nope: true }] } }),
    ]);

    expect(normalizeReactAppExport(doc)).toBe(doc);
    expect(doc.data.actors[REACT_APP_ID].configuration!.codeDir).toBe('code');
    expect((malformed.data.actors[REACT_APP_ID].configuration!.codeDir as unknown[])[0]).toEqual({ path: 'b' });
  });
});

describe('limit mirrors', () => {
  it('tracks the limits the API enforces', () => {
    expect(MAX_CODE_DIR_FILES).toBe(200);
    expect(MAX_OPTIONS_FILES).toBe(50);
  });
});
