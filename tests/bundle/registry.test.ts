import { describe, expect, it } from 'vitest';

import {
  BIQ_ACTOR_TYPES,
  BUNDLE_PATH_REGISTRY,
  RESERVED_CODE_FILENAMES,
  actorFolderPath,
  isKnownActorType,
} from '../../src/lib/bundle/registry.js';

describe('BUNDLE_PATH_REGISTRY', () => {
  it('covers every declared bundle actor type', () => {
    expect(Object.keys(BUNDLE_PATH_REGISTRY).sort()).toEqual([...BIQ_ACTOR_TYPES].sort());
  });

  it('uses kebab-case folder names and known categories', () => {
    for (const spec of Object.values(BUNDLE_PATH_REGISTRY)) {
      expect(spec.folder).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['triggers', 'tasks', 'other']).toContain(spec.category);
    }
  });

  it('marks React App as the only project-tree type', () => {
    const withProjectDir = Object.entries(BUNDLE_PATH_REGISTRY)
      .filter(([, spec]) => spec.projectDir)
      .map(([type]) => type);
    expect(withProjectDir).toEqual(['ReactAppTriggerActor']);
    expect(BUNDLE_PATH_REGISTRY.ReactAppTriggerActor.codeFiles).toEqual([]);
  });

  it('declares code entrypoints only for the five code-heavy types', () => {
    const withCode = Object.entries(BUNDLE_PATH_REGISTRY)
      .filter(([, spec]) => spec.codeFiles.length > 0)
      .map(([type]) => type)
      .sort();
    expect(withCode).toEqual(['AppTriggerActor', 'DenoActor', 'DenoTestActor', 'PythonActor', 'UniversalTriggerActor']);
    expect(BUNDLE_PATH_REGISTRY.DenoActor.codeFiles).toEqual([{ file: 'mod.ts', source: { kind: 'code' } }]);
    expect(BUNDLE_PATH_REGISTRY.PythonActor.codeFiles).toEqual([{ file: 'mod.py', source: { kind: 'code' } }]);
    expect(BUNDLE_PATH_REGISTRY.AppTriggerActor.codeFiles).toEqual([
      { file: 'index.html', source: { kind: 'option', key: 'html' } },
      { file: 'styles.css', source: { kind: 'option', key: 'css' } },
      { file: 'script.js', source: { kind: 'option', key: 'script' } },
    ]);
  });

  it('builds actor folder paths from the registry', () => {
    expect(actorFolderPath('HttpRequestActor', 'ACTR123')).toBe('actors/tasks/http-request/ACTR123');
    expect(actorFolderPath('WebhookTriggerActor', 'ACTR123')).toBe('actors/triggers/webhook/ACTR123');
    expect(actorFolderPath('DeprecatedAiAgent', 'ACTR123')).toBe('actors/tasks/deprecated-ai-agent/ACTR123');
    expect(actorFolderPath('ReactAppTriggerActor', 'ACTR123')).toBe('actors/triggers/react-app/ACTR123');
  });

  it('recognizes known and unknown types', () => {
    expect(isKnownActorType('DenoActor')).toBe(true);
    expect(isKnownActorType('FutureActor')).toBe(false);
  });

  it('reserves runtime-owned code filenames', () => {
    for (const name of ['server.ts', 'handler.ts', 'actor.ts', 'deno.jsonc', 'deno.lock', 'mod_test.ts']) {
      expect(RESERVED_CODE_FILENAMES.has(name)).toBe(true);
    }
  });
});
