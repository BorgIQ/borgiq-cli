/**
 * React App asset sync.
 *
 * A React App's images and fonts are not part of the actor's source: they live as workspace
 * assets, and the actor references them from `configuration.options.files` with an
 * `${{ assets["<key>"] }}` expression. Keeping `code/src/assets/` and those assets in step is a
 * network phase of its own, which is why it lives here rather than in the pure bundle compiler.
 *
 * Split in two on purpose: a pure planner decides every verdict from a snapshot of the world
 * (document, local files, baselines, workspace assets), and an impure applier does the transfers.
 * The planner is what the verdict tests exercise, and what `--dry-run` prints.
 *
 * Asset sync mirrors actor sync: three-way baselines, fail closed when both sides moved, and
 * `--force-local` / re-pull as the two ways out.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { BIQAssetMetadata, BIQAssetUpdateBody, BIQAssetCreateBody } from '../client/types.js';
import {
  REACT_APP_TYPE,
  assetExpression,
  assetKeyForFileName,
  managedAssetEntries,
  reactAppCodePrefix,
} from './bundle/reactApp.js';
import type { BundleSyncReactAppAsset, CanvasExportDocument, ExportedActor } from './bundle/types.js';
import type { BundleLocalAsset } from './bundleFs.js';
import { computeFileDigest, mimeTypeFromFileName } from './fileMeta.js';
import { fetchPresignedUrlBytes, uploadToPresignedUrl } from './upload.js';

/** actor id -> project path -> last-synced state. */
export type ReactAppAssetBaselines = Record<string, Record<string, BundleSyncReactAppAsset>>;

export interface LocalAssetFile extends BundleLocalAsset {
  sha256: string;
}

/** The workspace-asset facts the planner needs; `sha256` is absent on assets never hashed server-side. */
export interface ServerAsset {
  id: string;
  key: string;
  type: string;
  sha256?: string;
}

const basename = (projectPath: string): string => projectPath.slice(projectPath.lastIndexOf('/') + 1);

export const reactAppActors = (doc: CanvasExportDocument): ExportedActor[] =>
  Object.values(doc.data.actors).filter((actor) => actor.type === REACT_APP_TYPE);

/** True when a canvas has any React App actor. Guards every asset-phase network call. */
export const hasReactAppActors = (doc: CanvasExportDocument): boolean => reactAppActors(doc).length > 0;

// ── Push ────────────────────────────────────────────────────────────────────────────────────────

export type PushAssetAction =
  | { kind: 'unchanged'; actorId: string; projectPath: string; key: string; assetId: string; sha256: string }
  | { kind: 'upload-new'; actorId: string; projectPath: string; key: string; local: LocalAssetFile; hasEntry: boolean }
  | { kind: 'adopt'; actorId: string; projectPath: string; key: string; assetId: string; sha256: string; hasEntry: boolean }
  | { kind: 'update'; actorId: string; projectPath: string; key: string; assetId: string; local: LocalAssetFile }
  | { kind: 'conflict'; actorId: string; projectPath: string; key: string; detail: string }
  | { kind: 'remove-entry'; actorId: string; projectPath: string; key: string }
  | { kind: 'skip'; actorId: string; projectPath: string; key: string; detail: string };

export interface PushAssetPlan {
  actions: PushAssetAction[];
  conflicts: PushAssetAction[];
  /** Blocking problems the user must fix; unlike conflicts, --force-local cannot override them. */
  errors: string[];
  warnings: string[];
}

export interface PushPlanInput {
  doc: CanvasExportDocument;
  localAssets: LocalAssetFile[];
  baselines: ReactAppAssetBaselines;
  serverAssets: ServerAsset[];
  /** Downgrades conflicts to an in-place update, matching --force-local for actors. */
  forceLocal?: boolean;
}

