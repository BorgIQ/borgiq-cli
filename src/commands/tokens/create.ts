import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const tokensCreate = async (options: { name: string; scopes: string; expiresAt?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const scopes = options.scopes.split(',').map((s) => s.trim());

    const token = await client.createToken({
      name: options.name,
      scopes,
      expiresAt: options.expiresAt,
    });

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`\nToken created: ${token.name}\n`);
      process.stderr.write(`\nIMPORTANT: Copy your token now. It will not be shown again.\n\n`);
    }

    output(token, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
