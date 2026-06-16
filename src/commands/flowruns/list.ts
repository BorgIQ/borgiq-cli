import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';
import { resolveCanvasSlugOrId, type CanvasOptionFlags } from '../../lib/canvasFlag.js';

interface FlowrunsListOptions extends ListOptionFlags, CanvasOptionFlags {}

export const flowrunsList = async (options: FlowrunsListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const canvasSlugOrId = resolveCanvasSlugOrId(options);
    const result = await collectAllPages(options, (params) =>
      client.listFlowruns(ctx.org, ctx.workspace, canvasSlugOrId, params),
    );

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'state', header: 'STATE' },
        { key: 'canvasName', header: 'CANVAS' },
        { key: 'createdAt', header: 'CREATED' },
      ],
      title: 'Flow Runs',
    });
  } catch (error) {
    handleError(error);
  }
};
