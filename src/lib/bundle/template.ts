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

const createWebhookConfig = (): Record<string, unknown> => ({
  triggerKey: monotonicUlid(),
  authorizationLevel: 'public',
  allowedMethods: ['get', 'post'],
  responseTimeout: 30,
});

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
    description: "The Webhook Actor will create messages by receiving webhooks from any source to the actor's webhook URL.",
    isActive: true,
    sourcePorts: [{ id: 'SPRTdefault' }],
    continueOnError: false,
    enableLTM: false,
    enableSTM: false,
    showInWorkspaceApps: true,
    runtimeSlug: '',
    configuration: {
      webhook: createWebhookConfig(),
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

# React App actor projects: produced by local tooling, never synced by the CLI
actors/*/react-app/*/code/node_modules/
actors/*/react-app/*/code/dist/
actors/*/react-app/*/code/.vite/
actors/*/react-app/*/code/deno.lock
actors/*/react-app/*/code/package-lock.json

# CLI-materialized @borgiq/actors stub; the platform supplies the real SDK at build time
actors/*/react-app/*/code/__borgiq_sdk_placeholder__/
`;

export const BUNDLE_AGENTS_MD = `# BorgIQ Canvas Bundle

This folder is a BorgIQ canvas bundle: a workflow canvas expanded into files
for git and AI editing. The borgiq CLI compiles it to and from the platform's
canvas export format. Format: borgiq.canvas.bundle v1.

## Layout

- canvas.yaml: authoritative root for canvas metadata, graph.nodes, graph.edges,
  dependencies, export errors, warnings, sync.actors baselines, and the actor
  index. Do not edit sync metadata by hand.
- actors/<category>/<type>/<ACTOR_ID>/actor.yaml: one actor per folder. Edges
  and positions do not live here; they live in canvas.yaml.
- actors/.../<ACTOR_ID>/code/: native code files for Deno, Deno Test,
  Universal Trigger, Python, and App actors. When present, actor.yaml carries
  configuration.codeDir: code and must not also contain inline code.
- actors/triggers/react-app/<ACTOR_ID>/code/: a whole Vite project rather than
  a single entrypoint. See "React App actors" below.

## Editing Rules

1. Adding an actor takes three edits: create actor.yaml, add an actors[] entry
   in canvas.yaml, and add a graph.nodes entry. Wire it with graph.edges.
2. An edge sourcePortId must exist in the source actor's sourcePorts.
3. Edit code in code/ files, not in actor.yaml. Except for React App actors,
   only the canonical entrypoint file is allowed in code/; helper files are not
   supported yet.
4. Folder names are actor IDs and must match actor.yaml and the index.
5. Extra files under actors/ are ignored with warnings. Unmanaged files outside
   canvas.yaml and actors/ are left alone by the CLI.

## React App actors

A React App actor's code/ is a real, runnable Vite project, not a single file.
Run npm install, npm run dev, and any generator (npx shadcn@latest add button)
inside it; every text file you add becomes part of the actor's source on push.

\`\`\`
actors/triggers/react-app/<ACTOR_ID>/
  actor.yaml            # configuration.codeDir: code (marker); options.files inline
  code/
    package.json  vite.config.ts  index.html  tsconfig*.json  deno.json
    src/                          # main.tsx, App.tsx, components, ...
    src/assets/                   # THE asset directory - see below
    __borgiq_sdk_placeholder__/   # written once by the CLI; do not edit or commit
    node_modules/ dist/           # yours; the CLI never reads or deletes these
\`\`\`

### src/assets/ is the only synced asset directory

Files under code/src/assets/ are synced with workspace assets, not with the
actor's source: pull downloads them, push uploads new and changed ones and
records each as an options.files entry of the form

    { path: src/assets/hero.png, content: \${{ assets["hero.png"] }} }

A new file is keyed by its file name, exactly as uploading it in the editor
would be. Deleting a file locally removes the entry on the next push but leaves
the workspace asset in place (remove it with borgiq assets delete). Entries you
hand-author with inline text, or outside src/assets/, are left strictly alone.

Binary files anywhere else under code/ are ignored with a warning - move them
under src/assets/ to sync them. options.files order is meaningful (a later
overlay wins on a path collision), so it is never reordered.

### What the CLI never touches

node_modules/, dist/, .git/, .vite/, __borgiq_sdk_placeholder__/, lockfiles
(deno.lock, package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock*),
.DS_Store, and Thumbs.db. These survive every pull, push, and --replace. Lock
files are deliberately not synced: the platform installs dependencies itself,
and a lockfile can exceed the source-size budget on its own.

.env and .env.* are ignored with a warning: an actor's source is readable by
anyone who can open the canvas, and a Vite build inlines VITE_* values into the
app it serves. Use platform variables or secrets instead.

### Creating one from scratch

Prefer creating the actor in the editor and running bundle pull. Otherwise
scaffold a Vite react-ts project into code/, then make the usual three edits
with type: ReactAppTriggerActor, sourcePorts: [], configuration.codeDir: code,
and configuration.options: { files: [], endpoints: [] }. Keep the template's
"build": "tsc -b && vite build" script, the @borgiq/actors dependency line
pointing at ./__borgiq_sdk_placeholder__, and vite.config.ts's base: './',
build.cssCodeSplit: false, build.assetsInlineLimit: 0, and
build.rollupOptions.output.inlineDynamicImports: true. borgiq bundle validate
warns about each of these if it is missing.

### Line endings

Content is compared byte for byte, so a git autocrlf or .gitattributes setting
that rewrites line endings on checkout makes every file look locally edited.
Keep this project checked out with LF endings.

## Workflow

\`\`\`bash
borgiq bundle validate .
borgiq bundle pack . -o export.yaml
borgiq bundle push .
borgiq bundle pull <canvas> .
\`\`\`
`;
