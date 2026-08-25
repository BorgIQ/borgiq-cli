import { describe, expect, it } from 'vitest';

import { DENO_RESERVED_PATHS, PYTHON_RESERVED_PATHS } from '../../src/lib/bundle/registry.js';
import {
  MAX_CODE_DIR_FILES,
  MAX_CODE_DIR_TOTAL_BYTES,
  MAX_PROJECT_PATH_LENGTH,
  PROJECT_DIR_TYPES,
  binaryFileWarning,
  isIgnoredProjectDirFor,
  isIgnoredProjectPathFor,
  isProjectDirType,
  matchReservedPath,
  normalizeProjectDirExport,
  projectCodePrefix,
  splitProjectCodePath,
} from '../../src/lib/bundle/projectDir.js';
import {
  DENO_PROJECT,
  PYTHON_PROJECT,
  REACT_APP_ID,
  TASK_ID,
  makeActor,
  makeDenoActor,
  makeDoc,
  makePythonActor,
  makeReactAppActor,
} from './fixtures.js';

describe('project-dir path helpers', () => {
  it('maps every project type to its code prefix and back', () => {
    expect(projectCodePrefix('DenoActor', TASK_ID)).toBe(`actors/tasks/deno/${TASK_ID}/code/`);
    expect(projectCodePrefix('PythonActor', TASK_ID)).toBe(`actors/tasks/python/${TASK_ID}/code/`);
    expect(projectCodePrefix('UniversalTriggerActor', TASK_ID)).toBe(`actors/triggers/universal/${TASK_ID}/code/`);

    expect(splitProjectCodePath(`actors/tasks/deno/${TASK_ID}/code/lib/util.ts`))
      .toEqual({ actorType: 'DenoActor', actorId: TASK_ID, projectPath: 'lib/util.ts' });
    expect(splitProjectCodePath(`actors/tasks/python/${TASK_ID}/code/main.py`))
      .toEqual({ actorType: 'PythonActor', actorId: TASK_ID, projectPath: 'main.py' });
    expect(splitProjectCodePath(`actors/triggers/react-app/${REACT_APP_ID}/code/src/App.tsx`))
      .toEqual({ actorType: 'ReactAppTriggerActor', actorId: REACT_APP_ID, projectPath: 'src/App.tsx' });
  });

  it('ignores paths outside a project tree', () => {
    expect(splitProjectCodePath(`actors/tasks/deno/${TASK_ID}/actor.yaml`)).toBeUndefined();
    expect(splitProjectCodePath(`actors/tasks/deno/${TASK_ID}/code/`)).toBeUndefined();
    // An App actor's code/ holds three fixed files, not a project tree.
    expect(splitProjectCodePath(`actors/triggers/app/${TASK_ID}/code/index.html`)).toBeUndefined();
    expect(splitProjectCodePath(`actors/tasks/http-request/${TASK_ID}/code/main.ts`)).toBeUndefined();
    expect(splitProjectCodePath('canvas.yaml')).toBeUndefined();
  });

  it('lists the project types', () => {
    expect([...PROJECT_DIR_TYPES].sort()).toEqual([
      'DenoActor',
      'DenoTestActor',
      'PythonActor',
      'ReactAppTriggerActor',
      'UniversalTriggerActor',
    ]);
    expect(isProjectDirType('DenoActor')).toBe(true);
    expect(isProjectDirType('AppTriggerActor')).toBe(false);
    expect(isProjectDirType('FutureActor')).toBe(false);
  });
});

