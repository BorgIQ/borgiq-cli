import type { BatchActorOperation, BatchActorOperationsResponse } from '../../client/types.js';
import { diffCanvas, summarizeDiff, toBatchOperations } from '../../lib/bundle/diff.js';
import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { compactBatchResult, compactLayoutResult, compactOperations, withRaw } from '../../lib/bundle/output.js';
import type { CanvasExportDocument } from '../../lib/bundle/types.js';
import { readBundleDirDetailed, writeBundleDirIncremental } from '../../lib/bundleFs.js';
import type { BundleDirContents } from '../../lib/bundleFs.js';
import {
  applyAssetPush,
  baselinesFrom,
  digestsNeeded,
  hasReactAppActors,
  listAllAssets,
  patchOptionsFiles,
  planReactAppAssetPush,
  resolveMissingDigests,
  withDigests,
} from '../../lib/reactAppAssets.js';
import type { PushAssetPlan, ReactAppAssetBaselines, SyncedAsset } from '../../lib/reactAppAssets.js';
import { applyCanvasAutoLayout, canvasSlugOrIdFromCreateResult, shouldAutoLayout } from '../../lib/canvasLayout.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { assembleOrFail, bundleCompanions, reportIssues, skippedFileIssues } from './shared.js';

const MODES = new Set(['merge', 'insert', 'replace']);

