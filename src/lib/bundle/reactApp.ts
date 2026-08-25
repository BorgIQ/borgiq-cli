/**
 * Pure helpers for React App actors: the asset channel their project tree carries on
 * top of the generic project-dir model in `projectDir.ts`.
 *
 * Nothing here touches the filesystem, the network, or binary data: this module
 * only classifies asset paths and reads/writes the asset-reference expressions that
 * appear in `configuration.options.files`.
 */

import { REACT_APP_TYPE } from './registry.js';
import { projectCodePrefix } from './projectDir.js';

export { REACT_APP_TYPE };

/** The only project directory whose files are auto-synced with workspace assets. */
export const REACT_APP_ASSETS_DIR = 'src/assets';

/** Best-effort mirror of the limit the API enforces on `options.files`. */
export const MAX_OPTIONS_FILES = 50;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Bundle-relative prefix every project file of `actorId` lives under (trailing slash included). */
export const reactAppCodePrefix = (actorId: string): string => projectCodePrefix(REACT_APP_TYPE, actorId);

/** True for project paths under `src/assets/` - the auto-synced asset channel. */
export const isReactAppAssetPath = (projectPath: string): boolean =>
  projectPath.startsWith(`${REACT_APP_ASSETS_DIR}/`) && projectPath.length > REACT_APP_ASSETS_DIR.length + 1;

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
