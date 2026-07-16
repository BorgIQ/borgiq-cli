import { BUNDLE_PATH_REGISTRY, actorFolderPath, isKnownActorType } from './registry.js';
import type { BundleActorType, BundleCodeFile } from './registry.js';
import { actorContentHashes } from './diff.js';
import { isSafeBundlePath } from './path.js';
import { REACT_APP_ASSETS_DIR, isReactAppAssetPath } from './reactApp.js';
import {
  ACTOR_FILE,
  ACTOR_KEY_ORDER,
  CANVAS_KEY_ORDER,
  CODE_DIR,
  CONFIGURATION_KEY_ORDER,
  EDGE_KEY_ORDER,
  FORMAT_NAME,
  FORMAT_VERSION,
  ROOT_FILE,
  ROOT_KEY_ORDER,
  BundleError,
} from './types.js';
import type {
  BundleActorIndexEntry,
  BundleDependencies,
  BundleFileMap,
  BundleGraphNode,
  BundleSync,
  BundleSyncReactAppAsset,
  CanvasExportDocument,
  ExportedActor,
  ExportedEdge,
} from './types.js';
import { orderKeys, stringifyYamlDoc } from './yaml.js';

export interface DisassembleOptions {
  exportErrors?: unknown[];
  actorVersions?: Record<string, number>;
  /** Server baseline hashes; pass explicitly when `doc` contains locally-kept actors. */
  actorHashes?: Record<string, string>;
  /** React App asset baselines to record, keyed by actor id then project path. */
  reactAppAssets?: Record<string, Record<string, BundleSyncReactAppAsset>>;
}

export interface DisassembleResult {
  files: BundleFileMap;
  warnings: string[];
}

const SETUP_SENSITIVE_TYPES = new Set([
  'WebhookTriggerActor',
  'ScheduledTriggerActor',
  'UniversalTriggerActor',
  'EmailTriggerActor',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const disassemble = (doc: CanvasExportDocument, opts: DisassembleOptions = {}): DisassembleResult => {
  if (!isPlainObject(doc) || !isPlainObject(doc.metadata) || !isPlainObject(doc.data) || !isPlainObject(doc.data.actors)) {
    throw new BundleError('Not a canvas export document - expected top-level `metadata` and `data.actors`.');
  }

  const actors = Object.values(doc.data.actors);
  const unknown = actors.filter((actor) => !isKnownActorType(actor.type));
  if (unknown.length > 0) {
    const list = unknown.map((actor) => `'${actor.type}' (${actor.id})`).join(', ');
    throw new BundleError(`Unknown actor type ${list} - this CLI version does not support it; upgrade @borgiq/cli.`);
  }

  const files: BundleFileMap = {};
  const warnings: string[] = [];
  const index: BundleActorIndexEntry[] = [];
  const nodes: BundleGraphNode[] = [];
  const edges: ExportedEdge[] = [];

  for (const actor of actors) {
    const type = actor.type as BundleActorType;
    const dir = actorFolderPath(type, actor.id);

    if (type === 'DeprecatedAiAgent') {
      warnings.push(`Actor ${actor.id} uses deprecated type DeprecatedAiAgent.`);
    }
    if (SETUP_SENSITIVE_TYPES.has(type)) {
      warnings.push(
        `Actor ${actor.id} (${type}) was bundled, but trigger setup may not move with it. `
        + 'After import, verify its trigger URL/key, schedule, or external caller configuration in the target workspace.',
      );
    }

    nodes.push({ actorId: actor.id, position: actor.position ?? { x: 0, y: 0 } });
    for (const edge of Object.values(actor.edges ?? {})) {
      edges.push(orderKeys(edge, EDGE_KEY_ORDER) as unknown as ExportedEdge);
    }

    const { edges: _edges, position: _position, ...actorWithoutGraph } = actor;
    void _edges;
    void _position;
    const actorDoc = externalizeActorCode(actorWithoutGraph, actor.id, type, dir, files, warnings);

    files[`${dir}/${ACTOR_FILE}`] = stringifyYamlDoc(actorDoc);
    index.push({
      id: actor.id,
      type,
      name: typeof actor.name === 'string' ? actor.name : '',
      path: dir,
    });
  }

  nodes.sort((a, b) => compareStrings(a.actorId, b.actorId));
  edges.sort((a, b) => compareStrings(a.id, b.id));
  index.sort((a, b) => compareStrings(a.path, b.path));

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
      sync: syncRoot(opts.actorVersions, opts.actorHashes ?? actorContentHashes(doc), opts.reactAppAssets),
      actors: index,
    },
    ROOT_KEY_ORDER,
  );
  files[ROOT_FILE] = stringifyYamlDoc(rootDoc);

  return { files, warnings };
};

