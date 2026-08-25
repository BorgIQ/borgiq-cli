import { describe, expect, it } from 'vitest';

import {
  MAX_OPTIONS_FILES,
  assetExpression,
  assetKeyForFileName,
  isReactAppAssetPath,
  managedAssetEntries,
  optionsFileEntries,
  parseAssetExpression,
  reactAppCodePrefix,
  unmanagedAssetDirEntries,
} from '../../src/lib/bundle/reactApp.js';
import { REACT_APP_ID } from './fixtures.js';

describe('react-app path helpers', () => {
  it('maps an actor id to its project prefix', () => {
    expect(reactAppCodePrefix(REACT_APP_ID)).toBe(`actors/triggers/react-app/${REACT_APP_ID}/code/`);
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

describe('limit mirrors', () => {
  it('tracks the options.files limit the API enforces', () => {
    expect(MAX_OPTIONS_FILES).toBe(50);
  });
});
