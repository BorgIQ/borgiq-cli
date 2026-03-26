import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';

export const flowrunsInterrupt = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await client.interruptFlowrun(ctx.org, ctx.workspace, id);
    process.stderr.write(`Flow run interrupted: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
