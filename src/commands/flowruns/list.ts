import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

interface FlowrunsListOptions extends ListOptionFlags {
  canvasId: string;
}

export const flowrunsList = async (options: FlowrunsListOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await collectAllPages(options, (params) =>
      client.listFlowruns(ctx.org, ctx.workspace, options.canvasId, params),
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
