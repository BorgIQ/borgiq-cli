import { BUNDLE_PATH_REGISTRY, RESERVED_CODE_FILENAMES, actorFolderPath, isKnownActorType } from './registry.js';
import type { CodeSource } from './registry.js';
import {
  MAX_CODE_DIR_FILES,
  MAX_CODE_DIR_TOTAL_BYTES,
  MAX_OPTIONS_FILES,
  MAX_PROJECT_PATH_LENGTH,
  isIgnoredProjectPath,
  managedAssetEntries,
  unmanagedAssetDirEntries,
} from './reactApp.js';
import { ACTOR_FILE, CODE_DIR, FORMAT_NAME, FORMAT_VERSION, ROOT_FILE } from './types.js';
import type { BundleFileMap, BundleIssue } from './types.js';
import { parseYamlDoc } from './yaml.js';
import { isSafeBundlePath } from './path.js';

export interface ValidateBundleResult {
  errors: BundleIssue[];
  warnings: BundleIssue[];
}

/**
 * Optional facts a caller can supply that the file map alone cannot express. Pure
 * callers (and `assembleBundle`) omit it and simply get fewer warnings.
 */
export interface ValidateBundleContext {
  /**
   * Bundle-relative paths of React App asset files that exist on disk. Asset bytes never
   * enter the file map, so without this the checker cannot tell a referenced asset is missing.
   */
  localAssetPaths?: readonly string[];
}

/** Accumulators threaded through the checks, so rule helpers stay to a readable arity. */
interface ValidationRun {
  files: BundleFileMap;
  errors: BundleIssue[];
  warnings: BundleIssue[];
  localAssetPaths?: ReadonlySet<string>;
}

interface ActorIndexEntry {
  id: string;
  type: string;
  path: string;
}

/** One file of a React App project, from either the `code/` tree or an inline `codeDir`. */
interface ProjectFile {
  path: string;
  content: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIndexEntry = (value: unknown): value is ActorIndexEntry =>
  isPlainObject(value) && typeof value.id === 'string' && typeof value.type === 'string' && typeof value.path === 'string';

export const validateBundle = (files: BundleFileMap, context: ValidateBundleContext = {}): ValidateBundleResult => {
  const errors: BundleIssue[] = [];
  const warnings: BundleIssue[] = [];
  const run: ValidationRun = {
    files,
    errors,
    warnings,
    localAssetPaths: context.localAssetPaths ? new Set(context.localAssetPaths) : undefined,
  };

  const root = parseRoot(files, errors);
  if (!root) return { errors, warnings };

  if (root.format !== FORMAT_NAME) {
    errors.push({ path: ROOT_FILE, message: `Unsupported format '${String(root.format)}' - expected '${FORMAT_NAME}'.` });
  }
  if (root.formatVersion !== FORMAT_VERSION) {
    errors.push({ path: ROOT_FILE, message: `Unsupported formatVersion ${String(root.formatVersion)} - this CLI supports version ${FORMAT_VERSION}.` });
  }
  validateSync(root.sync, errors);
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

    validateActorIndexEntry(rawEntry, run, idToPath, seenPaths, actorDocs, referenced);
  }

  validateGraph(root.graph, errors, idToPath, actorDocs);
  validateUnreferencedFiles(files, referenced, warnings);

  return { errors, warnings };
};

const validateSync = (value: unknown, errors: BundleIssue[]): void => {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push({ path: ROOT_FILE, message: '`sync` must be a mapping containing `actors` and/or `reactAppAssets` baselines.' });
    return;
  }

  const actors = isPlainObject(value.actors) ? value.actors : undefined;
  const reactAppAssets = isPlainObject(value.reactAppAssets) ? value.reactAppAssets : undefined;
  if (!actors && !reactAppAssets) {
    errors.push({ path: ROOT_FILE, message: '`sync` must contain `actors` and/or `reactAppAssets` as mappings of baselines.' });
    return;
  }

  for (const [actorId, rawState] of Object.entries(actors ?? {})) {
    if (!isPlainObject(rawState)) {
      errors.push({ path: ROOT_FILE, message: `sync.actors.${actorId} must contain editVersion and contentHash.` });
      continue;
    }
    if (typeof rawState.editVersion !== 'number' || !Number.isInteger(rawState.editVersion) || rawState.editVersion < 0) {
      errors.push({ path: ROOT_FILE, message: `sync.actors.${actorId}.editVersion must be a non-negative integer.` });
    }
    if (typeof rawState.contentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(rawState.contentHash)) {
      errors.push({ path: ROOT_FILE, message: `sync.actors.${actorId}.contentHash must be a sha256-prefixed lowercase hex digest.` });
    }
  }

  for (const [actorId, rawPaths] of Object.entries(reactAppAssets ?? {})) {
    if (!isPlainObject(rawPaths)) {
      errors.push({ path: ROOT_FILE, message: `sync.reactAppAssets.${actorId} must be a mapping of project paths to asset baselines.` });
      continue;
    }
    for (const [projectPath, rawState] of Object.entries(rawPaths)) {
      validateReactAppAssetBaseline(`sync.reactAppAssets.${actorId}['${projectPath}']`, rawState, errors);
    }
  }
};

