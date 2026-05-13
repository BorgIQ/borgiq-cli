import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';

interface HandoffUrlOptions {
  redirect?: string;
}

/**
 * Print a one-time URL that, when loaded by a headless browser, exchanges itself
 * for a 15-minute borgiq_auth_session cookie on the borgiq web app and 302s to
 * the requested target path. Designed to be piped into the user's own Playwright /
 * Puppeteer / curl script — this CLI does not run a browser itself.
 *
 * The minted URL is valid for ~60 seconds and is single-use. Treat it like a
 * password: don't echo to shared logs or shell history.
 */
export const authHandoffUrl = async (options: HandoffUrlOptions, command: { parent: { opts: () => GlobalOptions } }): Promise<void> => {
  try {
    const globalOpts = command.parent.opts();
    const client = createClient(globalOpts);
    const { url, expiresAt } = await client.createSessionHandoff(options.redirect);
    if (globalOpts.json) {
      output({ url, expiresAt }, { json: true });
    } else {
      process.stdout.write(`${url}\n`);
      // Warning goes to stderr so `URL=$(borgiq auth handoff-url ...)` captures only the
      // URL on stdout while the warning still appears in the user's terminal.
      process.stderr.write('Sensitive — do not share this URL with other users. It can be used once to log in as you.\n');
    }
  } catch (error) {
    handleError(error);
  }
};