describe('per-type ignore rules', () => {
  it('skips the tooling output each language produces, at any depth', () => {
    expect(isIgnoredProjectPathFor('node_modules/x/index.js', 'DenoActor').ignored).toBe(true);
    expect(isIgnoredProjectPathFor('lib/node_modules/x/index.js', 'DenoActor').ignored).toBe(true);
    expect(isIgnoredProjectPathFor('deno.lock', 'DenoActor').ignored).toBe(true);

    expect(isIgnoredProjectPathFor('.venv/lib/python3.12/site.py', 'PythonActor').ignored).toBe(true);
    expect(isIgnoredProjectPathFor('lib/__pycache__/greeting.cpython-312.pyc', 'PythonActor').ignored).toBe(true);
    expect(isIgnoredProjectPathFor('uv.lock', 'PythonActor').ignored).toBe(true);

    expect(isIgnoredProjectPathFor('__borgiq_sdk_placeholder__/index.js', 'ReactAppTriggerActor').ignored).toBe(true);
  });

  it('keeps real source files of every type', () => {
    expect(isIgnoredProjectPathFor('main.ts', 'DenoActor')).toEqual({ ignored: false });
    expect(isIgnoredProjectPathFor('lib/greeting.ts', 'DenoActor')).toEqual({ ignored: false });
    expect(isIgnoredProjectPathFor('main.py', 'PythonActor')).toEqual({ ignored: false });
    // A Python virtualenv is a Python concern; a Deno project may legitimately hold that name.
    expect(isIgnoredProjectPathFor('.venv/notes.txt', 'DenoActor')).toEqual({ ignored: false });
    expect(isIgnoredProjectPathFor('uv.lock', 'DenoActor')).toEqual({ ignored: false });
  });

  it('warns about env files, naming the Vite leak only where a Vite build runs', () => {
    const deno = isIgnoredProjectPathFor('.env.production', 'DenoActor');
    expect(deno.ignored).toBe(true);
    expect(deno.warn).toMatch(/readable by anyone who can open the canvas/);
    expect(deno.warn).not.toMatch(/VITE_/);

    expect(isIgnoredProjectPathFor('.env', 'ReactAppTriggerActor').warn).toMatch(/VITE_\*/);
  });

  it('exposes the directory names a walker must not descend into', () => {
    expect(isIgnoredProjectDirFor('node_modules', 'DenoActor')).toBe(true);
    expect(isIgnoredProjectDirFor('__pycache__', 'PythonActor')).toBe(true);
    expect(isIgnoredProjectDirFor('__pycache__', 'DenoActor')).toBe(false);
    expect(isIgnoredProjectDirFor('lib', 'DenoActor')).toBe(false);
  });

  it('points a stray binary at the only channel that accepts one', () => {
    expect(binaryFileWarning('actors/tasks/deno/A/code/logo.png', 'DenoActor')).toMatch(/text only/);
    expect(binaryFileWarning('actors/triggers/react-app/A/code/logo.png', 'ReactAppTriggerActor'))
      .toMatch(/src\/assets\//);
  });
});

describe('matchReservedPath', () => {
  it('matches exact names case-insensitively', () => {
    expect(matchReservedPath('server.ts', DENO_RESERVED_PATHS)).toBe('server.ts');
    expect(matchReservedPath('Server.TS', DENO_RESERVED_PATHS)).toBe('server.ts');
    expect(matchReservedPath('deno.json', DENO_RESERVED_PATHS)).toBe('deno.json');
    expect(matchReservedPath('package.json', DENO_RESERVED_PATHS)).toBe('package.json');
    expect(matchReservedPath('pyproject.toml', PYTHON_RESERVED_PATHS)).toBe('pyproject.toml');
    expect(matchReservedPath('handler.py', PYTHON_RESERVED_PATHS)).toBe('handler.py');
  });

  it('matches directory prefixes, including the bare directory name', () => {
    expect(matchReservedPath('shared/api.ts', DENO_RESERVED_PATHS)).toBe('shared/');
    expect(matchReservedPath('Shared/deep/api.ts', DENO_RESERVED_PATHS)).toBe('shared/');
    expect(matchReservedPath('shared', DENO_RESERVED_PATHS)).toBe('shared/');
    expect(matchReservedPath('borgiq/errors.py', PYTHON_RESERVED_PATHS)).toBe('borgiq/');
    expect(matchReservedPath('.borgiq/server.py', PYTHON_RESERVED_PATHS)).toBe('.borgiq/');
  });

  it('leaves everything else alone, including names reserved for the other language', () => {
    expect(matchReservedPath('main.ts', DENO_RESERVED_PATHS)).toBeNull();
    expect(matchReservedPath('lib/shared.ts', DENO_RESERVED_PATHS)).toBeNull();
    expect(matchReservedPath('sharedish/api.ts', DENO_RESERVED_PATHS)).toBeNull();
    expect(matchReservedPath('handler.py', DENO_RESERVED_PATHS)).toBeNull();
    expect(matchReservedPath('main.py', PYTHON_RESERVED_PATHS)).toBeNull();
    expect(matchReservedPath('lib/borgiq/util.py', PYTHON_RESERVED_PATHS)).toBeNull();
  });
});

describe('normalizeProjectDirExport', () => {
  it('sorts the codeDir array of every project type by path', () => {
    const doc = makeDoc([
      makeDenoActor({ configuration: { codeDir: [...DENO_PROJECT].reverse().map((file) => ({ ...file })) } }),
      makePythonActor({
        id: 'ACTR01python00000000000000000',
        configuration: { codeDir: [...PYTHON_PROJECT].reverse().map((file) => ({ ...file })) },
      }),
      makeReactAppActor({
        configuration: {
          codeDir: [
            { path: 'src/main.tsx', content: 'main' },
            { path: 'index.html', content: 'html' },
          ],
        },
      }),
    ]);

    normalizeProjectDirExport(doc);

    const paths = (actorId: string): string[] =>
      (doc.data.actors[actorId].configuration!.codeDir as { path: string }[]).map((file) => file.path);
    expect(paths(TASK_ID)).toEqual(['lib/greeting.ts', 'main.ts']);
    expect(paths('ACTR01python00000000000000000')).toEqual(['lib/greeting.py', 'main.py']);
    expect(paths(REACT_APP_ID)).toEqual(['index.html', 'src/main.tsx']);
  });

  it('never reorders options.files, where a later overlay wins', () => {
    const files = [
      { path: 'src/assets/z.png', content: '${{ assets["z.png"] }}' },
      { path: 'src/assets/a.png', content: '${{ assets["a.png"] }}' },
    ];
    const doc = makeDoc([makeReactAppActor({ configuration: { codeDir: [], options: { files } } })]);

    normalizeProjectDirExport(doc);

    expect(doc.data.actors[REACT_APP_ID].configuration!.options).toEqual({ files });
  });

  it('leaves non-project types and malformed codeDir values alone', () => {
    const doc = makeDoc([
      makeActor({ id: TASK_ID, type: 'AppTriggerActor', configuration: { codeDir: [{ path: 'b' }, { path: 'a' }] } }),
      makeReactAppActor({ configuration: { codeDir: 'code' } }),
    ]);
    const malformed = makeDoc([
      makeReactAppActor({ configuration: { codeDir: [{ path: 'b' }, { nope: true }] } }),
    ]);

    expect(normalizeProjectDirExport(doc)).toBe(doc);
    expect((doc.data.actors[TASK_ID].configuration!.codeDir as { path: string }[])[0]).toEqual({ path: 'b' });
    expect(doc.data.actors[REACT_APP_ID].configuration!.codeDir).toBe('code');
    normalizeProjectDirExport(malformed);
    expect((malformed.data.actors[REACT_APP_ID].configuration!.codeDir as unknown[])[0]).toEqual({ path: 'b' });
  });
});

describe('limit mirrors', () => {
  it('tracks the limits the API enforces', () => {
    expect(MAX_CODE_DIR_FILES).toBe(200);
    expect(MAX_CODE_DIR_TOTAL_BYTES).toBe(1024 * 1024);
    expect(MAX_PROJECT_PATH_LENGTH).toBe(255);
  });
});
