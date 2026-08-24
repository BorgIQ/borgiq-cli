/**
 * Canvas Bundle v1 actor-type path registry. This is exhaustive over
 * the platform actor types supported by this CLI version.
 */

export const BIQ_ACTOR_TYPES = [
  'AgentHarnessActor',
  'AiActor',
  'AiAgentActor',
  'AiRouterActor',
  'AppTriggerActor',
  'ButtonTriggerActor',
  'CallFlowActor',
  'CallableResponseActor',
  'CallableTriggerActor',
  'CollectionActor',
  'CommentActor',
  'DataStoreActor',
  'DenoActor',
  'DenoTestActor',
  'DeprecatedAiAgent',
  'EchoActor',
  'EmailTriggerActor',
  'HttpRequestActor',
  'InterfaceActor',
  'InterfaceStatusActor',
  'InterfaceTriggerActor',
  'McpServerActor',
  'MessageProcessorActor',
  'PythonActor',
  'ReactAppTriggerActor',
  'RouterActor',
  'ScheduledTriggerActor',
  'SendEmailActor',
  'UniversalTriggerActor',
  'WebhookResponseActor',
  'WebhookTriggerActor',
] as const;

export type BundleActorType = (typeof BIQ_ACTOR_TYPES)[number];

export type BundleCategory = 'triggers' | 'tasks' | 'other';

export type CodeSource = { kind: 'code' } | { kind: 'option'; key: 'html' | 'css' | 'script' };

export interface BundleCodeFile {
  file: string;
  source: CodeSource;
}

/**
 * Paths the BorgIQ runtime owns inside an actor's code tree. A bundle may not contain
 * them: the runtime writes its own files over the actor's on every run, and some of the
 * names would change how the language resolves modules even without being overwritten.
 *
 * Matched case-insensitively, because a case-insensitive filesystem cannot tell
 * `Server.ts` from `server.ts`.
 */
export interface ReservedPathSet {
  /** whole paths that are reserved */
  exact: readonly string[];
  /** directory prefixes, each written WITH its trailing '/' */
  prefixes: readonly string[];
}

/** Files and directories the CLI never reads, writes, or deletes inside a project tree. */
export interface BundleProjectIgnore {
  /** Directory names a project walker never descends into, at any depth. */
  dirs: readonly string[];
  /** File names never synced, wherever in the tree they appear. */
  files: readonly string[];
}

export interface BundlePathSpec {
  category: BundleCategory;
  folder: string;
  codeFiles: BundleCodeFile[];
  /**
   * Externalizes the whole `configuration.codeDir` array as an arbitrary `code/` tree
   * instead of the fixed `codeFiles` entrypoints.
   */
  projectDir?: boolean;
  /** Required entrypoint filename at the project root (projectDir types only). */
  entrypoint?: string;
  /** Paths a bundle may not contain for this type (projectDir types only). */
  reservedPaths?: ReservedPathSet;
  /** Local tooling output the CLI leaves alone (projectDir types only). */
  ignore?: BundleProjectIgnore;
}

export const REACT_APP_TYPE = 'ReactAppTriggerActor';

/**
 * Reserved by the BorgIQ runtime for Deno, Deno Test, and Universal Trigger actors.
 *
 * These mirror what the BorgIQ API rejects on save, so a bundle fails locally rather than at
 * push time. The API is the authority: keep these lists in step when it names a new one.
 */
export const DENO_RESERVED_PATHS: ReservedPathSet = {
  exact: [
    'server.ts',
    'handler.ts',
    'actor.ts',
    'main_test.ts',
    'deno.json',
    'deno.jsonc',
    'deno.lock',
    'package.json',
  ],
  prefixes: ['shared/', 'node_modules/'],
};

/** Reserved by the BorgIQ runtime for Python actors. */
export const PYTHON_RESERVED_PATHS: ReservedPathSet = {
  exact: ['server.py', 'handler.py', 'borgiq.py', 'pyproject.toml', '.python-version', 'uv.lock'],
  prefixes: ['.borgiq/', '.venv/', 'borgiq/'],
};

/** Lockfiles and editor droppings no project syncs: the platform installs dependencies itself. */
const IGNORED_PROJECT_FILES = [
  'deno.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  '.DS_Store',
  'Thumbs.db',
] as const;

