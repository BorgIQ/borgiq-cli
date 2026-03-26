import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { readJsonInput } from '../../lib/input.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const canvasesPatchActors = async (id: string, options: { file?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const body = await readJsonInput(options.file);
    const result = await client.patchActors(ctx.org, ctx.workspace, id, body);

    if (!globalOpts.json && process.stderr.isTTY) {
      const applied = result.appliedOperations?.length ?? 0;
      const conflicts = result.conflicts?.length ?? 0;
      process.stderr.write(`Patch applied: ${applied} operations, ${conflicts} conflicts.\n`);
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