export const bundlePush = async (
  dir: string,
  options: {
    canvas?: string;
    mode?: string;
    create?: boolean;
    forceLocal?: boolean;
    dryRun?: boolean;
    refresh?: boolean;
    strict?: boolean;
    autoLayout?: boolean;
    layoutSourceActorId?: string[];
    raw?: boolean;
  },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  let appliedActorOperationCount = 0;
  let metadataWasUpdated = false;
  let layoutWasApplied = false;
  let uploadedAssetCount = 0;

  try {
    if (options.create && (options.canvas || options.mode || options.forceLocal || options.dryRun || options.refresh === false)) {
      throw new CliUsageError('--create cannot be combined with --canvas, --mode, --force-local, --dry-run, or --no-refresh.');
    }

    if (options.mode !== undefined && !MODES.has(options.mode)) {
      throw new CliUsageError(`Invalid --mode '${options.mode}' - use merge, insert, or replace.`);
    }
    if (options.mode !== undefined && (options.forceLocal || options.dryRun || options.refresh === false)) {
      throw new CliUsageError('--mode uses the legacy whole-document import path and cannot be combined with --force-local, --dry-run, or --no-refresh.');
    }

    const contents = readBundleDirDetailed(dir);
    const local = assembleOrFail(contents.files, options.strict ?? false);
    const { doc } = local;
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    reportIssues([], skippedFileIssues(contents.skipped));

    if (options.mode !== undefined && hasReactAppActors(doc)) {
      process.stderr.write('Warning: --mode uses the legacy whole-document import path, which does not sync react-app assets. Push without --mode to sync them.\n');
    }

    if (options.create) {
      // Everything is new here, so the asset phase runs first and its options.files patches are
      // part of the document the canvas is created from.
      const assets = await runAssetPhase(client, ctx, doc, contents, {}, false);
      uploadedAssetCount = assets.uploaded;
      const { id: _id, imagePath: _imagePath, ...metadata } = doc.metadata;
      void _id;
      void _imagePath;
      const result = await client.createCanvasWithData(ctx.org, ctx.workspace, { ...metadata, data: doc.data });
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Canvas '${String(metadata.slug)}' created from ${dir}.\n`);
      }
      let layout: unknown;
      if (shouldAutoLayout(options)) {
        const canvasTarget = canvasSlugOrIdFromCreateResult(result, metadata);
        if (!canvasTarget) {
          throw new CliUsageError('Cannot auto-layout created canvas because no canvas slug or ID was returned. Set canvas.slug in the bundle or run `borgiq canvases layout <canvas>` manually.');
        }
        layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, canvasTarget, options, globalOpts);
      }
      output(withRaw({ mode: 'create', canvas: result, layout: compactLayoutResult(layout) }, options.raw, { canvas: result, layout }), globalOpts);
      return;
    }

    const target = options.canvas ?? (typeof doc.metadata.slug === 'string' ? doc.metadata.slug : '');
    if (!target) {
      throw new CliUsageError('No canvas target - pass --canvas <canvas> or set canvas.slug in the bundle.');
    }

    if (options.mode !== undefined) {
      const result = await client.importCanvasData(ctx.org, ctx.workspace, target, { canvas: doc.data, mode: options.mode });
      if (!globalOpts.json && process.stderr.isTTY) {
        const applied = (result as { appliedOperations?: unknown[] })?.appliedOperations?.length ?? 0;
        const conflicts = (result as { conflicts?: unknown[] })?.conflicts?.length ?? 0;
        process.stderr.write(`Pushed ${dir} -> '${target}' (${options.mode} mode): ${applied} operations applied, ${conflicts} conflicts.\n`);
      }
      const layout = shouldAutoLayout(options)
        ? await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, target, options, globalOpts)
        : undefined;
      output(withRaw({ mode: options.mode, target, import: compactBatchResult(result), layout: compactLayoutResult(layout) }, options.raw, { import: result, layout }), globalOpts);
      return;
    }

    const [serverEnvelope, canvasDetail] = await Promise.all([
      client.exportCanvas(ctx.org, ctx.workspace, target),
      client.getCanvas(ctx.org, ctx.workspace, target, true),
    ]);
    const server = parseExportInput(JSON.stringify(serverEnvelope));
    if (server.exportErrors.length > 0) {
      reportExportErrors(server.exportErrors);
      process.exitCode = ExitCode.GENERAL;
      output({ mode: 'sync', target, exportErrors: server.exportErrors, applied: false }, globalOpts);
      return;
    }
    const actorVersions = canvasDetail.actorVersions ?? {};
    const hasActors = Object.keys(doc.data.actors).length > 0;
    if (local.sync.actors === undefined && hasActors) {
      process.stderr.write('Warning: this bundle has no content-hash sync baseline. Existing actors with differing server content will fail closed. Pull first to establish sync metadata.\n');
    }

    // The asset phase runs before the actor diff: its options.files patches are part of the
    // document that gets diffed, so a patched actor simply reads as an edit and rides along in
    // the existing batch. A dry run patches too, so the diff it previews matches a real run.
    const assetPlan = await planAssets(client, ctx, doc, contents, local.sync.reactAppAssets ?? {}, Boolean(options.forceLocal));
    if (assetPlan.errors.length > 0) {
      for (const error of assetPlan.errors) process.stderr.write(`Error: ${error}\n`);
      process.exitCode = ExitCode.USAGE;
      output({ mode: 'sync', target, assetErrors: assetPlan.errors, applied: false }, globalOpts);
      return;
    }
    if (assetPlan.conflicts.length > 0) {
      reportAssetConflicts(assetPlan.conflicts);
      process.exitCode = ExitCode.CONFLICT;
      output({ mode: 'sync', target, assetConflicts: assetPlan.conflicts, applied: false }, globalOpts);
      return;
    }

    let assetsSynced: SyncedAsset[] = [];
    if (!options.dryRun) {
      // Asset notices go to stderr regardless of --json: an adopted key, or an asset left behind
      // by a removed reference, is something the user needs to see even when stdout is piped.
      const applied = await applyAssetPush(client, ctx, assetPlan, (message) => process.stderr.write(`${message}\n`));
      assetsSynced = applied.synced;
      uploadedAssetCount = applied.uploaded;
    }
    patchOptionsFiles(doc, assetPlan);

    const diff = diffCanvas(doc, server.document, {
      localActorStates: local.sync.actors,
      serverActorVersions: actorVersions,
    });
    const summary = summarizeDiff(diff, { direction: 'push', forceLocal: Boolean(options.forceLocal) });
    const operations = toBatchOperations(diff, doc, Boolean(options.forceLocal), Date.now());
    const compactOps = compactOperations(operations);

    if (diff.pushConflicts.length > 0 && !options.forceLocal) {
      reportPushConflicts(diff.pushConflicts);
      process.exitCode = ExitCode.CONFLICT;
      output(withRaw({ mode: 'sync', target, summary, entries: diff.entries, conflicts: diff.pushConflicts }, options.raw, { operations }), globalOpts);
      return;
    }

    if (options.dryRun) {
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Dry run: would sync ${dir} -> '${target}': ${operations.length} actor operation(s), metadata ${diff.metadataDelta ? 'updated' : 'unchanged'}.\n`);
        for (const action of assetPlan.actions) {
          if (action.kind === 'unchanged') continue;
          process.stderr.write(`  asset ${action.kind}: ${action.projectPath}\n`);
        }
      }
      output(withRaw({
        mode: 'sync',
        target,
        summary,
        operations: compactOps,
        metadataDelta: diff.metadataDelta,
        entries: diff.entries,
        assets: assetPlan.actions.map((action) => ({ action: action.kind, path: action.projectPath })),
      }, options.raw, { operations }), globalOpts);
      return;
    }

    let batchResult: BatchActorOperationsResponse | undefined;
    if (operations.length > 0) {
      batchResult = await client.batchActorOperations(ctx.org, ctx.workspace, target, { operations }, { strict: options.strict });
      const conflicts = batchResult.conflicts ?? [];
      if (conflicts.length > 0) {
        appliedActorOperationCount = confirmedOperationCount(operations, batchResult);
        process.stderr.write(`Push hit ${conflicts.length} server-side conflict(s); ${appliedActorOperationCount} actor operation(s) were applied and no refresh was performed. Run \`borgiq bundle pull ${target} ${dir}\` to resync before retrying.\n`);
        process.exitCode = ExitCode.CONFLICT;
        output(withRaw({ mode: 'sync', target, summary, operations: compactOps, batch: compactBatchResult(batchResult) }, options.raw, { operations, batch: batchResult }), globalOpts);
        return;
      }

      const unconfirmedActorIds = unconfirmedOperationActorIds(operations, batchResult);
      if (unconfirmedActorIds.length > 0) {
        appliedActorOperationCount = confirmedOperationCount(operations, batchResult);
        process.stderr.write(`Push stopped: the API did not confirm ${unconfirmedActorIds.length} actor operation(s); no metadata update, layout, or refresh was performed.\n`);
        for (const actorId of unconfirmedActorIds) process.stderr.write(`  ${actorId}\n`);
        process.stderr.write(`Run \`borgiq bundle pull ${target} ${dir}\` to inspect and resync the server state.\n`);
        process.exitCode = ExitCode.GENERAL;
        output(withRaw({ mode: 'sync', target, summary, operations: compactOps, batch: compactBatchResult(batchResult), unconfirmedActorIds }, options.raw, { operations, batch: batchResult }), globalOpts);
        return;
      }
      appliedActorOperationCount = operations.length;
    }

    let metadataResult: unknown;
    if (diff.metadataDelta) {
      metadataResult = await client.updateCanvas(ctx.org, ctx.workspace, target, diff.metadataDelta);
      metadataWasUpdated = true;
    }

    let layout: unknown;
    if (shouldAutoLayout(options)) {
      layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, target, options, globalOpts);
      layoutWasApplied = true;
    }

    let refresh: unknown;
    if (options.refresh !== false) {
      const [refreshEnvelope, refreshCanvasDetail] = await Promise.all([
        client.exportCanvas(ctx.org, ctx.workspace, target),
        client.getCanvas(ctx.org, ctx.workspace, target, true),
      ]);
      const refreshed = parseExportInput(JSON.stringify(refreshEnvelope));
      if (refreshed.exportErrors.length > 0) {
        process.stderr.write(`Push mutations were applied, but the refresh export reported ${refreshed.exportErrors.length} actor error(s). No local files were refreshed. Run \`borgiq bundle pull ${target} ${dir}\` after fixing the export errors.\n`);
        process.exitCode = ExitCode.GENERAL;
        output(withRaw({
          mode: 'sync',
          target,
          summary,
          operations: compactOps,
          batch: compactBatchResult(batchResult),
          refresh: { applied: false, exportErrors: refreshed.exportErrors },
        }, options.raw, { operations, batch: batchResult, metadata: metadataResult, layout, refresh: refreshed }), globalOpts);
        return;
      }
      const refreshedFiles = disassemble(refreshed.document, {
        exportErrors: refreshed.exportErrors,
        actorVersions: refreshCanvasDetail.actorVersions ?? {},
        reactAppAssets: baselinesFrom(assetsSynced),
      }).files;
      const writePlan = writeBundleDirIncremental(dir, refreshedFiles, { createIfMissing: bundleCompanions(refreshed.document) });
      refresh = { writePlan, exportErrors: refreshed.exportErrors.length };
    } else if (assetsSynced.length > 0) {
      process.stderr.write('Warning: --no-refresh skipped the local refresh, so no asset sync baselines were recorded. The next push will fail closed on those assets until you pull.\n');
    }

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Synced ${dir} -> '${target}': ${summary.added} added, ${summary.updated} updated, ${summary.removed} deleted, ${summary.deletedOnServer} deleted on server, ${summary.unchanged} unchanged${diff.metadataDelta ? ', metadata updated' : ''}.\n`);
    }
    output(withRaw({
      mode: 'sync',
      target,
      summary,
      operations: compactOps,
      metadataDelta: diff.metadataDelta,
      batch: compactBatchResult(batchResult),
      metadata: metadataResult,
      layout: compactLayoutResult(layout),
      refresh,
    }, options.raw, { operations, batch: batchResult, metadata: metadataResult, layout }), globalOpts);
  } catch (error) {
    if (appliedActorOperationCount > 0 || metadataWasUpdated || layoutWasApplied || uploadedAssetCount > 0) {
      const completed = [
        uploadedAssetCount > 0 ? `${uploadedAssetCount} asset upload(s)` : undefined,
        appliedActorOperationCount > 0 ? `${appliedActorOperationCount} actor operation(s)` : undefined,
        metadataWasUpdated ? 'canvas metadata' : undefined,
        layoutWasApplied ? 'canvas layout' : undefined,
      ].filter((value): value is string => value !== undefined);
      process.stderr.write(`Warning: push partially completed before the error (${completed.join(', ')} applied). Run \`borgiq bundle pull\` to resync local version markers before retrying.\n`);
    }
    handleError(error);
  }
};

