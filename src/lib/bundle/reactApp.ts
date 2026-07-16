/**
 * Pure helpers for React App actors, whose `configuration.codeDir` is an arbitrary
 * project tree rather than the fixed entrypoint files every other code-carrying
 * actor type uses.
 *
 * Nothing here touches the filesystem, the network, or binary data: this module
 * only classifies paths and reads/writes the asset-reference expressions that
 * appear in `configuration.options.files`.
 */

import { BUNDLE_PATH_REGISTRY } from './registry.js';
import { CODE_DIR } from './types.js';
import type { CanvasExportDocument } from './types.js';

export const REACT_APP_TYPE = 'ReactAppTriggerActor';

/** The only project directory whose files are auto-synced with workspace assets. */
export const REACT_APP_ASSETS_DIR = 'src/assets';

/**
 * Best-effort mirrors of the limits the API enforces on save. Local checks that use
 * them are warnings only - the API is the authority (see AGENTS.md, thin client).
 */
export const MAX_CODE_DIR_FILES = 200;
export const MAX_CODE_DIR_TOTAL_BYTES = 1024 * 1024;
export const MAX_OPTIONS_FILES = 50;
export const MAX_PROJECT_PATH_LENGTH = 255;

/** Directories the CLI never reads, writes, or deletes inside a React App project. */
export const REACT_APP_IGNORED_DIRS: readonly string[] = [
  'node_modules',
  'dist',
  '.git',
  '.vite',
  '__borgiq_sdk_placeholder__',
];

/** Files the CLI never syncs. Lockfiles are excluded because the builder installs its own. */
export const REACT_APP_IGNORED_FILES: readonly string[] = [
  'deno.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  '.DS_Store',
  'Thumbs.db',
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const reactAppSpec = BUNDLE_PATH_REGISTRY[REACT_APP_TYPE];
const REACT_APP_FOLDER_PREFIX = `actors/${reactAppSpec.category}/${reactAppSpec.folder}/`;

/** Bundle-relative prefix every project file of `actorId` lives under (trailing slash included). */
export const reactAppCodePrefix = (actorId: string): string =>
  `${REACT_APP_FOLDER_PREFIX}${actorId}/${CODE_DIR}/`;

/** Inverse of `reactAppCodePrefix`: recognizes paths inside any React App project tree. */
export const splitReactAppCodePath = (bundlePath: string): { actorId: string; projectPath: string } | undefined => {
  if (!bundlePath.startsWith(REACT_APP_FOLDER_PREFIX)) return undefined;

  const rest = bundlePath.slice(REACT_APP_FOLDER_PREFIX.length);
  const separator = rest.indexOf('/');
  if (separator <= 0) return undefined;

  const actorId = rest.slice(0, separator);
  const codePrefix = `${CODE_DIR}/`;
  const afterActor = rest.slice(separator + 1);
  if (!afterActor.startsWith(codePrefix)) return undefined;

  const projectPath = afterActor.slice(codePrefix.length);
  if (projectPath.length === 0) return undefined;
  return { actorId, projectPath };
};

/** True for project paths under `src/assets/` - the auto-synced asset channel. */
export const isReactAppAssetPath = (projectPath: string): boolean =>
  projectPath.startsWith(`${REACT_APP_ASSETS_DIR}/`) && projectPath.length > REACT_APP_ASSETS_DIR.length + 1;

export interface IgnoreVerdict {
  ignored: boolean;
  /** Set when the file is ignored but the user probably wants to know about it. */
  warn?: string;
}

const NOT_IGNORED: IgnoreVerdict = { ignored: false };

/**
 * Ignore rules for a React App project, matched per path segment so that nested
 * copies (a second `node_modules` under a workspace package, say) are caught too.
 */
export const isIgnoredProjectPath = (projectPath: string): IgnoreVerdict => {
  const segments = projectPath.split('/');
  const fileName = segments[segments.length - 1];

  for (const segment of segments.slice(0, -1)) {
    if (REACT_APP_IGNORED_DIRS.includes(segment)) return { ignored: true };
  }

  if (REACT_APP_IGNORED_DIRS.includes(fileName) || REACT_APP_IGNORED_FILES.includes(fileName)) {
    return { ignored: true };
  }

  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return {
      ignored: true,
      warn: `'${projectPath}' is not synced: project files are readable by anyone who can open the canvas, and a Vite build inlines VITE_* values into the app it serves. Use platform variables or secrets for configuration instead.`,
    };
  }

  return NOT_IGNORED;
};