export const planReactAppAssetPush = (input: PushPlanInput): PushAssetPlan => {
  const plan: PushAssetPlan = { actions: [], conflicts: [], errors: [], warnings: [] };
  const byId = new Map(input.serverAssets.map((asset) => [asset.id, asset]));
  const byKey = new Map(input.serverAssets.map((asset) => [asset.key, asset]));

  for (const actor of reactAppActors(input.doc)) {
    const entries = managedAssetEntries(actor.configuration);
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const baseline = input.baselines[actor.id] ?? {};
    const locals = input.localAssets.filter((asset) => asset.actorId === actor.id);
    const localByPath = new Map(locals.map((asset) => [asset.projectPath, asset]));

    for (const local of locals) {
      const entry = entryByPath.get(local.projectPath);
      plan.actions.push(entry
        ? planExistingEntry(actor.id, local, entry.key, baseline[local.projectPath], byId, byKey, input.forceLocal ?? false, plan)
        : planNewLocalFile(actor.id, local, byKey, plan));
    }

    for (const entry of entries) {
      if (localByPath.has(entry.path)) continue;
      const base = baseline[entry.path];
      if (base) {
        plan.actions.push({ kind: 'remove-entry', actorId: actor.id, projectPath: entry.path, key: entry.key });
        continue;
      }
      plan.actions.push({
        kind: 'skip',
        actorId: actor.id,
        projectPath: entry.path,
        key: entry.key,
        detail: 'referenced asset not materialized locally - run \'borgiq bundle pull\' first',
      });
    }
  }

  plan.conflicts = plan.actions.filter((action) => action.kind === 'conflict');
  return plan;
};

/** A managed entry that also has a local file: the three-way case. */
const planExistingEntry = (
  actorId: string,
  local: LocalAssetFile,
  key: string,
  base: BundleSyncReactAppAsset | undefined,
  byId: Map<string, ServerAsset>,
  byKey: Map<string, ServerAsset>,
  forceLocal: boolean,
  plan: PushAssetPlan,
): PushAssetAction => {
  const server = (base && byId.get(base.assetId)) ?? byKey.get(key);
  if (!server) {
    // The asset was deleted in the workspace; recreate it under the same key.
    return { kind: 'upload-new', actorId, projectPath: local.projectPath, key, local, hasEntry: true };
  }

  if (server.sha256 === local.sha256) {
    return { kind: 'unchanged', actorId, projectPath: local.projectPath, key, assetId: server.id, sha256: local.sha256 };
  }

  const serverMoved = base === undefined || server.sha256 !== base.sha256;
  if (serverMoved && !forceLocal) {
    plan.warnings.push(base === undefined
      ? `${local.projectPath}: no sync baseline for asset '${key}' - cannot tell local and server changes apart.`
      : `${local.projectPath}: asset '${key}' also changed in the workspace since the last sync.`);
    return {
      kind: 'conflict',
      actorId,
      projectPath: local.projectPath,
      key,
      detail: base === undefined ? 'no baseline; both sides may have changed' : 'changed locally and in the workspace',
    };
  }

  return { kind: 'update', actorId, projectPath: local.projectPath, key, assetId: server.id, local };
};

/** A local file with no entry yet: a new asset, keyed by file name. */
const planNewLocalFile = (
  actorId: string,
  local: LocalAssetFile,
  byKey: Map<string, ServerAsset>,
  plan: PushAssetPlan,
): PushAssetAction => {
  const key = assetKeyForFileName(basename(local.projectPath));
  const existing = byKey.get(key);
  if (!existing) {
    return { kind: 'upload-new', actorId, projectPath: local.projectPath, key, local, hasEntry: false };
  }

  if (existing.sha256 === local.sha256) {
    // Same bytes already in the workspace: adopt it. Also what makes a retry of a
    // half-finished push converge instead of erroring.
    return { kind: 'adopt', actorId, projectPath: local.projectPath, key, assetId: existing.id, sha256: local.sha256, hasEntry: false };
  }

  plan.errors.push(
    `${local.projectPath}: workspace asset '${key}' already exists with different content. `
    + 'Rename the local file, or add an options.files entry for a key of your choosing and name the file to match.',
  );
  return { kind: 'skip', actorId, projectPath: local.projectPath, key, detail: `asset key '${key}' is taken` };
};

