import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';
import { resolveCanvasSlugOrId, type CanvasOptionFlags } from '../../lib/canvasFlag.js';

interface FlowrunMessagesListOptions extends ListOptionFlags, CanvasOptionFlags {
  flowrunId?: string;
  actorId: string;
}

export const flowrunMessagesList = async (options: FlowrunMessagesListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvasSlugOrId = resolveCanvasSlugOrId(options);
    const result = await collectAllPages(options, (params) =>
      client.listFlowrunMessages(ctx.org, ctx.workspace, {
        ...params,
        canvasSlugOrId,
        flowrunId: options.flowrunId,
        actorId: options.actorId,
      }),
    );

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