/** True when the directory itself should never be descended into by a project walker. */
export const isIgnoredProjectDir = (dirName: string): boolean => REACT_APP_IGNORED_DIRS.includes(dirName);

const BRACKET_EXPRESSION = /^\$\{\{\s*assets\[\s*(["'])([\s\S]*?)\1\s*\]\s*\}\}$/;
const DOT_EXPRESSION = /^\$\{\{\s*assets\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}$/;

/**
 * Read an asset reference. The bracket form is what the CLI and the editor write;
 * the dot form is tolerated because it is easy to hand-author for simple keys.
 */
export const parseAssetExpression = (content: unknown): string | undefined => {
  if (typeof content !== 'string') return undefined;

  const trimmed = content.trim();
  const bracket = BRACKET_EXPRESSION.exec(trimmed);
  if (bracket && bracket[2].length > 0) return bracket[2];

  const dot = DOT_EXPRESSION.exec(trimmed);
  if (dot) return dot[1];

  return undefined;
};

/** Always emits the bracket form, which supports every key an uploaded file can produce. */
export const assetExpression = (key: string): string => `\${{ assets["${key}"] }}`;

/**
 * New uploads key the asset by its file name, matching what uploading the same file
 * through the web editor would produce.
 */
export const assetKeyForFileName = (fileName: string): string => fileName;

export interface ReactAppOptionsFile {
  /** Position in `options.files`; the array order is user-authored and never sorted. */
  index: number;
  path: string;
  content: unknown;
}

/** Reads `configuration.options.files`, tolerating every malformed shape (validate reports those). */
export const optionsFileEntries = (configuration: unknown): ReactAppOptionsFile[] => {
  if (!isPlainObject(configuration) || !isPlainObject(configuration.options)) return [];

  const files = configuration.options.files;
  if (!Array.isArray(files)) return [];

  const entries: ReactAppOptionsFile[] = [];
  files.forEach((entry, index) => {
    if (!isPlainObject(entry) || typeof entry.path !== 'string') return;
    entries.push({ index, path: entry.path, content: entry.content });
  });
  return entries;
};

export interface ManagedAssetEntry {
  index: number;
  /** Project-relative path, always under `src/assets/`. */
  path: string;
  key: string;
}

/**
 * The overlay entries the CLI owns: an asset-directory path whose content is an asset
 * reference. Everything else in `options.files` is unmanaged and passes through verbatim.
 */
export const managedAssetEntries = (configuration: unknown): ManagedAssetEntry[] => {
  const managed: ManagedAssetEntry[] = [];
  for (const entry of optionsFileEntries(configuration)) {
    if (!isReactAppAssetPath(entry.path)) continue;
    const key = parseAssetExpression(entry.content);
    if (key === undefined) continue;
    managed.push({ index: entry.index, path: entry.path, key });
  }
  return managed;
};

/** Asset-directory overlays the CLI deliberately leaves alone (inline text or a file handle). */
export const unmanagedAssetDirEntries = (configuration: unknown): ReactAppOptionsFile[] =>
  optionsFileEntries(configuration).filter(
    (entry) => isReactAppAssetPath(entry.path) && parseAssetExpression(entry.content) === undefined,
  );

export const isReactAppActor = (actor: { type?: unknown }): boolean => actor.type === REACT_APP_TYPE;

/**
 * Sort every React App `codeDir` array by path, in place.
 *
 * Content hashing preserves array order, and the bundle rebuilds `codeDir` from a
 * directory listing (path-sorted). Normalizing server documents at the point they are
 * parsed keeps a differently-ordered server array from reading as a permanent local edit.
 * `options.files` is never sorted: its order is meaningful, since a later overlay wins.
 */
export const normalizeReactAppExport = (doc: CanvasExportDocument): CanvasExportDocument => {
  for (const actor of Object.values(doc.data.actors)) {
    if (!isReactAppActor(actor) || !isPlainObject(actor.configuration)) continue;

    const codeDir = actor.configuration.codeDir;
    if (!Array.isArray(codeDir)) continue;
    if (!codeDir.every((entry) => isPlainObject(entry) && typeof entry.path === 'string')) continue;

    actor.configuration.codeDir = [...codeDir].sort((a, b) =>
      compareStrings((a as { path: string }).path, (b as { path: string }).path));
  }
  return doc;
};
