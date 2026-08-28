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
