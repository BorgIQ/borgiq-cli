import { describe, expect, it } from 'vitest';

import {
  BIQ_ACTOR_TYPES,
  BUNDLE_PATH_REGISTRY,
  DENO_RESERVED_PATHS,
  PYTHON_RESERVED_PATHS,
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

  it('marks the code actors and React App as the project-tree types', () => {
    const withProjectDir = Object.entries(BUNDLE_PATH_REGISTRY)
      .filter(([, spec]) => spec.projectDir)
      .map(([type]) => type)
      .sort();
    expect(withProjectDir).toEqual([
      'DenoActor',
      'DenoTestActor',
      'PythonActor',
      'ReactAppTriggerActor',
      'UniversalTriggerActor',
    ]);
    for (const type of withProjectDir) {
      expect(BUNDLE_PATH_REGISTRY[type as keyof typeof BUNDLE_PATH_REGISTRY].codeFiles).toEqual([]);
    }
  });

  it('gives each code actor its entrypoint and reserved set, and React App neither', () => {
    for (const type of ['DenoActor', 'DenoTestActor', 'UniversalTriggerActor'] as const) {
      expect(BUNDLE_PATH_REGISTRY[type].entrypoint).toBe('main.ts');
      expect(BUNDLE_PATH_REGISTRY[type].reservedPaths).toBe(DENO_RESERVED_PATHS);
    }
    expect(BUNDLE_PATH_REGISTRY.PythonActor.entrypoint).toBe('main.py');
    expect(BUNDLE_PATH_REGISTRY.PythonActor.reservedPaths).toBe(PYTHON_RESERVED_PATHS);

    expect(BUNDLE_PATH_REGISTRY.ReactAppTriggerActor.entrypoint).toBeUndefined();
    expect(BUNDLE_PATH_REGISTRY.ReactAppTriggerActor.reservedPaths).toBeUndefined();
  });

  it('names the runtime-owned paths of each language', () => {
    expect([...DENO_RESERVED_PATHS.exact].sort()).toEqual([
      'actor.ts',
      'deno.json',
      'deno.jsonc',
      'deno.lock',
      'handler.ts',
      'main_test.ts',
      'package.json',
      'server.ts',
    ]);
    expect([...DENO_RESERVED_PATHS.prefixes].sort()).toEqual(['node_modules/', 'shared/']);

    expect([...PYTHON_RESERVED_PATHS.exact].sort()).toEqual([
      '.python-version',
      'borgiq.py',
      'handler.py',
      'pyproject.toml',
      'server.py',
      'uv.lock',
    ]);
    expect([...PYTHON_RESERVED_PATHS.prefixes].sort()).toEqual(['.borgiq/', '.venv/', 'borgiq/']);

    // Every prefix carries its trailing slash, which is what the matcher compares against.
    for (const reserved of [DENO_RESERVED_PATHS, PYTHON_RESERVED_PATHS]) {
      for (const prefix of reserved.prefixes) expect(prefix.endsWith('/')).toBe(true);
    }
  });

  it('declares fixed code files only for App actors', () => {
    const withCodeFiles = Object.entries(BUNDLE_PATH_REGISTRY)
      .filter(([, spec]) => spec.codeFiles.length > 0)
      .map(([type]) => type);
    expect(withCodeFiles).toEqual(['AppTriggerActor']);
    expect(BUNDLE_PATH_REGISTRY.AppTriggerActor.codeFiles).toEqual([
      { file: 'index.html', source: { kind: 'option', key: 'html' } },
      { file: 'styles.css', source: { kind: 'option', key: 'css' } },
      { file: 'script.js', source: { kind: 'option', key: 'script' } },
    ]);
  });

  it('carries the local tooling output each project type produces', () => {
    expect(BUNDLE_PATH_REGISTRY.DenoActor.ignore?.dirs).toContain('node_modules');
    expect(BUNDLE_PATH_REGISTRY.PythonActor.ignore?.dirs).toEqual(
      expect.arrayContaining(['.venv', '__pycache__', '.borgiq']),
    );
    expect(BUNDLE_PATH_REGISTRY.PythonActor.ignore?.files).toContain('uv.lock');
    expect(BUNDLE_PATH_REGISTRY.ReactAppTriggerActor.ignore?.dirs).toContain('__borgiq_sdk_placeholder__');
    for (const spec of Object.values(BUNDLE_PATH_REGISTRY)) {
      if (spec.projectDir) expect(spec.ignore?.dirs).toContain('.git');
      else expect(spec.ignore).toBeUndefined();
    }
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
});
