import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { BIQ_ACTOR_TYPES } from '../src/lib/bundle/registry.js';
import { VALID_ACTOR_TYPES, validateYaml } from '../src/lib/workflowValidation.js';

const ACTOR_ID = 'ACTR01hxxxxxxxxxxxxxxxxxxxxxxx';

const workflow = (configuration: Record<string, unknown>, type = 'DenoActor'): string =>
  yamlStringify({
    metadata: { schemaVersion: '1' },
    actors: {
      [ACTOR_ID]: {
        type,
        version: 1,
        name: 'Process event',
        msgVar: 'process_event',
        description: 'Processes an event',
        isActive: true,
        sourcePorts: [{ id: 'SPRTdefault' }],
        configuration,
        edges: {},
      },
    },
  });

const codeErrors = async (configuration: Record<string, unknown>, type?: string): Promise<string[]> => {
  const result = await validateYaml(workflow(configuration, type));
  return result.errors.filter((error) => error.includes('codeDir') || error.includes('code'));
};

describe('VALID_ACTOR_TYPES', () => {
  it('is the bundle registry minus the deprecated agent type', () => {
    expect(new Set([...VALID_ACTOR_TYPES, 'DeprecatedAiAgent'])).toEqual(new Set(BIQ_ACTOR_TYPES));
    expect(VALID_ACTOR_TYPES).not.toContain('DeprecatedAiAgent');
  });
});

describe('validateYaml: multi-file code actors', () => {
  it('accepts a project tree carrying its entrypoint', async () => {
    expect(await codeErrors({
      options: {},
      codeDir: [
        { path: 'main.ts', content: 'export default async () => ({ results: {} });\n' },
        { path: 'lib/util.ts', content: 'export const x = 1;\n' },
      ],
    })).toEqual([]);
  });

  it('requires the entrypoint of each language', async () => {
    expect(await codeErrors({ options: {}, codeDir: [{ path: 'lib/util.ts', content: 'export const x = 1;\n' }] }))
      .toEqual([`Actor '${ACTOR_ID}': 'configuration.codeDir' must contain an entrypoint file named 'main.ts'`]);

    expect(await codeErrors({ options: {}, codeDir: [{ path: 'util.py', content: 'x = 1\n' }] }, 'PythonActor'))
      .toEqual([`Actor '${ACTOR_ID}': 'configuration.codeDir' must contain an entrypoint file named 'main.py'`]);

    expect(await codeErrors({ options: {}, codeDir: [{ path: 'lib/util.ts', content: '' }] }, 'UniversalTriggerActor'))
      .toEqual([`Actor '${ACTOR_ID}': 'configuration.codeDir' must contain an entrypoint file named 'main.ts'`]);
  });

  it('rejects a codeDir that is not a list of {path, content} files', async () => {
    expect(await codeErrors({ options: {}, codeDir: 'code' }))
      .toEqual([`Actor '${ACTOR_ID}': 'configuration.codeDir' must be a list of {path, content} files`]);

    expect(await codeErrors({ options: {}, codeDir: [{ path: 'main.ts' }] }))
      .toEqual([`Actor '${ACTOR_ID}': 'configuration.codeDir[0]' must have a string 'path' and 'content'`]);
  });

  it('leaves a document still on the single code string to the API', async () => {
    expect(await codeErrors({ options: {}, code: 'export default async () => ({ results: {} });\n' })).toEqual([]);
    expect(await codeErrors({ options: {} })).toEqual([]);
  });

  it('still catches code nested inside options', async () => {
    expect(await codeErrors({ options: { code: 'export default 1;\n' } }))
      .toContainEqual(expect.stringContaining("'code' must be at 'configuration.code'"));
  });

  it('reads message-variable references across every file, not just the entrypoint', async () => {
    const result = await validateYaml(workflow({
      options: {},
      codeDir: [
        { path: 'main.ts', content: 'export default async () => ({ results: {} });\n' },
        { path: 'lib/util.ts', content: 'export const value = msg.no_such_actor.results;\n' },
      ],
    }));

    expect(result.warnings).toContainEqual(expect.stringContaining("msg.no_such_actor"));
  });

  it('does not shell out to a language toolchain to validate code', async () => {
    // Syntactically broken source is the API's verdict to give, and needs no local runtime.
    const result = await validateYaml(workflow({
      options: {},
      codeDir: [{ path: 'main.ts', content: 'export default async ( => {{{\n' }],
    }));

    expect(result.errors).toEqual([]);
  });
});

