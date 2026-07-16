import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import type { BundleFileMap, BundleIssue } from '../../src/lib/bundle/types.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { REACT_APP_DIR, REACT_APP_ID, REACT_APP_PROJECT, makeDoc, makeReactAppActor } from './fixtures.js';

const ACTOR_YAML = `${REACT_APP_DIR}/actor.yaml`;
const codePath = (projectPath: string): string => `${REACT_APP_DIR}/code/${projectPath}`;

const bundleFiles = (): BundleFileMap => ({ ...disassemble(makeDoc([makeReactAppActor()])).files });

/** A bundle whose project lives inline in actor.yaml rather than as a code/ tree. */
const inlineBundle = (codeDir: unknown): BundleFileMap => {
  const files = bundleFiles();
  for (const path of Object.keys(files)) {
    if (path.startsWith(`${REACT_APP_DIR}/code/`)) delete files[path];
  }
  return mutateActor(files, (actor) => {
    (actor.configuration as Record<string, unknown>).codeDir = codeDir;
  });
};

const mutateActor = (files: BundleFileMap, mutate: (actor: Record<string, unknown>) => void): BundleFileMap => {
  const actor = parseYamlDoc(files[ACTOR_YAML]) as Record<string, unknown>;
  mutate(actor);
  return { ...files, [ACTOR_YAML]: stringifyYamlDoc(actor) };
};

const mutateRoot = (files: BundleFileMap, mutate: (root: Record<string, unknown>) => void): BundleFileMap => {
  const root = parseYamlDoc(files['canvas.yaml']) as Record<string, unknown>;
  mutate(root);
  return { ...files, 'canvas.yaml': stringifyYamlDoc(root) };
};

const withOptions = (files: BundleFileMap, options: unknown): BundleFileMap =>
  mutateActor(files, (actor) => {
    (actor.configuration as Record<string, unknown>).options = options;
  });

const text = (issues: BundleIssue[]): string => issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');

describe('validate: react-app project source', () => {
  it('accepts a disassembled react-app bundle with no findings', () => {
    expect(validateBundle(bundleFiles())).toEqual({ errors: [], warnings: [] });
  });

  it('accepts arbitrary file names and nesting under code/', () => {
    const files = bundleFiles();
    files[codePath('src/components/ui/button.tsx')] = 'export const Button = () => null\n';
    files[codePath('eslint.config.js')] = 'export default []\n';
    files[codePath('public/vite.svg')] = '<svg/>\n';

    expect(validateBundle(files).errors).toEqual([]);
  });

  it('does not apply the reserved runtime filenames to a project tree', () => {
    const files = bundleFiles();
    files[codePath('server.ts')] = 'export const server = 1\n';
    files[codePath('deno.lock')] = '{}\n';

    expect(validateBundle(files).errors).toEqual([]);
  });

  it('rejects an inline codeDir array alongside a code/ tree', () => {
    const files = mutateActor(bundleFiles(), (actor) => {
      (actor.configuration as Record<string, unknown>).codeDir = [{ path: 'a.ts', content: 'a' }];
    });

    expect(text(validateBundle(files).errors)).toMatch(/inline list but code\/ also contains files - remove one source/);
  });

  it('rejects a codeDir that is neither the marker nor a list', () => {
    expect(text(validateBundle(inlineBundle('src')).errors)).toMatch(/codeDir must be 'code' or an inline list/);
    expect(text(validateBundle(inlineBundle(42)).errors)).toMatch(/codeDir must be 'code' or an inline list/);
  });

  it('rejects a code/ tree with no marker', () => {
    const files = mutateActor(bundleFiles(), (actor) => {
      delete (actor.configuration as Record<string, unknown>).codeDir;
    });

    expect(text(validateBundle(files).errors)).toMatch(/code\/ files are present but actor\.yaml has no configuration\.codeDir marker/);
  });

  it('rejects malformed and unsafe inline codeDir entries', () => {
    expect(text(validateBundle(inlineBundle([{ path: 'a.ts' }])).errors)).toMatch(/codeDir\[0\] must be a mapping with string path and content/);
    expect(text(validateBundle(inlineBundle([{ path: '../x.ts', content: 'x' }])).errors)).toMatch(/codeDir\[0\] has unsafe path/);
    expect(text(validateBundle(inlineBundle([{ path: '/x.ts', content: 'x' }])).errors)).toMatch(/unsafe path/);
  });
});

