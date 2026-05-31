import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { promptRequired } from '../../lib/prompt.js';

export const tokensCreate = async (options: { name?: string; scopes?: string; expiresAt?: string }, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);
    const isTty = process.stdin.isTTY;

    const name = options.name || (isTty ? await promptRequired('Token name') : undefined);
    if (!name) throw new CliUsageError('--name is required when not running interactively.');

    const scopesRaw = options.scopes || (isTty ? await promptRequired('Scopes (comma-separated)') : undefined);
    if (!scopesRaw) throw new CliUsageError('--scopes is required when not running interactively.');
    const scopes = scopesRaw.split(',').map((s) => s.trim());

    const token = await client.createToken({
      name,
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
