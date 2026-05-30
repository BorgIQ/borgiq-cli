import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';

export const tokensRevoke = async (
  id: string,
  options: { yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    await confirmDestructive(`Revoke token ${id}? Applications using it will stop working.`, options);
    await client.revokeToken(id);
    process.stderr.write(`Token revoked: ${id}\n`);
  } catch (error) {
    handleError(error);
  }
};