describe('validate: react-app project warnings', () => {
  it('warns past the file count and total size the API enforces', () => {
    const many = bundleFiles();
    for (let index = 0; index <= 200; index += 1) many[codePath(`src/f${index}.ts`)] = 'x\n';
    const large = bundleFiles();
    large[codePath('src/big.ts')] = 'x'.repeat(1024 * 1024 + 1);

    expect(text(validateBundle(many).warnings)).toMatch(/files; the API rejects more than 200/);
    expect(text(validateBundle(large).warnings)).toMatch(/bytes; the API rejects more than 1048576/);
    expect(validateBundle(many).errors).toEqual([]);
  });

  it('warns on an over-long project path', () => {
    const files = bundleFiles();
    files[codePath(`src/${'a'.repeat(260)}.ts`)] = 'x\n';

    expect(text(validateBundle(files).warnings)).toMatch(/characters; the API rejects paths longer than 255/);
  });

  it('warns when the template must-haves are missing', () => {
    const bare = inlineBundle([{ path: 'src/App.tsx', content: 'x' }]);
    const warnings = text(validateBundle(bare).warnings);

    expect(warnings).toMatch(/no package\.json/);
    expect(warnings).toMatch(/no index\.html/);
    expect(warnings).toMatch(/no vite\.config\.ts/);
  });

  it('warns on a build script that does not run vite build', () => {
    const files = { ...bundleFiles(), [codePath('package.json')]: '{ "scripts": { "build": "tsc -b" } }' };
    const noScript = { ...bundleFiles(), [codePath('package.json')]: '{ "name": "app" }' };
    const notJson = { ...bundleFiles(), [codePath('package.json')]: '{ oops' };

    expect(text(validateBundle(files).warnings)).toMatch(/does not run 'vite build' \(found 'tsc -b'\)/);
    expect(text(validateBundle(noScript).warnings)).toMatch(/no 'build' script/);
    expect(text(validateBundle(notJson).warnings)).toMatch(/package\.json is not valid JSON/);
  });

  it('warns on the load-bearing vite settings, and tolerates either quote style', () => {
    const template = REACT_APP_PROJECT.find((file) => file.path === 'vite.config.ts')!.content;
    const files = { ...bundleFiles(), [codePath('vite.config.ts')]: 'export default defineConfig({ build: {} })\n' };
    const quoted = { ...bundleFiles(), [codePath('vite.config.ts')]: template.replace("base: './'", 'base: "./"') };

    const warnings = text(validateBundle(files).warnings);
    expect(warnings).toMatch(/base: '\.\/'/);
    expect(warnings).toMatch(/build\.cssCodeSplit: false/);
    expect(warnings).toMatch(/build\.assetsInlineLimit: 0/);
    expect(warnings).toMatch(/inlineDynamicImports: true/);
    expect(validateBundle(quoted).warnings).toEqual([]);
  });

  it('warns on an env file that reached the project source', () => {
    expect(text(validateBundle(inlineBundle([{ path: '.env.production', content: 'VITE_KEY=x' }])).warnings))
      .toMatch(/VITE_\*/);
  });
});

