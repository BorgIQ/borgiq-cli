import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';

export const tokensRevoke = async (id: string, _options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    await client.revokeToken(id);
    process.stderr.write(`Token revoked: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