// ── Pull ────────────────────────────────────────────────────────────────────────────────────────

export type PullAssetAction =
  | { kind: 'download'; actorId: string; projectPath: string; key: string; assetId: string; bundlePath: string }
  | { kind: 'unchanged'; actorId: string; projectPath: string; key: string; assetId: string; sha256: string }
  | { kind: 'keep-local'; actorId: string; projectPath: string; key: string; assetId: string; sha256: string }
  | { kind: 'conflict'; actorId: string; projectPath: string; key: string; detail: string }
  | { kind: 'delete-local'; actorId: string; projectPath: string; bundlePath: string }
  | { kind: 'skip'; actorId: string; projectPath: string; key: string; detail: string };

export interface PullAssetPlan {
  actions: PullAssetAction[];
  conflicts: PullAssetAction[];
  warnings: string[];
}

export interface PullPlanInput {
  /** The document about to be written to disk. */
  doc: CanvasExportDocument;
  localAssets: LocalAssetFile[];
  baselines: ReactAppAssetBaselines;
  serverAssets: ServerAsset[];
  /** Downgrades every conflict to a download, matching --replace for actors. */
  replace?: boolean;
}

export const planReactAppAssetPull = (input: PullPlanInput): PullAssetPlan => {
  const plan: PullAssetPlan = { actions: [], conflicts: [], warnings: [] };
  const byId = new Map(input.serverAssets.map((asset) => [asset.id, asset]));
  const byKey = new Map(input.serverAssets.map((asset) => [asset.key, asset]));

  for (const actor of reactAppActors(input.doc)) {
    const entries = managedAssetEntries(actor.configuration);
    const baseline = input.baselines[actor.id] ?? {};
    const localByPath = new Map(
      input.localAssets.filter((asset) => asset.actorId === actor.id).map((asset) => [asset.projectPath, asset]),
    );
    const prefix = reactAppCodePrefix(actor.id);

    for (const entry of entries) {
      const base = baseline[entry.path];
      const server = (base && byId.get(base.assetId)) ?? byKey.get(entry.key);
      if (!server) {
        plan.warnings.push(`${entry.path}: asset '${entry.key}' no longer exists in this workspace - skipped.`);
        plan.actions.push({ kind: 'skip', actorId: actor.id, projectPath: entry.path, key: entry.key, detail: 'asset not found in workspace' });
        continue;
      }

      const local = localByPath.get(entry.path);
      const bundlePath = `${prefix}${entry.path}`;
      if (!local) {
        plan.actions.push({ kind: 'download', actorId: actor.id, projectPath: entry.path, key: entry.key, assetId: server.id, bundlePath });
        continue;
      }
      plan.actions.push(planExistingLocalFile(actor.id, entry, local, base, server, bundlePath, input.replace ?? false, plan));
    }

    for (const [projectPath, base] of Object.entries(baseline)) {
      if (entries.some((entry) => entry.path === projectPath)) continue;
      const local = localByPath.get(projectPath);
      if (!local) continue;

      if (local.sha256 === base.sha256) {
        plan.actions.push({ kind: 'delete-local', actorId: actor.id, projectPath, bundlePath: `${prefix}${projectPath}` });
        continue;
      }
      plan.warnings.push(`${projectPath}: no longer referenced by the actor, but the local file has changes - kept.`);
    }
  }

  plan.conflicts = plan.actions.filter((action) => action.kind === 'conflict');
  return plan;
};

