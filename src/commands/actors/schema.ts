import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const actorsSchema = async (actorType: string, options: { action?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const schema = await client.getActorSchema(actorType, options.action);
    output(schema, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
