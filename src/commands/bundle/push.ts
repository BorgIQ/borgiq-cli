import { diffCanvas, summarizeDiff, toBatchOperations } from '../../lib/bundle/diff.js';
import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { compactBatchResult, compactLayoutResult, compactOperations, withRaw } from '../../lib/bundle/output.js';
import { readBundleDir } from '../../lib/bundleFs.js';
import { writeBundleDirIncremental } from '../../lib/bundleFs.js';
import { applyCanvasAutoLayout, canvasSlugOrIdFromCreateResult, shouldAutoLayout } from '../../lib/canvasLayout.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { assembleOrFail, BUNDLE_COMPANIONS } from './shared.js';

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

    const local = assembleOrFail(readBundleDir(dir), options.strict ?? false);
    const { doc } = local;
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    if (options.create) {
      const { id: _id, imagePath: _imagePath, ...metadata } = doc.metadata;
      void _id;
      void _imagePath;
      const result = await client.createCanvasWithData(ctx.org, ctx.workspace, { ...metadata, data: doc.data });
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Canvas '${String(metadata.slug)}' created from ${dir}.\n`);
      }
      if (shouldAutoLayout(options)) {
        const canvasTarget = canvasSlugOrIdFromCreateResult(result, metadata);
        if (!canvasTarget) {
          throw new CliUsageError('Cannot auto-layout created canvas because no canvas slug or ID was returned. Set canvas.slug in the bundle or run `borgiq canvases layout <canvas>` manually.');
        }
        const layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, canvasTarget, options, globalOpts);
        output({ canvas: result, layout }, globalOpts);
        return;
      }
      output(result, globalOpts);
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
      if (shouldAutoLayout(options)) {
        const layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, target, options, globalOpts);
        output({ import: result, layout }, globalOpts);
        return;
      }
      output(result, globalOpts);
      return;
    }

    const [serverEnvelope, canvasDetail] = await Promise.all([
      client.exportCanvas(ctx.org, ctx.workspace, target),
      client.getCanvas(ctx.org, ctx.workspace, target, true),
    ]);
    const server = parseExportInput(JSON.stringify(serverEnvelope));
    const actorVersions = canvasDetail.actorVersions ?? {};
    const diff = diffCanvas(doc, server.document, {
      localActorVersions: local.sync.actorVersions,
      serverActorVersions: actorVersions,
      assumeServerVersionsWhenLocalMissing: true,
    });
    const summary = summarizeDiff(diff);
    const operations = toBatchOperations(diff, doc, Boolean(options.forceLocal), Date.now());
    const compactOps = compactOperations(operations);

    if (diff.conflicts.length > 0 && !options.forceLocal) {
      reportPushConflicts(diff.conflicts);
      process.exitCode = ExitCode.CONFLICT;
      output(withRaw({ mode: 'sync', target, summary, entries: diff.entries, conflicts: diff.conflicts }, options.raw, { operations }), globalOpts);
      return;
    }

    if (options.dryRun) {
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Dry run: would sync ${dir} -> '${target}': ${operations.length} actor operation(s), metadata ${diff.metadataDelta ? 'updated' : 'unchanged'}.\n`);
      }
      output(withRaw({ mode: 'sync', target, summary, operations: compactOps, metadataDelta: diff.metadataDelta, entries: diff.entries }, options.raw, { operations }), globalOpts);
      return;
    }

    let batchResult: unknown;
    if (operations.length > 0) {
      batchResult = await client.batchActorOperations(ctx.org, ctx.workspace, target, { operations });
      const conflicts = (batchResult as { conflicts?: unknown[] })?.conflicts ?? [];
      if (conflicts.length > 0) {
        process.stderr.write(`Push hit ${conflicts.length} server-side conflict(s); no refresh was performed.\n`);
        process.exitCode = ExitCode.CONFLICT;
        output(withRaw({ mode: 'sync', target, summary, operations: compactOps, batch: compactBatchResult(batchResult) }, options.raw, { operations, batch: batchResult }), globalOpts);
        return;
      }
    }

    let metadataResult: unknown;
    if (diff.metadataDelta) {
      metadataResult = await client.updateCanvas(ctx.org, ctx.workspace, target, diff.metadataDelta);
    }

    let layout: unknown;
    if (shouldAutoLayout(options)) {
      layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, target, options, globalOpts);
    }

    let refresh: unknown;
    if (options.refresh !== false) {
      const [refreshEnvelope, refreshCanvasDetail] = await Promise.all([
        client.exportCanvas(ctx.org, ctx.workspace, target),
        client.getCanvas(ctx.org, ctx.workspace, target, true),
      ]);
      const refreshed = parseExportInput(JSON.stringify(refreshEnvelope));
      const refreshedFiles = disassemble(refreshed.document, {
        exportErrors: refreshed.exportErrors,
        actorVersions: refreshCanvasDetail.actorVersions ?? {},
      }).files;
      const writePlan = writeBundleDirIncremental(dir, refreshedFiles, { createIfMissing: BUNDLE_COMPANIONS });
      refresh = { writePlan, exportErrors: refreshed.exportErrors.length };
    }

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`Synced ${dir} -> '${target}': ${summary.added} added, ${summary.updated} updated, ${summary.removed} deleted, ${summary.unchanged} unchanged${diff.metadataDelta ? ', metadata updated' : ''}.\n`);
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
    handleError(error);
  }
};

const reportPushConflicts = (conflicts: { actorId: string; name: string; bundleVersion?: number; serverVersion?: number }[]): void => {
  process.stderr.write(`Push aborted: ${conflicts.length} actor conflict(s). Re-pull, or re-run with --force-local for local wins.\n`);
  for (const conflict of conflicts) {
    process.stderr.write(
      `  ${conflict.actorId} (${conflict.name}): bundle editVersion ${String(conflict.bundleVersion ?? 'missing')} -> server editVersion ${String(conflict.serverVersion ?? 'missing')}\n`,
    );
  }
};
