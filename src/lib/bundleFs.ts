import fs from 'node:fs';
import path from 'node:path';

import { ROOT_FILE } from './bundle/types.js';
import type { BundleFileMap } from './bundle/types.js';
import { isSafeBundlePath } from './bundle/path.js';
import { isIgnoredProjectDir, isIgnoredProjectPath, isReactAppAssetPath, splitReactAppCodePath } from './bundle/reactApp.js';
import { CliUsageError } from './errors.js';

const MANAGED_DIR = 'actors';

export interface WriteBundleOptions {
  force?: boolean;
  createIfMissing?: Readonly<BundleFileMap>;
}

export interface IncrementalWritePlan {
  write: string[];
  delete: string[];
  /** Directories left behind because the CLI does not own their contents. */
  leftover?: string[];
}

/** A React App asset file on disk. Its bytes are deliberately never read into the file map. */
export interface BundleLocalAsset {
  actorId: string;
  projectPath: string;
  bundlePath: string;
  absPath: string;
  sizeInBytes: number;
}

export interface BundleSkippedFile {
  bundlePath: string;
  reason: 'ignored' | 'binary' | 'env-warning';
  /** Present when the user should hear about the skip. */
  message?: string;
}

export interface BundleDirContents {
  /** UTF-8 text the compiler owns. Never contains asset, ignored, or binary content. */
  files: BundleFileMap;
  assets: BundleLocalAsset[];
  skipped: BundleSkippedFile[];
}

/**
 * Read a bundle directory, classifying every file inside a React App project into exactly one
 * channel: project source (text), workspace asset (bytes, never read here), or skipped.
 *
 * A React App project is a live working directory - it holds node_modules, build output, and asset
 * binaries the CLI must never read into the text map nor delete. Every reader and writer below
 * shares this one classifier so those files stay invisible to the compiler and safe on disk.
 */
export const readBundleDirDetailed = (dir: string): BundleDirContents => {
  const rootPath = path.join(dir, ROOT_FILE);
  if (!fs.existsSync(rootPath)) {
    throw new CliUsageError(`${dir} is not a canvas bundle (no ${ROOT_FILE}).`);
  }

  const contents: BundleDirContents = {
    files: { [ROOT_FILE]: fs.readFileSync(rootPath, 'utf-8') },
    assets: [],
    skipped: [],
  };
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (fs.existsSync(actorsDir)) {
    readFilesRecursive(dir, actorsDir, contents);
  }
  return contents;
};

export const readBundleDir = (dir: string): BundleFileMap => readBundleDirDetailed(dir).files;

/**
 * Replace a bundle's managed files. Returns the directories left behind (see `leftoverActorDirs`).
 *
 * The replace is selective rather than an `rm -rf actors/`: a React App project under actors/ is a
 * real working directory, so wiping it would take node_modules, build output, asset binaries, and
 * the SDK placeholder with it. Only managed text files go.
 */
export const writeBundleDir = (dir: string, files: BundleFileMap, opts: WriteBundleOptions = {}): { leftover: string[] } => {
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) {
      throw new CliUsageError(`${dir} exists and is not a directory.`);
    }
    const entries = fs.readdirSync(dir);
    if (entries.length > 0 && !opts.force) {
      const message = entries.includes(ROOT_FILE)
        ? `${dir} already contains a canvas bundle - pass --force to replace its managed files.`
        : `${dir} is not empty and not a canvas bundle - pass --force to write into it anyway.`;
      throw new CliUsageError(message);
    }
    fs.rmSync(path.join(dir, ROOT_FILE), { force: true });
    for (const rel of existingManagedFiles(dir)) {
      fs.rmSync(resolveInside(dir, rel), { force: true });
    }
    pruneEmptyDirs(path.join(dir, MANAGED_DIR), dir);
  }

  for (const [rel, content] of Object.entries(files).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInside(dir, rel, content, true);
  }

  for (const [rel, content] of Object.entries(opts.createIfMissing ?? {}).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInside(dir, rel, content, false);
  }

  return { leftover: leftoverActorDirs(dir, files) };
};

export const planBundleDirIncrementalWrite = (dir: string, files: BundleFileMap): IncrementalWritePlan => {
  const write = Object.entries(files)
    .filter(([rel, content]) => {
      const abs = resolveInside(dir, rel);
      return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf-8') !== content;
    })
    .map(([rel]) => rel)
    .sort(compareStrings);

  const deleteFiles = existingManagedFiles(dir)
    .filter((rel) => files[rel] === undefined)
    .sort(compareStrings);

  return { write, delete: deleteFiles };
};

export const writeBundleDirIncremental = (dir: string, files: BundleFileMap, opts: WriteBundleOptions = {}): IncrementalWritePlan => {
  ensureWritableBundleDir(dir, opts);
  const plan = planBundleDirIncrementalWrite(dir, files);

  for (const [rel, content] of Object.entries(files).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInsideIfChanged(dir, rel, content);
  }

  for (const rel of plan.delete) {
    fs.rmSync(resolveInside(dir, rel), { force: true });
  }
  pruneEmptyDirs(path.join(dir, MANAGED_DIR), dir);

  for (const [rel, content] of Object.entries(opts.createIfMissing ?? {}).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInside(dir, rel, content, false);
  }

  const leftover = leftoverActorDirs(dir, files);
  return leftover.length > 0 ? { ...plan, leftover } : plan;
};

