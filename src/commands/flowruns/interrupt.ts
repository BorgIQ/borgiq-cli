import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';

export const flowrunsInterrupt = async (
  id: string,
  options: { yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    await confirmDestructive(`Interrupt flow run ${id}? This stops it mid-execution.`, options);
    await client.interruptFlowrun(ctx.org, ctx.workspace, id);
    process.stderr.write(`Flow run interrupted: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
