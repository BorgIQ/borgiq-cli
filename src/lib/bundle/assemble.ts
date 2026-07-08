import { BUNDLE_PATH_REGISTRY } from './registry.js';
import type { BIQActorType } from './registry.js';
import { ACTOR_FILE, CANVAS_KEY_ORDER, CODE_DIR, ROOT_FILE } from './types.js';
import type {
  BundleFileMap,
  BundleIssue,
  BundleRootDoc,
  BundleSync,
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
    const actor = rehydrateActorCode(actorDoc, entry.type as BIQActorType, entry.path, files);
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
  if (!isPlainObject(value) || !isPlainObject(value.actorVersions)) return {};
  const actorVersions: Record<string, number> = {};
  for (const [actorId, version] of Object.entries(value.actorVersions)) {
    if (typeof version === 'number') actorVersions[actorId] = version;
  }
  return Object.keys(actorVersions).length > 0 ? { actorVersions } : {};
};

const rehydrateActorCode = (
  actorDoc: Record<string, unknown>,
  type: BIQActorType,
  actorPath: string,
  files: BundleFileMap,
): Record<string, unknown> => {
  const actor = { ...actorDoc };
  if (!isPlainObject(actor.configuration)) return actor;

  const configuration = { ...actor.configuration };
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