const readFilesRecursive = (baseDir: string, currentDir: string, contents: BundleDirContents): void => {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
    const abs = path.join(currentDir, entry.name);
    const rel = bundleRelative(baseDir, abs);

    if (entry.isDirectory()) {
      // Never descend into an ignored project directory: node_modules alone can hold tens of
      // thousands of files, and nothing inside any of them is ours to read.
      const inProject = splitReactAppCodePath(rel);
      if (inProject && isIgnoredProjectDir(entry.name)) continue;
      readFilesRecursive(baseDir, abs, contents);
      continue;
    }

    if (!entry.isFile()) continue;
    collectFile(abs, rel, contents);
  }
};

const collectFile = (abs: string, rel: string, contents: BundleDirContents): void => {
  const inProject = splitReactAppCodePath(rel);
  if (!inProject) {
    contents.files[rel] = fs.readFileSync(abs, 'utf-8');
    return;
  }

  const { actorId, projectPath } = inProject;
  const ignored = isIgnoredProjectPath(projectPath);
  if (ignored.ignored) {
    contents.skipped.push({ bundlePath: rel, reason: ignored.warn ? 'env-warning' : 'ignored', message: ignored.warn });
    return;
  }

  if (isReactAppAssetPath(projectPath)) {
    contents.assets.push({
      actorId,
      projectPath,
      bundlePath: rel,
      absPath: abs,
      sizeInBytes: fs.statSync(abs).size,
    });
    return;
  }

  const text = decodeUtf8(fs.readFileSync(abs));
  if (text === undefined) {
    contents.skipped.push({
      bundlePath: rel,
      reason: 'binary',
      message: `'${rel}' is not UTF-8 text and is ignored - move it under the project's src/assets/ directory to sync it as an asset.`,
    });
    return;
  }
  contents.files[rel] = text;
};

/**
 * Decode as UTF-8 or report the file as binary. Keeps the BOM, matching how the rest of the
 * bundle reads text, so content hashes stay byte-exact.
 */
const decodeUtf8 = (buffer: Buffer): string | undefined => {
  if (buffer.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    return undefined;
  }
};

const bundleRelative = (baseDir: string, abs: string): string =>
  path.relative(baseDir, abs).split(path.sep).join('/');

const writeFileInside = (dir: string, rel: string, content: string, overwrite: boolean): void => {
  const abs = resolveInside(dir, rel);
  if (!overwrite && fs.existsSync(abs)) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
};

const writeFileInsideIfChanged = (dir: string, rel: string, content: string): void => {
  const abs = resolveInside(dir, rel);
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf-8') === content) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
};

const ensureWritableBundleDir = (dir: string, opts: WriteBundleOptions): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  if (!fs.statSync(dir).isDirectory()) {
    throw new CliUsageError(`${dir} exists and is not a directory.`);
  }

  const entries = fs.readdirSync(dir);
  const isBundle = entries.includes(ROOT_FILE);
  if (entries.length > 0 && !isBundle && !opts.force) {
    throw new CliUsageError(`${dir} is not empty and not a canvas bundle - pass --force to write into it anyway.`);
  }
};

/**
 * The managed text files on disk - the only files the CLI may delete.
 *
 * This uses the same classifier as the reader on purpose. Everything it omits (asset bytes,
 * node_modules, build output, lockfiles, the SDK placeholder) is therefore invisible to the
 * "delete managed files absent from the new map" rule, and survives every write.
 */
const existingManagedFiles = (dir: string): string[] => {
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (!fs.existsSync(actorsDir)) return [];
  const contents: BundleDirContents = { files: {}, assets: [], skipped: [] };
  readFilesRecursive(dir, actorsDir, contents);
  return Object.keys(contents.files);
};

/**
 * Actor directories that still hold files after a write, but that the new bundle no longer
 * indexes - local dev leftovers of a deleted actor. Reported, never deleted.
 */
const leftoverActorDirs = (dir: string, files: BundleFileMap): string[] => {
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (!fs.existsSync(actorsDir)) return [];

  const written = new Set(
    Object.keys(files)
      .map((rel) => rel.split('/').slice(0, 4).join('/'))
      .filter((prefix) => prefix.startsWith(`${MANAGED_DIR}/`)),
  );

  const leftover: string[] = [];
  for (const category of readDirNames(actorsDir)) {
    for (const folder of readDirNames(path.join(actorsDir, category))) {
      for (const actorId of readDirNames(path.join(actorsDir, category, folder))) {
        const rel = `${MANAGED_DIR}/${category}/${folder}/${actorId}`;
        if (!written.has(rel)) leftover.push(rel);
      }
    }
  }
  return leftover.sort(compareStrings);
};

const readDirNames = (dir: string): string[] =>
  fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];

const pruneEmptyDirs = (currentDir: string, stopDir: string): void => {
  if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) return;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(currentDir, entry.name), stopDir);
  }
  if (currentDir === stopDir) return;
  if (fs.existsSync(currentDir) && fs.readdirSync(currentDir).length === 0) {
    fs.rmdirSync(currentDir);
  }
};

const resolveInside = (dir: string, rel: string): string => {
  if (!isSafeBundlePath(rel)) {
    throw new CliUsageError(`Refusing to write '${rel}' - it escapes the bundle directory.`);
  }

  const base = path.resolve(dir);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new CliUsageError(`Refusing to write '${rel}' - it escapes the bundle directory.`);
  }
  return abs;
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
