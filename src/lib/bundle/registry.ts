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

export interface BundlePathSpec {
  category: BundleCategory;
  folder: string;
  codeFiles: BundleCodeFile[];
}

const modTs = (): BundleCodeFile[] => [{ file: 'mod.ts', source: { kind: 'code' } }];

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
  ScheduledTriggerActor: { category: 'triggers', folder: 'scheduled', codeFiles: [] },
  UniversalTriggerActor: { category: 'triggers', folder: 'universal', codeFiles: modTs() },
  WebhookTriggerActor: { category: 'triggers', folder: 'webhook', codeFiles: [] },

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

  CommentActor: { category: 'other', folder: 'comment', codeFiles: [] },
  EchoActor: { category: 'other', folder: 'echo', codeFiles: [] },
});

export const isKnownActorType = (type: string): type is BundleActorType =>
  (BIQ_ACTOR_TYPES as readonly string[]).includes(type);

export const actorFolderPath = (type: BundleActorType, actorId: string): string => {
  const spec = BUNDLE_PATH_REGISTRY[type];
  return `actors/${spec.category}/${spec.folder}/${actorId}`;
};

export const RESERVED_CODE_FILENAMES: ReadonlySet<string> = new Set([
  'server.ts',
  'handler.ts',
  'actor.ts',
  'deno.jsonc',
  'deno.lock',
  'mod_test.ts',
]);
