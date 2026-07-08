# Canvas Bundle CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `borgiq bundle` command group that deterministically compiles the platform's single-document canvas export (`{metadata, data}` YAML) into a git/AI-friendly filesystem bundle and back, plus an offline `init` starter — zero platform changes.

**Architecture:** A pure compiler core in `src/lib/bundle/` operating on an in-memory `BundleFileMap` (`Record<relativePath, string>`): `disassemble` (export doc → files), `assemble` (files → export doc), `validate` (path-scoped errors/warnings), an exhaustive 30-type path registry, and one deterministic YAML serialization seam. Filesystem I/O lives in `src/lib/bundleFs.ts`; API transport reuses existing `BorgIQClient` methods (`exportCanvas`, `createCanvasWithData`, `importCanvasData`) — no client changes.

**Tech Stack:** TypeScript (strict, NodeNext ESM), commander 15, `yaml` 2.9.0 (already pinned), `ulidx` (already present), Vitest (new devDependency — first test infra in this repo).

**Spec:** `docs/superpowers/specs/2026-07-07-canvas-bundle-cli-design.md` (committed on this branch). Read it before starting any task.

## Global Constraints

- Repo: `/home/baskar/borgiq/dev-container/code/borgiq-cli`, branch `baskar/borg-565-add-canvas-bundle-zip-export-format-for-large-workflows`. Node >= 22.
- npm only. The ONLY new dependency allowed is `vitest` (devDependency, exact-pinned like all deps here).
- Coding standards: 2-space indent; single quotes; semicolons; ES modules with `.js` extensions on relative imports (even from `.ts` files — NodeNext); explicit return types on all functions; prefer `unknown` over `any`; files end with exactly one newline.
- Commit after every task (branch commits are save points; squash-merge means only the PR title must be a perfect conventional commit).
- Format constants (from spec, verbatim): `format: borgiq.canvas.bundle`, `formatVersion: 1`, root file `canvas.yaml`, actor file `actor.yaml`, code dir `code`, actor path shape `actors/<category>/<folder>/<ACTOR_ID>`.
- Determinism guarantees (from spec): (1) packing an unchanged bundle twice is byte-identical; (2) `unpack(pack(dir)) == dir` over managed paths when `exportErrors` is empty; (3) `pack(unpack(yaml))` deep-equals the input document. Never use `Date.now()`, locale-dependent sorts (`localeCompare`), or randomness in disassemble/assemble/validate. (IDs in `template.ts`/`init` ARE random — init is generative, exempt.)
- No timestamps or volatile fields in any generated bundle file.
- Verification commands: `npm run build` (tsc) and `npm test` (vitest) must pass at the end of every task.

---

## File Map (locked decomposition)

| File | Responsibility |
|---|---|
| Create `src/lib/bundle/types.ts` | `BundleFileMap`, export-document/actor/edge types, root-doc types, `BundleIssue`, `BundleError`, format + key-order constants |
| Create `src/lib/bundle/yaml.ts` | `parseYamlDoc`, `stringifyYamlDoc` (the ONE deterministic serialization seam), `orderKeys` |
| Create `src/lib/bundle/registry.ts` | 30-type `BUNDLE_PATH_REGISTRY`, `BIQActorType`, `actorFolderPath`, `isKnownActorType`, reserved filenames |
| Create `src/lib/bundle/envelope.ts` | `parseExportInput` — raw YAML doc or `{yaml, errors}` JSON envelope → `{document, exportErrors}` |
| Create `src/lib/bundle/disassemble.ts` | export doc → `BundleFileMap` (+ warnings): graph lifting, code externalization, dependency walk |
| Create `src/lib/bundle/validate.ts` | `validateBundle(files)` → `{errors, warnings}`, all 8 spec check groups |
| Create `src/lib/bundle/assemble.ts` | `assembleBundle(files)` → `{doc, warnings}`; throws `BundleValidationError` on invalid input |
| Create `src/lib/bundle/template.ts` | `buildStarterBundle`, `BUNDLE_AGENTS_MD`, `BUNDLE_GITIGNORE` |
| Create `src/lib/bundleFs.ts` | `readBundleDir` / `writeBundleDir` with managed-path overwrite semantics |
| Create `src/commands/bundle/{index,shared,init,unpack,pack,validate,pull,push}.ts` | Thin command shells |
| Modify `src/program.ts` | Register the bundle group |
| Modify `package.json` | `vitest` devDep + `"test": "vitest run"` script |
| Modify `AGENTS.md` (repo root) + `README.md` | Document the new group |
| Create `tests/bundle/{fixtures,yaml.test,registry.test,disassemble.test,validate.test,roundtrip.test,template.test,bundleFs.test}.ts` | Test suite (outside `src/` so `tsc` — `include: ["src"]` — never compiles or ships them) |

---

### Task 1: Vitest infra + bundle types + deterministic YAML helpers

**Files:**
- Modify: `package.json` (devDependency + test script)
- Create: `src/lib/bundle/types.ts`
- Create: `src/lib/bundle/yaml.ts`
- Test: `tests/bundle/yaml.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces (later tasks import these exactly):
  - from `types.ts`: `BundleFileMap`, `CanvasExportDocument`, `ExportedActor`, `ExportedEdge`, `BundleRootDoc`, `BundleGraphNode`, `BundleActorIndexEntry`, `BundleDependencies`, `BundleDependencyRef`, `BundleIssue`, `BundleError`, `FORMAT_NAME`, `FORMAT_VERSION`, `ROOT_FILE`, `ACTOR_FILE`, `CODE_DIR`, `ROOT_KEY_ORDER`, `CANVAS_KEY_ORDER`, `ACTOR_KEY_ORDER`, `CONFIGURATION_KEY_ORDER`, `EDGE_KEY_ORDER`
  - from `yaml.ts`: `parseYamlDoc(text: string): unknown`, `stringifyYamlDoc(value: unknown): string`, `orderKeys(obj: Record<string, unknown>, knownOrder: readonly string[]): Record<string, unknown>`

- [ ] **Step 1: Install vitest and add the test script**

```bash
cd /home/baskar/borgiq/dev-container/code/borgiq-cli
npm install --save-dev --save-exact vitest
```

Then edit `package.json` scripts block (keep existing entries):

```json
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build"
  },
