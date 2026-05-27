import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

interface FlowrunMessagesListOptions extends ListOptionFlags {
  canvasId: string;
  flowrunId?: string;
  actorId: string;
}

export const flowrunMessagesList = async (options: FlowrunMessagesListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const { page, pageSize, search, sortBy, sortOrder } = parseListOptions(options);
    const result = await client.listFlowrunMessages(ctx.org, ctx.workspace, {
      page, pageSize, search, sortBy, sortOrder,
      canvasId: options.canvasId,
      flowrunId: options.flowrunId,
      actorId: options.actorId,
    });

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'sourcePortId', header: 'PORT' },
        { key: 'flowrunJobId', header: 'JOB' },
        { key: 'emittedAt', header: 'EMITTED' },
      ],
      title: 'Flow Run Messages',
    });
  } catch (error) {
    handleError(error);
  }
};
