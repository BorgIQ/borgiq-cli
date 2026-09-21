import type { Command } from 'commander';

import { ApiError } from '../../client/errors.js';
import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';

/**
 * Print the URL an app actor is served from - the page the web app frames, without the editor
 * around it. Made for capturing a screenshot with the user's own headless browser; this CLI does not
 * run one itself.
 *
 * The URL carries a content token that expires within minutes, so fetch it right before use.
 */
export const canvasActorsAppUrl = async (
  canvasSlugOrId: string,
  actorId: string,
  _options: unknown,
  command: Command,
): Promise<void> => {
  try {
    const globalOpts = command.optsWithGlobals() as GlobalOptions;
    const { client, ctx } = createClientWithContext(globalOpts);

    const { src } = await client.getAppTrigger(ctx.org, ctx.workspace, canvasSlugOrId, actorId);
    if (globalOpts.json) {
      output({ actorId, src }, { json: true });
    } else {
      process.stdout.write(`${src}\n`);
      // stderr, so `SRC=$(borgiq canvas-actors app-url ...)` captures only the URL.
      process.stderr.write('Short-lived: the token in this URL expires within minutes. Anyone holding it can load the app as you until then.\n');
    }
  } catch (error) {
    handleError(explainAppUrlError(error, canvasSlugOrId));
  }
};

const explainAppUrlError = (error: unknown, canvasSlugOrId: string): unknown => {
  if (!(error instanceof ApiError)) return error;
  if (error.status === 409) {
    return new ApiError(409, `${error.message} - a React app is served only once built; run \`borgiq bundle build\` on a bundle of ${canvasSlugOrId}, or Build in the editor.`, error.details);
  }
  if (error.status === 403) {
    return new ApiError(403, `${error.message} - reading an app's URL needs a token with the app:use scope.`, error.details);
  }
  return error;
};