const EMPTY_PUSH_PLAN: PushAssetPlan = { actions: [], conflicts: [], errors: [], warnings: [] };

/** Plans the asset phase, making no network call at all when the canvas has no React App actor. */
const planAssets = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  doc: CanvasExportDocument,
  contents: BundleDirContents,
  baselines: ReactAppAssetBaselines,
  forceLocal: boolean,
): Promise<PushAssetPlan> => {
  if (!hasReactAppActors(doc)) return EMPTY_PUSH_PLAN;

  const localAssets = withDigests(contents.assets);
  const listed = await listAllAssets(client, ctx);
  const serverAssets = await resolveMissingDigests(
    client,
    ctx,
    listed,
    digestsNeeded({ doc, localAssets, baselines, serverAssets: listed }),
    (message) => process.stderr.write(`${message}\n`),
  );

  const plan = planReactAppAssetPush({ doc, localAssets, baselines, serverAssets, forceLocal });
  for (const warning of plan.warnings) process.stderr.write(`Warning: ${warning}\n`);
  return plan;
};

/** Plan, upload, and patch in one step, for the --create path where everything is new. */
const runAssetPhase = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  doc: CanvasExportDocument,
  contents: BundleDirContents,
  baselines: ReactAppAssetBaselines,
  forceLocal: boolean,
): Promise<{ uploaded: number }> => {
  const plan = await planAssets(client, ctx, doc, contents, baselines, forceLocal);
  if (plan.errors.length > 0) {
    throw new CliUsageError(plan.errors.join('\n'));
  }
  const applied = await applyAssetPush(client, ctx, plan, (message) => process.stderr.write(`${message}\n`));
  patchOptionsFiles(doc, plan);
  return { uploaded: applied.uploaded };
};