describe('validateYaml: JavaScriptActor', () => {
  const js = (content: string, options: Record<string, unknown> = {}) =>
    validateYaml(workflow({ options, codeDir: [{ path: 'main.ts', content }] }, 'JavaScriptActor'));

  it('accepts what its bundler accepts', async () => {
    const result = await js([
      'import { stashFile } from "@borgiq/actors";',
      'import { readFileSync } from "node:fs";',
      'import escape from "npm:escape-html@1.0.3";',
      'import { join } from "jsr:@std/path@1.0.8/posix";',
      'import { helper } from "./lib/helper.ts";',
      'export default async function receive() { return { results: escape(join("a", "b")) }; }',
    ].join('\n'), { allowNet: true, allowNetList: ['api.example.com'] });
    expect(result.errors).toEqual([]);
  });

  it('runs the DenoActor checks: mountFile and stashFile need allowNet', async () => {
    const result = await js('import { stashFile } from "@borgiq/actors";\nexport default async function receive() { await stashFile("x"); return { results: 1 }; }');
    expect(result.errors).toEqual([expect.stringContaining('stashFile which requires network access')]);
  });

  it.each([
    ['a floating npm: version', 'import x from "npm:escape-html";', 'must pin an exact version'],
    ['a range', 'import x from "npm:escape-html@^1.0.3";', 'must pin an exact version'],
    ['a jsr: tag', 'import { join } from "jsr:@std/path@latest";', 'must pin an exact version'],
    ['an https: import', 'import x from "https://deno.land/x/y/mod.ts";', 'never from a URL'],
    ['a bare import', 'import _ from "lodash";', 'is a bare specifier'],
    ['a dynamic bare import', 'const m = await import("zod");', 'is a bare specifier'],
    ['a node: name workerd lacks', 'import WebSocket from "node:ws";', '`node:ws` is not a Node.js built-in module the JavaScript actor provides'],
    ['an absolute path', 'import x from "/etc/passwd";', 'is an absolute path'],
  ])('refuses %s', async (_name, line, text) => {
    const result = await js(`${line}\nexport default async function receive() { return { results: 1 }; }`);
    expect(result.errors).toEqual([expect.stringContaining(text)]);
  });

  it('warns that allowFs does nothing', async () => {
    const result = await js('export default async function receive() { return { results: 1 }; }', { allowFs: true });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("'allowFs' does nothing")]));
  });
  const receive = 'export default async function receive() { return { results: 1 }; }';
  const files = (codeDir: Array<{ path: string; content: string }>) =>
    validateYaml(workflow({ options: {}, codeDir }, 'JavaScriptActor'));

  it('warns (does not refuse) on Deno. reached in code: it fails only if it runs', async () => {
    const result = await js(`const t = await Deno.makeTempDir();\n${receive}`);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("'Deno' does not exist in a JavaScriptActor")]));
  });

  it('warns on a guarded Deno use, and never errors', async () => {
    const result = await js(`const v = typeof Deno !== "undefined" ? Deno.env.get("X") : process.env.X;\n${receive}`);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("'Deno' does not exist")]));
  });

  it('ignores Deno. in comments, strings, template text and non-source files', async () => {
    const result = await files([
      {
        path: 'main.ts',
        content: [
          '// ported from Deno.readFile',
          '/* Deno.env.get("X") */',
          'const s = "Deno.exit()";',
          'const t = `call Deno.serve here`;',
          receive,
        ].join('\n'),
      },
      { path: 'README.md', content: 'Uses `Deno.readTextFile` in the original.' },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.includes('Deno'))).toEqual([]);
  });

  it('ignores imports in README.md, comments and string/template literals', async () => {
    const result = await files([
      {
        path: 'main.ts',
        content: [
          '// import _ from "lodash";',
          '/* import x from "https://deno.land/x/y/mod.ts"; */',
          "const s = 'import y from \"zod\"';",
          'const t = `import z from "left-pad"; ${1 + 1} await import("chalk")`;',
          'const re = /import a from "b"/;',
          receive,
        ].join('\n'),
      },
      { path: 'README.md', content: '```ts\nimport _ from "lodash";\nimport x from "node:ws";\n```\n' },
      { path: 'data.json', content: '{ "note": "import y from \\"zod\\"" }' },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('checks imports in a ${} expression and warns about unused source files', async () => {
    const result = await files([
      { path: 'main.ts', content: `const m = \`\${await import("zod")}\`;\n${receive}` },
      { path: 'lib/util.mjs', content: 'import _ from "lodash";\nexport const x = 1;\n' },
    ]);
    expect(result.errors).toEqual([
      expect.stringContaining('`zod` is a bare specifier'),
    ]);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('(lib/util.mjs, if bundled): `lodash` is a bare specifier'),
    );
  });

  it.each([
    ['import type', 'import type { Schema } from "zod";'],
    ['import type default', 'import type Lodash from "lodash";'],
    ['import type namespace', 'import type * as Z from "zod";'],
    ['every specifier type-marked', 'import { type A, type B } from "pkg";'],
    ['export type', 'export type { Options } from "pkg";'],
    ['export type *', 'export type * from "pkg";'],
    ['export with type-marked specifiers', 'export { type A } from "pkg";'],
  ])('skips a type-only import (%s): esbuild drops it before resolving', async (_name, line) => {
    const result = await js(`${line}\n${receive}`);
    expect(result.errors).toEqual([]);
  });

  it.each([
    ['a value next to a type', 'import { type A, b } from "pkg";'],
    ['a default named type', 'import type from "pkg";'],
    ['the value `type`, renamed', 'import { type as t } from "pkg";'],
  ])('checks an import that is not type-only (%s)', async (_name, line) => {
    const result = await js(`${line}\n${receive}`);
    expect(result.errors).toEqual([expect.stringContaining('`pkg` is a bare specifier')]);
  });

  it.each([
    ['lodash/chunk', 'npm:lodash@<exact version>/chunk'],
    ['@scope/pkg/sub/path', 'npm:@scope/pkg@<exact version>/sub/path'],
    ['@scope/pkg', 'npm:@scope/pkg@<exact version>'],
    ['lodash', 'npm:lodash@<exact version>'],
  ])('puts the version on the package name in the hint for %s', async (specifier, pinned) => {
    const result = await js(`import x from "${specifier}";\n${receive}`);
    expect(result.errors).toEqual([
      `Actor '${ACTOR_ID}': \`${specifier}\` is a bare specifier: import packages as \`${pinned}\``,
    ]);
  });

  it.each([
    ['fs', 'node:fs'],
    ['fs/promises', 'node:fs/promises'],
  ])('offers node: for a bare Node.js built-in workerd provides (%s)', async (specifier, node) => {
    const result = await js(`import x from "${specifier}";\n${receive}`);
    expect(result.errors).toEqual([expect.stringContaining(`(for the Node.js built-in, \`${node}\`)`)]);
  });

  it.each(['lodash', 'ws', 'test', 'sqlite'])('does not offer node: for %s (no bare workerd built-in)', async (specifier) => {
    const result = await js(`import x from "${specifier}";\n${receive}`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).not.toContain('node:');
  });

  it.each(['node:fs', 'node:fs/promises', 'node:crypto', 'node:test', 'node:sqlite'])('accepts %s, a built-in workerd provides', async (specifier) => {
    const result = await js(`import * as m from "${specifier}";\n${receive}`);
    expect(result.errors).toEqual([]);
  });

  it.each(['node:ws', 'node:sea', 'node:undici'])('refuses %s, which workerd does not provide', async (specifier) => {
    const result = await js(`import m from "${specifier}";\n${receive}`);
    expect(result.errors).toEqual([
      `Actor '${ACTOR_ID}': \`${specifier}\` is not a Node.js built-in module the JavaScript actor provides`,
    ]);
  });
});
