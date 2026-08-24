/**
 * Pure helpers for actors whose `configuration.codeDir` is a project tree of
 * `{path, content}` files rather than a single entrypoint string: Deno, Deno Test,
 * Universal Trigger, Python, and React App actors.
 *
 * Nothing here touches the filesystem or the network. It classifies bundle paths,
 * applies the per-type ignore and reserved-name rules the registry carries, and
 * normalizes server documents into the order a bundle on disk produces.
 */

import { BUNDLE_PATH_REGISTRY, REACT_APP_TYPE, isKnownActorType } from './registry.js';
import type { BundleActorType, BundlePathSpec, ReservedPathSet } from './registry.js';
import { CODE_DIR } from './types.js';
import type { CanvasExportDocument } from './types.js';

/**
 * Best-effort mirrors of the limits the API enforces on save. Local checks that use
 * them are warnings only - the API is the authority (see AGENTS.md, thin client).
 */
export const MAX_CODE_DIR_FILES = 200;
export const MAX_CODE_DIR_TOTAL_BYTES = 1024 * 1024;
export const MAX_PROJECT_PATH_LENGTH = 255;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The project-tree types, in registry order. */
export const PROJECT_DIR_TYPES: readonly BundleActorType[] = Object.entries(BUNDLE_PATH_REGISTRY)
  .filter(([, spec]) => spec.projectDir)
  .map(([type]) => type as BundleActorType);

export const isProjectDirType = (type: string): type is BundleActorType =>
  isKnownActorType(type) && Boolean(BUNDLE_PATH_REGISTRY[type].projectDir);

const folderPrefix = (spec: BundlePathSpec): string => `actors/${spec.category}/${spec.folder}/`;

/** Folder prefix -> actor type, for every project-tree type. */
const PROJECT_FOLDER_PREFIXES: readonly [string, BundleActorType][] = PROJECT_DIR_TYPES
  .map((type) => [folderPrefix(BUNDLE_PATH_REGISTRY[type]), type]);

/** Bundle-relative prefix every project file of `actorId` lives under (trailing slash included). */
export const projectCodePrefix = (type: BundleActorType, actorId: string): string =>
  `${folderPrefix(BUNDLE_PATH_REGISTRY[type])}${actorId}/${CODE_DIR}/`;

export interface ProjectPathParts {
  actorType: BundleActorType;
  actorId: string;
  projectPath: string;
}

/** Inverse of `projectCodePrefix`: recognizes paths inside any project tree. */
export const splitProjectCodePath = (bundlePath: string): ProjectPathParts | undefined => {
  for (const [prefix, actorType] of PROJECT_FOLDER_PREFIXES) {
    if (!bundlePath.startsWith(prefix)) continue;

    const rest = bundlePath.slice(prefix.length);
    const separator = rest.indexOf('/');
    if (separator <= 0) return undefined;

    const actorId = rest.slice(0, separator);
    const codePrefix = `${CODE_DIR}/`;
    const afterActor = rest.slice(separator + 1);
    if (!afterActor.startsWith(codePrefix)) return undefined;

    const projectPath = afterActor.slice(codePrefix.length);
    if (projectPath.length === 0) return undefined;
    return { actorType, actorId, projectPath };
  }
  return undefined;
};

export interface IgnoreVerdict {
  ignored: boolean;
  /** Set when the file is ignored but the user probably wants to know about it. */
  warn?: string;
}

const NOT_IGNORED: IgnoreVerdict = { ignored: false };

/**
 * Ignore rules for one project type, matched per path segment so that nested copies
 * (a second `node_modules` under a workspace package, say) are caught too.
 */
export const isIgnoredProjectPathFor = (projectPath: string, type: BundleActorType): IgnoreVerdict => {
  const ignore = BUNDLE_PATH_REGISTRY[type].ignore;
  if (!ignore) return NOT_IGNORED;

  const segments = projectPath.split('/');
  const fileName = segments[segments.length - 1];

  for (const segment of segments.slice(0, -1)) {
    if (ignore.dirs.includes(segment)) return { ignored: true };
  }

  if (ignore.dirs.includes(fileName) || ignore.files.includes(fileName)) {
    return { ignored: true };
  }

  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return { ignored: true, warn: envFileWarning(projectPath, type) };
  }

  return NOT_IGNORED;
};

/** True when the directory itself should never be descended into by a project walker. */
export const isIgnoredProjectDirFor = (dirName: string, type: BundleActorType): boolean =>
  BUNDLE_PATH_REGISTRY[type].ignore?.dirs.includes(dirName) ?? false;

const envFileWarning = (projectPath: string, type: BundleActorType): string =>
  `'${projectPath}' is not synced: project files are readable by anyone who can open the canvas`
  + (type === REACT_APP_TYPE ? ', and a Vite build inlines VITE_* values into the app it serves' : '')
  + '. Use platform variables or secrets for configuration instead.';

/** Why a non-UTF-8 file under `code/` is skipped, and what to do about it. */
export const binaryFileWarning = (bundlePath: string, type: BundleActorType): string =>
  type === REACT_APP_TYPE
    ? `'${bundlePath}' is not UTF-8 text and is ignored - move it under the project's src/assets/ directory to sync it as an asset.`
    : `'${bundlePath}' is not UTF-8 text and is ignored - actor code files are text only.`;

/**
 * Return the reserved entry a project path collides with, or `null` when it is free.
 *
 * Comparison is case-insensitive, matching the case-fold collision rule the compiler
 * applies to project paths: on a case-insensitive filesystem `Server.ts` and `server.ts`
 * are the same file. Prefixes are tested against `path + '/'`, so a prefix of `shared/`
 * rejects both `shared/api.ts` and a file literally named `shared`.
 */
export const matchReservedPath = (projectPath: string, reserved: ReservedPathSet): string | null => {
  const lowered = projectPath.toLowerCase();
  for (const exact of reserved.exact) {
    if (lowered === exact.toLowerCase()) return exact;
  }
  const loweredAsDir = `${lowered}/`;
  for (const prefix of reserved.prefixes) {
    if (loweredAsDir.startsWith(prefix.toLowerCase())) return prefix;
  }
  return null;
};

/**
 * Sort every project-tree `codeDir` array by path, in place.
 *
 * Content hashing preserves array order, and the bundle rebuilds `codeDir` from a
 * directory listing (path-sorted). Normalizing server documents at the point they are
 * parsed keeps a differently-ordered server array from reading as a permanent local edit.
 * `options.files` is never sorted: its order is meaningful, since a later overlay wins.
 */
export const normalizeProjectDirExport = (doc: CanvasExportDocument): CanvasExportDocument => {
  for (const actor of Object.values(doc.data.actors)) {
    if (typeof actor.type !== 'string' || !isProjectDirType(actor.type)) continue;
    if (!isPlainObject(actor.configuration)) continue;

    const codeDir = actor.configuration.codeDir;
    if (!Array.isArray(codeDir)) continue;
    if (!codeDir.every((entry) => isPlainObject(entry) && typeof entry.path === 'string')) continue;

    actor.configuration.codeDir = [...codeDir].sort((a, b) =>
      compareStrings((a as { path: string }).path, (b as { path: string }).path));
  }
  return doc;
};
