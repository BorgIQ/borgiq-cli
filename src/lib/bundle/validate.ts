import { BUNDLE_PATH_REGISTRY, RESERVED_CODE_FILENAMES, actorFolderPath, isKnownActorType } from './registry.js';
import { ACTOR_FILE, CODE_DIR, FORMAT_NAME, FORMAT_VERSION, ROOT_FILE } from './types.js';
import type { BundleFileMap, BundleIssue } from './types.js';
import { parseYamlDoc } from './yaml.js';

export interface ValidateBundleResult {
  errors: BundleIssue[];
  warnings: BundleIssue[];
}

interface ActorIndexEntry {
  id: string;
  type: string;
  path: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIndexEntry = (value: unknown): value is ActorIndexEntry =>
  isPlainObject(value) && typeof value.id === 'string' && typeof value.type === 'string' && typeof value.path === 'string';

export const validateBundle = (files: BundleFileMap): ValidateBundleResult => {
  const errors: BundleIssue[] = [];
  const warnings: BundleIssue[] = [];

  const root = parseRoot(files, errors);
  if (!root) return { errors, warnings };

  if (root.format !== FORMAT_NAME) {
    errors.push({ path: ROOT_FILE, message: `Unsupported format '${String(root.format)}' - expected '${FORMAT_NAME}'.` });
  }
  if (root.formatVersion !== FORMAT_VERSION) {
    errors.push({ path: ROOT_FILE, message: `Unsupported formatVersion ${String(root.formatVersion)} - this CLI supports version ${FORMAT_VERSION}.` });
  }
  if (!Array.isArray(root.actors)) {
    errors.push({ path: ROOT_FILE, message: 'Root document must contain `actors` as a list.' });
  }
  if (!isPlainObject(root.graph) || !Array.isArray(root.graph.nodes) || !Array.isArray(root.graph.edges)) {
    errors.push({ path: ROOT_FILE, message: 'Root document must contain `graph.nodes` and `graph.edges` as lists.' });
  }
  if (!Array.isArray(root.actors) || !isPlainObject(root.graph) || !Array.isArray(root.graph.nodes) || !Array.isArray(root.graph.edges)) {
    return { errors, warnings };
  }

  const idToPath = new Map<string, string>();
  const seenPaths = new Set<string>();
  const actorDocs = new Map<string, Record<string, unknown>>();
  const referenced = new Set<string>([ROOT_FILE]);

  for (const rawEntry of root.actors) {
    if (!isIndexEntry(rawEntry)) {
      errors.push({ path: ROOT_FILE, message: `Malformed actors[] entry: ${JSON.stringify(rawEntry)} - need string id, type, and path.` });
      continue;
    }

    validateActorIndexEntry(rawEntry, files, errors, idToPath, seenPaths, actorDocs, referenced);
  }

  validateGraph(root.graph, errors, idToPath, actorDocs);
  validateUnreferencedFiles(files, referenced, warnings);

  return { errors, warnings };
};

const parseRoot = (files: BundleFileMap, errors: BundleIssue[]): Record<string, unknown> | undefined => {
  const rootText = files[ROOT_FILE];
  if (rootText === undefined) {
    errors.push({ path: ROOT_FILE, message: 'canvas.yaml is missing - not a canvas bundle.' });
    return undefined;
  }

  try {
    const parsed = parseYamlDoc(rootText);
    if (!isPlainObject(parsed)) throw new Error('document is not a mapping');
    return parsed;
  } catch (error) {
    errors.push({ path: ROOT_FILE, message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
};

const validateActorIndexEntry = (
  entry: ActorIndexEntry,
  files: BundleFileMap,
  errors: BundleIssue[],
  idToPath: Map<string, string>,
  seenPaths: Set<string>,
  actorDocs: Map<string, Record<string, unknown>>,
  referenced: Set<string>,
): void => {
  if (!isSafeBundlePath(entry.path)) {
    errors.push({ path: ROOT_FILE, message: `Unsafe actor path '${entry.path}' - absolute paths, empty segments, and '..' are rejected.` });
    return;
  }

  if (idToPath.has(entry.id)) {
    errors.push({ path: ROOT_FILE, message: `Duplicate actor id ${entry.id} (paths ${idToPath.get(entry.id)} and ${entry.path}).` });
  } else {
    idToPath.set(entry.id, entry.path);
  }

  if (seenPaths.has(entry.path)) {
    errors.push({ path: ROOT_FILE, message: `Duplicate actor path ${entry.path}.` });
  } else {
    seenPaths.add(entry.path);
  }

  if (!isKnownActorType(entry.type)) {
    errors.push({ path: entry.path, message: `Unknown actor type '${entry.type}' - this CLI version does not support it; upgrade @borgiq/cli.` });
    return;
  }

  const expected = actorFolderPath(entry.type, entry.id);
  if (entry.path !== expected) {
    errors.push({ path: entry.path, message: `Actor path does not match the registry - expected ${expected}.` });
  }

  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  referenced.add(actorFile);
  const actorText = files[actorFile];
  if (actorText === undefined) {
    errors.push({ path: actorFile, message: 'Missing actor.yaml for indexed actor.' });
    return;
  }

  const actorDoc = parseActorDoc(actorFile, actorText, errors);
  if (!actorDoc) return;

  if (actorDoc.id !== entry.id) {
    errors.push({ path: actorFile, message: `actor.yaml id '${String(actorDoc.id)}' does not match index id '${entry.id}'.` });
  }
  if (actorDoc.type !== entry.type) {
    errors.push({ path: actorFile, message: `actor.yaml type '${String(actorDoc.type)}' does not match index type '${entry.type}'.` });
  }

  actorDocs.set(entry.id, actorDoc);
  validateCodeDir(entry, actorDoc, files, errors, referenced);
};

const parseActorDoc = (path: string, text: string, errors: BundleIssue[]): Record<string, unknown> | undefined => {
  try {
    const parsed = parseYamlDoc(text);
    if (!isPlainObject(parsed)) throw new Error('document is not a mapping');
    return parsed;
  } catch (error) {
    errors.push({ path, message: `YAML parse error: ${error instanceof Error ? error.message : String(error)}` });
    return undefined;
  }
};

const validateCodeDir = (
  entry: ActorIndexEntry,
  actorDoc: Record<string, unknown>,
  files: BundleFileMap,
  errors: BundleIssue[],
  referenced: Set<string>,
): void => {
  if (!isKnownActorType(entry.type)) return;

  const spec = BUNDLE_PATH_REGISTRY[entry.type];
  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  const configuration = isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {};
  const codePrefix = `${entry.path}/${CODE_DIR}/`;
  const codeFilesPresent = Object.keys(files).filter((path) => path.startsWith(codePrefix));
  for (const path of codeFilesPresent) referenced.add(path);

  const canonical = new Set(spec.codeFiles.map((codeFile) => `${codePrefix}${codeFile.file}`));
  if (configuration.codeDir === undefined) {
    if (codeFilesPresent.length > 0) {
      errors.push({ path: codeFilesPresent[0], message: 'code/ files are present but actor.yaml has no configuration.codeDir marker.' });
    }
    return;
  }

  if (configuration.codeDir !== CODE_DIR) {
    errors.push({ path: actorFile, message: `configuration.codeDir must be 'code', got '${String(configuration.codeDir)}'.` });
  }
  if (spec.codeFiles.length === 0) {
    errors.push({ path: actorFile, message: `Actor type ${entry.type} does not support external code - remove configuration.codeDir.` });
  }

  const inlineSources = findInlineCodeSources(configuration, spec.codeFiles);
  if (inlineSources.length > 0) {
    errors.push({ path: actorFile, message: `Both codeDir and inline code present (${inlineSources.join(', ')}) - remove one source.` });
  }

  if (spec.codeFiles.length > 0 && !spec.codeFiles.some((codeFile) => files[`${codePrefix}${codeFile.file}`] !== undefined)) {
    errors.push({
      path: `${codePrefix}${spec.codeFiles[0].file}`,
      message: `codeDir is set but no code file exists (expected ${spec.codeFiles.map((codeFile) => codeFile.file).join(' or ')}).`,
    });
  }

  for (const path of codeFilesPresent) {
    if (canonical.has(path)) continue;
    const name = path.slice(codePrefix.length);
    const reserved = RESERVED_CODE_FILENAMES.has(name) || name.startsWith('shared/');
    errors.push({
      path,
      message: reserved
        ? `'${name}' is runtime-owned and may not appear in a bundle.`
        : `Unexpected file in code/ - multi-file actor code is not yet supported (v1 allows only: ${spec.codeFiles.map((codeFile) => codeFile.file).join(', ')}).`,
    });
  }
};

const findInlineCodeSources = (
  configuration: Record<string, unknown>,
  codeFiles: { source: { kind: 'code' } | { kind: 'option'; key: 'html' | 'css' | 'script' } }[],
): string[] => {
  const sources: string[] = [];
  if (typeof configuration.code === 'string') sources.push('configuration.code');
  const options = isPlainObject(configuration.options) ? configuration.options : {};
  for (const codeFile of codeFiles) {
    if (codeFile.source.kind === 'option' && typeof options[codeFile.source.key] === 'string') {
      sources.push(`configuration.options.${codeFile.source.key}`);
    }
  }
  return sources;
};

const validateGraph = (
  graph: Record<string, unknown>,
  errors: BundleIssue[],
  idToPath: Map<string, string>,
  actorDocs: Map<string, Record<string, unknown>>,
): void => {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes as unknown[]) {
    if (!isPlainObject(node) || typeof node.actorId !== 'string' || !isPlainObject(node.position)) {
      errors.push({ path: ROOT_FILE, message: `Malformed graph node: ${JSON.stringify(node)}.` });
      continue;
    }
    if (!idToPath.has(node.actorId)) {
      errors.push({ path: ROOT_FILE, message: `graph.nodes references unknown actor ${node.actorId}.` });
    }
    if (nodeIds.has(node.actorId)) {
      errors.push({ path: ROOT_FILE, message: `Duplicate graph node for actor ${node.actorId}.` });
    }
    nodeIds.add(node.actorId);
  }

  for (const id of idToPath.keys()) {
    if (!nodeIds.has(id)) {
      errors.push({ path: ROOT_FILE, message: `Actor ${id} has no graph.nodes entry.` });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges as unknown[]) {
    validateEdge(edge, edgeIds, errors, idToPath, actorDocs);
  }

  for (const [id, actorDoc] of actorDocs) {
    const configuration = isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {};
    if (!Array.isArray(configuration.aiAgentToolActorIds)) continue;
    for (const toolId of configuration.aiAgentToolActorIds) {
      if (typeof toolId !== 'string' || !idToPath.has(toolId)) {
        errors.push({ path: `${idToPath.get(id)}/${ACTOR_FILE}`, message: `aiAgentToolActorIds references unknown actor ${String(toolId)}.` });
      }
    }
  }
};

const validateEdge = (
  edge: unknown,
  edgeIds: Set<string>,
  errors: BundleIssue[],
  idToPath: Map<string, string>,
  actorDocs: Map<string, Record<string, unknown>>,
): void => {
  if (
    !isPlainObject(edge)
    || typeof edge.id !== 'string'
    || typeof edge.sourceActorId !== 'string'
    || typeof edge.sourcePortId !== 'string'
    || typeof edge.targetActorId !== 'string'
    || typeof edge.targetPortId !== 'string'
  ) {
    errors.push({ path: ROOT_FILE, message: `Malformed graph edge: ${JSON.stringify(edge)}.` });
    return;
  }

  if (edgeIds.has(edge.id)) {
    errors.push({ path: ROOT_FILE, message: `Duplicate edge id ${edge.id}.` });
  }
  edgeIds.add(edge.id);

  if (!idToPath.has(edge.sourceActorId)) {
    errors.push({ path: ROOT_FILE, message: `Edge ${edge.id} references unknown actor ${edge.sourceActorId}.` });
  }
  if (!idToPath.has(edge.targetActorId)) {
    errors.push({ path: ROOT_FILE, message: `Edge ${edge.id} references unknown actor ${edge.targetActorId}.` });
  }

  const sourceDoc = actorDocs.get(edge.sourceActorId);
  if (!sourceDoc) return;
  const sourcePorts = Array.isArray(sourceDoc.sourcePorts) ? sourceDoc.sourcePorts : [];
  if (!sourcePorts.some((port) => isPlainObject(port) && port.id === edge.sourcePortId)) {
    errors.push({ path: ROOT_FILE, message: `Edge ${edge.id}: port '${edge.sourcePortId}' not found in sourcePorts of actor ${edge.sourceActorId}.` });
  }
};

const validateUnreferencedFiles = (files: BundleFileMap, referenced: Set<string>, warnings: BundleIssue[]): void => {
  for (const path of Object.keys(files)) {
    if (!path.startsWith('actors/')) continue;
    if (!referenced.has(path)) {
      warnings.push({ path, message: 'File is not referenced by canvas.yaml - it will be ignored.' });
    }
  }
};

const isSafeBundlePath = (path: string): boolean =>
  !path.startsWith('/')
  && !path.includes('\\')
  && !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
