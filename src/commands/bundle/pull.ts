import fs from 'node:fs';
import path from 'node:path';

import { assembleBundle, BundleValidationError } from '../../lib/bundle/assemble.js';
import { actorContentHashes, diffCanvas, mergeForPull, summarizeDiff } from '../../lib/bundle/diff.js';
import { disassemble } from '../../lib/bundle/disassemble.js';
import type { DisassembleOptions } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { ROOT_FILE } from '../../lib/bundle/types.js';
import type { CanvasExportDocument } from '../../lib/bundle/types.js';
import { planBundleDirIncrementalWrite, readBundleDirDetailed, writeBundleDir, writeBundleDirIncremental } from '../../lib/bundleFs.js';
import type { BundleDirContents } from '../../lib/bundleFs.js';
import {
  applyAssetPull,
  baselinesFrom,
  digestsNeeded,
  hasReactAppActors,
  listAllAssets,
  planReactAppAssetPull,
  resolveMissingDigests,
  withDigests,
} from '../../lib/reactAppAssets.js';
import type { PullAssetPlan, ReactAppAssetBaselines, ServerAsset, SyncedAsset } from '../../lib/reactAppAssets.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { bundleCompanions, reportIssues, skippedFileIssues } from './shared.js';

export const bundlePull = async (
  canvasSlugOrId: string,
  dir: string | undefined,
  options: { force?: boolean; replace?: boolean; dryRun?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const [envelope, canvasDetail] = await Promise.all([
      client.exportCanvas(ctx.org, ctx.workspace, canvasSlugOrId),
      client.getCanvas(ctx.org, ctx.workspace, canvasSlugOrId, true),
    ]);
    const input = parseExportInput(JSON.stringify(envelope));
    const actorVersions = canvasDetail.actorVersions ?? {};

    const slug = typeof input.document.metadata.slug === 'string' && input.document.metadata.slug.length > 0
      ? input.document.metadata.slug
      : canvasSlugOrId;
    const target = dir ?? `./${slug}.borgiq-canvas`;

    const disassembleOpts: DisassembleOptions = { exportErrors: input.exportErrors, actorVersions };
    const { files, warnings } = disassemble(input.document, disassembleOpts);
    const shouldReplace = options.replace || !isBundleDir(target);
    if (shouldReplace) {
      reportPullWarnings(warnings, input.exportErrors);

      // A replace takes the server's side of everything, so plan without baselines and let the
      // replace rule settle every difference; identical bytes are still left alone.
      const localContents = isBundleDir(target) ? readBundleDirDetailed(target) : undefined;
      const assets = await planAssets(client, ctx, input.document, localContents, {}, true);

      if (options.dryRun) {
        const plan = { mode: 'replace', target, actorCount: actorCount(files), write: Object.keys(files).sort(), assets: assets.summary };
        if (!globalOpts.json && process.stderr.isTTY) {
          process.stderr.write(`Dry run: would pull '${slug}' (${plan.actorCount} actor(s)) into ${target}${options.replace ? ' with full replace' : ''}.\n`);
          reportAssetPlan(assets.plan);
        }
        output(plan, globalOpts);
        return;
      }

      writeBundleDir(target, files, { force: Boolean(options.force || options.replace), createIfMissing: bundleCompanions(input.document) });
      const synced = await applyAssets(client, ctx, target, assets, input.document, disassembleOpts);
      process.stderr.write(`Pulled '${slug}' (${actorCount(files)} actor(s)) into ${target}${options.replace ? ' (replace)' : ''}${assetSuffix(synced)}\n`);
      return;
    }

    const localContents = readBundleDirDetailed(target);
    const local = assembleLocalBundle(target, localContents);
    const diff = diffCanvas(local.doc, input.document, {
      localActorStates: local.sync.actors,
      serverActorVersions: actorVersions,
    });
    const summary = summarizeDiff(diff, { direction: 'pull' });
    if (diff.pullConflicts.length > 0) {
      reportPullWarnings(warnings, input.exportErrors);
      reportPullConflicts(diff.pullConflicts);
      process.exitCode = ExitCode.CONFLICT;
      output({ mode: 'sync', target, summary, entries: diff.entries, conflicts: diff.pullConflicts, applied: false }, globalOpts);
      return;
    }
    const merged = mergeForPull(local.doc, input.document, diff);
    const mergedOpts: DisassembleOptions = {
      exportErrors: input.exportErrors,
      actorVersions,
      actorHashes: actorContentHashes(input.document),
    };
    const mergedDisassembly = disassemble(merged, mergedOpts);
    const mergedFiles = mergedDisassembly.files;
    const writePlan = planBundleDirIncrementalWrite(target, mergedFiles);
    reportPullWarnings(mergedDisassembly.warnings, input.exportErrors);
    reportIssues([], skippedFileIssues(localContents.skipped));

    const assets = await planAssets(client, ctx, merged, localContents, local.sync.reactAppAssets ?? {}, false);
    if (assets.plan.conflicts.length > 0) {
      reportAssetConflicts(assets.plan.conflicts);
      process.exitCode = ExitCode.CONFLICT;
      output({ mode: 'sync', target, summary, entries: diff.entries, assetConflicts: assets.plan.conflicts, applied: false }, globalOpts);
      return;
    }

    if (options.dryRun) {
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Dry run: would sync '${slug}' into ${target}: ${writePlan.write.length} file(s) changed, ${writePlan.delete.length} file(s) deleted.\n`);
        reportAssetPlan(assets.plan);
      }
      output({ mode: 'sync', target, summary, entries: diff.entries, writePlan, assets: assets.summary }, globalOpts);
      return;
    }

    writeBundleDirIncremental(target, mergedFiles, { force: options.force, createIfMissing: bundleCompanions(merged) });
    const synced = await applyAssets(client, ctx, target, assets, merged, mergedOpts);

    process.stderr.write(`Synced '${slug}' into ${target}: ${writePlan.write.length} file(s) changed, ${writePlan.delete.length} file(s) deleted${assetSuffix(synced)}; kept ${summary.localKept} local actor(s).\n`);
  } catch (error) {
    handleError(error);
  }
};

interface PlannedAssets {
  plan: PullAssetPlan;
  serverAssets: ServerAsset[];
  summary: { download: number; unchanged: number; keepLocal: number; delete: number; skip: number; conflict: number };
}

const EMPTY_ASSET_PLAN: PlannedAssets = {
  plan: { actions: [], conflicts: [], warnings: [] },
  serverAssets: [],
  summary: { download: 0, unchanged: 0, keepLocal: 0, delete: 0, skip: 0, conflict: 0 },
};

/** Plans the asset phase, making no network call at all when the canvas has no React App actor. */
const planAssets = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  doc: CanvasExportDocument,
  localContents: BundleDirContents | undefined,
  baselines: ReactAppAssetBaselines,
  replace: boolean,
): Promise<PlannedAssets> => {
  if (!hasReactAppActors(doc)) return EMPTY_ASSET_PLAN;

  const localAssets = withDigests(localContents?.assets ?? []);
  const listed = await listAllAssets(client, ctx);
  const serverAssets = await resolveMissingDigests(
    client,
    ctx,
    listed,
    digestsNeeded({ doc, localAssets, baselines, serverAssets: listed }),
    (message) => process.stderr.write(`${message}\n`),
  );

  const plan = planReactAppAssetPull({ doc, localAssets, baselines, serverAssets, replace });
  for (const warning of plan.warnings) process.stderr.write(`Warning: ${warning}\n`);

  const count = (kind: PullAssetPlan['actions'][number]['kind']): number =>
    plan.actions.filter((action) => action.kind === kind).length;
  return {
    plan,
    serverAssets,
    summary: {
      download: count('download'),
      unchanged: count('unchanged'),
      keepLocal: count('keep-local'),
      delete: count('delete-local'),
      skip: count('skip'),
      conflict: plan.conflicts.length,
    },
  };
};

/**
 * Runs the transfers, then rewrites canvas.yaml with the baselines they produced. The text files
 * land first so the project directories exist, and the baselines record what actually synced.
 */
const applyAssets = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  target: string,
  assets: PlannedAssets,
  doc: CanvasExportDocument,
  disassembleOpts: DisassembleOptions,
): Promise<SyncedAsset[]> => {
  if (assets.plan.actions.length === 0) return [];

  const result = await applyAssetPull(client, ctx, assets.plan, target, assets.serverAssets, (message) =>
    process.stderr.write(`${message}\n`));

  const refreshed = disassemble(doc, { ...disassembleOpts, reactAppAssets: baselinesFrom(result.synced) }).files;
  fs.writeFileSync(path.join(target, ROOT_FILE), refreshed[ROOT_FILE], 'utf-8');
  return result.synced;
};

const assetSuffix = (synced: SyncedAsset[]): string =>
  synced.length > 0 ? `, ${synced.length} asset(s) in sync` : '';

const reportAssetPlan = (plan: PullAssetPlan): void => {
  for (const action of plan.actions) {
    if (action.kind === 'unchanged' || action.kind === 'keep-local') continue;
    process.stderr.write(`  asset ${action.kind}: ${action.projectPath}\n`);
  }
};

const reportAssetConflicts = (conflicts: PullAssetPlan['conflicts']): void => {
  process.stderr.write(`Pull aborted: ${conflicts.length} asset conflict(s) have both local and server changes. No files were written. Reconcile them manually, or re-run with --replace to accept the server versions.\n`);
  for (const conflict of conflicts) {
    if (conflict.kind !== 'conflict') continue;
    process.stderr.write(`  ${conflict.projectPath} (asset '${conflict.key}'): ${conflict.detail}\n`);
  }
};

const reportPullWarnings = (warnings: string[], exportErrors: unknown[]): void => {
  for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
  if (exportErrors.length > 0) {
    process.stderr.write(`Warning: export reported ${exportErrors.length} actor error(s) - see exportErrors in canvas.yaml.\n`);
  }
};

const reportPullConflicts = (conflicts: { actorId: string; name: string; verdict: string; bundleVersion?: number; serverVersion?: number }[]): void => {
  process.stderr.write(`Pull aborted: ${conflicts.length} actor conflict(s) have both local and server changes. No files were written. Reconcile them manually, or re-run with --replace to accept the server versions.\n`);
  for (const conflict of conflicts) {
    process.stderr.write(
      `  ${conflict.actorId} (${conflict.name}): ${conflict.verdict}; bundle editVersion ${String(conflict.bundleVersion ?? 'missing')} -> server editVersion ${String(conflict.serverVersion ?? 'missing')}\n`,
    );
  }
};

const actorCount = (files: Record<string, string>): number =>
  Object.keys(files).filter((path) => path.endsWith('/actor.yaml')).length;

const isBundleDir = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'canvas.yaml'));

const assembleLocalBundle = (dir: string, contents: BundleDirContents) => {
  try {
    return assembleBundle(contents.files);
  } catch (error) {
    if (error instanceof BundleValidationError) {
      reportIssues(error.errors, error.warnings);
      throw new CliUsageError(`Cannot sync-pull into ${dir} because the local bundle is invalid. Fix it or run pull with --replace.`);
    }
    throw error;
  }
};