const validateReactAppAssetBaseline = (label: string, rawState: unknown, errors: BundleIssue[]): void => {
  if (!isPlainObject(rawState)) {
    errors.push({ path: ROOT_FILE, message: `${label} must contain assetId, assetKey, and sha256.` });
    return;
  }
  if (typeof rawState.assetId !== 'string' || rawState.assetId.length === 0) {
    errors.push({ path: ROOT_FILE, message: `${label}.assetId must be a non-empty string.` });
  }
  if (typeof rawState.assetKey !== 'string' || rawState.assetKey.length === 0) {
    errors.push({ path: ROOT_FILE, message: `${label}.assetKey must be a non-empty string.` });
  }
  if (typeof rawState.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(rawState.sha256)) {
    errors.push({ path: ROOT_FILE, message: `${label}.sha256 must be a lowercase 64-character hex digest.` });
  }
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
  run: ValidationRun,
  idToPath: Map<string, string>,
  seenPaths: Set<string>,
  actorDocs: Map<string, Record<string, unknown>>,
  referenced: Set<string>,
): void => {
  const { files, errors } = run;
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
  validateCodeDir(entry, actorDoc, run, referenced);
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
  run: ValidationRun,
  referenced: Set<string>,
): void => {
  if (!isKnownActorType(entry.type)) return;
  if (BUNDLE_PATH_REGISTRY[entry.type].projectDir) {
    validateProjectDir(entry, actorDoc, run, referenced);
    return;
  }

  const { files, errors } = run;
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
  codeFiles: { source: CodeSource }[],
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

/**
 * A project-tree actor carries an arbitrary source tree under `code/`, so the canonical
 * filename rules do not apply. Only genuine format ambiguities are errors here; every
 * shape and size rule is a warning, because the API validates the push and is the authority.
 */
const validateProjectDir = (
  entry: ActorIndexEntry,
  actorDoc: Record<string, unknown>,
  run: ValidationRun,
  referenced: Set<string>,
): void => {
  const configuration = isPlainObject(actorDoc.configuration) ? actorDoc.configuration : {};
  const codePrefix = `${entry.path}/${CODE_DIR}/`;
  const treePaths = Object.keys(run.files).filter((path) => path.startsWith(codePrefix)).sort();
  for (const path of treePaths) referenced.add(path);

  const project = collectProjectFiles(entry, configuration, treePaths, codePrefix, run);
  validateOptionsFiles(entry, configuration, project, run);
  if (!project) return;

  warnProjectLimits(entry, project, run);
  warnTemplateShape(entry, project, run);
};

/** Resolves the effective project files, or undefined when the source is missing or ambiguous. */
const collectProjectFiles = (
  entry: ActorIndexEntry,
  configuration: Record<string, unknown>,
  treePaths: string[],
  codePrefix: string,
  run: ValidationRun,
): ProjectFile[] | undefined => {
  const { files, errors } = run;
  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  const codeDir = configuration.codeDir;

  if (Array.isArray(codeDir)) {
    if (treePaths.length > 0) {
      errors.push({
        path: actorFile,
        message: 'configuration.codeDir is an inline list but code/ also contains files - remove one source.',
      });
      return undefined;
    }
    return collectInlineProjectFiles(codeDir, actorFile, errors);
  }

  if (codeDir === undefined) {
    if (treePaths.length > 0) {
      errors.push({ path: treePaths[0], message: 'code/ files are present but actor.yaml has no configuration.codeDir marker.' });
      return undefined;
    }
    return [];
  }

  if (codeDir !== CODE_DIR) {
    errors.push({
      path: actorFile,
      message: `configuration.codeDir must be '${CODE_DIR}' or an inline list of {path, content} entries, got '${String(codeDir)}'.`,
    });
    return undefined;
  }

  const project: ProjectFile[] = [];
  for (const path of treePaths) {
    const projectPath = path.slice(codePrefix.length);
    if (!isSafeBundlePath(projectPath)) {
      errors.push({ path, message: `Unsafe project path '${projectPath}' - absolute paths, empty segments, and '..' are rejected.` });
      continue;
    }
    project.push({ path: projectPath, content: files[path] });
  }
  return project;
};

const collectInlineProjectFiles = (codeDir: unknown[], actorFile: string, errors: BundleIssue[]): ProjectFile[] => {
  const project: ProjectFile[] = [];
  codeDir.forEach((raw, index) => {
    if (!isPlainObject(raw) || typeof raw.path !== 'string' || typeof raw.content !== 'string') {
      errors.push({ path: actorFile, message: `configuration.codeDir[${index}] must be a mapping with string path and content.` });
      return;
    }
    if (!isSafeBundlePath(raw.path)) {
      errors.push({
        path: actorFile,
        message: `configuration.codeDir[${index}] has unsafe path '${raw.path}' - absolute paths, empty segments, and '..' are rejected.`,
      });
      return;
    }
    project.push({ path: raw.path, content: raw.content });
  });
  return project;
};

const warnProjectLimits = (entry: ActorIndexEntry, project: ProjectFile[], run: ValidationRun): void => {
  const { warnings } = run;
  const actorFile = `${entry.path}/${ACTOR_FILE}`;

  if (project.length > MAX_CODE_DIR_FILES) {
    warnings.push({ path: actorFile, message: `Project has ${project.length} files; the API rejects more than ${MAX_CODE_DIR_FILES}.` });
  }

  const totalBytes = project.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0);
  if (totalBytes > MAX_CODE_DIR_TOTAL_BYTES) {
    warnings.push({
      path: actorFile,
      message: `Project source totals ${totalBytes} bytes; the API rejects more than ${MAX_CODE_DIR_TOTAL_BYTES}.`,
    });
  }

  for (const file of project) {
    if (file.path.length > MAX_PROJECT_PATH_LENGTH) {
      warnings.push({
        path: `${entry.path}/${CODE_DIR}/${file.path}`,
        message: `Project path is ${file.path.length} characters; the API rejects paths longer than ${MAX_PROJECT_PATH_LENGTH}.`,
      });
    }
    const ignore = isIgnoredProjectPath(file.path);
    if (ignore.warn) warnings.push({ path: `${entry.path}/${CODE_DIR}/${file.path}`, message: ignore.warn });
  }
};

