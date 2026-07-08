/** Relative POSIX path -> file contents. The in-memory form of a bundle. */
export type BundleFileMap = Record<string, string>;

/**
 * The platform's exported canvas document (`{ metadata, data }`).
 * `data` is ExportedCanvasData: actors keyed by id.
 */
export interface CanvasExportDocument {
  metadata: Record<string, unknown>;
  data: {
    schemaVersion: string;
    actors: Record<string, ExportedActor>;
  };
}

/**
 * An actor in exported form. Only fields the compiler transforms are typed;
 * everything else passes through verbatim for forward compatibility.
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

export interface BundleSync {
  actorVersions?: Record<string, number>;
}

export interface BundleRootDoc {
  format: string;
  formatVersion: number;
  canvas: Record<string, unknown>;
  graph: { nodes: BundleGraphNode[]; edges: ExportedEdge[] };
  dependencies: BundleDependencies;
  exportErrors: unknown[];
  warnings: string[];
  sync?: BundleSync;
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

export const FORMAT_NAME = 'borgiq.canvas.bundle';
export const FORMAT_VERSION = 1;
export const ROOT_FILE = 'canvas.yaml';
export const ACTOR_FILE = 'actor.yaml';
export const CODE_DIR = 'code';

export const ROOT_KEY_ORDER = ['format', 'formatVersion', 'canvas', 'graph', 'dependencies', 'exportErrors', 'warnings', 'sync', 'actors'] as const;
export const CANVAS_KEY_ORDER = ['id', 'slug', 'name', 'description', 'tags', 'imagePath', 'messageTTLInDays', 'runtimeSlug', 'schemaVersion'] as const;
export const ACTOR_KEY_ORDER = [
  'id',
  'version',
  'type',
  'name',
  'msgVar',
  'description',
  'isActive',
  'sourcePorts',
  'template',
  'icon',
  'continueOnError',
  'enableLTM',
  'enableSTM',
  'showInWorkspaceApps',
  'runtimeSlug',
  'webhookTriggerKey',
  'configuration',
  'schemas',
] as const;
export const CONFIGURATION_KEY_ORDER = [
  'connection',
  'webhook',
  'schedule',
  'aiAgentToolActorIds',
  'credentials',
  'codeDir',
  'code',
  'inputs',
  'vars',
  'options',
  'outputs',
  'error',
] as const;
export const EDGE_KEY_ORDER = ['id', 'sourceActorId', 'sourcePortId', 'targetActorId', 'targetPortId', 'label', 'type'] as const;
