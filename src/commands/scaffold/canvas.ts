import fs from 'node:fs';

import { CliUsageError, handleError } from '../../lib/errors.js';
import { Id, convertActorNameToMsgVar } from '../../lib/ids.js';

// === BEGIN verbatim port from scaffold-canvas.ts (interfaces + templates + buildCanvas) ===
// --- Types ---

interface ActorDef {
  type: string;
  name: string;
  description: string;
  configuration: Record<string, unknown>;
  sourcePorts?: { id: string; name?: string }[];
  code?: string;
  position: { x: number; y: number };
  enableLTM?: boolean;
  enableSTM?: boolean;
}

interface EdgeDef {
  sourceActorIndex: number;
  sourcePortId: string;
  targetActorIndex: number;
  label?: string;
}

interface Template {
  actors: ActorDef[];
  edges: EdgeDef[];
}

// --- Templates ---

const templates: Record<string, Template> = {
  'button-http': {
    actors: [
      {
        type: 'ButtonTriggerActor',
        name: 'Manual Trigger',
        description: 'Click to start the flow',
        configuration: { options: {} },
        position: { x: 0, y: 0 },
      },
      {
        type: 'HttpRequestActor',
        name: 'HTTP Request',
        description: 'Makes an HTTP request',
        configuration: {
          options: { method: 'GET', url: 'https://example.com' },
          outputs: '${{ results.body }}',
        },
        position: { x: 0, y: 200 },
      },
    ],
    edges: [{ sourceActorIndex: 0, sourcePortId: 'SPRTdefault', targetActorIndex: 1 }],
  },

  'webhook-router': {
    actors: [
      {
        type: 'WebhookTriggerActor',
        name: 'Webhook Trigger',
        description: 'Receives incoming webhook requests',
        configuration: {
          options: { allowedMethods: ['post'], respondImmediately: false, emitRawBody: false },
        },
        position: { x: 0, y: 0 },
      },
      {
        type: 'RouterActor',
        name: 'Router',
        description: 'Routes by condition',
        configuration: {
          options: {
            emitType: 'singleRoute',
            conditions: { Success: "${{ msg.webhook_trigger.body?.status === 'ok' }}" },
          },
        },
        // sourcePorts will be auto-generated for RouterActor
        position: { x: 0, y: 200 },
      },
      {
        type: 'WebhookResponseActor',
        name: 'Success Response',
        description: 'Returns 200 OK',
        configuration: {
          options: {
            statusCode: 200,
            body: { success: true, message: 'OK' },
            headers: { 'content-type': 'application/json' },
          },
        },
        position: { x: -300, y: 400 },
      },
      {
        type: 'WebhookResponseActor',
        name: 'Error Response',
        description: 'Returns 400 Bad Request',
        configuration: {
          options: {
            statusCode: 400,
            body: { success: false, message: 'Bad request' },
            headers: { 'content-type': 'application/json' },
          },
        },
        position: { x: 300, y: 400 },
      },
    ],
    edges: [
      { sourceActorIndex: 0, sourcePortId: 'SPRTdefault', targetActorIndex: 1 },
      { sourceActorIndex: 1, sourcePortId: '__ROUTE_0__', targetActorIndex: 2, label: 'Success' },
      { sourceActorIndex: 1, sourcePortId: 'SPRTdefault', targetActorIndex: 3, label: 'Error' },
    ],
  },

  'button-deno': {
    actors: [
      {
        type: 'ButtonTriggerActor',
        name: 'Manual Trigger',
        description: 'Click to start the flow',
        configuration: { options: {} },
        position: { x: 0, y: 0 },
      },
      {
        type: 'DenoActor',
        name: 'Process Data',
        description: 'Custom TypeScript processing',
        configuration: {
          options: {},
          code: 'const { message } = inputs;\n\nreturn {\n  processed: true,\n  result: message,\n  timestamp: new Date().toISOString(),\n};',
          inputs: { message: '${{ msg.manual_trigger.body }}' },
          outputs: '${{ results }}',
        },
        position: { x: 0, y: 200 },
      },
    ],
    edges: [{ sourceActorIndex: 0, sourcePortId: 'SPRTdefault', targetActorIndex: 1 }],
  },

  'scheduled-http': {
    actors: [
      {
        type: 'ScheduledTriggerActor',
        name: 'Scheduled Trigger',
        description: 'Runs on a cron schedule',
        configuration: { options: {} },
        position: { x: 0, y: 0 },
      },
      {
        type: 'HttpRequestActor',
        name: 'HTTP Request',
        description: 'Makes a scheduled HTTP request',
        configuration: {
          options: { method: 'GET', url: 'https://example.com/health' },
          outputs: '${{ results.body }}',
        },
        position: { x: 0, y: 200 },
      },
    ],
    edges: [{ sourceActorIndex: 0, sourcePortId: 'SPRTdefault', targetActorIndex: 1 }],
  },

  'button-ai': {
    actors: [
      {
        type: 'ButtonTriggerActor',
        name: 'Manual Trigger',
        description: 'Click to start the flow',
        configuration: { options: {} },
        position: { x: 0, y: 0 },
      },
      {
        type: 'AiActor',
        name: 'AI Response',
        description: 'Generates an AI response',
        configuration: {
          options: {
            model: 'claude-sonnet-4-5-20250514',
            maxTokens: 4096,
            systemPrompt: 'You are a helpful assistant.',
            prompt: '${{ inputs.prompt }}',
          },
          inputs: { prompt: '${{ msg.manual_trigger.body.prompt }}' },
          outputs: '${{ results.content }}',
        },
        position: { x: 0, y: 200 },
      },
    ],
    edges: [{ sourceActorIndex: 0, sourcePortId: 'SPRTdefault', targetActorIndex: 1 }],
  },
};