```

- [ ] **Step 2: Write the failing test**

Create `tests/bundle/yaml.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { orderKeys, parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';

describe('orderKeys', () => {
  it('puts known keys first in the given order, unknown keys after alphabetically', () => {
    const input = { zeta: 1, name: 'x', alpha: 2, id: 'a' };
    expect(Object.keys(orderKeys(input, ['id', 'name']))).toEqual(['id', 'name', 'alpha', 'zeta']);
  });

  it('skips undefined values but keeps null values', () => {
    const input = { id: 'a', name: undefined, imagePath: null };
    const out = orderKeys(input, ['id', 'name', 'imagePath']);
    expect(Object.keys(out)).toEqual(['id', 'imagePath']);
    expect(out.imagePath).toBeNull();
  });
});

describe('stringifyYamlDoc', () => {
  it('is deterministic: same value, same bytes', () => {
    const value = { a: 'x'.repeat(300), b: ['one', 'two'], c: { nested: true } };
    expect(stringifyYamlDoc(value)).toBe(stringifyYamlDoc(value));
  });

  it('never folds long lines', () => {
    const url = `https://example.com/${'a'.repeat(300)}`;
    const text = stringifyYamlDoc({ url });
    expect(text.trimEnd().split('\n')).toHaveLength(1);
  });

  it('emits multiline strings as literal blocks and round-trips them exactly', () => {
    const code = 'line one\nline two\n\nline four\n';
    const text = stringifyYamlDoc({ code });
    expect(text).toContain('|');
    expect((parseYamlDoc(text) as { code: string }).code).toBe(code);
  });

  it('quotes strings that would parse as other scalar types', () => {
    const value = { v: '1', t: 'true', n: 'null' };
    expect(parseYamlDoc(stringifyYamlDoc(value))).toEqual(value);
  });

  it('never emits anchors or aliases for duplicate object references', () => {
    const shared = { k: 'v' };
    const text = stringifyYamlDoc({ a: shared, b: shared });
    expect(text).not.toContain('&');
    expect(text).not.toContain('*');
  });

  it('ends with exactly one trailing newline', () => {
    const text = stringifyYamlDoc({ a: 1 });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/bundle/yaml.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/bundle/yaml.js`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/bundle/types.ts`:

```typescript
/** Relative POSIX path → file contents. The in-memory form of a bundle. */
export type BundleFileMap = Record<string, string>;

/**
 * The platform's exported canvas document (`{ metadata, data }` — the YAML
 * returned by GET .../exportData). `data` is ExportedCanvasData: actors keyed
 * by id, with the 8 internally-YAML-string fields already parsed to objects.
 */
export interface CanvasExportDocument {
  metadata: Record<string, unknown>;
  data: {
    schemaVersion: string;
    actors: Record<string, ExportedActor>;
  };
}

/**
 * An actor in exported (object-shaped) form. Only the fields the compiler
 * transforms are typed; everything else passes through verbatim (the platform
 * spreads `...actor` on export, so unknown fields must survive round trips).
 */
export interface ExportedActor {
  id: string;
  type: string;
  name?: string;
  sourcePorts?: { id: string; name?: string; description?: string }[];
  edges?: Record<string, ExportedEdge>;
  position?: { x: number; y: number };
  configuration?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExportedEdge {
  id: string;
  sourceActorId: string;
  sourcePortId: string;
  targetActorId: string;
  targetPortId: string;
  label?: string;
  type?: string;
  [key: string]: unknown;
}

// ── Root canvas.yaml document ─────────────────────────────

export interface BundleGraphNode {
  actorId: string;
  position: { x: number; y: number };
}

export interface BundleActorIndexEntry {
  id: string;
  type: string;
  name: string;
  path: string;
}

export interface BundleDependencyRef {
  workspaceKey: string;
  referencedBy: string[];
}

export interface BundleDependencies {
  runtimes: string[];
  connections: BundleDependencyRef[];
  secrets: BundleDependencyRef[];
}

export interface BundleRootDoc {
  format: string;
  formatVersion: number;
  canvas: Record<string, unknown>;
  graph: { nodes: BundleGraphNode[]; edges: ExportedEdge[] };
  dependencies: BundleDependencies;
  exportErrors: unknown[];
  warnings: string[];
  actors: BundleActorIndexEntry[];
}

/** A validation/assembly finding anchored to a bundle-relative file path. */
export interface BundleIssue {
  path: string;
  message: string;
}

/** Thrown for compiler failures that are not per-file validation findings. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

// ── Format constants (BORG-565 Canvas Bundle v1) ──────────

export const FORMAT_NAME = 'borgiq.canvas.bundle';
export const FORMAT_VERSION = 1;
export const ROOT_FILE = 'canvas.yaml';
export const ACTOR_FILE = 'actor.yaml';
export const CODE_DIR = 'code';

// Canonical key orders. Known keys first in this order (absent ones skipped),
// unknown keys after, alphabetically — see orderKeys() in yaml.ts.
export const ROOT_KEY_ORDER = ['format', 'formatVersion', 'canvas', 'graph', 'dependencies', 'exportErrors', 'warnings', 'actors'] as const;
export const CANVAS_KEY_ORDER = ['id', 'slug', 'name', 'description', 'tags', 'imagePath', 'messageTTLInDays', 'runtimeSlug', 'schemaVersion'] as const;
export const ACTOR_KEY_ORDER = [
  'id', 'version', 'type', 'name', 'msgVar', 'description', 'isActive', 'sourcePorts', 'template', 'icon',
  'continueOnError', 'enableLTM', 'enableSTM', 'showInWorkspaceApps', 'runtimeSlug', 'webhookTriggerKey',
  'configuration', 'schemas',
] as const;
export const CONFIGURATION_KEY_ORDER = [
  'connection', 'webhook', 'schedule', 'aiAgentToolActorIds', 'credentials', 'codeDir', 'code',
  'inputs', 'vars', 'options', 'outputs', 'error',
] as const;
export const EDGE_KEY_ORDER = ['id', 'sourceActorId', 'sourcePortId', 'targetActorId', 'targetPortId', 'label', 'type'] as const;
```

Create `src/lib/bundle/yaml.ts`:

```typescript
import { parse, stringify } from 'yaml';

/** Parse YAML with the default core schema (strings stay strings, no dates). */
export const parseYamlDoc = (text: string): unknown => parse(text);

/**
 * Deterministic YAML serialization — the single seam every bundle file goes
 * through. Options (do not change without updating the determinism tests):
 * - lineWidth: 0            — never fold long lines (prompts/URLs stay whole)
 * - blockQuote: 'literal'   — multiline strings as `|` blocks (git-diffable)
 * - aliasDuplicateObjects: false — never emit anchors/aliases
 */
export const stringifyYamlDoc = (value: unknown): string =>
  stringify(value, { lineWidth: 0, blockQuote: 'literal', aliasDuplicateObjects: false });

/**
 * Rebuild an object with known keys first (in the given order, skipping
 * absent/undefined ones) and unknown keys after, alphabetically. Values are
 * untouched; null is data and survives, undefined is omission.
 */
export const orderKeys = (obj: Record<string, unknown>, knownOrder: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of knownOrder) {
    if (key in obj && obj[key] !== undefined) out[key] = obj[key];
  }
  const rest = Object.keys(obj)
    .filter((key) => !knownOrder.includes(key) && obj[key] !== undefined)
    .sort();
  for (const key of rest) out[key] = obj[key];
  return out;
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/bundle/yaml.test.ts`
Expected: PASS (7 tests). Also run `npm run build` — must compile clean, and `ls dist/lib/bundle` must NOT contain any `.test.` files (tests live outside `src/`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/bundle tests/bundle
git commit -m "test(lib): add vitest infra + deterministic bundle YAML helpers"
```

---

### Task 2: Actor path registry (exhaustive over 30 types)

**Files:**
- Create: `src/lib/bundle/registry.ts`
- Test: `tests/bundle/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BIQ_ACTOR_TYPES: readonly string[]` (30 entries), `type BIQActorType`
  - `type BundleCategory = 'triggers' | 'tasks' | 'other'`
  - `type CodeSource = { kind: 'code' } | { kind: 'option'; key: 'html' | 'css' | 'script' }`
  - `interface BundleCodeFile { file: string; source: CodeSource }`
  - `interface BundlePathSpec { category: BundleCategory; folder: string; codeFiles: BundleCodeFile[] }`
  - `BUNDLE_PATH_REGISTRY: Record<BIQActorType, BundlePathSpec>`
  - `isKnownActorType(type: string): type is BIQActorType`
  - `actorFolderPath(type: BIQActorType, actorId: string): string` → `actors/<category>/<folder>/<actorId>`
  - `RESERVED_CODE_FILENAMES: ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

Create `tests/bundle/registry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  BIQ_ACTOR_TYPES,
  BUNDLE_PATH_REGISTRY,
  RESERVED_CODE_FILENAMES,
  actorFolderPath,
  isKnownActorType,
} from '../../src/lib/bundle/registry.js';

describe('BUNDLE_PATH_REGISTRY', () => {
  it('covers exactly 30 actor types', () => {
    expect(BIQ_ACTOR_TYPES).toHaveLength(30);
    expect(Object.keys(BUNDLE_PATH_REGISTRY).sort()).toEqual([...BIQ_ACTOR_TYPES].sort());
  });

  it('uses kebab-case folder names and known categories', () => {
    for (const spec of Object.values(BUNDLE_PATH_REGISTRY)) {
      expect(spec.folder).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(['triggers', 'tasks', 'other']).toContain(spec.category);
    }
  });

  it('assigns the spec-verified categories (9 triggers / 19 tasks / 2 other)', () => {
    const byCategory = { triggers: 0, tasks: 0, other: 0 };
    for (const spec of Object.values(BUNDLE_PATH_REGISTRY)) byCategory[spec.category] += 1;
    expect(byCategory).toEqual({ triggers: 9, tasks: 19, other: 2 });
    expect(BUNDLE_PATH_REGISTRY.McpServerActor.category).toBe('triggers');
    expect(BUNDLE_PATH_REGISTRY.EchoActor.category).toBe('other');
    expect(BUNDLE_PATH_REGISTRY.CommentActor.category).toBe('other');
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
  });

  it('recognizes known and unknown types', () => {
    expect(isKnownActorType('DenoActor')).toBe(true);
    expect(isKnownActorType('FutureActor')).toBe(false);
  });

  it('reserves the runtime-owned filenames from BORG-565', () => {
    for (const name of ['server.ts', 'handler.ts', 'actor.ts', 'deno.jsonc', 'deno.lock', 'mod_test.ts']) {
      expect(RESERVED_CODE_FILENAMES.has(name)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bundle/registry.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/bundle/registry.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bundle/registry.ts`:

```typescript
/**
 * BORG-565 Canvas Bundle v1 actor-type path registry. Exhaustive over every
 * BIQActorType the platform defines (packages/runtime-types/src/canvas.ts) —
 * adding a type here without a BundlePathSpec is a compile error. Categories
 * mirror the platform's actor definition folders (actors/{trigger,task,other}).
 */

export const BIQ_ACTOR_TYPES = [
  'AgentHarnessActor', 'AiActor', 'AiAgentActor', 'AiRouterActor', 'AppTriggerActor',
  'ButtonTriggerActor', 'CallFlowActor', 'CallableResponseActor', 'CallableTriggerActor',
  'CollectionActor', 'CommentActor', 'DataStoreActor', 'DenoActor', 'DenoTestActor',
  'DeprecatedAiAgent', 'EchoActor', 'EmailTriggerActor', 'HttpRequestActor',
  'InterfaceActor', 'InterfaceStatusActor', 'InterfaceTriggerActor', 'McpServerActor',
  'MessageProcessorActor', 'PythonActor', 'RouterActor', 'ScheduledTriggerActor',
  'SendEmailActor', 'UniversalTriggerActor', 'WebhookResponseActor', 'WebhookTriggerActor',
] as const;

export type BIQActorType = (typeof BIQ_ACTOR_TYPES)[number];

export type BundleCategory = 'triggers' | 'tasks' | 'other';

/** Where a code file's contents live inside the exported actor. */
export type CodeSource = { kind: 'code' } | { kind: 'option'; key: 'html' | 'css' | 'script' };

export interface BundleCodeFile {
  file: string;
  source: CodeSource;
}

export interface BundlePathSpec {
  category: BundleCategory;
  folder: string;
  codeFiles: BundleCodeFile[];
}

const modTs = (): BundleCodeFile[] => [{ file: 'mod.ts', source: { kind: 'code' } }];

export const BUNDLE_PATH_REGISTRY: Record<BIQActorType, BundlePathSpec> = {
  // triggers (9)
  AppTriggerActor: {
    category: 'triggers',
    folder: 'app',
    codeFiles: [
      { file: 'index.html', source: { kind: 'option', key: 'html' } },
      { file: 'styles.css', source: { kind: 'option', key: 'css' } },
      { file: 'script.js', source: { kind: 'option', key: 'script' } },
    ],
  },
  ButtonTriggerActor: { category: 'triggers', folder: 'button', codeFiles: [] },
  CallableTriggerActor: { category: 'triggers', folder: 'callable', codeFiles: [] },
  EmailTriggerActor: { category: 'triggers', folder: 'email', codeFiles: [] },
  InterfaceTriggerActor: { category: 'triggers', folder: 'interface', codeFiles: [] },
  McpServerActor: { category: 'triggers', folder: 'mcp-server', codeFiles: [] },
  ScheduledTriggerActor: { category: 'triggers', folder: 'scheduled', codeFiles: [] },
  UniversalTriggerActor: { category: 'triggers', folder: 'universal', codeFiles: modTs() },
  WebhookTriggerActor: { category: 'triggers', folder: 'webhook', codeFiles: [] },
  // tasks (19)
  AgentHarnessActor: { category: 'tasks', folder: 'agent-harness', codeFiles: [] },
  AiActor: { category: 'tasks', folder: 'ai', codeFiles: [] },
  AiAgentActor: { category: 'tasks', folder: 'ai-agent', codeFiles: [] },
  AiRouterActor: { category: 'tasks', folder: 'ai-router', codeFiles: [] },
  CallFlowActor: { category: 'tasks', folder: 'call-flow', codeFiles: [] },
  CallableResponseActor: { category: 'tasks', folder: 'callable-response', codeFiles: [] },
  CollectionActor: { category: 'tasks', folder: 'collection', codeFiles: [] },
  DataStoreActor: { category: 'tasks', folder: 'data-store', codeFiles: [] },
  DenoActor: { category: 'tasks', folder: 'deno', codeFiles: modTs() },
  DenoTestActor: { category: 'tasks', folder: 'deno-test', codeFiles: modTs() },
  DeprecatedAiAgent: { category: 'tasks', folder: 'deprecated-ai-agent', codeFiles: [] },
  HttpRequestActor: { category: 'tasks', folder: 'http-request', codeFiles: [] },
  InterfaceActor: { category: 'tasks', folder: 'interface', codeFiles: [] },
  InterfaceStatusActor: { category: 'tasks', folder: 'interface-status', codeFiles: [] },
  MessageProcessorActor: { category: 'tasks', folder: 'message-processor', codeFiles: [] },
  PythonActor: { category: 'tasks', folder: 'python', codeFiles: [{ file: 'mod.py', source: { kind: 'code' } }] },
  RouterActor: { category: 'tasks', folder: 'router', codeFiles: [] },
  SendEmailActor: { category: 'tasks', folder: 'send-email', codeFiles: [] },
  WebhookResponseActor: { category: 'tasks', folder: 'webhook-response', codeFiles: [] },
  // other (2)
  CommentActor: { category: 'other', folder: 'comment', codeFiles: [] },
  EchoActor: { category: 'other', folder: 'echo', codeFiles: [] },
};

export const isKnownActorType = (type: string): type is BIQActorType =>
  (BIQ_ACTOR_TYPES as readonly string[]).includes(type);

export const actorFolderPath = (type: BIQActorType, actorId: string): string => {
  const spec = BUNDLE_PATH_REGISTRY[type];
  return `actors/${spec.category}/${spec.folder}/${actorId}`;
};

/** Runtime-owned filenames user code may never use inside code/ (BORG-565). */
export const RESERVED_CODE_FILENAMES: ReadonlySet<string> = new Set([
  'server.ts', 'handler.ts', 'actor.ts', 'deno.jsonc', 'deno.lock', 'mod_test.ts',
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bundle/registry.test.ts`
Expected: PASS. Run `npm run build` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bundle/registry.ts tests/bundle/registry.test.ts
git commit -m "feat(lib): add exhaustive 30-type canvas bundle path registry"
```

---

### Task 3: Disassembler (export doc → file map) + envelope input parsing

**Files:**
- Create: `src/lib/bundle/disassemble.ts`
- Create: `src/lib/bundle/envelope.ts`
- Create: `tests/bundle/fixtures.ts`
- Test: `tests/bundle/disassemble.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2 (`types.ts`, `yaml.ts`, `registry.ts`).
- Produces:
  - `disassemble(doc: CanvasExportDocument, opts?: { exportErrors?: unknown[] }): { files: BundleFileMap; warnings: string[] }` — throws `BundleError` on malformed docs or unknown actor types.
  - `parseExportInput(raw: string): { document: CanvasExportDocument; exportErrors: unknown[] }` from `envelope.ts`.
  - Fixture helpers `makeActor`, `makeDoc` from `tests/bundle/fixtures.ts` (used by every later test file).

- [ ] **Step 1: Write the fixtures module**

Create `tests/bundle/fixtures.ts`:

```typescript
import type { CanvasExportDocument, ExportedActor } from '../../src/lib/bundle/types.js';

/**
 * Build an exported actor with every platform-required field present
 * (exported canvases always carry edges/position/configuration.options).
 * Fixed, deterministic ids — never mint random ids in fixtures.
 */
export const makeActor = (over: Partial<ExportedActor> & { id: string; type: string }): ExportedActor => ({
  version: 1,
  name: over.id,
  msgVar: over.id.toLowerCase(),
  description: '',
  isActive: true,
  sourcePorts: [{ id: 'SPRTdefault' }],
  continueOnError: false,
  enableLTM: false,
  enableSTM: false,
  configuration: { options: {} },
  schemas: {},
  edges: {},
  position: { x: 0, y: 0 },
  ...over,
});

export const makeDoc = (actors: ExportedActor[], metadata?: Record<string, unknown>): CanvasExportDocument => ({
  metadata: {
    id: 'CNVS01aaaaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'test-canvas',
    name: 'Test Canvas',
    description: '',
    tags: '',
    imagePath: null,
    messageTTLInDays: 7,
    runtimeSlug: '',
    ...metadata,
  },
  data: {
    schemaVersion: '1',
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
  },
});

// Two wired actors: webhook trigger -> deno task (with code), used everywhere.
export const TRIGGER_ID = 'ACTR01trigger00000000000000000';
export const TASK_ID = 'ACTR01task000000000000000000000';
export const EDGE_ID = 'EDGE01edge000000000000000000000';

export const makeWiredDoc = (): CanvasExportDocument =>
  makeDoc([
    makeActor({
      id: TRIGGER_ID,
      type: 'WebhookTriggerActor',
      name: 'Incoming hook',
      webhookTriggerKey: '01hxxxxxxxxxxxxxxxxxxxxxxxxx',
      edges: {
        [EDGE_ID]: {
          id: EDGE_ID,
          sourceActorId: TRIGGER_ID,
          sourcePortId: 'SPRTdefault',
          targetActorId: TASK_ID,
          targetPortId: 'TPRTdefault',
          type: 'borgiqEdge',
        },
      },
    }),
    makeActor({
      id: TASK_ID,
      type: 'DenoActor',
      name: 'Process',
      position: { x: 320, y: 0 },
      configuration: {
        code: 'export default async function receive(req) {\n  return { results: {}, memory: req.memory };\n}\n',
        inputs: {},
        options: { allowNet: true, allowFs: true },
      },
    }),
  ]);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/bundle/disassemble.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { parseExportInput } from '../../src/lib/bundle/envelope.js';
import { parseYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleRootDoc } from '../../src/lib/bundle/types.js';
import { EDGE_ID, TASK_ID, TRIGGER_ID, makeActor, makeDoc, makeWiredDoc } from './fixtures.js';

const root = (files: Record<string, string>): BundleRootDoc => parseYamlDoc(files['canvas.yaml']) as BundleRootDoc;

describe('disassemble', () => {
  it('produces canvas.yaml plus one folder per actor at the registry path', () => {
    const { files } = disassemble(makeWiredDoc());
    expect(Object.keys(files).sort()).toEqual([
      `actors/tasks/deno/${TASK_ID}/actor.yaml`,
      `actors/tasks/deno/${TASK_ID}/code/mod.ts`,
      `actors/triggers/webhook/${TRIGGER_ID}/actor.yaml`,
      'canvas.yaml',
    ]);
  });

  it('lifts edges and positions into the root graph and strips them from actor.yaml', () => {
    const { files } = disassemble(makeWiredDoc());
    const doc = root(files);
    expect(doc.graph.nodes).toEqual([
      { actorId: TASK_ID, position: { x: 320, y: 0 } },
      { actorId: TRIGGER_ID, position: { x: 0, y: 0 } },
    ]);
    expect(doc.graph.edges).toHaveLength(1);
    expect(doc.graph.edges[0].id).toBe(EDGE_ID);
    const actorDoc = parseYamlDoc(files[`actors/triggers/webhook/${TRIGGER_ID}/actor.yaml`]) as Record<string, unknown>;
    expect(actorDoc.edges).toBeUndefined();
    expect(actorDoc.position).toBeUndefined();
  });

  it('externalizes Deno code into code/mod.ts and replaces it with codeDir', () => {
    const { files } = disassemble(makeWiredDoc());
    expect(files[`actors/tasks/deno/${TASK_ID}/code/mod.ts`]).toContain('export default');
    const actorDoc = parseYamlDoc(files[`actors/tasks/deno/${TASK_ID}/actor.yaml`]) as {
      configuration: Record<string, unknown>;
    };
    expect(actorDoc.configuration.codeDir).toBe('code');
    expect(actorDoc.configuration.code).toBeUndefined();
  });

  it('externalizes Python code as code/mod.py', () => {
    const doc = makeDoc([makeActor({ id: TASK_ID, type: 'PythonActor', configuration: { code: 'x = 1\n', options: {} } })]);
    const { files } = disassemble(doc);
    expect(files[`actors/tasks/python/${TASK_ID}/code/mod.py`]).toBe('x = 1\n');
  });

  it('splits app inline strings but leaves BIQFile references inline', () => {
    const doc = makeDoc([
      makeActor({
        id: TASK_ID,
        type: 'AppTriggerActor',
        configuration: {
          options: { html: '<h1>hi</h1>', css: { type: 'BIQFile', fileId: 'FILE1' }, allowInlineScripts: true },
        },
      }),
    ]);
    const { files } = disassemble(doc);
    const dir = `actors/triggers/app/${TASK_ID}`;
    expect(files[`${dir}/code/index.html`]).toBe('<h1>hi</h1>');
    expect(files[`${dir}/code/styles.css`]).toBeUndefined();
    expect(files[`${dir}/code/script.js`]).toBeUndefined();
    const actorDoc = parseYamlDoc(files[`${dir}/actor.yaml`]) as { configuration: { options: Record<string, unknown>; codeDir?: string } };
    expect(actorDoc.configuration.codeDir).toBe('code');
    expect(actorDoc.configuration.options.html).toBeUndefined();
    expect(actorDoc.configuration.options.css).toEqual({ type: 'BIQFile', fileId: 'FILE1' });
    expect(actorDoc.configuration.options.allowInlineScripts).toBe(true);
  });

  it('emits no code dir and no codeDir when a code-capable actor has no code', () => {
    const doc = makeDoc([makeActor({ id: TASK_ID, type: 'DenoActor', configuration: { options: {} } })]);
    const { files } = disassemble(doc);
    expect(Object.keys(files).some((p) => p.includes('/code/'))).toBe(false);
    const actorDoc = parseYamlDoc(files[`actors/tasks/deno/${TASK_ID}/actor.yaml`]) as { configuration: Record<string, unknown> };
    expect(actorDoc.configuration.codeDir).toBeUndefined();
  });

  it('walks dependencies from connection.key and credentials source', () => {
    const doc = makeDoc([
      makeActor({
        id: TASK_ID,
        type: 'HttpRequestActor',
        runtimeSlug: 'edge',
        configuration: {
          connection: { type: 'github', key: 'github-main' },
          credentials: {
            token: { workspaceKey: 'gh-token', source: 'secret' },
            slack: { workspaceKey: 'slack-prod', source: 'connection' },
          },
          options: {},
        },
      }),
    ]);
    const { files } = disassemble(doc);
    expect(root(files).dependencies).toEqual({
      runtimes: ['edge'],
      connections: [
        { workspaceKey: 'github-main', referencedBy: [TASK_ID] },
        { workspaceKey: 'slack-prod', referencedBy: [TASK_ID] },
      ],
      secrets: [{ workspaceKey: 'gh-token', referencedBy: [TASK_ID] }],
    });
  });

  it('records the actor index sorted by path and carries exportErrors', () => {
    const errors = [{ actorId: TASK_ID, field: 'options', error: 'bad yaml' }];
    const { files } = disassemble(makeWiredDoc(), { exportErrors: errors });
    const doc = root(files);
    expect(doc.actors.map((a) => a.path)).toEqual([
      `actors/tasks/deno/${TASK_ID}`,
      `actors/triggers/webhook/${TRIGGER_ID}`,
    ]);
    expect(doc.exportErrors).toEqual(errors);
    expect(doc.format).toBe('borgiq.canvas.bundle');
    expect(doc.formatVersion).toBe(1);
  });

  it('warns on DeprecatedAiAgent and on setup-sensitive triggers', () => {
    const { files, warnings } = disassemble(
      makeDoc([
        makeActor({ id: TASK_ID, type: 'DeprecatedAiAgent' }),
        makeActor({ id: TRIGGER_ID, type: 'ScheduledTriggerActor' }),
      ]),
    );
    expect(warnings.some((w) => w.includes('DeprecatedAiAgent'))).toBe(true);
    expect(warnings.some((w) => w.includes('target environment'))).toBe(true);
    expect(root(files).warnings).toEqual(warnings);
  });

  it('throws on unknown actor types with an upgrade hint', () => {
    const doc = makeDoc([makeActor({ id: TASK_ID, type: 'FutureActor' })]);
    expect(() => disassemble(doc)).toThrow(/Unknown actor type 'FutureActor'.*upgrade/);
  });

  it('is deterministic and matches the snapshot', () => {
    const first = disassemble(makeWiredDoc());
    const second = disassemble(makeWiredDoc());
    expect(first.files).toEqual(second.files);
    expect(first.files).toMatchSnapshot();
  });
});

describe('parseExportInput', () => {
  it('detects the {yaml, errors} JSON envelope from canvases export --json', () => {
    const envelope = JSON.stringify({ yaml: 'metadata:\n  slug: x\ndata:\n  schemaVersion: "1"\n  actors: {}\n', errors: [{ actorId: 'A' }] });
    const result = parseExportInput(envelope);
    expect(result.document.metadata.slug).toBe('x');
    expect(result.exportErrors).toEqual([{ actorId: 'A' }]);
  });

  it('parses a raw YAML export document with no errors channel', () => {
    const result = parseExportInput('metadata:\n  slug: y\ndata:\n  schemaVersion: "1"\n  actors: {}\n');
    expect(result.document.metadata.slug).toBe('y');
    expect(result.exportErrors).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/bundle/disassemble.test.ts`
Expected: FAIL — cannot resolve `disassemble.js` / `envelope.js`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/bundle/disassemble.ts`:

```typescript
import { BUNDLE_PATH_REGISTRY, actorFolderPath, isKnownActorType } from './registry.js';
import type { BIQActorType } from './registry.js';
import {
  ACTOR_FILE, ACTOR_KEY_ORDER, BundleError, CANVAS_KEY_ORDER, CODE_DIR, CONFIGURATION_KEY_ORDER,
  EDGE_KEY_ORDER, FORMAT_NAME, FORMAT_VERSION, ROOT_FILE, ROOT_KEY_ORDER,
} from './types.js';
import type {
  BundleActorIndexEntry, BundleDependencies, BundleFileMap, BundleGraphNode,
  CanvasExportDocument, ExportedActor, ExportedEdge,
} from './types.js';
import { orderKeys, stringifyYamlDoc } from './yaml.js';

export interface DisassembleOptions {
  exportErrors?: unknown[];
}

export interface DisassembleResult {
  files: BundleFileMap;
  warnings: string[];
}

/** Trigger types whose webhook/schedule setup does not transfer across environments. */
const SETUP_SENSITIVE_TYPES = new Set(['WebhookTriggerActor', 'ScheduledTriggerActor', 'UniversalTriggerActor', 'EmailTriggerActor']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Convert a platform canvas export document into the Canvas Bundle v1 file
 * map. Pure and deterministic: same document, same bytes. Lifts per-actor
 * edges/position into the root graph, externalizes code fields per the
 * registry, and passes every unrecognized actor field through verbatim.
 */
export const disassemble = (doc: CanvasExportDocument, opts: DisassembleOptions = {}): DisassembleResult => {
  if (!isPlainObject(doc) || !isPlainObject(doc.data) || !isPlainObject(doc.data.actors)) {
    throw new BundleError('Not a canvas export document — expected top-level `metadata` and `data.actors`.');
  }

  const actors = Object.values(doc.data.actors);
  const unknown = actors.filter((actor) => !isKnownActorType(actor.type));
  if (unknown.length > 0) {
    const list = unknown.map((actor) => `'${actor.type}' (${actor.id})`).join(', ');
    throw new BundleError(`Unknown actor type ${list} — this CLI version does not support it; upgrade @borgiq/cli.`);
  }

  const files: BundleFileMap = {};
  const warnings: string[] = [];
  const index: BundleActorIndexEntry[] = [];
  const nodes: BundleGraphNode[] = [];
  const edges: ExportedEdge[] = [];

  for (const actor of actors) {
    const type = actor.type as BIQActorType;
    const spec = BUNDLE_PATH_REGISTRY[type];
    const dir = actorFolderPath(type, actor.id);

    if (type === 'DeprecatedAiAgent') {
      warnings.push(`Actor ${actor.id} uses deprecated type DeprecatedAiAgent.`);
    }

    nodes.push({ actorId: actor.id, position: actor.position ?? { x: 0, y: 0 } });
    for (const edge of Object.values(actor.edges ?? {})) {
      edges.push(orderKeys(edge, EDGE_KEY_ORDER) as unknown as ExportedEdge);
    }

    const { edges: _edges, position: _position, ...rest } = actor;
    const configuration: Record<string, unknown> = { ...(isPlainObject(rest.configuration) ? rest.configuration : {}) };

    let hasCode = false;
    for (const codeFile of spec.codeFiles) {
      if (codeFile.source.kind === 'code') {
        if (typeof configuration.code === 'string') {
          files[`${dir}/${CODE_DIR}/${codeFile.file}`] = configuration.code;
          delete configuration.code;
          hasCode = true;
        }
      } else if (isPlainObject(configuration.options)) {
        const value = configuration.options[codeFile.source.key];
        if (typeof value === 'string') {
          files[`${dir}/${CODE_DIR}/${codeFile.file}`] = value;
          const options = { ...configuration.options };
          delete options[codeFile.source.key];
          configuration.options = options;
          hasCode = true;
        }
      }
    }
    if (hasCode) configuration.codeDir = CODE_DIR;

    const actorDoc = orderKeys(
      { ...rest, configuration: orderKeys(configuration, CONFIGURATION_KEY_ORDER) },
      ACTOR_KEY_ORDER,
    );
    files[`${dir}/${ACTOR_FILE}`] = stringifyYamlDoc(actorDoc);
    index.push({ id: actor.id, type, name: String(rest.name ?? ''), path: dir });
  }

  if (actors.some((actor) => SETUP_SENSITIVE_TYPES.has(actor.type))) {
    warnings.push('Scheduled and webhook triggers may require target environment setup after import.');
  }

  nodes.sort((a, b) => (a.actorId < b.actorId ? -1 : 1));
  edges.sort((a, b) => (a.id < b.id ? -1 : 1));
  index.sort((a, b) => (a.path < b.path ? -1 : 1));

  const canvas = orderKeys({ ...doc.metadata, schemaVersion: doc.data.schemaVersion }, CANVAS_KEY_ORDER);
  const rootDoc = orderKeys(
    {
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      canvas,
      graph: { nodes, edges },
      dependencies: walkDependencies(doc),
      exportErrors: opts.exportErrors ?? [],
      warnings,
      actors: index,
    },
    ROOT_KEY_ORDER,
  );
  files[ROOT_FILE] = stringifyYamlDoc(rootDoc);

  return { files, warnings };
};

/**
 * Reference-only dependency walk (mirrors the orchestrator's credential walk):
 * configuration.connection.key + credentials entries split by `source`.
 * Secret/connection VALUES are never exported — keys only.
 */
const walkDependencies = (doc: CanvasExportDocument): BundleDependencies => {
  const runtimes = new Set<string>();
  const connections = new Map<string, Set<string>>();
  const secrets = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, key: string, actorId: string): void => {
    const refs = map.get(key) ?? new Set<string>();
    refs.add(actorId);
    map.set(key, refs);
  };

  const metaRuntime = doc.metadata.runtimeSlug;
  if (typeof metaRuntime === 'string' && metaRuntime.length > 0) runtimes.add(metaRuntime);

  for (const actor of Object.values(doc.data.actors)) {
    if (typeof actor.runtimeSlug === 'string' && actor.runtimeSlug.length > 0) runtimes.add(actor.runtimeSlug);
    const configuration = isPlainObject(actor.configuration) ? actor.configuration : {};
    const connection = configuration.connection;
    if (isPlainObject(connection) && typeof connection.key === 'string' && connection.key.length > 0) {
      add(connections, connection.key, actor.id);
    }
    const credentials = configuration.credentials;
    if (isPlainObject(credentials)) {
      for (const entry of Object.values(credentials)) {
        if (!isPlainObject(entry) || typeof entry.workspaceKey !== 'string' || entry.workspaceKey.length === 0) continue;
        add(entry.source === 'connection' ? connections : secrets, entry.workspaceKey, actor.id);
      }
    }
  }

  const toRefs = (map: Map<string, Set<string>>): { workspaceKey: string; referencedBy: string[] }[] =>
    [...map.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([workspaceKey, refs]) => ({ workspaceKey, referencedBy: [...refs].sort() }));

  return { runtimes: [...runtimes].sort(), connections: toRefs(connections), secrets: toRefs(secrets) };
};
```

Create `src/lib/bundle/envelope.ts`:

```typescript
import { BundleError } from './types.js';
import type { CanvasExportDocument } from './types.js';
import { parseYamlDoc } from './yaml.js';

export interface ExportInput {
  document: CanvasExportDocument;
  exportErrors: unknown[];
}

/**
 * Accept either input shape for unpack:
 * - the `{ yaml, errors }` JSON envelope printed by `borgiq canvases export --json`
 * - a raw `{ metadata, data }` YAML export document
 * A raw YAML doc is never valid JSON, so JSON.parse cleanly discriminates;
 * pure-JSON export docs still work because JSON is a YAML subset.
 */
export const parseExportInput = (raw: string): ExportInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null && typeof (parsed as { yaml?: unknown }).yaml === 'string') {
    const envelope = parsed as { yaml: string; errors?: unknown[] };
    return {
      document: parseDocument(envelope.yaml),
      exportErrors: Array.isArray(envelope.errors) ? envelope.errors : [],
    };
  }
  return { document: parseDocument(raw), exportErrors: [] };
};

const parseDocument = (text: string): CanvasExportDocument => {
  const doc = parseYamlDoc(text);
  if (typeof doc !== 'object' || doc === null || !('data' in doc)) {
    throw new BundleError('Input is not a canvas export document (expected `metadata` and `data` keys).');
  }
  return doc as CanvasExportDocument;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/bundle/disassemble.test.ts`
Expected: PASS (12 tests; the snapshot is written on first run — eyeball `tests/bundle/__snapshots__/disassemble.test.ts.snap` once: canvas.yaml should read exactly like the spec's root example structure). Run `npm run build` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bundle tests/bundle
git commit -m "feat(lib): add canvas bundle disassembler and export-envelope parsing"
```

---

### Task 4: Bundle validation

**Files:**
- Create: `src/lib/bundle/validate.ts`
- Test: `tests/bundle/validate.test.ts`

**Interfaces:**
- Consumes: `types.ts`, `yaml.ts`, `registry.ts`, and (in tests) `disassemble` + fixtures to produce valid baseline bundles.
- Produces: `validateBundle(files: BundleFileMap): { errors: BundleIssue[]; warnings: BundleIssue[] }` — collects ALL findings (never fail-fast), each anchored to a bundle-relative path.

- [ ] **Step 1: Write the failing tests**

Create `tests/bundle/validate.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { BundleFileMap } from '../../src/lib/bundle/types.js';
import { TASK_ID, TRIGGER_ID, makeWiredDoc } from './fixtures.js';

const validFiles = (): BundleFileMap => ({ ...disassemble(makeWiredDoc()).files });

const TASK_DIR = `actors/tasks/deno/${TASK_ID}`;

/** Parse canvas.yaml, apply a mutation, re-serialize. */
const mutateRoot = (files: BundleFileMap, mutate: (root: Record<string, unknown>) => void): BundleFileMap => {
  const root = parseYamlDoc(files['canvas.yaml']) as Record<string, unknown>;
  mutate(root);
  return { ...files, 'canvas.yaml': stringifyYamlDoc(root) };
};

const messages = (issues: { path: string; message: string }[]): string => issues.map((i) => `${i.path}: ${i.message}`).join('\n');

describe('validateBundle', () => {
  it('accepts a disassembled bundle with no errors and no warnings', () => {
    const { errors, warnings } = validateBundle(validFiles());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('rejects a missing or unparseable canvas.yaml', () => {
    expect(validateBundle({}).errors[0].message).toMatch(/canvas\.yaml is missing/);
    expect(validateBundle({ 'canvas.yaml': ':\n  - bad' }).errors[0].message).toMatch(/parse/i);
  });

  it('rejects wrong format or formatVersion', () => {
    const files = mutateRoot(validFiles(), (root) => { root.formatVersion = 2; });
    expect(messages(validateBundle(files).errors)).toMatch(/formatVersion/);
  });

  it('rejects path escapes before touching files', () => {
    const files = mutateRoot(validFiles(), (root) => {
      (root.actors as { path: string }[])[0].path = 'actors/tasks/deno/../../../etc';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/path/i);
  });

  it('rejects a path that does not match the registry for the type', () => {
    const files = mutateRoot(validFiles(), (root) => {
      const entry = (root.actors as { id: string; type: string; path: string }[]).find((a) => a.type === 'DenoActor');
      entry!.path = `actors/tasks/python/${entry!.id}`;
    });
    expect(messages(validateBundle(files).errors)).toMatch(/expected actors\/tasks\/deno/);
  });

  it('detects duplicate actor ids at the file-map level', () => {
    const files = mutateRoot(validFiles(), (root) => {
      const actors = root.actors as { id: string }[];
      actors.push({ ...actors[0] });
    });
    expect(messages(validateBundle(files).errors)).toMatch(/Duplicate actor id/);
  });

  it('errors on a missing actor.yaml for an indexed actor', () => {
    const files = validFiles();
    delete files[`${TASK_DIR}/actor.yaml`];
    expect(messages(validateBundle(files).errors)).toMatch(/Missing actor\.yaml/);
  });

  it('errors when actor.yaml id or type disagree with the index', () => {
    const files = validFiles();
    const actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as Record<string, unknown>;
    actorDoc.id = 'ACTR01other0000000000000000000';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/does not match/);
  });

  it('rejects unknown actor types with an upgrade hint', () => {
    const files = mutateRoot(validFiles(), (root) => {
      (root.actors as { type: string }[]).find((a) => a.type === 'DenoActor')!.type = 'FutureActor';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/Unknown actor type 'FutureActor'.*upgrade/);
  });

  it('enforces the codeDir contract', () => {
    // wrong value
    let files = validFiles();
    let actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.codeDir = 'src';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/codeDir must be 'code'/);

    // dual source
    files = validFiles();
    actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.code = 'inline';
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/[Bb]oth codeDir and inline code/);

    // missing entrypoint
    files = validFiles();
    delete files[`${TASK_DIR}/code/mod.ts`];
    expect(messages(validateBundle(files).errors)).toMatch(/mod\.ts/);

    // helper file → multi-file error
    files = validFiles();
    files[`${TASK_DIR}/code/helper.ts`] = 'export const x = 1;\n';
    expect(messages(validateBundle(files).errors)).toMatch(/multi-file actor code is not yet supported/);

    // reserved filename → specific error
    files = validFiles();
    files[`${TASK_DIR}/code/server.ts`] = '// nope\n';
    expect(messages(validateBundle(files).errors)).toMatch(/runtime-owned/);

    // code file with no codeDir marker
    files = validFiles();
    actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    delete actorDoc.configuration.codeDir;
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/no configuration\.codeDir/);
  });

  it('validates graph referential integrity', () => {
    // edge to a missing target
    let files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { edges: { targetActorId: string }[] };
      graph.edges[0].targetActorId = 'ACTR01missing000000000000000000';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/unknown actor/);

    // bad source port
    files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { edges: { sourcePortId: string }[] };
      graph.edges[0].sourcePortId = 'SPRTnope';
    });
    expect(messages(validateBundle(files).errors)).toMatch(/sourcePorts/);

    // actor missing from graph.nodes
    files = mutateRoot(validFiles(), (root) => {
      const graph = root.graph as { nodes: { actorId: string }[] };
      graph.nodes = graph.nodes.filter((n) => n.actorId !== TRIGGER_ID);
    });
    expect(messages(validateBundle(files).errors)).toMatch(/graph\.nodes/);
  });

  it('validates aiAgentToolActorIds references', () => {
    const files = validFiles();
    const actorDoc = parseYamlDoc(files[`${TASK_DIR}/actor.yaml`]) as { configuration: Record<string, unknown> };
    actorDoc.configuration.aiAgentToolActorIds = ['ACTR01missing000000000000000000'];
    files[`${TASK_DIR}/actor.yaml`] = stringifyYamlDoc(actorDoc);
    expect(messages(validateBundle(files).errors)).toMatch(/aiAgentToolActorIds/);
  });

  it('warns (not errors) on unreferenced files inside actors/ and ignores files outside it', () => {
    const files = validFiles();
    files['actors/stray.txt'] = 'hello\n';
    files['AGENTS.md'] = '# docs\n';
    files['.gitignore'] = '.borgiq/\n';
    const { errors, warnings } = validateBundle(files);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('actors/stray.txt');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bundle/validate.test.ts`
Expected: FAIL — cannot resolve `validate.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bundle/validate.ts`:

```typescript
import { BUNDLE_PATH_REGISTRY, RESERVED_CODE_FILENAMES, actorFolderPath, isKnownActorType } from './registry.js';
import { ACTOR_FILE, CODE_DIR, FORMAT_NAME, FORMAT_VERSION, ROOT_FILE } from './types.js';
import type { BundleFileMap, BundleIssue } from './types.js';
import { parseYamlDoc } from './yaml.js';

export interface ValidateBundleResult {
  errors: BundleIssue[];
  warnings: BundleIssue[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate a bundle file map against the Canvas Bundle v1 contract. Collects
 * every finding (never fail-fast); errors block assembly, warnings do not
 * (unless the caller runs in --strict mode).
 */
export const validateBundle = (files: BundleFileMap): ValidateBundleResult => {
  const errors: BundleIssue[] = [];
  const warnings: BundleIssue[] = [];

  // 1. Root file
  const rootText = files[ROOT_FILE];
  if (rootText === undefined) {
    return { errors: [{ path: ROOT_FILE, message: 'canvas.yaml is missing — not a canvas bundle.' }], warnings };
  }
  let root: Record<string, unknown>;
  try {
    const parsed = parseYamlDoc(rootText);
    if (!isPlainObject(parsed)) throw new Error('document is not a mapping');
    root = parsed;
  } catch (error) {
    return { errors: [{ path: ROOT_FILE, message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}` }], warnings };
  }
  if (root.format !== FORMAT_NAME) {
    return { errors: [{ path: ROOT_FILE, message: `Unsupported format '${String(root.format)}' — expected '${FORMAT_NAME}'.` }], warnings };
  }
  if (root.formatVersion !== FORMAT_VERSION) {
    return { errors: [{ path: ROOT_FILE, message: `Unsupported formatVersion ${String(root.formatVersion)} — this CLI supports version ${FORMAT_VERSION}.` }], warnings };
  }
  const graph = root.graph;
  if (!Array.isArray(root.actors) || !isPlainObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { errors: [{ path: ROOT_FILE, message: 'Root document must contain `actors` (list) and `graph.nodes`/`graph.edges` (lists).' }], warnings };
  }

  // 2–6. Actor index entries, actor files, codeDir contract
  const idToPath = new Map<string, string>();
  const seenPaths = new Set<string>();
  const actorDocs = new Map<string, Record<string, unknown>>();
  const referenced = new Set<string>([ROOT_FILE]);

  // Type guard (not inline typeof checks): destructuring from a
  // Record<string, unknown> does not carry typeof narrowing in TS.
  const isIndexEntry = (value: unknown): value is { id: string; type: string; path: string } =>
    isPlainObject(value) && typeof value.id === 'string' && typeof value.type === 'string' && typeof value.path === 'string';

  for (const entry of root.actors as unknown[]) {
    if (!isIndexEntry(entry)) {
      errors.push({ path: ROOT_FILE, message: `Malformed actors[] entry: ${JSON.stringify(entry)} — need string id, type, and path.` });
      continue;
    }
    const { id, type, path } = entry;

    // Path safety BEFORE any file lookups.
    if (path.startsWith('/') || path.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) {
      errors.push({ path: ROOT_FILE, message: `Unsafe actor path '${path}' — absolute paths and '..' segments are rejected.` });
      continue;
    }
    if (!isKnownActorType(type)) {
      errors.push({ path, message: `Unknown actor type '${type}' — this CLI version does not support it; upgrade @borgiq/cli.` });
      continue;
    }
    const expected = actorFolderPath(type, id);
    if (path !== expected) {
      errors.push({ path, message: `Actor path does not match the registry — expected ${expected}.` });
    }
    if (idToPath.has(id)) {
      errors.push({ path: ROOT_FILE, message: `Duplicate actor id ${id} (paths ${idToPath.get(id)} and ${path}).` });
      continue;
    }
    idToPath.set(id, path);
    if (seenPaths.has(path)) {
      errors.push({ path: ROOT_FILE, message: `Duplicate actor path ${path}.` });
      continue;
    }
    seenPaths.add(path);

    const actorFile = `${path}/${ACTOR_FILE}`;
    referenced.add(actorFile);
    const text = files[actorFile];
    if (text === undefined) {
      errors.push({ path: actorFile, message: 'Missing actor.yaml for indexed actor.' });
      continue;
    }
    let actorDoc: Record<string, unknown>;
    try {
      const parsed = parseYamlDoc(text);
      if (!isPlainObject(parsed)) throw new Error('document is not a mapping');
      actorDoc = parsed;
    } catch (error) {
      errors.push({ path: actorFile, message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (actorDoc.id !== id) errors.push({ path: actorFile, message: `actor.yaml id '${String(actorDoc.id)}' does not match index id '${id}'.` });
    if (actorDoc.type !== type) errors.push({ path: actorFile, message: `actor.yaml type '${String(actorDoc.type)}' does not match index type '${type}'.` });
    actorDocs.set(id, actorDoc);

    // codeDir contract
    const spec = BUNDLE_PATH_REGISTRY[type];
    const configuration = isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {};
    const codePrefix = `${path}/${CODE_DIR}/`;
    const codeFilesPresent = Object.keys(files).filter((p) => p.startsWith(codePrefix));
    for (const p of codeFilesPresent) referenced.add(p); // accounted for here, never double-reported as unreferenced
    const canonical = new Set(spec.codeFiles.map((cf) => `${codePrefix}${cf.file}`));

    if (configuration.codeDir !== undefined) {
      if (configuration.codeDir !== CODE_DIR) {
        errors.push({ path: actorFile, message: `configuration.codeDir must be 'code', got '${String(configuration.codeDir)}'.` });
      }
      if (spec.codeFiles.length === 0) {
        errors.push({ path: actorFile, message: `Actor type ${type} does not support external code — remove configuration.codeDir.` });
      }
      const inline: string[] = [];
      if (typeof configuration.code === 'string') inline.push('configuration.code');
      const options = isPlainObject(configuration.options) ? configuration.options : {};
      for (const cf of spec.codeFiles) {
        if (cf.source.kind === 'option' && typeof options[cf.source.key] === 'string') inline.push(`configuration.options.${cf.source.key}`);
      }
      if (inline.length > 0) {
        errors.push({ path: actorFile, message: `Both codeDir and inline code present (${inline.join(', ')}) — remove one source.` });
      }
      if (spec.codeFiles.length > 0 && !spec.codeFiles.some((cf) => files[`${codePrefix}${cf.file}`] !== undefined)) {
        errors.push({ path: `${codePrefix}${spec.codeFiles[0].file}`, message: `codeDir is set but no code file exists (expected ${spec.codeFiles.map((cf) => cf.file).join(' or ')}).` });
      }
      for (const p of codeFilesPresent) {
        if (canonical.has(p)) continue;
        const base = p.slice(codePrefix.length);
        const reserved = RESERVED_CODE_FILENAMES.has(base) || base.startsWith('shared/');
        errors.push({
          path: p,
          message: reserved
            ? `'${base}' is runtime-owned and may not appear in a bundle.`
            : `Unexpected file in code/ — multi-file actor code is not yet supported (v1 allows only: ${spec.codeFiles.map((cf) => cf.file).join(', ')}).`,
        });
      }
    } else if (codeFilesPresent.length > 0) {
      errors.push({ path: codeFilesPresent[0], message: 'code/ files present but actor.yaml has no configuration.codeDir marker.' });
    }
  }

  // 7. Graph referential integrity
  const nodeIds = new Set<string>();
  for (const node of graph.nodes as unknown[]) {
    if (!isPlainObject(node) || typeof node.actorId !== 'string' || !isPlainObject(node.position)) {
      errors.push({ path: ROOT_FILE, message: `Malformed graph node: ${JSON.stringify(node)}.` });
      continue;
    }
    if (!idToPath.has(node.actorId)) errors.push({ path: ROOT_FILE, message: `graph.nodes references unknown actor ${node.actorId}.` });
    if (nodeIds.has(node.actorId)) errors.push({ path: ROOT_FILE, message: `Duplicate graph node for actor ${node.actorId}.` });
    nodeIds.add(node.actorId);
  }
  for (const id of idToPath.keys()) {
    if (!nodeIds.has(id)) errors.push({ path: ROOT_FILE, message: `Actor ${id} has no graph.nodes entry.` });
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges as unknown[]) {
    if (!isPlainObject(edge) || typeof edge.id !== 'string' || typeof edge.sourceActorId !== 'string' || typeof edge.targetActorId !== 'string' || typeof edge.sourcePortId !== 'string') {
      errors.push({ path: ROOT_FILE, message: `Malformed graph edge: ${JSON.stringify(edge)}.` });
      continue;
    }
    if (edgeIds.has(edge.id)) errors.push({ path: ROOT_FILE, message: `Duplicate edge id ${edge.id}.` });
    edgeIds.add(edge.id);
    for (const endpoint of [edge.sourceActorId, edge.targetActorId]) {
      if (!idToPath.has(endpoint)) errors.push({ path: ROOT_FILE, message: `Edge ${edge.id} references unknown actor ${endpoint}.` });
    }
    const sourceDoc = actorDocs.get(edge.sourceActorId);
    if (sourceDoc) {
      const ports = Array.isArray(sourceDoc.sourcePorts) ? (sourceDoc.sourcePorts as { id?: unknown }[]) : [];
      if (!ports.some((port) => port.id === edge.sourcePortId)) {
        errors.push({ path: ROOT_FILE, message: `Edge ${edge.id}: port '${edge.sourcePortId}' not found in sourcePorts of actor ${edge.sourceActorId}.` });
      }
    }
  }
  for (const [id, actorDoc] of actorDocs) {
    const configuration = isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {};
    const toolIds = configuration.aiAgentToolActorIds;
    if (Array.isArray(toolIds)) {
      for (const toolId of toolIds) {
        if (typeof toolId !== 'string' || !idToPath.has(toolId)) {
          errors.push({ path: `${idToPath.get(id)}/${ACTOR_FILE}`, message: `aiAgentToolActorIds references unknown actor ${String(toolId)}.` });
        }
      }
    }
  }

  // 3 (tail). Unreferenced files: inside actors/ → warning; outside → ignored.
  for (const p of Object.keys(files)) {
    if (!p.startsWith('actors/')) continue;
    if (!referenced.has(p)) warnings.push({ path: p, message: 'File is not referenced by canvas.yaml — it will be ignored.' });
  }

  return { errors, warnings };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bundle/validate.test.ts`
Expected: PASS (13 tests). Run the whole suite once (`npm test`) to catch regressions, and `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bundle/validate.ts tests/bundle/validate.test.ts
git commit -m "feat(lib): add path-scoped canvas bundle validation"
```

---

### Task 5: Assembler + the three round-trip guarantees

**Files:**
- Create: `src/lib/bundle/assemble.ts`
- Test: `tests/bundle/roundtrip.test.ts`

**Interfaces:**
- Consumes: `validateBundle` (Task 4), `disassemble` (Task 3), registry/types/yaml.
- Produces:
  - `assembleBundle(files: BundleFileMap): { doc: CanvasExportDocument; warnings: BundleIssue[] }`
  - `class BundleValidationError extends Error { errors: BundleIssue[]; warnings: BundleIssue[] }` — thrown when validation finds errors; commands catch it to print findings.

- [ ] **Step 1: Write the failing tests**

Create `tests/bundle/roundtrip.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { assembleBundle, BundleValidationError } from '../../src/lib/bundle/assemble.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import type { CanvasExportDocument } from '../../src/lib/bundle/types.js';
import { EDGE_ID, TASK_ID, TRIGGER_ID, makeActor, makeDoc, makeWiredDoc } from './fixtures.js';

/** The spec's acceptance-matrix documents, all round-tripped below. */
const documents: [string, () => CanvasExportDocument][] = [
  ['wired webhook -> deno canvas', makeWiredDoc],
  ['http task', () => makeDoc([makeActor({ id: TASK_ID, type: 'HttpRequestActor', configuration: { options: { method: 'GET', url: 'https://x' } } })])],
  ['python actor', () => makeDoc([makeActor({ id: TASK_ID, type: 'PythonActor', configuration: { code: 'x = 1\n', options: {} } })])],
  ['app actor with inline assets', () => makeDoc([makeActor({ id: TASK_ID, type: 'AppTriggerActor', configuration: { options: { html: '<h1>a</h1>', css: 'h1{}', script: 'let a;', allowInlineScripts: true } } })])],
  ['app actor with BIQFile refs', () => makeDoc([makeActor({ id: TASK_ID, type: 'AppTriggerActor', configuration: { options: { html: { type: 'BIQFile', fileId: 'F1' }, css: { type: 'BIQFile', fileId: 'F2' } } } })])],
  ['schemas + credentials + connection + multiline prompt', () => makeDoc([
    makeActor({
      id: TASK_ID,
      type: 'AiActor',
      configuration: {
        connection: { type: 'anthropic', key: 'anthropic-main' },
        credentials: { api: { workspaceKey: 'anthropic-key', source: 'secret' } },
        options: { prompt: 'You are a bot.\n\nBe helpful.\nAlways.\n' },
      },
      schemas: { inputs: { type: 'object', properties: { q: { type: 'string' } } }, outputs: null },
    }),
  ])],
  ['unknown future actor field passes through', () => makeDoc([makeActor({ id: TASK_ID, type: 'EchoActor', futureField: { nested: [1, 2] } })])],
];

describe('round-trip guarantees', () => {
  it.each(documents)('guarantee 3 — pack(unpack(doc)) deep-equals doc: %s', (_name, make) => {
    const doc = make();
    const { files } = disassemble(doc);
    const { doc: back } = assembleBundle(files);
    expect(back).toEqual(doc);
  });

  it.each(documents)('guarantee 1+2 — disassembly is deterministic and unpack(pack(dir)) == dir: %s', (_name, make) => {
    const { files } = disassemble(make());
    // 1: same input, same bytes
    expect(disassemble(make()).files).toEqual(files);
    // 2: files -> doc -> files is identity (exportErrors empty here)
    const { doc } = assembleBundle(files);
    expect(disassemble(doc).files).toEqual(files);
  });

  it('serialized pack output is byte-deterministic', () => {
    const { files } = disassemble(makeWiredDoc());
    const a = stringifyYamlDoc(assembleBundle(files).doc);
    const b = stringifyYamlDoc(assembleBundle({ ...files }).doc);
    expect(a).toBe(b);
  });

  it('reattaches edges to the source actor keyed by edge id', () => {
    const { files } = disassemble(makeWiredDoc());
    const { doc } = assembleBundle(files);
    expect(Object.keys(doc.data.actors[TRIGGER_ID].edges ?? {})).toEqual([EDGE_ID]);
    expect(doc.data.actors[TASK_ID].edges).toEqual({});
    expect(doc.data.actors[TASK_ID].position).toEqual({ x: 320, y: 0 });
  });

  it('maps canvas.schemaVersion back to data.schemaVersion and strips it from metadata', () => {
    const { files } = disassemble(makeWiredDoc());
    const { doc } = assembleBundle(files);
    expect(doc.data.schemaVersion).toBe('1');
    expect(doc.metadata.schemaVersion).toBeUndefined();
    expect(doc.metadata.slug).toBe('test-canvas');
  });

  it('throws BundleValidationError carrying all findings on an invalid bundle', () => {
    const { files } = disassemble(makeWiredDoc());
    delete files[`actors/tasks/deno/${TASK_ID}/code/mod.ts`];
    try {
      assembleBundle(files);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BundleValidationError);
      expect((error as BundleValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it('surfaces validation warnings as assembly warnings', () => {
    const { files } = disassemble(makeWiredDoc());
    files['actors/stray.txt'] = 'x\n';
    const { warnings } = assembleBundle(files);
    expect(warnings.some((w) => w.path === 'actors/stray.txt')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bundle/roundtrip.test.ts`
Expected: FAIL — cannot resolve `assemble.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bundle/assemble.ts`:

```typescript
import { BUNDLE_PATH_REGISTRY } from './registry.js';
import type { BIQActorType } from './registry.js';
import { ACTOR_FILE, CANVAS_KEY_ORDER, CODE_DIR, ROOT_FILE } from './types.js';
import type {
  BundleFileMap, BundleIssue, BundleRootDoc, CanvasExportDocument, ExportedActor, ExportedEdge,
} from './types.js';
import { validateBundle } from './validate.js';
import { orderKeys, parseYamlDoc } from './yaml.js';

/** Thrown when a bundle fails validation; carries every finding for reporting. */
export class BundleValidationError extends Error {
  constructor(
    public readonly errors: BundleIssue[],
    public readonly warnings: BundleIssue[],
  ) {
    super(`Bundle validation failed with ${errors.length} error(s).`);
    this.name = 'BundleValidationError';
  }
}

export interface AssembleResult {
  doc: CanvasExportDocument;
  warnings: BundleIssue[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Convert a validated bundle file map back into the platform export document.
 * Validation always runs first — an invalid bundle throws BundleValidationError
 * instead of producing partial output. Inverse of disassemble(): pushes the
 * root graph back onto actors and reads code files back inline; `codeDir`
 * never reaches the platform document.
 */
export const assembleBundle = (files: BundleFileMap): AssembleResult => {
  const { errors, warnings } = validateBundle(files);
  if (errors.length > 0) throw new BundleValidationError(errors, warnings);

  const root = parseYamlDoc(files[ROOT_FILE]) as unknown as BundleRootDoc;

  const positionsById = new Map(root.graph.nodes.map((node) => [node.actorId, node.position]));
  const edgesBySource = new Map<string, Record<string, ExportedEdge>>();
  for (const edge of root.graph.edges) {
    const forSource = edgesBySource.get(edge.sourceActorId) ?? {};
    forSource[edge.id] = edge;
    edgesBySource.set(edge.sourceActorId, forSource);
  }

  const actors: Record<string, ExportedActor> = {};
  for (const entry of root.actors) {
    const actorDoc = parseYamlDoc(files[`${entry.path}/${ACTOR_FILE}`]) as Record<string, unknown>;
    const spec = BUNDLE_PATH_REGISTRY[entry.type as BIQActorType];
    const configuration: Record<string, unknown> = { ...(isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {}) };

    if (configuration.codeDir === CODE_DIR) {
      delete configuration.codeDir;
      for (const codeFile of spec.codeFiles) {
        const content = files[`${entry.path}/${CODE_DIR}/${codeFile.file}`];
        if (content === undefined) continue; // e.g. app field left as a BIQFile reference
        if (codeFile.source.kind === 'code') {
          configuration.code = content;
        } else {
          const options = { ...(isPlainObject(configuration.options) ? configuration.options : {}) };
          options[codeFile.source.key] = content;
          configuration.options = options;
        }
      }
    }

    actors[entry.id] = {
      ...actorDoc,
      configuration,
      edges: edgesBySource.get(entry.id) ?? {},
      position: positionsById.get(entry.id) ?? { x: 0, y: 0 },
    } as ExportedActor;
  }

  const { schemaVersion, ...metadataRest } = (isPlainObject(root.canvas) ? root.canvas : {}) as Record<string, unknown>;
  const metadata = orderKeys(metadataRest, CANVAS_KEY_ORDER);

  return {
    doc: { metadata, data: { schemaVersion: String(schemaVersion ?? '1'), actors } },
    warnings,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS. If guarantee 3 fails on the app-actor case, the likely bug is options key ordering vs deep equality — remember `toEqual` ignores key order, so a real failure means a value (not order) diverged. Run `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bundle/assemble.ts tests/bundle/roundtrip.test.ts
git commit -m "feat(lib): add bundle assembler with round-trip guarantees"
```

---

### Task 6: Init starter template + bundle AGENTS.md/.gitignore

**Files:**
- Create: `src/lib/bundle/template.ts`
- Test: `tests/bundle/template.test.ts`

**Interfaces:**
- Consumes: `disassemble` (the starter is built as an export doc and disassembled — validity by construction), `Id`/`convertActorNameToMsgVar`/`monotonicUlid` from `src/lib/ids.js` (existing).
- Produces:
  - `buildStarterBundle(opts: { name: string; slug: string }): BundleFileMap` (managed files only)
  - `BUNDLE_AGENTS_MD: string`, `BUNDLE_GITIGNORE: string` (written as create-if-missing extras by init/unpack/pull)

- [ ] **Step 1: Write the failing tests**

Create `tests/bundle/template.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { assembleBundle } from '../../src/lib/bundle/assemble.js';
import { BUNDLE_AGENTS_MD, BUNDLE_GITIGNORE, buildStarterBundle } from '../../src/lib/bundle/template.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';

describe('buildStarterBundle', () => {
  it('passes strict validation (no errors, no warnings) and assembles', () => {
    const files = buildStarterBundle({ name: 'My Flow', slug: 'my-flow' });
    const { errors, warnings } = validateBundle(files);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const { doc } = assembleBundle(files);
    expect(doc.metadata.slug).toBe('my-flow');
    expect(doc.metadata.name).toBe('My Flow');
    expect(Object.keys(doc.data.actors)).toHaveLength(3);
  });

  it('creates a webhook trigger, a test sender, and a deno task with external code', () => {
    const files = buildStarterBundle({ name: 'My Flow', slug: 'my-flow' });
    const paths = Object.keys(files).sort();
    expect(paths.some((p) => p.startsWith('actors/triggers/webhook/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('actors/tasks/http-request/'))).toBe(true);
    expect(paths.some((p) => /^actors\/tasks\/deno\/ACTR[a-z0-9]+\/code\/mod\.ts$/.test(p))).toBe(true);
    const { doc } = assembleBundle(files);
    const actors = Object.values(doc.data.actors);
    const trigger = actors.find((a) => a.type === 'WebhookTriggerActor')!;
    const testSender = actors.find((a) => a.type === 'HttpRequestActor')!;
    const task = actors.find((a) => a.type === 'DenoActor')!;
    const edges = Object.values(trigger.edges ?? {});
    expect(edges).toHaveLength(1);
    expect(edges[0].targetActorId).toBe(task.id);
    expect(trigger.msgVar).toBe('incoming_webhook');
    expect(trigger.webhookTriggerKey).toBeUndefined();
    expect(trigger.configuration?.webhook).toEqual({
      triggerKey: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      authorizationLevel: 'public',
      allowedMethods: ['get', 'post'],
      responseTimeout: 30,
    });
    expect(testSender.configuration?.options).toEqual({
      url: '${{ ctx.canvas.webhookTriggers.incoming_webhook.url }}',
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: { message: 'Hello, world!' },
    });
    expect(task.configuration?.code).toContain('@borgiq/actors');
    expect(task.configuration?.code).toContain('denoVersion: Deno.version');
    expect(task.configuration?.code).toContain('denoBuild: Deno.build');
    expect(task.configuration?.code).toContain('ctx: req.ctx');
  });

  it('mints fresh ids per invocation', () => {
    const a = assembleBundle(buildStarterBundle({ name: 'A', slug: 'a-flow' })).doc;
    const b = assembleBundle(buildStarterBundle({ name: 'B', slug: 'b-flow' })).doc;
    expect(Object.keys(a.data.actors)).not.toEqual(Object.keys(b.data.actors));
  });
});

describe('bundle companion files', () => {
  it('AGENTS.md documents the contract and the commands', () => {
    for (const needle of ['canvas.yaml', 'actor.yaml', 'codeDir', 'graph.nodes', 'bundle validate', 'bundle pack', 'bundle push', 'borgiq.canvas.bundle']) {
      expect(BUNDLE_AGENTS_MD).toContain(needle);
    }
  });

  it('.gitignore reserves the local dev artifacts dir', () => {
    expect(BUNDLE_GITIGNORE).toContain('.borgiq/');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bundle/template.test.ts`
Expected: FAIL — cannot resolve `template.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bundle/template.ts`:

```typescript
import { Id, convertActorNameToMsgVar, monotonicUlid } from '../ids.js';
import { disassemble } from './disassemble.js';
import type { BundleFileMap, CanvasExportDocument, ExportedActor } from './types.js';

export interface StarterOptions {
  name: string;
  slug: string;
}

const DENO_STARTER_CODE = `import type { Request, Response } from "@borgiq/actors";

export default async function receive(req: Request): Promise<Response> {
  return {
    results: {
      runtime: {
        denoVersion: Deno.version,
        denoBuild: Deno.build,
      },
      ctx: req.ctx,
    },
    memory: req.memory,
  };
}
`;

/**
 * Build the `bundle init` starter as an export document and disassemble it —
 * validity by construction (whatever disassemble produces, validate accepts).
 * IDs are minted per call: init is generative; determinism applies to
 * unpack/pack, not here.
 */
export const buildStarterBundle = (opts: StarterOptions): BundleFileMap => {
  const triggerId = Id.create('ACTR');
  const taskId = Id.create('ACTR');
  const testSenderId = Id.create('ACTR');
  const edgeId = Id.create('EDGE');

  const trigger: ExportedActor = {
    id: triggerId,
    version: 1,
    type: 'WebhookTriggerActor',
    name: 'Incoming webhook',
    msgVar: convertActorNameToMsgVar('Incoming webhook'),
    description: 'Starter trigger — replace or rewire as needed.',
    isActive: true,
    sourcePorts: [{ id: 'SPRTdefault' }],
    continueOnError: false,
    enableLTM: false,
    enableSTM: false,
    showInWorkspaceApps: true,
    runtimeSlug: '',
    configuration: {
      webhook: {
        triggerKey: monotonicUlid(),
        authorizationLevel: 'public',
        allowedMethods: ['get', 'post'],
        responseTimeout: 30,
      },
      options: {
        webhook: {
          respondImmediately: true,
          emitRawBody: false,
          response: {
            statusCode: 200,
            headers: {
              'content-type': 'text/plain; charset=utf-8',
            },
            body: 'OK',
          },
        },
      },
    },
    schemas: {},
    edges: {
      [edgeId]: {
        id: edgeId,
        sourceActorId: triggerId,
        sourcePortId: 'SPRTdefault',
        targetActorId: taskId,
        targetPortId: 'TPRTdefault',
        type: 'borgiqEdge',
      },
    },
    position: { x: 0, y: 0 },
  };

  const testSender: ExportedActor = {
    id: testSenderId,
    version: 1,
    type: 'HttpRequestActor',
    name: 'Send test event',
    msgVar: convertActorNameToMsgVar('Send test event'),
    description: 'The HTTP Request Actor can make HTTP requests',
    isActive: true,
    sourcePorts: [{ id: 'SPRTdefault' }],
    continueOnError: false,
    enableLTM: false,
    enableSTM: false,
    showInWorkspaceApps: true,
    runtimeSlug: '',
    configuration: {
      options: {
        url: '${{ ctx.canvas.webhookTriggers.incoming_webhook.url }}',
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: {
          message: 'Hello, world!',
        },
      },
    },
    schemas: {},
    edges: {},
    position: { x: -320, y: 0 },
  };

  const task: ExportedActor = {
    id: taskId,
    version: 1,
    type: 'DenoActor',
    name: 'Process event',
    msgVar: convertActorNameToMsgVar('Process event'),
    description: 'Starter Deno task — edit code/mod.ts.',
    isActive: true,
    sourcePorts: [{ id: 'SPRTdefault' }],
    continueOnError: false,
    enableLTM: true,
    enableSTM: true,
    configuration: {
      code: DENO_STARTER_CODE,
      inputs: {},
      options: { allowNet: true, allowFs: true },
    },
    schemas: {},
    edges: {},
    position: { x: 320, y: 0 },
  };

  const doc: CanvasExportDocument = {
    metadata: {
      slug: opts.slug,
      name: opts.name,
      description: '',
      tags: '',
      messageTTLInDays: 7,
      runtimeSlug: '',
    },
    data: { schemaVersion: '1', actors: { [testSenderId]: testSender, [triggerId]: trigger, [taskId]: task } },
  };

  return disassemble(doc).files;
};

export const BUNDLE_GITIGNORE = `# BorgIQ local dev artifacts (reserved for a future 'borgiq bundle dev-setup')
.borgiq/
`;

export const BUNDLE_AGENTS_MD = `# BorgIQ Canvas Bundle

This folder is a BorgIQ **canvas bundle** — a workflow canvas expanded into files for git
and AI editing. The \`borgiq\` CLI compiles it to/from the platform's canvas export format
(\`borgiq bundle --help\`). Format: \`borgiq.canvas.bundle\` v1 (BORG-565).

## Layout

- \`canvas.yaml\` — authoritative root: canvas metadata, the graph (ALL edges and node
  positions), dependency references, and the actor index. An actor folder is only read
  if it is listed under \`actors:\` here.
- \`actors/<category>/<type>/<ACTOR_ID>/actor.yaml\` — one folder per actor: identity,
  configuration, schemas. **No edges or positions in actor.yaml** — those live only in
  the root graph.
- \`actors/.../<ACTOR_ID>/code/\` — only for code actors: \`mod.ts\` (Deno / Deno Test /
  Universal Trigger), \`mod.py\` (Python), or \`index.html\`/\`styles.css\`/\`script.js\` (App).
  When present, \`actor.yaml\` carries \`configuration.codeDir: code\` and must not also
  contain inline code.

## Editing rules

1. **Adding an actor takes three edits:** create the actor folder with \`actor.yaml\`,
   add an \`actors[]\` index entry in \`canvas.yaml\`, and add a \`graph.nodes\` entry.
   Wire it with \`graph.edges\`.
2. An edge's \`sourcePortId\` must exist in the source actor's \`sourcePorts\`.
3. Edit code in \`code/\` files, not in \`actor.yaml\`. Only the canonical entrypoint
   file is allowed in \`code/\` — helper files are not supported yet.
4. Folder names are actor IDs and must match the \`id\` in \`actor.yaml\` and the index.
5. Extra files under \`actors/\` are ignored with warnings; files outside \`actors/\`
   (like this one) are always left alone by the CLI.

## Workflow

\`\`\`bash
borgiq bundle validate .             # check after editing (--strict in CI)
borgiq bundle pack . -o export.yaml  # compile to the platform export document
borgiq bundle push .                 # validate + import into the canvas (merge mode)
borgiq bundle pull <canvas> .        # re-export (rewrites canvas.yaml + actors/ only)
\`\`\`
`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bundle/template.test.ts`
Expected: PASS. Run `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bundle/template.ts tests/bundle/template.test.ts
git commit -m "feat(lib): add offline starter bundle template and companion files"
```

---

### Task 7: Filesystem layer (managed-path read/write)

**Files:**
- Create: `src/lib/bundleFs.ts`
- Test: `tests/bundle/bundleFs.test.ts`

**Interfaces:**
- Consumes: `BundleFileMap`, `ROOT_FILE` from `types.ts`; `CliUsageError` from `src/lib/errors.js` (existing).
- Produces:
  - `readBundleDir(dir: string): BundleFileMap` — reads `canvas.yaml` + everything under `actors/` (utf-8); throws `CliUsageError` if `canvas.yaml` is absent.
  - `writeBundleDir(dir: string, files: BundleFileMap, opts?: { force?: boolean; createIfMissing?: BundleFileMap }): void` — managed-path overwrite semantics from the spec.

- [ ] **Step 1: Write the failing tests**

Create `tests/bundle/bundleFs.test.ts`:

```typescript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBundleDir, writeBundleDir } from '../../src/lib/bundleFs.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const FILES = {
  'canvas.yaml': 'format: borgiq.canvas.bundle\n',
  'actors/tasks/deno/ACTR1/actor.yaml': 'id: ACTR1\n',
  'actors/tasks/deno/ACTR1/code/mod.ts': 'export default 1;\n',
};

describe('writeBundleDir / readBundleDir', () => {
  it('round-trips a file map through disk', () => {
    writeBundleDir(dir, FILES);
    expect(readBundleDir(dir)).toEqual(FILES);
  });

  it('readBundleDir rejects a directory without canvas.yaml', () => {
    expect(() => readBundleDir(dir)).toThrow(/not a canvas bundle/);
  });

  it('rewrites managed paths only: stale actor folders go, user files stay', () => {
    writeBundleDir(dir, FILES);
    fs.writeFileSync(path.join(dir, 'NOTES.md'), 'mine\n');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref\n');
    const next = { 'canvas.yaml': 'format: borgiq.canvas.bundle\n', 'actors/other/echo/ACTR2/actor.yaml': 'id: ACTR2\n' };
    writeBundleDir(dir, next);
    expect(readBundleDir(dir)).toEqual(next); // ACTR1 folder fully removed
    expect(fs.readFileSync(path.join(dir, 'NOTES.md'), 'utf-8')).toBe('mine\n');
    expect(fs.existsSync(path.join(dir, '.git', 'HEAD'))).toBe(true);
  });

  it('createIfMissing writes companions once and never overwrites them', () => {
    writeBundleDir(dir, FILES, { createIfMissing: { 'AGENTS.md': 'v1\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
    writeBundleDir(dir, FILES, { createIfMissing: { 'AGENTS.md': 'v2\n' } });
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toBe('v1\n');
  });

  it('refuses a non-empty non-bundle directory without force, allows with force', () => {
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x\n');
    expect(() => writeBundleDir(dir, FILES)).toThrow(/--force/);
    writeBundleDir(dir, FILES, { force: true });
    expect(fs.readFileSync(path.join(dir, 'unrelated.txt'), 'utf-8')).toBe('x\n'); // still only managed paths touched
    expect(readBundleDir(dir)).toEqual(FILES);
  });

  it('overwrites an existing bundle without force (the pull workflow)', () => {
    writeBundleDir(dir, FILES);
    expect(() => writeBundleDir(dir, FILES)).not.toThrow();
  });

  it('rejects file-map paths that escape the target directory', () => {
    expect(() => writeBundleDir(dir, { 'canvas.yaml': 'x\n', '../escape.txt': 'x\n' })).toThrow(/escape/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bundle/bundleFs.test.ts`
Expected: FAIL — cannot resolve `bundleFs.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bundleFs.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

import { ROOT_FILE } from './bundle/types.js';
import type { BundleFileMap } from './bundle/types.js';
import { CliUsageError } from './errors.js';

/**
 * The paths the CLI owns inside a bundle directory. Everything else —
 * .git/, AGENTS.md, .gitignore, user notes — is never deleted or rewritten.
 */
const MANAGED_DIR = 'actors';

const resolveInside = (dir: string, rel: string): string => {
  const abs = path.resolve(dir, rel);
  const base = path.resolve(dir);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new CliUsageError(`Refusing to write '${rel}' — it escapes the bundle directory.`);
  }
  return abs;
};

/** Read canvas.yaml plus every file under actors/ into a bundle file map. */
export const readBundleDir = (dir: string): BundleFileMap => {
  const rootPath = path.join(dir, ROOT_FILE);
  if (!fs.existsSync(rootPath)) {
    throw new CliUsageError(`${dir} is not a canvas bundle (no ${ROOT_FILE}).`);
  }
  const files: BundleFileMap = { [ROOT_FILE]: fs.readFileSync(rootPath, 'utf-8') };
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (fs.existsSync(actorsDir)) {
    for (const entry of fs.readdirSync(actorsDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath, entry.name);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      files[rel] = fs.readFileSync(abs, 'utf-8');
    }
  }
  return files;
};

export interface WriteBundleOptions {
  force?: boolean;
  /** Companion files (AGENTS.md, .gitignore) written only when absent. */
  createIfMissing?: BundleFileMap;
}

/**
 * Write a bundle file map to disk with the spec's managed-path semantics:
 * canvas.yaml and actors/ are deleted and rewritten; nothing else is touched.
 * A non-empty directory that is not already a bundle requires force.
 */
export const writeBundleDir = (dir: string, files: BundleFileMap, opts: WriteBundleOptions = {}): void => {
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir);
    const isBundle = entries.includes(ROOT_FILE);
    if (entries.length > 0 && !isBundle && !opts.force) {
      throw new CliUsageError(`${dir} is not empty and not a canvas bundle — pass --force to write into it anyway.`);
    }
    fs.rmSync(path.join(dir, ROOT_FILE), { force: true });
    fs.rmSync(path.join(dir, MANAGED_DIR), { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolveInside(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const [rel, content] of Object.entries(opts.createIfMissing ?? {})) {
    const abs = resolveInside(dir, rel);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bundle/bundleFs.test.ts`
Expected: PASS. Run `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bundleFs.ts tests/bundle/bundleFs.test.ts
git commit -m "feat(lib): add bundle filesystem layer with managed-path overwrite"
```

---

### Task 8: Local commands — init, unpack, pack, validate — and registration

**Files:**
- Create: `src/commands/bundle/shared.ts`
- Create: `src/commands/bundle/init.ts`
- Create: `src/commands/bundle/unpack.ts`
- Create: `src/commands/bundle/pack.ts`
- Create: `src/commands/bundle/validate.ts`
- Create: `src/commands/bundle/index.ts` (pull/push wired in Task 9)
- Modify: `src/program.ts` (two lines: import + register)

**Interfaces:**
- Consumes: everything from Tasks 1–7, plus existing `handleError`/`CliUsageError`/`ExitCode` (`src/lib/errors.js`), `output` (`src/output/index.js`), `GlobalOptions` (`src/lib/context.js`).
- Produces (Task 9 imports these from `shared.ts`):
  - `readRawInput(file: string): Promise<string>` — raw text from a path or `-`/stdin
  - `reportIssues(errors: BundleIssue[], warnings: BundleIssue[]): void` — prints `Error: <path>: <msg>` / `Warning: <path>: <msg>` to stderr
  - `assembleOrFail(files: BundleFileMap, strict: boolean): AssembleResult` — prints findings; throws `CliUsageError` on errors (or warnings when strict)
  - `BUNDLE_COMPANIONS: BundleFileMap` — `{ 'AGENTS.md': BUNDLE_AGENTS_MD, '.gitignore': BUNDLE_GITIGNORE }`
  - Command handlers follow the repo pattern: `(args..., options, command) => { const globalOpts = command.parent.parent.opts(); ... }` with all failures routed through `handleError`.

No unit tests for the thin shells (the core is fully covered); each step ends with a real CLI smoke test via `npm run dev`.

- [ ] **Step 1: Write the shared helpers**

Create `src/commands/bundle/shared.ts`:

```typescript
import fs from 'node:fs';

import { BundleValidationError, assembleBundle } from '../../lib/bundle/assemble.js';
import type { AssembleResult } from '../../lib/bundle/assemble.js';
import { BUNDLE_AGENTS_MD, BUNDLE_GITIGNORE } from '../../lib/bundle/template.js';
import type { BundleFileMap, BundleIssue } from '../../lib/bundle/types.js';
import { CliUsageError } from '../../lib/errors.js';

/** Companion files created (never overwritten) by init/unpack/pull. */
export const BUNDLE_COMPANIONS: BundleFileMap = {
  'AGENTS.md': BUNDLE_AGENTS_MD,
  '.gitignore': BUNDLE_GITIGNORE,
};

/** Raw text from a file path, or from stdin when the path is '-'. */
export const readRawInput = async (file: string): Promise<string> => {
  if (file !== '-') return fs.readFileSync(file, 'utf-8');
  if (process.stdin.isTTY) throw new CliUsageError("No input on stdin — pass a file path or pipe a document to '-'.");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
};

export const reportIssues = (errors: BundleIssue[], warnings: BundleIssue[]): void => {
  for (const warning of warnings) process.stderr.write(`Warning: ${warning.path}: ${warning.message}\n`);
  for (const error of errors) process.stderr.write(`Error: ${error.path}: ${error.message}\n`);
};

/**
 * Assemble a bundle for pack/push: print every finding, then throw a
 * CliUsageError (exit code 2) when errors exist — or when warnings exist and
 * strict mode is on. Never calls the API with an invalid bundle.
 */
export const assembleOrFail = (files: BundleFileMap, strict: boolean): AssembleResult => {
  let result: AssembleResult;
  try {
    result = assembleBundle(files);
  } catch (error) {
    if (error instanceof BundleValidationError) {
      reportIssues(error.errors, error.warnings);
      throw new CliUsageError(`Bundle validation failed with ${error.errors.length} error(s).`);
    }
    throw error;
  }
  reportIssues([], result.warnings);
  if (strict && result.warnings.length > 0) {
    throw new CliUsageError(`Bundle has ${result.warnings.length} warning(s) (strict mode).`);
  }
  return result;
};
```

- [ ] **Step 2: Write the four local command handlers**

Create `src/commands/bundle/init.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

import { buildStarterBundle } from '../../lib/bundle/template.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { BUNDLE_COMPANIONS } from './shared.js';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const slugify = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** `borgiq bundle init <dir>` — offline starter bundle for a git repo. */
export const bundleInit = async (dir: string, options: { name?: string; slug?: string }): Promise<void> => {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      throw new CliUsageError(`${dir} already exists and is not empty — init needs a fresh directory.`);
    }
    const base = path.basename(path.resolve(dir)).replace(/\.borgiq-canvas$/, '');
    const slug = options.slug ?? slugify(base);
    if (!SLUG_PATTERN.test(slug) || slug.length < 2) {
      throw new CliUsageError(`Invalid slug '${slug}' — use lowercase letters, digits, and hyphens (or pass --slug).`);
    }
    const name = options.name ?? base;
    const files = buildStarterBundle({ name, slug });
    writeBundleDir(dir, files, { createIfMissing: BUNDLE_COMPANIONS });
    process.stderr.write(`Initialized canvas bundle '${slug}' in ${dir}\n`);
  } catch (error) {
    handleError(error);
  }
};
```

Create `src/commands/bundle/unpack.ts`:

```typescript
import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import { handleError } from '../../lib/errors.js';
import { BUNDLE_COMPANIONS, readRawInput } from './shared.js';

/** `borgiq bundle unpack <file|-> <dir>` — export document → bundle folder. */
export const bundleUnpack = async (file: string, dir: string, options: { force?: boolean }): Promise<void> => {
  try {
    const input = parseExportInput(await readRawInput(file));
    const { files, warnings } = disassemble(input.document, { exportErrors: input.exportErrors });
    writeBundleDir(dir, files, { force: options.force, createIfMissing: BUNDLE_COMPANIONS });
    for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
    const actorCount = Object.keys(files).filter((p) => p.endsWith('/actor.yaml')).length;
    process.stderr.write(`Unpacked ${actorCount} actor(s) into ${dir}\n`);
  } catch (error) {
    handleError(error);
  }
};
```

Create `src/commands/bundle/pack.ts`:

```typescript
import fs from 'node:fs';

import { stringifyYamlDoc } from '../../lib/bundle/yaml.js';
import { readBundleDir } from '../../lib/bundleFs.js';
import { handleError } from '../../lib/errors.js';
import { assembleOrFail } from './shared.js';

/** `borgiq bundle pack <dir>` — bundle folder → export document (stdout or -o). */
export const bundlePack = async (dir: string, options: { output?: string; strict?: boolean }): Promise<void> => {
  try {
    const files = readBundleDir(dir);
    const { doc } = assembleOrFail(files, options.strict ?? false);
    const text = stringifyYamlDoc(doc);
    if (options.output) {
      fs.writeFileSync(options.output, text);
      process.stderr.write(`Packed ${dir} -> ${options.output}\n`);
    } else {
      process.stdout.write(text);
    }
  } catch (error) {
    handleError(error);
  }
};
```

Create `src/commands/bundle/validate.ts`:

```typescript
import { validateBundle } from '../../lib/bundle/validate.js';
import { readBundleDir } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { reportIssues } from './shared.js';

/** `borgiq bundle validate <dir>` — report all findings; exit 2 when invalid. */
export const bundleValidate = async (
  dir: string,
  options: { strict?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { errors, warnings } = validateBundle(readBundleDir(dir));
    const valid = errors.length === 0 && (!options.strict || warnings.length === 0);
    if (globalOpts.json || !process.stdout.isTTY) {
      output({ valid, errors, warnings }, globalOpts);
    } else {
      reportIssues(errors, warnings);
      process.stderr.write(valid ? `Bundle is valid (${warnings.length} warning(s)).\n` : 'Bundle is invalid.\n');
    }
    if (!valid) process.exitCode = ExitCode.USAGE;
  } catch (error) {
    handleError(error);
  }
};
```

- [ ] **Step 3: Register the command group**

Create `src/commands/bundle/index.ts`:

```typescript
import type { Command } from 'commander';

import { bundleInit } from './init.js';
import { bundlePack } from './pack.js';
import { bundleUnpack } from './unpack.js';
import { bundleValidate } from './validate.js';

export const registerBundleCommands = (program: Command): void => {
  const bundle = program
    .command('bundle')
    .description('Convert canvases to/from git-friendly bundle folders (BORG-565)');

  bundle
    .command('init <dir>')
    .description('Create a starter canvas bundle folder (offline, git-ready)')
    .option('--name <name>', 'Canvas name (default: derived from the directory name)')
    .option('--slug <slug>', 'Canvas slug (default: derived from the directory name)')
    .action(bundleInit);

  bundle
    .command('unpack <file> <dir>')
    .description("Expand a canvas export document into a bundle folder ('-' reads stdin; accepts raw YAML or the {yaml, errors} JSON envelope)")
    .option('--force', 'Write into a non-empty directory that is not a bundle')
    .addHelpText('after', `
Examples:
  $ borgiq canvases export my-canvas --json | borgiq bundle unpack - ./my-canvas.borgiq-canvas
  $ borgiq bundle unpack export.yaml ./my-canvas.borgiq-canvas`)
    .action(bundleUnpack);

  bundle
    .command('pack <dir>')
    .description('Compile a bundle folder back into a canvas export document')
    .option('-o, --output <file>', 'Write to a file instead of stdout')
    .option('--strict', 'Treat warnings as errors')
    .action(bundlePack);

  bundle
    .command('validate <dir>')
    .description('Validate a bundle folder and report file-scoped errors and warnings')
    .option('--strict', 'Treat warnings as errors')
    .action(bundleValidate);
};
```

Modify `src/program.ts` — add the import after `registerValidateCommands` and the call alongside the other registrations (find the block of `register*Commands(program)` calls lower in the file and append there):

```typescript
import { registerBundleCommands } from './commands/bundle/index.js';
```

```typescript
  registerBundleCommands(program);
```

- [ ] **Step 4: Build and smoke-test end to end**

```bash
npm run build && npm test
cd "$(mktemp -d)"
node /home/baskar/borgiq/dev-container/code/borgiq-cli/dist/index.js bundle init ./demo.borgiq-canvas
find demo.borgiq-canvas -type f | sort            # canvas.yaml, AGENTS.md, .gitignore, 2 actor folders, code/mod.ts
node /home/baskar/borgiq/dev-container/code/borgiq-cli/dist/index.js bundle validate ./demo.borgiq-canvas --strict
node /home/baskar/borgiq/dev-container/code/borgiq-cli/dist/index.js bundle pack ./demo.borgiq-canvas -o export.yaml
node /home/baskar/borgiq/dev-container/code/borgiq-cli/dist/index.js bundle unpack export.yaml ./roundtrip.borgiq-canvas
diff -r demo.borgiq-canvas roundtrip.borgiq-canvas   # must be identical (guarantee 2, on-disk)
```

Expected: every command exits 0; the final `diff -r` prints nothing.

- [ ] **Step 5: Commit**

```bash
cd /home/baskar/borgiq/dev-container/code/borgiq-cli
git add src/commands/bundle src/program.ts
git commit -m "feat(bundle): add init/unpack/pack/validate commands"
```

---

### Task 9: API commands — pull and push — plus docs and final gate

**Files:**
- Create: `src/commands/bundle/pull.ts`
- Create: `src/commands/bundle/push.ts`
- Modify: `src/commands/bundle/index.ts` (register the two commands)
- Modify: `AGENTS.md` (repo root — add `bundle/` to the commands tree)
- Modify: `README.md` (add a Canvas bundles section)

**Interfaces:**
- Consumes: `shared.ts` helpers (Task 8), `disassemble`/`parseYamlDoc`/`writeBundleDir`, and the EXISTING client methods — no client changes: `client.exportCanvas(org, workspace, id): Promise<unknown>` (returns `{yaml, errors}`), `client.importCanvasData(org, workspace, canvasSlugOrId, { canvas, mode })`, `client.createCanvasWithData(org, workspace, body)`.
- Produces: the complete `borgiq bundle` surface from the spec.

- [ ] **Step 1: Write the pull handler**

Create `src/commands/bundle/pull.ts`:

```typescript
import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseYamlDoc } from '../../lib/bundle/yaml.js';
import type { CanvasExportDocument } from '../../lib/bundle/types.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { BUNDLE_COMPANIONS } from './shared.js';

/** `borgiq bundle pull <canvas> [dir]` — export from the API and unpack. */
export const bundlePull = async (
  canvas: string,
  dir: string | undefined,
  options: { force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const envelope = (await client.exportCanvas(ctx.org, ctx.workspace, canvas)) as { yaml?: unknown; errors?: unknown[] };
    if (typeof envelope?.yaml !== 'string') {
      throw new Error('Unexpected export response from the API (no yaml field).');
    }
    const document = parseYamlDoc(envelope.yaml) as CanvasExportDocument;
    const exportErrors = Array.isArray(envelope.errors) ? envelope.errors : [];

    const slug = typeof document?.metadata?.slug === 'string' ? document.metadata.slug : canvas;
    const target = dir ?? `./${slug}.borgiq-canvas`;

    const { files, warnings } = disassemble(document, { exportErrors });
    writeBundleDir(target, files, { force: options.force, createIfMissing: BUNDLE_COMPANIONS });

    for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
    if (exportErrors.length > 0) {
      process.stderr.write(`Warning: export reported ${exportErrors.length} actor error(s) — see exportErrors in canvas.yaml.\n`);
    }
    const actorCount = Object.keys(files).filter((p) => p.endsWith('/actor.yaml')).length;
    process.stderr.write(`Pulled '${slug}' (${actorCount} actor(s)) into ${target}\n`);
  } catch (error) {
    handleError(error);
  }
};
```

- [ ] **Step 2: Write the push handler**

Create `src/commands/bundle/push.ts`:

```typescript
import { readBundleDir } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { assembleOrFail } from './shared.js';

const MODES = new Set(['merge', 'insert', 'replace']);

/** `borgiq bundle push <dir>` — validate, pack, and import via the API. */
export const bundlePush = async (
  dir: string,
  options: { canvas?: string; mode?: string; create?: boolean; strict?: boolean; autoLayout?: boolean; layoutSourceActorId?: string[] },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    if (options.create && (options.canvas || options.mode)) {
      throw new CliUsageError('--create cannot be combined with --canvas or --mode.');
    }
    const mode = options.mode ?? 'merge';
    if (!MODES.has(mode)) {
      throw new CliUsageError(`Invalid --mode '${mode}' — use merge, insert, or replace.`);
    }

    // Validate and assemble BEFORE any API call.
    const { doc } = assembleOrFail(readBundleDir(dir), options.strict ?? false);

    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    if (options.create) {
      // Create body: bundle metadata minus the import-ignored fields.
      const { id: _id, imagePath: _imagePath, ...metadata } = doc.metadata;
      const result = await client.createCanvasWithData(ctx.org, ctx.workspace, { ...metadata, data: doc.data });
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Canvas '${String(metadata.slug)}' created from ${dir}.\n`);
      }
      output(result, globalOpts);
      return;
    }

    const target = options.canvas ?? (typeof doc.metadata.slug === 'string' ? doc.metadata.slug : '');
    if (!target) {
      throw new CliUsageError('No canvas target — pass --canvas <slugOrId> or set canvas.slug in the bundle.');
    }
    const result = await client.importCanvasData(ctx.org, ctx.workspace, target, { canvas: doc.data, mode });
    if (!globalOpts.json && process.stderr.isTTY) {
      const applied = (result as { appliedOperations?: unknown[] })?.appliedOperations?.length ?? 0;
      const conflicts = (result as { conflicts?: unknown[] })?.conflicts?.length ?? 0;
      process.stderr.write(`Pushed ${dir} -> '${target}' (${mode} mode): ${applied} operations applied, ${conflicts} conflicts.\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
```

If `options.autoLayout` is true, or `options.layoutSourceActorId` is provided, call `layoutCanvas` after the successful create/import. For create, resolve the layout target from the created canvas response first and the bundle metadata slug/id second. JSON output wraps the primary response with `layout`; TTY stderr reports the layout actor count.

- [ ] **Step 3: Register pull/push**

Modify `src/commands/bundle/index.ts` — add imports:

```typescript
import { bundlePull } from './pull.js';
import { bundlePush } from './push.js';
```

and append inside `registerBundleCommands` after the `validate` registration:

```typescript
  bundle
    .command('pull <canvas> [dir]')
    .description('Export a canvas from the API and unpack it into a bundle folder (default: ./<slug>.borgiq-canvas)')
    .option('--force', 'Write into a non-empty directory that is not a bundle')
    .action(bundlePull);

  bundle
    .command('push <dir>')
    .description('Validate, pack, and import a bundle into a canvas')
    .option('--canvas <slugOrId>', "Target canvas (default: the bundle's canvas.slug)")
    .option('--mode <mode>', 'Import mode: merge (default), insert, or replace', 'merge')
    .option('--create', 'Create a new canvas from the bundle metadata instead of importing')
    .option('--strict', 'Treat validation warnings as errors')
    .option('--auto-layout', 'Run canvas auto-layout after a successful create/import')
    .option('--layout-source-actor-id <actorId...>', 'Auto-layout only downstream of these actors (implies --auto-layout)')
    .addHelpText('after', `
Examples:
  $ borgiq bundle pull my-canvas
  $ borgiq bundle push ./my-canvas.borgiq-canvas
  $ borgiq bundle push ./my-canvas.borgiq-canvas --mode replace
  $ borgiq bundle push ./my-canvas.borgiq-canvas --create --auto-layout`)
    .action(bundlePush);
```

- [ ] **Step 4: Update repo docs**

Modify root `AGENTS.md` — in the Project Structure tree, add one line to the `commands/` list (after the `canvases/` line, matching the existing comment style):

```
│   ├── bundle/           # init, unpack, pack, validate, pull, push — canvas bundle folders (BORG-565)
```

Modify `README.md` — add a section after the canvases examples (match the README's existing heading/example style; check it when editing):

```markdown
### Canvas bundles (git-friendly folders)

Expand a canvas into a folder of per-actor files — designed for git and AI editing.
`canvas.yaml` holds the graph and actor index; each actor lives in
`actors/<category>/<type>/<ACTOR_ID>/actor.yaml`, with native `code/` files for
Deno/Python/App actors. Pack/unpack is deterministic and lossless.

```bash
borgiq bundle init ./my-flow.borgiq-canvas      # offline starter (git-ready)
borgiq bundle pull my-canvas                    # export + unpack from the API
borgiq bundle validate ./my-flow.borgiq-canvas  # file-scoped errors/warnings
borgiq bundle pack ./my-flow.borgiq-canvas -o export.yaml
borgiq bundle push ./my-flow.borgiq-canvas      # validate + import (merge mode)
borgiq bundle push ./my-flow.borgiq-canvas --auto-layout   # import, then auto-layout
borgiq bundle push ./my-flow.borgiq-canvas --create   # create a new canvas
```
```

- [ ] **Step 5: Full gate + live smoke test (if an API is reachable)**

```bash
npm run build && npm test
```

Expected: clean build, full suite green.

Optional live smoke test against a dev instance (requires `borgiq auth login` and a workspace with a canvas):

```bash
npm run dev -- bundle pull <canvas-slug>
npm run dev -- bundle push ./<canvas-slug>.borgiq-canvas --mode merge
```

Expected: pull writes the folder; push reports applied operations. If no live API is available, note that in the task report — the offline smoke test in Task 8 already covers the compiler path.

- [ ] **Step 6: Commit**

```bash
git add src/commands/bundle AGENTS.md README.md
git commit -m "feat(bundle): add pull/push commands and document the bundle workflow"
```

---

## Post-plan notes for the implementer

- **PR title** (this repo squash-merges; the title is the release-please commit): `feat(bundle): add canvas bundle init/unpack/pack/validate/pull/push commands`. See `.claude/skills/release-please-prs`.
- **Determinism review before opening the PR:** grep the new code for `Date.now`, `Math.random`, `localeCompare`, and `toLocale` — only `template.ts`/`ids.ts` usage (ULID minting) is allowed, and only in the init path.
- **Spec conformance:** `docs/superpowers/specs/2026-07-07-canvas-bundle-cli-design.md` is the contract. If implementation reality forces a deviation, update the spec in the same PR and say so in the task report.
