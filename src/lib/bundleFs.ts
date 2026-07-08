import fs from 'node:fs';
import path from 'node:path';

import { ROOT_FILE } from './bundle/types.js';
import type { BundleFileMap } from './bundle/types.js';
import { CliUsageError } from './errors.js';

const MANAGED_DIR = 'actors';

export interface WriteBundleOptions {
  force?: boolean;
  createIfMissing?: BundleFileMap;
}

export interface IncrementalWritePlan {
  write: string[];
  delete: string[];
}

export const readBundleDir = (dir: string): BundleFileMap => {
  const rootPath = path.join(dir, ROOT_FILE);
  if (!fs.existsSync(rootPath)) {
    throw new CliUsageError(`${dir} is not a canvas bundle (no ${ROOT_FILE}).`);
  }

  const files: BundleFileMap = { [ROOT_FILE]: fs.readFileSync(rootPath, 'utf-8') };
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (fs.existsSync(actorsDir)) {
    readFilesRecursive(dir, actorsDir, files);
  }
  return files;
};

export const writeBundleDir = (dir: string, files: BundleFileMap, opts: WriteBundleOptions = {}): void => {
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) {
      throw new CliUsageError(`${dir} exists and is not a directory.`);
    }
    const entries = fs.readdirSync(dir);
    const isBundle = entries.includes(ROOT_FILE);
    if (entries.length > 0 && !isBundle && !opts.force) {
      throw new CliUsageError(`${dir} is not empty and not a canvas bundle - pass --force to write into it anyway.`);
    }
    fs.rmSync(path.join(dir, ROOT_FILE), { force: true });
    fs.rmSync(path.join(dir, MANAGED_DIR), { recursive: true, force: true });
  }

  for (const [rel, content] of Object.entries(files).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInside(dir, rel, content, true);
  }

  for (const [rel, content] of Object.entries(opts.createIfMissing ?? {}).sort(([a], [b]) => compareStrings(a, b))) {
    writeFileInside(dir, rel, content, false);
  }
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

  return plan;
};

const readFilesRecursive = (baseDir: string, currentDir: string, files: BundleFileMap): void => {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name))) {
    const abs = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      readFilesRecursive(baseDir, abs, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(baseDir, abs).split(path.sep).join('/');
    files[rel] = fs.readFileSync(abs, 'utf-8');
  }
};

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

const existingManagedFiles = (dir: string): string[] => {
  const actorsDir = path.join(dir, MANAGED_DIR);
  if (!fs.existsSync(actorsDir)) return [];
  const files: BundleFileMap = {};
  readFilesRecursive(dir, actorsDir, files);
  return Object.keys(files);
};

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
  if (!isSafeRelativePath(rel)) {
    throw new CliUsageError(`Refusing to write '${rel}' - it escapes the bundle directory.`);
  }

  const base = path.resolve(dir);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new CliUsageError(`Refusing to write '${rel}' - it escapes the bundle directory.`);
  }
  return abs;
};

const isSafeRelativePath = (rel: string): boolean =>
  rel.length > 0
  && !rel.startsWith('/')
  && !rel.includes('\\')
  && !rel.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
