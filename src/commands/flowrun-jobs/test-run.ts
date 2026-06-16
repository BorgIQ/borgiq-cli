import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { resolveCanvasSlugOrId, type CanvasOptionFlags } from '../../lib/canvasFlag.js';

export const flowrunJobsTestRun = async (options: CanvasOptionFlags & { actorId: string; publish?: boolean }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // The testRun endpoint validates the body's canvasId as a ULID, so a slug is
    // not accepted here — but we still resolve through the shared --canvas flag.
    const result = await client.testRunJob(ctx.org, ctx.workspace, {
      canvasId: resolveCanvasSlugOrId(options),
      actorId: options.actorId,
      publishEmittedMessageToConnectedActors: options.publish ?? false,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write('Test run started.\n');
    }
    output(result, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