const VITE_CONFIG_NAMES = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'] as const;

/**
 * Shallow checks for the settings the platform's React App template provides and the
 * served app relies on. Deliberately substring-level: this is a hint before a push,
 * not a parser, and a false warning must never block anyone.
 */
const warnTemplateShape = (entry: ActorIndexEntry, project: ProjectFile[], run: ValidationRun): void => {
  const { warnings } = run;
  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  const byPath = new Map(project.map((file) => [file.path, file.content]));
  const warn = (message: string): void => void warnings.push({ path: actorFile, message });

  const packageJson = byPath.get('package.json');
  if (packageJson === undefined) {
    warn("Project has no package.json - a React App needs one declaring a 'build' script and its dependencies.");
  } else {
    warnPackageJsonShape(packageJson, warn);
  }

  if (!byPath.has('index.html')) {
    warn('Project has no index.html - Vite needs it as the app entry point.');
  }

  const viteConfig = VITE_CONFIG_NAMES.find((name) => byPath.has(name));
  if (viteConfig === undefined) {
    warn(`Project has no ${VITE_CONFIG_NAMES[0]} - the served app relies on its build settings.`);
    return;
  }

  const config = byPath.get(viteConfig) ?? '';
  const missing = [
    { needle: /base\s*:\s*['"]\.\/['"]/, label: "base: './'" },
    { needle: /cssCodeSplit\s*:\s*false/, label: 'build.cssCodeSplit: false' },
    { needle: /assetsInlineLimit\s*:\s*0/, label: 'build.assetsInlineLimit: 0' },
    { needle: /inlineDynamicImports\s*:\s*true/, label: 'build.rollupOptions.output.inlineDynamicImports: true' },
  ].filter((setting) => !setting.needle.test(config)).map((setting) => setting.label);

  if (missing.length > 0) {
    warnings.push({
      path: `${entry.path}/${CODE_DIR}/${viteConfig}`,
      message: `${viteConfig} does not appear to set ${missing.join(', ')} - the served app may not load correctly without them.`,
    });
  }
};

const warnPackageJsonShape = (packageJson: string, warn: (message: string) => void): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch (error) {
    warn(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const scripts = isPlainObject(parsed) && isPlainObject(parsed.scripts) ? parsed.scripts : undefined;
  const build = scripts?.build;
  if (typeof build !== 'string') {
    warn("package.json has no 'build' script - the platform runs it to build the app.");
    return;
  }
  if (!build.includes('vite build')) {
    warn(`package.json 'build' script does not run 'vite build' (found '${build}').`);
  }
};

const validateOptionsFiles = (
  entry: ActorIndexEntry,
  configuration: Record<string, unknown>,
  project: ProjectFile[] | undefined,
  run: ValidationRun,
): void => {
  const { errors, warnings } = run;
  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  const options = isPlainObject(configuration.options) ? configuration.options : undefined;
  const rawFiles = options?.files;
  if (rawFiles === undefined || rawFiles === null) return;

  if (!Array.isArray(rawFiles)) {
    errors.push({ path: actorFile, message: 'configuration.options.files must be a list of {path, content} entries.' });
    return;
  }

  rawFiles.forEach((raw, index) => {
    if (!isPlainObject(raw) || typeof raw.path !== 'string') {
      errors.push({ path: actorFile, message: `configuration.options.files[${index}] must be a mapping with a string path.` });
      return;
    }
    if (!isSafeBundlePath(raw.path)) {
      errors.push({
        path: actorFile,
        message: `configuration.options.files[${index}] has unsafe path '${raw.path}' - absolute paths, empty segments, and '..' are rejected.`,
      });
    }
  });

  if (rawFiles.length > MAX_OPTIONS_FILES) {
    warnings.push({
      path: actorFile,
      message: `configuration.options.files has ${rawFiles.length} entries; the API rejects more than ${MAX_OPTIONS_FILES}.`,
    });
  }

  warnOverlayCollisions(entry, configuration, project, warnings);
  warnAssetEntries(entry, configuration, run);
};

const warnOverlayCollisions = (
  entry: ActorIndexEntry,
  configuration: Record<string, unknown>,
  project: ProjectFile[] | undefined,
  warnings: BundleIssue[],
): void => {
  const actorFile = `${entry.path}/${ACTOR_FILE}`;
  const overlayPaths = optionsFilePaths(configuration);
  const seen = new Set<string>();

  for (const path of overlayPaths) {
    if (seen.has(path)) {
      warnings.push({ path: actorFile, message: `configuration.options.files has duplicate entries for '${path}' - the last one wins.` });
    }
    seen.add(path);
  }

  if (!project) return;
  const projectPaths = new Set(project.map((file) => file.path));
  for (const path of new Set(overlayPaths)) {
    if (projectPaths.has(path)) {
      warnings.push({
        path: actorFile,
        message: `configuration.options.files overlays '${path}', which also exists in the project source - the overlay wins at build time.`,
      });
    }
  }
};

const warnAssetEntries = (entry: ActorIndexEntry, configuration: Record<string, unknown>, run: ValidationRun): void => {
  const { warnings, localAssetPaths } = run;
  const actorFile = `${entry.path}/${ACTOR_FILE}`;

  for (const unmanaged of unmanagedAssetDirEntries(configuration)) {
    warnings.push({
      path: actorFile,
      message: `configuration.options.files['${unmanaged.path}'] is in the asset directory but its content is not an asset reference, `
        + 'so the CLI leaves it alone: it is never downloaded, uploaded, or materialized on disk.',
    });
  }

  if (!localAssetPaths) return;
  for (const managed of managedAssetEntries(configuration)) {
    if (localAssetPaths.has(`${entry.path}/${CODE_DIR}/${managed.path}`)) continue;
    warnings.push({
      path: `${entry.path}/${CODE_DIR}/${managed.path}`,
      message: `Asset '${managed.key}' is referenced but not present locally - run 'borgiq bundle pull' to download it.`,
    });
  }
};

const optionsFilePaths = (configuration: Record<string, unknown>): string[] => {
  const options = isPlainObject(configuration.options) ? configuration.options : undefined;
  const rawFiles = Array.isArray(options?.files) ? options.files : [];
  return rawFiles
    .filter((raw): raw is { path: string } => isPlainObject(raw) && typeof raw.path === 'string')
    .map((raw) => raw.path);
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
