import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';
import { resolveCanvasSlugOrId, type CanvasOptionFlags } from '../../lib/canvasFlag.js';

interface FlowrunJobsListOptions extends ListOptionFlags, CanvasOptionFlags {
  actorId: string;
  flowrunId?: string;
}

export const flowrunJobsList = async (options: FlowrunJobsListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvasSlugOrId = resolveCanvasSlugOrId(options);
    const result = await collectAllPages(options, (params) =>
      client.listFlowrunJobs(ctx.org, ctx.workspace, {
        ...params,
        canvasSlugOrId,
        actorId: options.actorId,
        flowrunId: options.flowrunId,
      }),
    );

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'state', header: 'STATE' },
        { key: 'flowrunId', header: 'FLOWRUN' },
        { key: 'createdAt', header: 'CREATED' },
      ],
      title: 'Flow Run Jobs',
    });
  } catch (error) {
    handleError(error);
  }
};