const DENO_IGNORE: BundleProjectIgnore = {
  dirs: ['node_modules', 'dist', '.vite', '.git'],
  files: IGNORED_PROJECT_FILES,
};

const PYTHON_IGNORE: BundleProjectIgnore = {
  dirs: ['.venv', '__pycache__', '.borgiq', '.git'],
  files: [...IGNORED_PROJECT_FILES, 'uv.lock'],
};

const REACT_APP_IGNORE: BundleProjectIgnore = {
  dirs: ['node_modules', 'dist', '.git', '.vite', '__borgiq_sdk_placeholder__'],
  files: IGNORED_PROJECT_FILES,
};

/** The three Deno-family code actors share one entrypoint name and one reserved set. */
const denoProject = (): Pick<BundlePathSpec, 'codeFiles' | 'projectDir' | 'entrypoint' | 'reservedPaths' | 'ignore'> => ({
  codeFiles: [],
  projectDir: true,
  entrypoint: 'main.ts',
  reservedPaths: DENO_RESERVED_PATHS,
  ignore: DENO_IGNORE,
});

export const BUNDLE_PATH_REGISTRY: Readonly<Record<BundleActorType, BundlePathSpec>> = Object.freeze({
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
  ReactAppTriggerActor: { category: 'triggers', folder: 'react-app', codeFiles: [], projectDir: true, ignore: REACT_APP_IGNORE },
  ScheduledTriggerActor: { category: 'triggers', folder: 'scheduled', codeFiles: [] },
  UniversalTriggerActor: { category: 'triggers', folder: 'universal', ...denoProject() },
  WebhookTriggerActor: { category: 'triggers', folder: 'webhook', codeFiles: [] },

  AgentHarnessActor: { category: 'tasks', folder: 'agent-harness', codeFiles: [] },
  AiActor: { category: 'tasks', folder: 'ai', codeFiles: [] },
  AiAgentActor: { category: 'tasks', folder: 'ai-agent', codeFiles: [] },
  AiRouterActor: { category: 'tasks', folder: 'ai-router', codeFiles: [] },
  CallFlowActor: { category: 'tasks', folder: 'call-flow', codeFiles: [] },
  CallableResponseActor: { category: 'tasks', folder: 'callable-response', codeFiles: [] },
  CollectionActor: { category: 'tasks', folder: 'collection', codeFiles: [] },
  DataStoreActor: { category: 'tasks', folder: 'data-store', codeFiles: [] },
  DenoActor: { category: 'tasks', folder: 'deno', ...denoProject() },
  DenoTestActor: { category: 'tasks', folder: 'deno-test', ...denoProject() },
  DeprecatedAiAgent: { category: 'tasks', folder: 'deprecated-ai-agent', codeFiles: [] },
  HttpRequestActor: { category: 'tasks', folder: 'http-request', codeFiles: [] },
  InterfaceActor: { category: 'tasks', folder: 'interface', codeFiles: [] },
  InterfaceStatusActor: { category: 'tasks', folder: 'interface-status', codeFiles: [] },
  MessageProcessorActor: { category: 'tasks', folder: 'message-processor', codeFiles: [] },
  PythonActor: {
    category: 'tasks',
    folder: 'python',
    codeFiles: [],
    projectDir: true,
    entrypoint: 'main.py',
    reservedPaths: PYTHON_RESERVED_PATHS,
    ignore: PYTHON_IGNORE,
  },
  RouterActor: { category: 'tasks', folder: 'router', codeFiles: [] },
  SendEmailActor: { category: 'tasks', folder: 'send-email', codeFiles: [] },
  WebhookResponseActor: { category: 'tasks', folder: 'webhook-response', codeFiles: [] },

  CommentActor: { category: 'other', folder: 'comment', codeFiles: [] },
  EchoActor: { category: 'other', folder: 'echo', codeFiles: [] },
});

export const isKnownActorType = (type: string): type is BundleActorType =>
  (BIQ_ACTOR_TYPES as readonly string[]).includes(type);

export const actorFolderPath = (type: BundleActorType, actorId: string): string => {
  const spec = BUNDLE_PATH_REGISTRY[type];
  return `actors/${spec.category}/${spec.folder}/${actorId}`;
};
