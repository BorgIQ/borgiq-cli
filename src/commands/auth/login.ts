import readline from 'node:readline';

import { saveConfig } from '../../config/index.js';
import type { CliConfig } from '../../config/index.js';
import { BorgIQClient } from '../../client/index.js';
import { handleError } from '../../lib/errors.js';

const DEFAULT_API_URL = 'https://api.borgiq.com/v1';

const prompt = (question: string, defaultValue?: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
};

export const authLogin = async (options: { apiUrl?: string; token?: string }): Promise<void> => {
  try {
    // Resolve API URL
    let apiUrl = options.apiUrl || process.env.BORGIQ_API_URL;
    if (!apiUrl) {
      if (process.stdin.isTTY) {
        apiUrl = await prompt('API URL', DEFAULT_API_URL);
      } else {
        apiUrl = DEFAULT_API_URL;
      }
    }

    // Resolve token
    let apiToken = options.token || process.env.BORGIQ_API_TOKEN;
    if (!apiToken) {
      if (process.stdin.isTTY) {
        apiToken = await prompt('API Token (biq_...)');
      }
      if (!apiToken) {
        process.stderr.write('Error: API token is required. Use --token or provide interactively.\n');
        process.exit(1);
      }
    }

    // Validate token format
    if (!apiToken.startsWith('biq_')) {
      process.stderr.write('Error: Invalid token format. BorgIQ tokens start with "biq_".\n');
      process.exit(1);
    }

    // Validate by calling the API
    process.stderr.write('Validating credentials...\n');
    const client = new BorgIQClient(apiUrl, apiToken);
    const profile = await client.getProfile();

    process.stderr.write(`Authenticated as: ${profile.name} (${profile.email})\n`);

    // Try to get orgs and workspaces for defaults
    const config: CliConfig = { apiUrl, apiToken };

    try {
      const orgsAndWorkspaces = await client.getOrgsAndWorkspaces();
      if (orgsAndWorkspaces.length === 1) {
        const org = orgsAndWorkspaces[0];
        config.defaultOrg = org.slug;
        process.stderr.write(`Default org: ${org.name} (${org.slug})\n`);

        if (org.workspaces.length === 1) {
          config.defaultWorkspace = org.workspaces[0].slug;
          process.stderr.write(`Default workspace: ${org.workspaces[0].name} (${org.workspaces[0].slug})\n`);
        }
      }
    } catch {
      // Non-fatal: user can set defaults manually
    }

    saveConfig(config);
    process.stderr.write('Configuration saved.\n');
  } catch (error) {
    handleError(error);
  }
};