const syncRoot = (
  actorVersions: Record<string, number> | undefined,
  actorHashes: Record<string, string>,
  reactAppAssets: Record<string, Record<string, BundleSyncReactAppAsset>> | undefined,
): BundleSync | undefined => {
  const actors = Object.fromEntries(
    Object.entries(actorVersions ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && typeof actorHashes[entry[0]] === 'string')
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([actorId, editVersion]) => [actorId, { editVersion, contentHash: actorHashes[actorId] }]),
  );

  const assets = sortedReactAppAssets(reactAppAssets);
  const sync: BundleSync = {};
  if (Object.keys(actors).length > 0) sync.actors = actors;
  if (assets) sync.reactAppAssets = assets;
  return Object.keys(sync).length > 0 ? sync : undefined;
};

/** Sorted actor id -> project path so the emitted baseline map is byte-stable. */
const sortedReactAppAssets = (
  reactAppAssets: Record<string, Record<string, BundleSyncReactAppAsset>> | undefined,
): Record<string, Record<string, BundleSyncReactAppAsset>> | undefined => {
  if (!reactAppAssets) return undefined;

  const out: Record<string, Record<string, BundleSyncReactAppAsset>> = {};
  for (const actorId of Object.keys(reactAppAssets).sort(compareStrings)) {
    const paths = reactAppAssets[actorId];
    if (!paths || Object.keys(paths).length === 0) continue;
    out[actorId] = Object.fromEntries(
      Object.keys(paths)
        .sort(compareStrings)
        .map((projectPath) => [projectPath, paths[projectPath]]),
    );
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const externalizeActorCode = (
  actor: Omit<ExportedActor, 'edges' | 'position'>,
  actorId: string,
  type: BundleActorType,
  dir: string,
  files: BundleFileMap,
  warnings: string[],
): Record<string, unknown> => {
  const spec = BUNDLE_PATH_REGISTRY[type];
  const out: Record<string, unknown> = { ...actor };
  const hadConfiguration = 'configuration' in actor;
  const configuration = isPlainObject(actor.configuration) ? { ...actor.configuration } : {};

  if (spec.projectDir) {
    externalizeProjectDir(configuration, actorId, dir, files, warnings);
  } else {
    let hasExternalCode = false;
    for (const codeFile of spec.codeFiles) {
      if (externalizeCodeFile(configuration, codeFile, `${dir}/${CODE_DIR}/${codeFile.file}`, files)) {
        hasExternalCode = true;
      }
    }
    if (hasExternalCode) {
      configuration.codeDir = CODE_DIR;
    }
  }

  if (hadConfiguration || Object.keys(configuration).length > 0) {
    out.configuration = orderKeys(configuration, CONFIGURATION_KEY_ORDER);
  } else {
    delete out.configuration;
  }

  return orderKeys(out, ACTOR_KEY_ORDER);
};

/**
 * Writes a project-tree `configuration.codeDir` array out as real files under `code/`,
 * leaving the `code` marker behind. Anything that cannot round-trip through a filesystem
 * keeps the whole array inline instead: a partial tree would silently lose files on the
 * next push, whereas an inline array is still valid (just less pleasant to edit).
 */
const externalizeProjectDir = (
  configuration: Record<string, unknown>,
  actorId: string,
  dir: string,
  files: BundleFileMap,
  warnings: string[],
): void => {
  const codeDir = configuration.codeDir;
  if (!Array.isArray(codeDir)) return;

  const pathsByFold = new Map<string, string>();
  const blockers: string[] = [];

  for (const entry of codeDir) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.content !== 'string') {
      blockers.push(`an entry is not a {path, content} pair (${JSON.stringify(entry)})`);
      continue;
    }
    if (!isSafeBundlePath(entry.path)) {
      blockers.push(`path '${entry.path}' cannot be written to disk safely`);
      continue;
    }

    const fold = entry.path.toLowerCase();
    const clashing = pathsByFold.get(fold);
    if (clashing !== undefined) {
      blockers.push(`paths '${clashing}' and '${entry.path}' differ only in letter case, which case-insensitive filesystems cannot represent`);
      continue;
    }
    pathsByFold.set(fold, entry.path);
  }

  if (blockers.length > 0) {
    warnings.push(
      `Actor ${actorId}: configuration.codeDir was left inline in actor.yaml because ${blockers[0]}`
      + `${blockers.length > 1 ? ` (and ${blockers.length - 1} more problem(s))` : ''}. `
      + 'Fix the reported paths in the editor to get an editable code/ tree.',
    );
    return;
  }

  for (const entry of codeDir as { path: string; content: string }[]) {
    files[`${dir}/${CODE_DIR}/${entry.path}`] = entry.content;
    if (isReactAppAssetPath(entry.path)) {
      warnings.push(
        `Actor ${actorId}: project file '${entry.path}' is source code but sits in the ${REACT_APP_ASSETS_DIR}/ directory, `
        + 'which the CLI syncs with workspace assets. The next push uploads it as an asset (the built app is unchanged); '
        + `move it out of ${REACT_APP_ASSETS_DIR}/ to keep it as source.`,
      );
    }
  }

  configuration.codeDir = CODE_DIR;
};

