import { BUNDLE_PATH_REGISTRY } from './registry.js';
import type { BundleActorType } from './registry.js';
import { ACTOR_FILE, CANVAS_KEY_ORDER, CODE_DIR, ROOT_FILE } from './types.js';
import type {
  BundleFileMap,
  BundleIssue,
  BundleRootDoc,
  BundleSync,
  BundleSyncActor,
  BundleSyncReactAppAsset,
  CanvasExportDocument,
  ExportedActor,
  ExportedEdge,
} from './types.js';
import { validateBundle } from './validate.js';
import { orderKeys, parseYamlDoc } from './yaml.js';

export class BundleValidationError extends Error {
  constructor(
    public readonly errors: BundleIssue[],
    public readonly warnings: BundleIssue[],
  ) {
    super(`Bundle validation failed with ${errors.length} error(s).`);
    this.name = 'BundleValidationError';
  }
}

export interface AssembleResult {
  doc: CanvasExportDocument;
  sync: BundleSync;
  warnings: BundleIssue[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const assembleBundle = (files: BundleFileMap): AssembleResult => {
  const findings = validateBundle(files);
  if (findings.errors.length > 0) {
    throw new BundleValidationError(findings.errors, findings.warnings);
  }

  const root = parseYamlDoc(files[ROOT_FILE]) as BundleRootDoc;
  const warnings = [...findings.warnings];
  if (Array.isArray(root.exportErrors) && root.exportErrors.length > 0) {
    warnings.push({ path: ROOT_FILE, message: `exportErrors contains ${root.exportErrors.length} item(s); packed YAML cannot preserve that channel.` });
  }

  const positionsById = new Map(root.graph.nodes.map((node) => [node.actorId, node.position]));
  const edgesBySource = new Map<string, Record<string, ExportedEdge>>();
  for (const edge of root.graph.edges) {
    const sourceEdges = edgesBySource.get(edge.sourceActorId) ?? {};
    sourceEdges[edge.id] = edge;
    edgesBySource.set(edge.sourceActorId, sourceEdges);
  }

  const actors: Record<string, ExportedActor> = {};
  for (const entry of root.actors) {
    const actorDoc = parseYamlDoc(files[`${entry.path}/${ACTOR_FILE}`]) as Record<string, unknown>;
    const actor = rehydrateActorCode(actorDoc, entry.type as BundleActorType, entry.path, files);
    actors[entry.id] = {
      ...actor,
      edges: edgesBySource.get(entry.id) ?? {},
      position: positionsById.get(entry.id) ?? { x: 0, y: 0 },
    } as ExportedActor;
  }

  const { schemaVersion, ...metadataRest } = (isPlainObject(root.canvas) ? root.canvas : {}) as Record<string, unknown>;
  const metadata = orderKeys(metadataRest, CANVAS_KEY_ORDER);

  return {
    doc: {
      metadata,
      data: {
        schemaVersion: String(schemaVersion ?? '1'),
        actors,
      },
    },
    sync: parseSync(root.sync),
    warnings,
  };
};

const parseSync = (value: unknown): BundleSync => {
  if (!isPlainObject(value)) return {};

  const actors: Record<string, BundleSyncActor> = {};
  if (isPlainObject(value.actors)) {
    for (const [actorId, rawState] of Object.entries(value.actors)) {
      if (!isPlainObject(rawState) || typeof rawState.editVersion !== 'number' || typeof rawState.contentHash !== 'string') continue;
      actors[actorId] = { editVersion: rawState.editVersion, contentHash: rawState.contentHash };
    }
  }

  const reactAppAssets = parseReactAppAssets(value.reactAppAssets);
  const sync: BundleSync = {};
  if (Object.keys(actors).length > 0) sync.actors = actors;
  if (reactAppAssets) sync.reactAppAssets = reactAppAssets;
  return sync;
};

const parseReactAppAssets = (value: unknown): Record<string, Record<string, BundleSyncReactAppAsset>> | undefined => {
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, Record<string, BundleSyncReactAppAsset>> = {};
  for (const [actorId, rawPaths] of Object.entries(value)) {
    if (!isPlainObject(rawPaths)) continue;

    const paths: Record<string, BundleSyncReactAppAsset> = {};
    for (const [projectPath, rawState] of Object.entries(rawPaths)) {
      if (
        !isPlainObject(rawState)
        || typeof rawState.assetId !== 'string'
        || typeof rawState.assetKey !== 'string'
        || typeof rawState.sha256 !== 'string'
      ) continue;
      paths[projectPath] = { assetId: rawState.assetId, assetKey: rawState.assetKey, sha256: rawState.sha256 };
    }
    if (Object.keys(paths).length > 0) out[actorId] = paths;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const rehydrateActorCode = (
  actorDoc: Record<string, unknown>,
  type: BundleActorType,
  actorPath: string,
  files: BundleFileMap,
): Record<string, unknown> => {
  const actor = { ...actorDoc };
  if (!isPlainObject(actor.configuration)) return actor;

  const configuration = { ...actor.configuration };
  if (BUNDLE_PATH_REGISTRY[type].projectDir) {
    if (configuration.codeDir === CODE_DIR) {
      configuration.codeDir = collectProjectDir(actorPath, files);
    }
    // An inline codeDir array passes through verbatim; validate rejects having both.
    actor.configuration = configuration;
    return actor;
  }

  if (configuration.codeDir === CODE_DIR) {
    delete configuration.codeDir;
    for (const codeFile of BUNDLE_PATH_REGISTRY[type].codeFiles) {
      const content = files[`${actorPath}/${CODE_DIR}/${codeFile.file}`];
      if (content === undefined) continue;
      if (codeFile.source.kind === 'code') {
        configuration.code = content;
      } else {
        const options = { ...(isPlainObject(configuration.options) ? configuration.options : {}) };
        options[codeFile.source.key] = content;
        configuration.options = options;
      }
    }
  }

  actor.configuration = configuration;
  return actor;
};

/**
 * Rebuild a project-tree `codeDir` from the files under `code/`, sorted by path so the
 * array is byte-stable no matter what order the walker produced.
 */
const collectProjectDir = (actorPath: string, files: BundleFileMap): { path: string; content: string }[] => {
  const prefix = `${actorPath}/${CODE_DIR}/`;
  return Object.keys(files)
    .filter((path) => path.startsWith(prefix))
    .sort(compareStrings)
    .map((path) => ({ path: path.slice(prefix.length), content: files[path] }));
};