// --- Build Canvas ---

function buildCanvas(
  name: string,
  slug: string,
  description: string,
  ttl: number,
  template: Template,
): Record<string, unknown> {
  // Generate actor IDs
  const actorIds = template.actors.map(() => Id.create('ACTR'));
  const actorMsgVars = template.actors.map((a) => convertActorNameToMsgVar(a.name));

  // Generate router port IDs for any RouterActor/AiRouterActor
  const routerPortIds: Record<number, string[]> = {};
  for (let i = 0; i < template.actors.length; i++) {
    const actor = template.actors[i];
    if (actor.type === 'RouterActor' || actor.type === 'AiRouterActor') {
      // Count how many edges use __ROUTE_N__ from this actor
      const routeEdges = template.edges.filter(
        (e) => e.sourceActorIndex === i && e.sourcePortId.startsWith('__ROUTE_'),
      );
      routerPortIds[i] = routeEdges.map(() => Id.createShortId('SPRT'));
    }
  }

  // Build actors
  const actors: Record<string, unknown> = {};

  for (let i = 0; i < template.actors.length; i++) {
    const def = template.actors[i];
    const actorId = actorIds[i];
    const msgVar = actorMsgVars[i];

    // Build source ports
    let sourcePorts: { id: string; name?: string }[];
    if (def.sourcePorts) {
      sourcePorts = def.sourcePorts;
    } else if (def.type === 'RouterActor' || def.type === 'AiRouterActor') {
      const routePorts = routerPortIds[i] || [];
      const conditionNames = Object.keys(
        (def.configuration.options as Record<string, unknown>)?.conditions as Record<string, unknown> || {},
      );
      sourcePorts = [
        ...routePorts.map((portId, idx) => ({ id: portId, name: conditionNames[idx] || `Route ${idx}` })),
        { id: 'SPRTdefault', name: 'F' },
      ];
    } else if (def.type === 'AgentHarnessActor' || def.type === 'AiAgentActor') {
      sourcePorts = [
        { id: 'SPRTdone000', name: 'Done' },
        { id: 'SPRTdefault', name: 'Status' },
      ];
    } else if (def.type === 'InterfaceActor') {
      sourcePorts = [
        { id: 'SPRTevent00', name: 'Event' },
        { id: 'SPRTdefault', name: 'Meta' },
      ];
    } else if (def.type === 'AppTriggerActor' || def.type === 'CommentActor') {
      sourcePorts = [];
    } else {
      sourcePorts = [{ id: 'SPRTdefault' }];
    }

    // Build edges for this actor
    const edges: Record<string, unknown> = {};
    const actorEdges = template.edges.filter((e) => e.sourceActorIndex === i);

    for (const edgeDef of actorEdges) {
      const edgeId = Id.create('EDGE');
      let sourcePortId = edgeDef.sourcePortId;

      // Resolve __ROUTE_N__ placeholders
      if (sourcePortId.startsWith('__ROUTE_')) {
        const routeIdx = parseInt(sourcePortId.replace('__ROUTE_', '').replace('__', ''), 10);
        sourcePortId = routerPortIds[i]?.[routeIdx] || 'SPRTdefault';
      }

      edges[edgeId] = {
        id: edgeId,
        sourceActorId: actorId,
        sourcePortId,
        targetActorId: actorIds[edgeDef.targetActorIndex],
        targetPortId: 'TPRTdefault',
        ...(edgeDef.label ? { label: edgeDef.label } : {}),
        type: 'borgiqEdge',
      };
    }

    // Build configuration
    const configuration: Record<string, unknown> = { ...def.configuration };
    if (def.type === 'WebhookTriggerActor' && !configuration.webhookTriggerKey) {
      configuration.webhookTriggerKey = Id.ulid();
    }

    actors[actorId] = {
      id: actorId,
      type: def.type,
      version: 1,
      name: def.name,
      msgVar,
      description: def.description,
      isActive: true,
      continueOnError: false,
      enableLTM: def.enableLTM ?? false,
      enableSTM: def.enableSTM ?? false,
      sourcePorts,
      configuration,
      schemas: {},
      position: def.position,
      edges,
    };
  }

  return {
    name,
    slug,
    description,
    messageTTLInDays: ttl,
    runtimeSlug: '',
    data: {
      schemaVersion: '1',
      actors,
    },
  };
}
// === END verbatim port ===

interface ScaffoldCanvasOptions {
  name?: string;
  slug?: string;
  description?: string;
  template: string;
  ttl: string;
  output?: string;
}

export const scaffoldCanvas = (options: ScaffoldCanvasOptions, _command: unknown): void => {
  try {
    if (!options.name || !options.slug) {
      throw new CliUsageError('--name and --slug are required.');
    }
    const tpl = templates[options.template];
    if (!tpl) {
      throw new CliUsageError(`Unknown template '${options.template}'. Available: ${Object.keys(templates).join(', ')}`);
    }
    const canvas = buildCanvas(
      options.name,
      options.slug,
      options.description ?? '',
      parseInt(options.ttl, 10),
      tpl,
    );
    const json = JSON.stringify(canvas, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, json + '\n');
      if (process.stderr.isTTY) process.stderr.write(`Canvas JSON written to ${options.output}\n`);
    } else {
      process.stdout.write(json + '\n');
    }
  } catch (error) {
    handleError(error);
  }
};
