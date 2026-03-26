import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const actorsList = async (_options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const actors = await client.listActors();

    output(actors, globalOpts, {
      columns: [
        { key: 'type', header: 'TYPE' },
        { key: 'name', header: 'NAME' },
        { key: 'category', header: 'CATEGORY' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Actor Types',
    });
  } catch (error) {
    handleError(error);
  }
};