const planExistingLocalFile = (
  actorId: string,
  entry: { path: string; key: string },
  local: LocalAssetFile,
  base: BundleSyncReactAppAsset | undefined,
  server: ServerAsset,
  bundlePath: string,
  replace: boolean,
  plan: PullAssetPlan,
): PullAssetAction => {
  if (server.sha256 === local.sha256) {
    return { kind: 'unchanged', actorId, projectPath: entry.path, key: entry.key, assetId: server.id, sha256: local.sha256 };
  }

  const localChanged = base === undefined || local.sha256 !== base.sha256;
  const serverChanged = base === undefined || server.sha256 !== base.sha256;

  if (!localChanged && serverChanged) {
    return { kind: 'download', actorId, projectPath: entry.path, key: entry.key, assetId: server.id, bundlePath };
  }
  if (localChanged && !serverChanged) {
    return { kind: 'keep-local', actorId, projectPath: entry.path, key: entry.key, assetId: server.id, sha256: local.sha256 };
  }

  if (replace) {
    return { kind: 'download', actorId, projectPath: entry.path, key: entry.key, assetId: server.id, bundlePath };
  }
  plan.warnings.push(base === undefined
    ? `${entry.path}: no sync baseline for asset '${entry.key}' - cannot tell local and server changes apart.`
    : `${entry.path}: asset '${entry.key}' changed locally and in the workspace.`);
  return {
    kind: 'conflict',
    actorId,
    projectPath: entry.path,
    key: entry.key,
    detail: base === undefined ? 'no baseline; both sides may have changed' : 'changed locally and in the workspace',
  };
};

// ── Patching the document ───────────────────────────────────────────────────────────────────────

/**
 * Apply a push plan's `options.files` changes to the in-memory document, so the actor diff that
 * follows sees them. Pure and order-preserving: entry order decides which overlay wins, so new
 * entries append and the rest keep their position.
 */
