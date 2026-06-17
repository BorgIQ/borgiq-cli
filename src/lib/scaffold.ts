import { stringify as yamlStringify } from 'yaml';

import { Id, convertActorNameToMsgVar, monotonicUlid } from './ids.js';
import type { BIQActorSchema, BIQActorTemplateDetail } from '../client/types.js';

/**
 * A scaffolded actor in **CanvasActor** shape — the format
 * `borgiq canvas-actors create/batch` expects. Configuration fields are YAML
 * strings (not native objects); see `importActor` in
 * `borgiq-platform/packages/utils/src/canvas.ts`.
 */
export interface ScaffoldedActor {
  id: string;
  type: string;
  version: number;
  name: string;
  msgVar: string;
  description: string;
  isActive: boolean;
  continueOnError: boolean;
  enableLTM: boolean;
  enableSTM: boolean;
  sourcePorts: { id: string; name?: string }[];
  configuration: Record<string, unknown>;
  schemas: Record<string, unknown>;
  position: { x: number; y: number };
  edges: Record<string, unknown>;
  webhookTriggerKey?: string;
  /** Template provenance — drives the app-type badge + version check in the UI. */
  template?: { id: string; version: number; appName: string };
  [key: string]: unknown;
}

/** Config fields the platform stores as YAML strings (mirrors `importActor`). */
const CONFIG_YAML_FIELDS = ['credentials', 'inputs', 'vars', 'options', 'outputs', 'error'] as const;
const SCHEMA_YAML_FIELDS = ['inputs', 'outputs'] as const;

/** Language-appropriate code stub for actors whose schema reports code support. */
const CODE_STUBS: Record<'typescript' | 'python', string> = {
  typescript: 'const { input } = inputs;\n\nreturn {\n  result: input,\n};\n',
  python: 'result = inputs.get("input", None)\nreturn {"result": result}\n',
};

/** Actor types that carry a webhook trigger key. */
const WEBHOOK_TRIGGER_TYPES = new Set(['WebhookTriggerActor']);

/**
 * Derive the `sourcePorts` array from a schema's port descriptor. `dynamic`
 * ports (RouterActor / AiRouterActor) get one minted port per `--routes`
 * entry on top of the schema's fixed ports.
 */
export const deriveSourcePorts = (
  schema: BIQActorSchema,
  routes: string[] | undefined,
): { id: string; name?: string }[] => {
  const { type, fixedPorts, canAddPorts } = schema.sourcePorts;
  switch (type) {
    case 'none':
      return [];
    case 'singleDefault':
      return [{ id: 'SPRTdefault' }];
    case 'fixedMulti':
      return [...fixedPorts];
    case 'dynamic': {
      const added = (routes ?? [])
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ id: Id.createShortId('SPRT'), name }));
      // Fixed ports (e.g. the default fall-through) come after the routes,
      // matching the canvas convention.
      return canAddPorts ? [...added, ...fixedPorts] : [...fixedPorts];
    }
    default:
      return [...fixedPorts];
  }
};

export interface ScaffoldActorOptions {
  name: string;
  routes?: string[];
}

/**
 * Build a valid CanvasActor from a platform actor schema. Defaults
 * (`options`, ports, LTM/STM, code support) come straight from the schema —
 * no hardcoded per-type tables — so every actor type scaffolds correctly.
 */
export const buildCanvasActor = (schema: BIQActorSchema, opts: ScaffoldActorOptions): ScaffoldedActor => {
  const configuration: Record<string, unknown> = {
    options: yamlStringify(schema.defaultOptions ?? {}),
  };
  if (schema.code.supported && schema.code.language) {
    configuration.code = CODE_STUBS[schema.code.language];
  }

  const actor: ScaffoldedActor = {
    id: Id.create('ACTR'),
    type: schema.actorType,
    version: 1,
    name: opts.name,
    msgVar: convertActorNameToMsgVar(opts.name),
    description: '',
    isActive: true,
    continueOnError: false,
    enableLTM: schema.enableLTM,
    enableSTM: schema.enableSTM,
    sourcePorts: deriveSourcePorts(schema, opts.routes),
    configuration,
    schemas: {},
    position: { x: 0, y: 0 },
    edges: {},
  };

  if (WEBHOOK_TRIGGER_TYPES.has(schema.actorType)) {
    actor.webhookTriggerKey = monotonicUlid();
  }

  return actor;
};

