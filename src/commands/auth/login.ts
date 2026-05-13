import type { Command } from 'commander';

import { saveConfig } from '../../config/index.js';
import type { CliConfig } from '../../config/index.js';
import { BorgIQClient } from '../../client/index.js';
import type { BIQUserAccessibleWorkspaceInfo, BIQUserWorkspaceAccessInfo } from '../../client/types.js';
import { handleError } from '../../lib/errors.js';
import { prompt } from '../../lib/prompt.js';
import { deriveWebUrlFromApiUrl } from '../../lib/webUrl.js';

const DEFAULT_API_URL = 'https://api.borgiq.com/v1';
const DEFAULT_WEB_URL = 'https://app.borgiq.com';

interface LoginOptions {
  apiUrl?: string;
  token?: string;
  webUrl?: string;
  org?: string;
  workspace?: string;
}

export const authLogin = async (_options: LoginOptions, command: Command): Promise<void> => {
  try {
    // optsWithGlobals merges this command's opts with every ancestor command's
    // opts, so flags passed at any level (e.g. `borgiq --token X auth login`)
    // are seen here. command.parent is `auth` (no flags) — that's why
    // `command.parent.opts()` alone misses program-level globals.
    const opts = command.optsWithGlobals() as LoginOptions;
    const apiUrlFlag = opts.apiUrl;
    const tokenFlag = opts.token;
    const webUrlFlag = opts.webUrl;
    const orgFlag = opts.org;
    const workspaceFlag = opts.workspace;

    // Resolve API URL
    let apiUrl = apiUrlFlag || process.env.BORGIQ_API_URL;
    if (!apiUrl) {
      if (process.stdin.isTTY) {
        apiUrl = await prompt('API URL', DEFAULT_API_URL);
      } else {
        apiUrl = DEFAULT_API_URL;
      }
    }

    // Resolve token
    let apiToken = tokenFlag || process.env.BORGIQ_API_TOKEN;
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

    // Resolve web app URL (used for OAuth2 handoff). Resolved before
    // credential verification so users pick all their endpoints up front.
    const derivedWebUrl = deriveWebUrlFromApiUrl(apiUrl) || DEFAULT_WEB_URL;
    let webUrl = webUrlFlag || process.env.BORGIQ_WEB_URL;
    if (!webUrl) {
      if (process.stdin.isTTY) {
        webUrl = await prompt('Web app URL (used for OAuth2 handoff)', derivedWebUrl);
      } else {
        webUrl = derivedWebUrl;
      }
    }

    // Validate by calling the API
    process.stderr.write('Validating credentials...\n');
    const client = new BorgIQClient(apiUrl, apiToken);
    const profile = await client.getProfile();

    process.stderr.write(`Authenticated as: ${profile.name} (${profile.email})\n`);

    const config: CliConfig = { apiUrl, apiToken };
    if (webUrl && webUrl !== derivedWebUrl) {
      config.webUrl = webUrl;
    }

    try {
      const orgsAndWorkspaces = await client.getOrgsAndWorkspaces();
      const orgs = Object.values(orgsAndWorkspaces);

      let resolvedOrg: BIQUserAccessibleWorkspaceInfo | undefined;
      if (orgFlag) {
        resolvedOrg = orgs.find((o) => o.slug === orgFlag || o.id === orgFlag);
        if (!resolvedOrg) {
          const available = orgs.map((o) => o.slug).join(', ') || '(none)';
          process.stderr.write(`Error: Organization "${orgFlag}" not found. Available: ${available}\n`);
          process.exit(1);
        }
      } else if (orgs.length === 1) {
        resolvedOrg = orgs[0];
      }

      if (resolvedOrg) {
        config.defaultOrg = resolvedOrg.slug;
        process.stderr.write(`Default org: ${resolvedOrg.name} (${resolvedOrg.slug})\n`);

        let resolvedWorkspace: BIQUserWorkspaceAccessInfo | undefined;
        if (workspaceFlag) {
          resolvedWorkspace = resolvedOrg.workspaces.find(
            (w) => w.slug === workspaceFlag || w.id === workspaceFlag
          );
          if (!resolvedWorkspace) {
            const available = resolvedOrg.workspaces.map((w) => w.slug).join(', ') || '(none)';
            process.stderr.write(
              `Error: Workspace "${workspaceFlag}" not found in org "${resolvedOrg.slug}". Available: ${available}\n`
            );
            process.exit(1);
          }
        } else if (resolvedOrg.workspaces.length === 1) {
          resolvedWorkspace = resolvedOrg.workspaces[0];
        }

        if (resolvedWorkspace) {
          config.defaultWorkspace = resolvedWorkspace.slug;
          process.stderr.write(`Default workspace: ${resolvedWorkspace.name} (${resolvedWorkspace.slug})\n`);
        }
      } else if (workspaceFlag) {
        // Workspace specified but no org to anchor it.
        process.stderr.write(
          'Error: --workspace requires --org (or a single accessible org).\n'
        );
        process.exit(1);
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