const reportAssetConflicts = (conflicts: PushAssetPlan['conflicts']): void => {
  process.stderr.write(`Push aborted: ${conflicts.length} asset conflict(s) changed both locally and in the workspace. Nothing was uploaded. Re-pull, or re-run with --force-local for local wins.\n`);
  for (const conflict of conflicts) {
    if (conflict.kind !== 'conflict') continue;
    process.stderr.write(`  ${conflict.projectPath} (asset '${conflict.key}'): ${conflict.detail}\n`);
  }
};

const reportExportErrors = (errors: unknown[]): void => {
  process.stderr.write(`Push aborted: the server export reported ${errors.length} actor error(s), so the sync baseline is incomplete. Fix the export errors and retry.\n`);
  for (const error of errors) {
    const value = isRecord(error) ? error : {};
    const actorId = typeof value.actorId === 'string' ? value.actorId : 'unknown actor';
    const field = typeof value.field === 'string' ? ` ${value.field}` : '';
    const message = typeof value.error === 'string' ? `: ${value.error}` : '';
    process.stderr.write(`  ${actorId}${field}${message}\n`);
  }
};

const unconfirmedOperationActorIds = (operations: BatchActorOperation[], result: BatchActorOperationsResponse): string[] => {
  const confirmed = confirmedActorIds(result);
  return [...new Set(operations.map((operation) => operation.actorId).filter((actorId) => !confirmed.has(actorId)))].sort();
};