describe('validate: react-app options.files', () => {
  it('rejects a malformed overlay list', () => {
    expect(text(validateBundle(withOptions(bundleFiles(), { files: 'nope' })).errors))
      .toMatch(/options\.files must be a list/);
    expect(text(validateBundle(withOptions(bundleFiles(), { files: [{ content: 'x' }] })).errors))
      .toMatch(/options\.files\[0\] must be a mapping with a string path/);
    expect(text(validateBundle(withOptions(bundleFiles(), { files: [{ path: '../x.png', content: 'x' }] })).errors))
      .toMatch(/options\.files\[0\] has unsafe path/);
  });

  it('warns past the overlay count the API enforces', () => {
    const files = Array.from({ length: 51 }, (_unused, index) => ({
      path: `src/assets/a${index}.png`,
      content: `\${{ assets["a${index}.png"] }}`,
    }));

    expect(text(validateBundle(withOptions(bundleFiles(), { files })).warnings))
      .toMatch(/51 entries; the API rejects more than 50/);
  });

  it('warns on duplicate overlays and on overlays that shadow project source', () => {
    const duplicate = withOptions(bundleFiles(), {
      files: [
        { path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' },
        { path: 'src/assets/hero.png', content: '${{ assets["other.png"] }}' },
      ],
    });
    const shadowing = withOptions(bundleFiles(), { files: [{ path: 'index.html', content: '<div/>' }] });

    expect(text(validateBundle(duplicate).warnings)).toMatch(/duplicate entries for 'src\/assets\/hero\.png' - the last one wins/);
    expect(text(validateBundle(shadowing).warnings)).toMatch(/overlays 'index\.html', which also exists in the project source - the overlay wins/);
  });

  it('warns on asset-directory overlays the CLI does not manage', () => {
    const files = withOptions(bundleFiles(), {
      files: [
        { path: 'src/assets/notes.txt', content: 'inline text' },
        { path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' },
      ],
    });

    const warnings = text(validateBundle(files).warnings);
    expect(warnings).toMatch(/src\/assets\/notes\.txt.*not an asset reference/s);
    expect(warnings).not.toMatch(/hero\.png.*not an asset reference/s);
  });

  it('warns about a referenced asset only when the caller says what is on disk', () => {
    const files = withOptions(bundleFiles(), { files: [{ path: 'src/assets/hero.png', content: '${{ assets["hero.png"] }}' }] });

    expect(validateBundle(files).warnings).toEqual([]);
    expect(text(validateBundle(files, { localAssetPaths: [] }).warnings))
      .toMatch(/Asset 'hero\.png' is referenced but not present locally - run 'borgiq bundle pull'/);
    expect(validateBundle(files, { localAssetPaths: [codePath('src/assets/hero.png')] }).warnings).toEqual([]);
  });
});

describe('validate: sync.reactAppAssets baselines', () => {
  const baseline = { assetId: 'ASET01hero000000000000000000000', assetKey: 'hero.png', sha256: 'a'.repeat(64) };
  const withSync = (sync: unknown): BundleFileMap => mutateRoot(bundleFiles(), (root) => { root.sync = sync; });

  it('accepts a sync that carries asset baselines with no actor baselines', () => {
    expect(validateBundle(withSync({ reactAppAssets: { [REACT_APP_ID]: { 'src/assets/hero.png': baseline } } })).errors)
      .toEqual([]);
  });

  it('rejects malformed asset baselines', () => {
    const badDigest = withSync({ reactAppAssets: { [REACT_APP_ID]: { 'src/assets/hero.png': { ...baseline, sha256: 'nope' } } } });
    const emptyId = withSync({ reactAppAssets: { [REACT_APP_ID]: { 'src/assets/hero.png': { ...baseline, assetId: '' } } } });
    const emptyKey = withSync({ reactAppAssets: { [REACT_APP_ID]: { 'src/assets/hero.png': { ...baseline, assetKey: '' } } } });
    const notAMap = withSync({ reactAppAssets: { [REACT_APP_ID]: 'nope' } });

    expect(text(validateBundle(badDigest).errors)).toMatch(/sha256 must be a lowercase 64-character hex digest/);
    expect(text(validateBundle(emptyId).errors)).toMatch(/assetId must be a non-empty string/);
    expect(text(validateBundle(emptyKey).errors)).toMatch(/assetKey must be a non-empty string/);
    expect(text(validateBundle(notAMap).errors)).toMatch(/must be a mapping of project paths to asset baselines/);
  });

  it('names the offending path so the error is actionable', () => {
    const files = withSync({ reactAppAssets: { [REACT_APP_ID]: { 'src/assets/hero.png': { ...baseline, sha256: 'nope' } } } });
    expect(text(validateBundle(files).errors)).toContain(`sync.reactAppAssets.${REACT_APP_ID}['src/assets/hero.png']`);
  });
});
