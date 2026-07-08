import { Id, convertActorNameToMsgVar, monotonicUlid } from '../ids.js';
import { disassemble } from './disassemble.js';
import type { BundleFileMap, CanvasExportDocument, ExportedActor } from './types.js';

export interface StarterOptions {
  name: string;
  slug: string;
}

const DENO_STARTER_CODE = `import type { Request, Response } from '@borgiq/actors';

export default async function receive(req: Request): Promise<Response> {
  return {
    results: {},
    memory: req.memory,
  };
}
`;

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
    description: 'The Webhook Actor will create messages by receiving webhooks from any source to the actor"s webhook URL.',
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
    description: 'Starter Deno task - edit code/mod.ts.',
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

export const BUNDLE_GITIGNORE = `# BorgIQ local dev artifacts (reserved for future bundle tooling)
.borgiq/
`;

export const BUNDLE_AGENTS_MD = `# BorgIQ Canvas Bundle

This folder is a BorgIQ canvas bundle: a workflow canvas expanded into files
for git and AI editing. The borgiq CLI compiles it to and from the platform's
canvas export format. Format: borgiq.canvas.bundle v1.

## Layout

- canvas.yaml: authoritative root for canvas metadata, graph.nodes, graph.edges,
  dependencies, export errors, warnings, and the actor index.
- actors/<category>/<type>/<ACTOR_ID>/actor.yaml: one actor per folder. Edges
  and positions do not live here; they live in canvas.yaml.
- actors/.../<ACTOR_ID>/code/: native code files for Deno, Deno Test,
  Universal Trigger, Python, and App actors. When present, actor.yaml carries
  configuration.codeDir: code and must not also contain inline code.

## Editing Rules

1. Adding an actor takes three edits: create actor.yaml, add an actors[] entry
   in canvas.yaml, and add a graph.nodes entry. Wire it with graph.edges.
2. An edge sourcePortId must exist in the source actor's sourcePorts.
3. Edit code in code/ files, not in actor.yaml. Only the canonical entrypoint
   file is allowed in code/; helper files are not supported yet.
4. Folder names are actor IDs and must match actor.yaml and the index.
5. Extra files under actors/ are ignored with warnings; files outside actors/
   are left alone by the CLI.

## Workflow

\`\`\`bash
borgiq bundle validate .
borgiq bundle pack . -o export.yaml
borgiq bundle push .
borgiq bundle pull <canvas> .
\`\`\`
`;
