import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

export const tokensList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const result = await client.listTokens(parseListOptions(options));

    output(result, globalOpts, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'tokenPrefix', header: 'PREFIX' },
        { key: 'createdAt', header: 'CREATED' },
        { key: 'lastUsedAt', header: 'LAST USED' },
        { key: 'revokedAt', header: 'REVOKED' },
      ],
      title: 'API Tokens',
    });
  } catch (error) {
    handleError(error);
  }
};