/**
 * Convert a `borgiq templates get` payload (a template whose `actor` is in
 * ExportedCanvasActor shape) into a CanvasActor. Does both jobs the platform
 * splits across `importActor` (config → YAML strings) and the web canvas
 * layer (stamp `template` provenance):
 *  - YAML-stringify each present configuration/schema field,
 *  - mint a fresh actor id (+ webhook key when present),
 *  - stamp `template: { id, version, appName }` so the UI shows the app badge.
 */
export const actorFromTemplate = (
  template: BIQActorTemplateDetail,
  opts: { name?: string },
): ScaffoldedActor => {
  const src = template.actor as Record<string, unknown> | undefined;
  if (!src || typeof src !== 'object') {
    throw new Error("Template payload has no `actor` — pass the output of `borgiq templates get <id> --json`.");
  }

  const srcConfig = (src.configuration as Record<string, unknown> | undefined) ?? {};
  const configuration: Record<string, unknown> = { ...srcConfig };
  for (const field of CONFIG_YAML_FIELDS) {
    if (field === 'options') {
      // `options` is always serialized (mirrors importActor's unconditional dump).
      configuration.options = yamlStringify(srcConfig.options ?? {});
    } else if (srcConfig[field] !== undefined) {
      configuration[field] = yamlStringify(srcConfig[field]);
    }
  }

  const srcSchemas = (src.schemas as Record<string, unknown> | undefined) ?? {};
  const schemas: Record<string, unknown> = {};
  for (const field of SCHEMA_YAML_FIELDS) {
    if (srcSchemas[field] !== undefined) schemas[field] = yamlStringify(srcSchemas[field]);
  }

  const name = opts.name ?? (typeof src.name === 'string' ? src.name : template.name);

  const actor: ScaffoldedActor = {
    ...(src as ScaffoldedActor),
    id: Id.create('ACTR'),
    name,
    msgVar: convertActorNameToMsgVar(name),
    configuration,
    schemas,
    template: { id: template.id, version: template.version, appName: template.appName },
  };

  if (src.webhookTriggerKey !== undefined) {
    actor.webhookTriggerKey = monotonicUlid();
  }

  return actor;
};

/** Wrap actor(s) in the ExportedCanvasData envelope for `canvases create-with-data`. */
export const wrapCanvasEnvelope = (
  actors: Record<string, unknown>,
  meta: { name: string; slug: string; messageTtlInDays?: number },
): Record<string, unknown> => ({
  name: meta.name,
  slug: meta.slug,
  messageTTLInDays: meta.messageTtlInDays ?? 7,
  data: {
    schemaVersion: '1',
    actors,
  },
});

/** Wrap actor(s) in the operations envelope for `canvas-actors batch`. */
export const wrapBatch = (
  actors: { id: string; [key: string]: unknown }[],
  timestamp: number,
): Record<string, unknown> => ({
  operations: actors.map((actor) => ({
    type: 'add',
    actorId: actor.id,
    timestamp,
    data: actor,
  })),
});

/**
 * Normalize `--file` input (a single actor object, an array of actors, or an
 * `{ actors: {...} }` / `{ <id>: actor }` map) into an id→actor map.
 */
export const normalizeActorsInput = (input: unknown): Record<string, unknown> => {
  if (input == null || typeof input !== 'object') {
    throw new Error('Expected an actor object, an array of actors, or an actors map.');
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((actor) => [actorId(actor), actor]));
  }
  const obj = input as Record<string, unknown>;
  if (obj.actors && typeof obj.actors === 'object') {
    return obj.actors as Record<string, unknown>;
  }
  // A single actor (has an `id` + `type`) vs. an already-shaped id→actor map.
  if (typeof obj.id === 'string' && typeof obj.type === 'string') {
    return { [obj.id]: obj };
  }
  return obj;
};

const actorId = (actor: unknown): string => {
  if (actor && typeof actor === 'object' && typeof (actor as { id?: unknown }).id === 'string') {
    return (actor as { id: string }).id;
  }
  throw new Error('Each actor must have a string `id`.');
};