export const patchOptionsFiles = (doc: CanvasExportDocument, plan: PushAssetPlan): void => {
  for (const actor of reactAppActors(doc)) {
    const actions = plan.actions.filter((action) => action.actorId === actor.id);
    const added = actions.filter((action) => (action.kind === 'upload-new' || action.kind === 'adopt') && !action.hasEntry);
    const removed = new Set(actions.filter((action) => action.kind === 'remove-entry').map((action) => action.projectPath));
    if (added.length === 0 && removed.size === 0) continue;

    const configuration = isRecord(actor.configuration) ? { ...actor.configuration } : {};
    const options = isRecord(configuration.options) ? { ...configuration.options } : {};
    const current = Array.isArray(options.files) ? options.files : [];

    const kept = current.filter((entry) => !(isRecord(entry) && typeof entry.path === 'string' && removed.has(entry.path)));
    const appended = added
      .slice()
      .sort((a, b) => (a.projectPath < b.projectPath ? -1 : a.projectPath > b.projectPath ? 1 : 0))
      .map((action) => ({ path: action.projectPath, content: assetExpression(action.key) }));

    options.files = [...kept, ...appended];
    configuration.options = options;
    actor.configuration = configuration;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ── Baselines ───────────────────────────────────────────────────────────────────────────────────

export interface SyncedAsset {
  actorId: string;
  projectPath: string;
  assetId: string;
  assetKey: string;
  sha256: string;
}

export const baselinesFrom = (synced: SyncedAsset[]): ReactAppAssetBaselines => {
  const out: ReactAppAssetBaselines = {};
  for (const asset of synced) {
    const paths = out[asset.actorId] ?? {};
    paths[asset.projectPath] = { assetId: asset.assetId, assetKey: asset.assetKey, sha256: asset.sha256 };
    out[asset.actorId] = paths;
  }
  return out;
};

// ── Network ─────────────────────────────────────────────────────────────────────────────────────

/** Just the client surface this module needs, which keeps it easy to fake in tests. */
export interface AssetClient {
  listAssets: (org: string, workspace: string, params?: { page?: number; pageSize?: number }) =>
  Promise<{ total: number; data: BIQAssetMetadata[] }>;
  createAsset: (org: string, workspace: string, body: BIQAssetCreateBody) => Promise<unknown>;
  updateAsset: (org: string, workspace: string, id: string, body: BIQAssetUpdateBody) => Promise<unknown>;
  getAssetData: (org: string, workspace: string, id: string) => Promise<string>;
  updateFileUpload: (
    org: string,
    workspace: string,
    fileId: string,
    body: { status: 'upload_success'; md5: string; sha256: string } | { status: 'upload_failure' },
  ) => Promise<unknown>;
}

export interface AssetContext {
  org: string;
  workspace: string;
}

const PAGE_SIZE = 100;

/**
 * Every workspace asset.
 *
 * The asset data and update routes accept only strict asset ids, so a key has to be resolved to an
 * id before either can be called - the list is how the CLI does that.
 */
export const listAllAssets = async (client: AssetClient, ctx: AssetContext): Promise<ServerAsset[]> => {
  const assets: ServerAsset[] = [];
  for (let page = 1; ; page += 1) {
    const result = await client.listAssets(ctx.org, ctx.workspace, { page, pageSize: PAGE_SIZE });
    for (const asset of result.data) {
      assets.push({ id: asset.id, key: asset.key, type: asset.type, sha256: asset.file?.sha256 });
    }
    if (result.data.length < PAGE_SIZE) return assets;
  }
};

/**
 * The workspace assets a verdict actually depends on: those a managed entry resolves to (by
 * baselined id, else by key) plus those a new local file would collide with by key. Only these
 * are worth downloading when a digest is missing.
 */
export const digestsNeeded = (input: {
  doc: CanvasExportDocument;
  localAssets: LocalAssetFile[];
  baselines: ReactAppAssetBaselines;
  serverAssets: ServerAsset[];
}): Set<string> => {
  const byId = new Map(input.serverAssets.map((asset) => [asset.id, asset]));
  const byKey = new Map(input.serverAssets.map((asset) => [asset.key, asset]));
  const ids = new Set<string>();

  for (const actor of reactAppActors(input.doc)) {
    const baseline = input.baselines[actor.id] ?? {};
    const entries = managedAssetEntries(actor.configuration);

    for (const entry of entries) {
      const base = baseline[entry.path];
      const server = (base && byId.get(base.assetId)) ?? byKey.get(entry.key);
      if (server) ids.add(server.id);
    }

    const entryPaths = new Set(entries.map((entry) => entry.path));
    for (const local of input.localAssets) {
      if (local.actorId !== actor.id || entryPaths.has(local.projectPath)) continue;
      const collision = byKey.get(assetKeyForFileName(basename(local.projectPath)));
      if (collision) ids.add(collision.id);
    }
  }
  return ids;
};

/**
 * Fill in digests for assets the workspace never recorded one for, by downloading and hashing.
 * Slower than trusting a stored digest, but a verdict must never be guessed.
 */
export const resolveMissingDigests = async (
  client: AssetClient,
  ctx: AssetContext,
  assets: ServerAsset[],
  needed: ReadonlySet<string>,
  report: (message: string) => void,
): Promise<ServerAsset[]> => {
  const resolved: ServerAsset[] = [];
  for (const asset of assets) {
    if (asset.sha256 !== undefined || !needed.has(asset.id)) {
      resolved.push(asset);
      continue;
    }
    report(`Asset '${asset.key}' has no recorded digest; downloading it to compare.`);
    const bytes = await downloadAssetBytes(client, ctx, asset);
    resolved.push({ ...asset, sha256: computeFileDigest(bytes).sha256 });
  }
  return resolved;
};

const downloadAssetBytes = async (client: AssetClient, ctx: AssetContext, asset: ServerAsset): Promise<Uint8Array> => {
  const data = await client.getAssetData(ctx.org, ctx.workspace, asset.id);
  // File assets hand back a presigned download URL; text assets hand back their content.
  return asset.type === 'file' ? fetchPresignedUrlBytes(data) : new Uint8Array(Buffer.from(data, 'utf-8'));
};

/** Read and hash the asset files the walker found. */
export const withDigests = (assets: BundleLocalAsset[]): LocalAssetFile[] =>
  assets.map((asset) => ({ ...asset, sha256: computeFileDigest(fs.readFileSync(asset.absPath)).sha256 }));

export interface ApplyPushResult {
  synced: SyncedAsset[];
  uploaded: number;
}

/** Perform a push plan's transfers. Everything it returns becomes the new baseline. */
export const applyAssetPush = async (
  client: AssetClient,
  ctx: AssetContext,
  plan: PushAssetPlan,
  report: (message: string) => void,
): Promise<ApplyPushResult> => {
  const synced: SyncedAsset[] = [];
  let uploaded = 0;

  for (const action of plan.actions) {
    switch (action.kind) {
      case 'unchanged':
        synced.push({ actorId: action.actorId, projectPath: action.projectPath, assetId: action.assetId, assetKey: action.key, sha256: action.sha256 });
        break;
      case 'adopt':
        report(`Adopted existing asset '${action.key}' for ${action.projectPath} (identical content).`);
        synced.push({ actorId: action.actorId, projectPath: action.projectPath, assetId: action.assetId, assetKey: action.key, sha256: action.sha256 });
        break;
      case 'upload-new': {
        const assetId = await uploadNewAsset(client, ctx, action.key, action.local, report);
        uploaded += 1;
        synced.push({ actorId: action.actorId, projectPath: action.projectPath, assetId, assetKey: action.key, sha256: action.local.sha256 });
        break;
      }
      case 'update': {
        await updateExistingAsset(client, ctx, action.assetId, action.key, action.local, report);
        uploaded += 1;
        synced.push({ actorId: action.actorId, projectPath: action.projectPath, assetId: action.assetId, assetKey: action.key, sha256: action.local.sha256 });
        break;
      }
      case 'remove-entry':
        report(`Removed the reference to '${action.key}' (${action.projectPath}); the asset is left in the workspace - delete it with 'borgiq assets delete'.`);
        break;
      case 'skip':
      case 'conflict':
        break;
    }
  }

  return { synced, uploaded };
};

const uploadNewAsset = async (
  client: AssetClient,
  ctx: AssetContext,
  key: string,
  local: LocalAssetFile,
  report: (message: string) => void,
): Promise<string> => {
  const bytes = new Uint8Array(fs.readFileSync(local.absPath));
  const digest = computeFileDigest(bytes);
  const fileName = basename(local.projectPath);
  const mimeType = mimeTypeFromFileName(fileName);

  report(`Uploading ${local.projectPath} as asset '${key}' (${digest.sizeInBytes} bytes).`);
  const response = await client.createAsset(ctx.org, ctx.workspace, {
    type: 'file',
    key,
    file: { fileName, mimeType, sizeInBytes: digest.sizeInBytes },
  });

  const { assetId, fileId, presignedUrl } = readUploadTarget(response, key);
  await transfer(client, ctx, presignedUrl, fileId, bytes, fileName, mimeType, digest);
  return assetId;
};

const updateExistingAsset = async (
  client: AssetClient,
  ctx: AssetContext,
  assetId: string,
  key: string,
  local: LocalAssetFile,
  report: (message: string) => void,
): Promise<void> => {
  const bytes = new Uint8Array(fs.readFileSync(local.absPath));
  const digest = computeFileDigest(bytes);
  const fileName = basename(local.projectPath);
  const mimeType = mimeTypeFromFileName(fileName);

  report(`Updating asset '${key}' from ${local.projectPath} (${digest.sizeInBytes} bytes).`);
  const response = await client.updateAsset(ctx.org, ctx.workspace, assetId, {
    type: 'file',
    key,
    file: { fileName, mimeType, sizeInBytes: digest.sizeInBytes },
    updateFile: true,
  });

  const { fileId, presignedUrl } = readUploadTarget(response, key);
  await transfer(client, ctx, presignedUrl, fileId, bytes, fileName, mimeType, digest);
};

const readUploadTarget = (response: unknown, key: string): { assetId: string; fileId: string; presignedUrl: { url: string; fields: Record<string, string> } } => {
  if (!isRecord(response) || !isRecord(response.asset)) {
    throw new Error(`Asset '${key}': the server response did not include the asset.`);
  }
  const presignedUrl = response.presignedUrl;
  if (!isRecord(presignedUrl) || typeof presignedUrl.url !== 'string') {
    throw new Error(`Asset '${key}': the server did not return an upload URL.`);
  }
  const file = response.asset.file;
  if (!isRecord(file) || typeof file.id !== 'string') {
    throw new Error(`Asset '${key}': the server response did not include a file id.`);
  }
  return {
    assetId: String(response.asset.id),
    fileId: file.id,
    presignedUrl: presignedUrl as unknown as { url: string; fields: Record<string, string> },
  };
};

const transfer = async (
  client: AssetClient,
  ctx: AssetContext,
  presignedUrl: { url: string; fields: Record<string, string> },
  fileId: string,
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  digest: { md5: string; sha256: string },
): Promise<void> => {
  try {
    await uploadToPresignedUrl(presignedUrl, bytes, fileName, mimeType);
  } catch (error) {
    // Best-effort: tell the server the upload failed, but surface the original cause.
    await client.updateFileUpload(ctx.org, ctx.workspace, fileId, { status: 'upload_failure' }).catch(() => undefined);
    throw error;
  }
  await client.updateFileUpload(ctx.org, ctx.workspace, fileId, { status: 'upload_success', md5: digest.md5, sha256: digest.sha256 });
};

export interface ApplyPullResult {
  synced: SyncedAsset[];
  downloaded: number;
  deleted: number;
}

/** Perform a pull plan's transfers. Runs after the text files, so the directories already exist. */
export const applyAssetPull = async (
  client: AssetClient,
  ctx: AssetContext,
  plan: PullAssetPlan,
  targetDir: string,
  serverAssets: ServerAsset[],
  report: (message: string) => void,
): Promise<ApplyPullResult> => {
  const byId = new Map(serverAssets.map((asset) => [asset.id, asset]));
  const synced: SyncedAsset[] = [];
  let downloaded = 0;
  let deleted = 0;

  for (const action of plan.actions) {
    switch (action.kind) {
      case 'download': {
        const asset = byId.get(action.assetId);
        if (!asset) break;
        const bytes = await downloadAssetBytes(client, ctx, asset);
        writeAssetFile(targetDir, action.bundlePath, bytes);
        report(`Downloaded asset '${action.key}' to ${action.projectPath} (${bytes.length} bytes).`);
        downloaded += 1;
        synced.push({
          actorId: action.actorId,
          projectPath: action.projectPath,
          assetId: asset.id,
          assetKey: asset.key,
          sha256: computeFileDigest(bytes).sha256,
        });
        break;
      }
      case 'unchanged':
      case 'keep-local': {
        const asset = byId.get(action.assetId);
        synced.push({
          actorId: action.actorId,
          projectPath: action.projectPath,
          assetId: action.assetId,
          assetKey: asset?.key ?? action.key,
          sha256: action.sha256,
        });
        break;
      }
      case 'delete-local':
        fs.rmSync(path.join(targetDir, action.bundlePath), { force: true });
        report(`Removed ${action.projectPath}; the actor no longer references it.`);
        deleted += 1;
        break;
      case 'skip':
      case 'conflict':
        break;
    }
  }

  return { synced, downloaded, deleted };
};

const writeAssetFile = (targetDir: string, bundlePath: string, bytes: Uint8Array): void => {
  const abs = path.join(targetDir, bundlePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
};
