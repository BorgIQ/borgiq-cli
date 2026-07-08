import { readBundleDir } from '../../lib/bundleFs.js';
import { applyCanvasAutoLayout, canvasSlugOrIdFromCreateResult, shouldAutoLayout } from '../../lib/canvasLayout.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { assembleOrFail } from './shared.js';

const MODES = new Set(['merge', 'insert', 'replace']);

export const bundlePush = async (
  dir: string,
  options: { canvas?: string; mode?: string; create?: boolean; strict?: boolean; autoLayout?: boolean; layoutSourceActorId?: string[] },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    if (options.create && (options.canvas || options.mode)) {
      throw new CliUsageError('--create cannot be combined with --canvas or --mode.');
    }

    const mode = options.mode ?? 'merge';
    if (!MODES.has(mode)) {
      throw new CliUsageError(`Invalid --mode '${mode}' - use merge, insert, or replace.`);
    }

    const { doc } = assembleOrFail(readBundleDir(dir), options.strict ?? false);
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

    const result = await client.importCanvasData(ctx.org, ctx.workspace, target, { canvas: doc.data, mode });
    if (!globalOpts.json && process.stderr.isTTY) {
      const applied = (result as { appliedOperations?: unknown[] })?.appliedOperations?.length ?? 0;
      const conflicts = (result as { conflicts?: unknown[] })?.conflicts?.length ?? 0;
      process.stderr.write(`Pushed ${dir} -> '${target}' (${mode} mode): ${applied} operations applied, ${conflicts} conflicts.\n`);
    }
    if (shouldAutoLayout(options)) {
      const layout = await applyCanvasAutoLayout(client, ctx.org, ctx.workspace, target, options, globalOpts);
      output({ import: result, layout }, globalOpts);
      return;
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
