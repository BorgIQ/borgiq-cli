import fs from 'node:fs';
import path from 'node:path';

import { assembleBundle, BundleValidationError } from '../../lib/bundle/assemble.js';
import { diffCanvas, mergeForPull, summarizeDiff } from '../../lib/bundle/diff.js';
import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { planBundleDirIncrementalWrite, readBundleDir, writeBundleDir, writeBundleDirIncremental } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { BUNDLE_COMPANIONS, reportIssues } from './shared.js';

export const bundlePull = async (
  canvasSlugOrId: string,
  dir: string | undefined,
  options: { force?: boolean; replace?: boolean; dryRun?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const envelope = await client.exportCanvas(ctx.org, ctx.workspace, canvasSlugOrId);
    const input = parseExportInput(JSON.stringify(envelope));

    const slug = typeof input.document.metadata.slug === 'string' && input.document.metadata.slug.length > 0
      ? input.document.metadata.slug
      : canvasSlugOrId;
    const target = dir ?? `./${slug}.borgiq-canvas`;

    const { files, warnings } = disassemble(input.document, { exportErrors: input.exportErrors });
    const shouldReplace = options.replace || !isBundleDir(target);
    if (shouldReplace) {
      if (options.dryRun) {
        const plan = { mode: 'replace', target, actorCount: actorCount(files), write: Object.keys(files).sort() };
        if (!globalOpts.json && process.stderr.isTTY) {
          process.stderr.write(`Dry run: would pull '${slug}' (${plan.actorCount} actor(s)) into ${target}${options.replace ? ' with full replace' : ''}.\n`);
        }
        output(plan, globalOpts);
        return;
      }

      writeBundleDir(target, files, { force: options.force, createIfMissing: BUNDLE_COMPANIONS });
      for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
      if (input.exportErrors.length > 0) {
        process.stderr.write(`Warning: export reported ${input.exportErrors.length} actor error(s) - see exportErrors in canvas.yaml.\n`);
      }
      process.stderr.write(`Pulled '${slug}' (${actorCount(files)} actor(s)) into ${target}${options.replace ? ' (replace)' : ''}\n`);
      return;
    }

    const local = assembleLocalBundle(target);
    const diff = diffCanvas(local, input.document);
    const merged = mergeForPull(local, input.document, diff);
    const mergedDisassembly = disassemble(merged, { exportErrors: input.exportErrors });
    const mergedFiles = mergedDisassembly.files;
    const writePlan = planBundleDirIncrementalWrite(target, mergedFiles);
    const summary = summarizeDiff(diff);

    if (options.dryRun) {
      if (!globalOpts.json && process.stderr.isTTY) {
        process.stderr.write(`Dry run: would sync '${slug}' into ${target}: ${writePlan.write.length} file(s) changed, ${writePlan.delete.length} file(s) deleted.\n`);
      }
      output({ mode: 'sync', target, summary, entries: diff.entries, writePlan }, globalOpts);
      return;
    }

    writeBundleDirIncremental(target, mergedFiles, { force: options.force, createIfMissing: BUNDLE_COMPANIONS });

    for (const warning of mergedDisassembly.warnings) process.stderr.write(`Warning: ${warning}\n`);
    if (input.exportErrors.length > 0) {
      process.stderr.write(`Warning: export reported ${input.exportErrors.length} actor error(s) - see exportErrors in canvas.yaml.\n`);
    }
    process.stderr.write(`Synced '${slug}' into ${target}: ${writePlan.write.length} file(s) changed, ${writePlan.delete.length} file(s) deleted; kept ${summary.localKept} local actor(s).\n`);
  } catch (error) {
    handleError(error);
  }
};

const actorCount = (files: Record<string, string>): number =>
  Object.keys(files).filter((path) => path.endsWith('/actor.yaml')).length;

const isBundleDir = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'canvas.yaml'));

const assembleLocalBundle = (dir: string) => {
  try {
    return assembleBundle(readBundleDir(dir)).doc;
  } catch (error) {
    if (error instanceof BundleValidationError) {
      reportIssues(error.errors, error.warnings);
      throw new CliUsageError(`Cannot sync-pull into ${dir} because the local bundle is invalid. Fix it or run pull with --replace.`);
    }
    throw error;
  }
};
