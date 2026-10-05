import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import type { JobResultDataRootPath } from '../../client/types.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const flowrunResultsData = async (resultId: string, options: { rootPath: JobResultDataRootPath }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const result = await client.getJobResultData(ctx.org, ctx.workspace, resultId, options.rootPath);
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