const externalizeCodeFile = (
  configuration: Record<string, unknown>,
  codeFile: BundleCodeFile,
  path: string,
  files: BundleFileMap,
): boolean => {
  if (codeFile.source.kind === 'code') {
    if (typeof configuration.code !== 'string') return false;
    files[path] = configuration.code;
    delete configuration.code;
    return true;
  }

  if (!isPlainObject(configuration.options)) return false;
  const value = configuration.options[codeFile.source.key];
  if (typeof value !== 'string') return false;

  files[path] = value;
  const options = { ...configuration.options };
  delete options[codeFile.source.key];
  configuration.options = options;
  return true;
};

const walkDependencies = (doc: CanvasExportDocument): BundleDependencies => {
  const runtimes = new Set<string>();
  const connections = new Map<string, Set<string>>();
  const secrets = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, key: string, actorId: string): void => {
    const refs = map.get(key) ?? new Set<string>();
    refs.add(actorId);
    map.set(key, refs);
  };

  if (typeof doc.metadata.runtimeSlug === 'string' && doc.metadata.runtimeSlug.length > 0) {
    runtimes.add(doc.metadata.runtimeSlug);
  }

  for (const actor of Object.values(doc.data.actors)) {
    if (typeof actor.runtimeSlug === 'string' && actor.runtimeSlug.length > 0) {
      runtimes.add(actor.runtimeSlug);
    }

    const configuration = isPlainObject(actor.configuration) ? actor.configuration : {};
    if (isPlainObject(configuration.connection) && typeof configuration.connection.key === 'string' && configuration.connection.key.length > 0) {
      add(connections, configuration.connection.key, actor.id);
    }

    if (isPlainObject(configuration.credentials)) {
      for (const entry of Object.values(configuration.credentials)) {
        if (!isPlainObject(entry) || typeof entry.workspaceKey !== 'string' || entry.workspaceKey.length === 0) continue;
        add(entry.source === 'connection' ? connections : secrets, entry.workspaceKey, actor.id);
      }
    }
  }

  return {
    runtimes: [...runtimes].sort(compareStrings),
    connections: toDependencyRefs(connections),
    secrets: toDependencyRefs(secrets),
  };
};

const toDependencyRefs = (map: Map<string, Set<string>>): { workspaceKey: string; referencedBy: string[] }[] =>
  [...map.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([workspaceKey, refs]) => ({ workspaceKey, referencedBy: [...refs].sort(compareStrings) }));
