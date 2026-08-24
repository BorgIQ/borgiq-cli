import { describe, expect, it } from 'vitest';

import { buildCanvasActor } from '../src/lib/scaffold.js';
import type { BIQActorSchema } from '../src/client/types.js';

const schema = (over: Partial<BIQActorSchema> = {}): BIQActorSchema => ({
  actorType: 'DenoActor',
  name: 'Deno',
  description: '',
  category: 'task',
  optionsSchema: null,
  actions: null,
  defaultOptions: { allowNet: false },
  sourcePorts: { type: 'singleDefault', fixedPorts: [], canAddPorts: false },
  code: { supported: true, language: 'typescript', entrypoint: 'main.ts', multiFile: true },
  canReceiveMessage: true,
  canEmitMessage: true,
  supportsConnection: false,
  enableLTM: false,
  enableSTM: false,
  ...over,
});

describe('buildCanvasActor code scaffolding', () => {
  it('emits a one-entry codeDir at the entrypoint the API names', () => {
    const actor = buildCanvasActor(schema(), { name: 'Process event' });

    const codeDir = actor.configuration.codeDir as { path: string; content: string }[];
    expect(codeDir).toHaveLength(1);
    expect(codeDir[0].path).toBe('main.ts');
    expect(codeDir[0].content.length).toBeGreaterThan(0);
    expect(actor.configuration.code).toBeUndefined();
  });

  it('uses the entrypoint of the language the API reports', () => {
    const actor = buildCanvasActor(
      schema({ actorType: 'PythonActor', code: { supported: true, language: 'python', entrypoint: 'main.py', multiFile: true } }),
      { name: 'Process event' },
    );

    expect((actor.configuration.codeDir as { path: string }[])[0].path).toBe('main.py');
  });

  it('falls back to the single code string when the server reports no multi-file support', () => {
    const older = buildCanvasActor(
      schema({ code: { supported: true, language: 'typescript' } }),
      { name: 'Process event' },
    );

    expect(typeof older.configuration.code).toBe('string');
    expect(older.configuration.codeDir).toBeUndefined();
  });

  it('scaffolds no code at all for an actor type that carries none', () => {
    const actor = buildCanvasActor(
      schema({ actorType: 'EchoActor', code: { supported: false, language: null, entrypoint: null, multiFile: false } }),
      { name: 'Echo' },
    );

    expect(actor.configuration.code).toBeUndefined();
    expect(actor.configuration.codeDir).toBeUndefined();
  });
});
