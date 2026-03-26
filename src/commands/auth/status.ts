import { loadConfig, configExists } from '../../config/index.js';
import { BorgIQClient } from '../../client/index.js';
import { handleError } from '../../lib/errors.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';

export const authStatus = async (_options: unknown, command: { parent: { opts: () => GlobalOptions } }): Promise<void> => {
  try {
    const globalOpts = command.parent.opts();

    if (!configExists() && !globalOpts.token) {
      process.stderr.write('Not logged in. Run \'borgiq auth login\' to configure.\n');
      process.exit(1);
    }

    const config = loadConfig();
    const apiUrl = globalOpts.apiUrl || process.env.BORGIQ_API_URL || config?.apiUrl;
    const apiToken = globalOpts.token || process.env.BORGIQ_API_TOKEN || config?.apiToken;

    if (!apiUrl || !apiToken) {
      process.stderr.write('Error: Missing API URL or token. Run \'borgiq auth login\'.\n');
      process.exit(1);
    }

    const client = new BorgIQClient(apiUrl, apiToken);
    const profile = await client.getProfile();

    const statusData = {
      user: profile.name,
      email: profile.email,
      apiUrl,
      tokenPrefix: apiToken.substring(0, 8) + '...',
      defaultOrg: config?.defaultOrg || '(not set)',
      defaultWorkspace: config?.defaultWorkspace || '(not set)',
    };

    if (globalOpts.json) {
      output(statusData, { json: true });
    } else {
      process.stdout.write(`\nAuthenticated as: ${profile.name} (${profile.email})\n`);
      process.stdout.write(`API URL:           ${apiUrl}\n`);
      process.stdout.write(`Token:             ${statusData.tokenPrefix}\n`);
      process.stdout.write(`Default org:       ${statusData.defaultOrg}\n`);
      process.stdout.write(`Default workspace: ${statusData.defaultWorkspace}\n\n`);
    }
  } catch (error) {
    handleError(error);
  }
};
