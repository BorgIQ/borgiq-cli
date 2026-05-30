import fs from 'node:fs';

import { stringify as yamlStringify } from 'yaml';

import { handleError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { Id, convertActorNameToMsgVar } from '../../lib/ids.js';

// === BEGIN verbatim port from convert-template-to-actor.ts ===
// --- Types (narrowed to what we touch) ---

interface ExportedActorConfiguration {
  webhookTriggerKey?: string;
  aiAgentToolActorIds?: string[];
  code?: string;
  connection?: unknown;
  credentials?: Record<string, unknown>;
  inputs?: unknown;
  vars?: unknown;
  options: unknown;
  outputs?: unknown;
  error?: unknown;
}

interface ExportedActorSchemas {
  inputs?: unknown;
  outputs?: unknown;
}

interface ExportedCanvasActor {
  id: string;
  version: number;
  type: string;
  name: string;
  msgVar: string;
  description: string;
  isActive: boolean;
  continueOnError: boolean;
  enableLTM: boolean;
  enableSTM: boolean;
  showInWorkspaceApps?: boolean;
  sourcePorts: { id: string; name?: string; description?: string }[];
  configuration: ExportedActorConfiguration;
  schemas: ExportedActorSchemas;
  position?: { x: number; y: number };
  runtimeSlug?: string;
  icon?: unknown;
  edges?: Record<string, unknown>;
}

interface TemplatePayload {
  id: string;
  version: number;
  appName: string;
  actor?: ExportedCanvasActor;
}

interface CanvasActorBody {
  id?: string;
  version: number;
  type: string;
  name: string;
  msgVar: string;
  description: string;
  isActive: boolean;
  continueOnError: boolean;
  enableLTM: boolean;
  enableSTM: boolean;
  showInWorkspaceApps?: boolean;
  sourcePorts: { id: string; name?: string; description?: string }[];
  configuration: Record<string, unknown>;
  schemas: Record<string, unknown>;
  edges: Record<string, unknown>;
  position: { x: number; y: number };
  runtimeSlug?: string;
  icon?: unknown;
  template: { id: string; version: number; appName: string };
}

// --- Conversion ---

const TRIGGER_TYPES_NEEDING_WEBHOOK_KEY = new Set([
  'WebhookTriggerActor',
  'UniversalTriggerActor',
]);

// Mirrors importActor() in packages/utils/src/canvas.ts. Each field is only
// stringified when defined; `options` is the one required field on the
// platform side, so we always emit it (defaulting to {} if the template
// omitted it — shouldn't happen, but defensive).
function yamlOrUndefined(value: unknown): string | undefined {
  return value === undefined ? undefined : yamlStringify(value);
}

function importActorConfiguration(cfg: ExportedActorConfiguration): Record<string, unknown> {
  return {
    ...cfg,
    credentials: yamlOrUndefined(cfg.credentials),
    inputs: yamlOrUndefined(cfg.inputs),
    vars: yamlOrUndefined(cfg.vars),
    options: yamlStringify(cfg.options ?? {}),
    outputs: yamlOrUndefined(cfg.outputs),
    error: yamlOrUndefined(cfg.error),
  };
}

function importActorSchemas(schemas: ExportedActorSchemas): Record<string, unknown> {
  return {
    inputs: yamlOrUndefined(schemas.inputs),
    outputs: yamlOrUndefined(schemas.outputs),
  };
}

interface ConvertOptions {
  actorId?: string;
  name?: string;
  msgVar?: string;
  description?: string;
  positionX?: number;
  positionY?: number;
  includeId?: boolean;
}

function convertTemplateToActor(template: TemplatePayload, opts: ConvertOptions): { actorId: string; body: CanvasActorBody } {
  if (!template.actor) {
    throw new Error('Template payload is missing `actor` — pass the full response from `borgiq templates get`.');
  }
  const src = template.actor;

  const actorId = opts.actorId ?? Id.create('ACTR');
  const name = opts.name ?? src.name;
  const msgVar = opts.msgVar ?? convertActorNameToMsgVar(name);
  const position = {
    x: opts.positionX ?? src.position?.x ?? 0,
    y: opts.positionY ?? src.position?.y ?? 0,
  };

  const configuration = importActorConfiguration(src.configuration);
  if (TRIGGER_TYPES_NEEDING_WEBHOOK_KEY.has(src.type) && !configuration.webhookTriggerKey) {
    configuration.webhookTriggerKey = Id.ulid();
  }

  const body: CanvasActorBody = {
    version: src.version,
    type: src.type,
    name,
    msgVar,
    description: opts.description ?? src.description,
    isActive: src.isActive,
    continueOnError: src.continueOnError,
    enableLTM: src.enableLTM,
    enableSTM: src.enableSTM,
    showInWorkspaceApps: src.showInWorkspaceApps ?? true,
    sourcePorts: src.sourcePorts,
    configuration,
    schemas: importActorSchemas(src.schemas),
    // Template-internal edges don't apply — the new canvas owns edges.
    edges: {},
    position,
    runtimeSlug: src.runtimeSlug,
    icon: src.icon,
    template: {
      id: template.id,
      version: template.version,
      appName: template.appName,
    },
  };

  if (opts.includeId) {
    body.id = actorId;
  }

  return { actorId, body };
}
// === END verbatim port ===

interface ActorFromTemplateOptions {
  file?: string;
  output?: string;
  actorId?: string;
  name?: string;
  msgVar?: string;
  description?: string;
  positionX?: string;
  positionY?: string;
  batch?: boolean;
  includeId?: boolean;
  printId?: boolean; // commander sets to false when --no-print-id is passed
}

export const scaffoldActorFromTemplate = async (
  options: ActorFromTemplateOptions,
  _command: unknown,
): Promise<void> => {
  try {
    const template = (await readInput(options.file)) as TemplatePayload;

    const { actorId: newActorId, body } = convertTemplateToActor(template, {
      actorId: options.actorId,
      name: options.name,
      msgVar: options.msgVar,
      description: options.description,
      positionX: options.positionX !== undefined ? parseFloat(options.positionX) : undefined,
      positionY: options.positionY !== undefined ? parseFloat(options.positionY) : undefined,
      includeId: Boolean(options.includeId) || Boolean(options.batch),
    });

    const result = options.batch
      ? { operations: [{ type: 'add', actorId: newActorId, timestamp: Date.now(), data: body }] }
      : body;

    const json = JSON.stringify(result, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, json + '\n');
      if (process.stderr.isTTY) process.stderr.write(`Wrote ${options.output}\n`);
    } else {
      process.stdout.write(json + '\n');
    }

    const shouldPrintId = options.printId ?? Boolean(options.output);
    if (shouldPrintId) {
      process.stderr.write(newActorId + '\n');
    }
  } catch (error) {
    handleError(error);
  }
};
