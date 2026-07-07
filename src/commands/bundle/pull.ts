import { disassemble } from '../../lib/bundle/disassemble.js';
import { parseExportInput } from '../../lib/bundle/envelope.js';
import { writeBundleDir } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { BUNDLE_COMPANIONS } from './shared.js';

export const bundlePull = async (
  canvas: string,
  dir: string | undefined,
  options: { force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const envelope = await client.exportCanvas(ctx.org, ctx.workspace, canvas);
    const input = parseExportInput(JSON.stringify(envelope));

    const slug = typeof input.document.metadata.slug === 'string' && input.document.metadata.slug.length > 0
      ? input.document.metadata.slug
      : canvas;
    const target = dir ?? `./${slug}.borgiq-canvas`;

    const { files, warnings } = disassemble(input.document, { exportErrors: input.exportErrors });
    writeBundleDir(target, files, { force: options.force, createIfMissing: BUNDLE_COMPANIONS });

    for (const warning of warnings) process.stderr.write(`Warning: ${warning}\n`);
    if (input.exportErrors.length > 0) {
      process.stderr.write(`Warning: export reported ${input.exportErrors.length} actor error(s) - see exportErrors in canvas.yaml.\n`);
    }
    process.stderr.write(`Pulled '${slug}' (${actorCount(files)} actor(s)) into ${target}\n`);
  } catch (error) {
    handleError(error);
  }
};

const actorCount = (files: Record<string, string>): number =>
  Object.keys(files).filter((path) => path.endsWith('/actor.yaml')).length;