const confirmedOperationCount = (operations: BatchActorOperation[], result: BatchActorOperationsResponse): number => {
  const confirmed = confirmedActorIds(result);
  return new Set(operations.map((operation) => operation.actorId).filter((actorId) => confirmed.has(actorId))).size;
};

const confirmedActorIds = (result: BatchActorOperationsResponse): Set<string> => {
  const confirmed = new Set(Array.isArray(result.processed) ? result.processed.filter((value): value is string => typeof value === 'string') : []);
  const failed = new Set<string>();

  for (const operation of Array.isArray(result.appliedOperations) ? result.appliedOperations : []) {
    const value = operation as unknown as Record<string, unknown>;
    if (typeof value.actorId !== 'string') continue;
    const status = typeof value.status === 'string' ? value.status.toLowerCase() : undefined;
    if (status !== undefined && status !== 'applied' && status !== 'success') {
      failed.add(value.actorId);
      continue;
    }
    confirmed.add(value.actorId);
  }
  for (const actorId of failed) confirmed.delete(actorId);
  return confirmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const reportPushConflicts = (conflicts: { actorId: string; name: string; verdict: string; bundleVersion?: number; serverVersion?: number }[]): void => {
  process.stderr.write(`Push aborted: ${conflicts.length} actor conflict(s). Re-pull, or re-run with --force-local for local wins.\n`);
  for (const conflict of conflicts) {
    process.stderr.write(
      `  ${conflict.actorId} (${conflict.name}): ${conflict.verdict}; bundle editVersion ${String(conflict.bundleVersion ?? 'missing')} -> server editVersion ${String(conflict.serverVersion ?? 'missing')}\n`,
    );
  }
};
