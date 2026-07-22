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
actors/*/react-app/*/code/npm-shrinkwrap.json
actors/*/react-app/*/code/yarn.lock
actors/*/react-app/*/code/pnpm-lock.yaml
actors/*/react-app/*/code/bun.lockb
actors/*/react-app/*/code/bun.lock

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
  a single entrypoint. Push publishes its source; borgiq bundle build (or Build
  in the web editor) compiles and serves it. See "React App actors" below.

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

### The local loop, and the Build step

Work in code/ like any Vite project: npm install (it resolves @borgiq/actors
from the stub the CLI writes), npm run dev, and any generator you like
(npx shadcn@latest add button). Every text file you add becomes part of the
actor's source on the next push.

A push uploads source only - the app visitors see does not change until the
project is built. Build it with borgiq bundle build (it pushes first, then
builds and waits for the result) or by pressing Build in the web editor. When a
canvas has several react-app actors, borgiq bundle build builds them all; pass
--actor <id> (repeatable) to build a subset. The platform installs the
dependencies and builds the project there, and reports failures in the build
log, so a successful push is not evidence that the app compiles. Run npm run
build locally before building to find that out sooner.

### Third-party dependencies

Add packages the normal way - npm install <pkg> inside code/, or edit
package.json by hand. What differs from an ordinary Vite app:

- Pin exact versions. The lockfile is never synced, so the build resolves
  package.json on its own and a range can drift to a version you never ran.
  The template pins exact versions for this reason.
- devDependencies are installed too; vite and typescript belong there.
- A version published in the last few days may be rejected: deno.json sets a
  minimum dependency age. Prefer a release that has been out a week or more.
- Packages that need a postinstall step (native builds, downloaded binaries)
  are not supported - install scripts do not run.
- The build must produce one JS file and at most one CSS file, or it fails.
  Do not introduce route-level React.lazy or dynamic-import code splitting,
  and be wary of libraries that emit a CSS chunk of their own. Keep
  build.cssCodeSplit: false and
  build.rollupOptions.output.inlineDynamicImports: true in vite.config.ts.
- Icon packages (@tabler/icons-react, lucide-react) ship one .mjs file per
  icon, so a barrel import pulls in thousands of modules. Rollup reads up to
  1000 in parallel by default, which can exhaust the build sandbox's
  file-descriptor limit and fail with "EMFILE: too many open files". Keep
  build.rollupOptions.maxParallelFileOps: 20 in vite.config.ts.
- Keep the @borgiq/actors dependency line and resolve.dedupe:
  ['react', 'react-dom'] - the SDK's hooks and your components must share one
  React instance.
- Styling: build-time CSS (plain CSS, CSS Modules, Tailwind, shadcn/ui) is the
  smooth path. Libraries that inject <style> tags at runtime - the CSS-in-JS
  family - render unstyled unless the actor's allowInlineStyling option is on.
- Network: the served app cannot call third-party APIs from the browser. Reach
  BorgIQ through a declared endpoint (below) and anything else through a
  canvas actor.
- node_modules/ is never synced and does not count toward the source budget,
  but files a generator copies into src/ do: bundle validate warns past 200
  files or 1 MiB of text.

### src/assets/ is the only synced asset directory

Files under code/src/assets/ are synced with workspace assets, not with the
actor's source: pull downloads them, push uploads new and changed ones and
records each as an options.files entry of the form

    { path: src/assets/hero.png, content: \${{ assets["hero.png"] }} }

Reference one from source with a normal import, so the bundler rewrites it:

    import hero from './assets/hero.png';   // then <img src={hero} />

Do not hardcode a path like /src/assets/hero.png, and do not use public/: the
app is served under a per-app base path, so a root-absolute URL resolves
somewhere else entirely.

A new file is keyed by its file name, exactly as uploading it in the editor
would be. Assets are workspace-wide, so two actors referencing hero.png share
one asset and replacing it changes both on their next Build. If that key is
already taken by an identical file the CLI adopts it; if it is taken by
different content the push stops and asks you to rename. Deleting a file
locally removes the entry on the next push but leaves the workspace asset in
place (remove it with borgiq assets delete). Entries you hand-author with
inline text, or outside src/assets/, are left strictly alone.

Binary files anywhere else under code/ are ignored with a warning - move them
under src/assets/ to sync them. options.files order is meaningful (a later
overlay wins on a path collision), so it is never reordered.

### Calling BorgIQ from the app

The app reaches a canvas through endpoints declared on the actor. Each entry in
configuration.options.endpoints names a Webhook Trigger actor, which should use
the 'apps' authorization level:

    endpoints:
      - name: submitOrder      # the SDK lookup key
        actorId: ACTR...       # a WebhookTriggerActor

Add canvasSlug or workspaceSlug to target a trigger elsewhere in the org; omit
them for this app's own canvas. Then, in a component:

    import { useEndpoint } from '@borgiq/actors';
    const { data, loading, error, trigger } = useEndpoint('submitOrder');

useEndpoint does not fetch on mount - call trigger(), optionally with method,
headers, or body overrides. trigger never rejects, so read error instead of
wrapping it in try/catch; callEndpoint(name, search, init) is the promise form
and does reject. Use getBasename() as your router's basename, since the app is
served under a per-app base path.

A raw fetch() to a webhook URL is not authenticated - the app token rides on
SDK calls only. Endpoint changes take effect on the next Build, and the local
stub SDK carries no endpoint data, so under npm run dev an endpoint call
throws; gate it behind mock data if you need the page to render.

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
borgiq bundle build .            # React App actors: push, then compile and serve
\`\`\`

For React App actors, borgiq bundle build pushes the bundle and then compiles
and serves the app (what visitors see does not change until it is built). It
builds every React App actor on the canvas by default; pass --actor <id>
(repeatable) to build a subset, and --force-local to let the pre-build push
resolve conflicts in favour of the local version. A non-zero exit means a build
failed; the compiler error and structured details are reported. React App
actors are the only actor type that needs a build step.
`;
