import type { Command } from 'commander';

import { loadConfig, saveConfig } from '../../config/index.js';
import type { CliConfig } from '../../config/index.js';
import type { BIQUserAccessibleWorkspaceInfo, BIQUserWorkspaceAccessInfo } from '../../client/types.js';
import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { promptChoice } from '../../lib/prompt.js';

interface SelectOptions {
  apiUrl?: string;
  token?: string;
  org?: string;
  workspace?: string;
}

export const authSelect = async (_options: SelectOptions, command: Command): Promise<void> => {
  try {
    const opts = command.optsWithGlobals() as SelectOptions;
    const orgFlag = opts.org;
    const workspaceFlag = opts.workspace;

    if (!orgFlag && !process.stdin.isTTY) {
      process.stderr.write('Error: --org is required in non-interactive mode.\n');
      process.exit(1);
    }

    const existing = loadConfig();
    if (!existing) {
      process.stderr.write("Error: No saved config. Run 'borgiq auth login' first.\n");
      process.exit(1);
    }

    const client = createClient(opts as GlobalOptions);
    const orgsAndWorkspaces = await client.getOrgsAndWorkspaces();
    const orgs = Object.values(orgsAndWorkspaces);
    if (orgs.length === 0) {
      process.stderr.write('Error: No organizations accessible with these credentials.\n');
      process.exit(1);
    }

    let resolvedOrg: BIQUserAccessibleWorkspaceInfo;
    if (orgFlag) {
      const found = orgs.find((o) => o.slug === orgFlag || o.id === orgFlag);
      if (!found) {
        const available = orgs.map((o) => o.slug).join(', ');
        process.stderr.write(`Error: Organization "${orgFlag}" not found. Available: ${available}\n`);
        process.exit(1);
      }
      resolvedOrg = found;
    } else {
      const orgSlug = await promptChoice(
        'Select organization:',
        orgs.map((o) => ({ label: `${o.name} (${o.slug})`, value: o.slug }))
      );
      resolvedOrg = orgs.find((o) => o.slug === orgSlug) as BIQUserAccessibleWorkspaceInfo;
    }

    let resolvedWorkspace: BIQUserWorkspaceAccessInfo | undefined;
    if (workspaceFlag) {
      const found = resolvedOrg.workspaces.find(
        (w) => w.slug === workspaceFlag || w.id === workspaceFlag
      );
      if (!found) {
        const available = resolvedOrg.workspaces.map((w) => w.slug).join(', ') || '(none)';
        process.stderr.write(
          `Error: Workspace "${workspaceFlag}" not found in org "${resolvedOrg.slug}". Available: ${available}\n`
        );
        process.exit(1);
      }
      resolvedWorkspace = found;
    } else if (!orgFlag && resolvedOrg.workspaces.length > 0) {
      // Interactive entry point (no --org) — also prompt for workspace.
      const NONE = '__none__';
      const choice = await promptChoice('Select workspace:', [
        ...resolvedOrg.workspaces.map((w) => ({ label: `${w.name} (${w.slug})`, value: w.slug })),
        { label: '(none — clear default workspace)', value: NONE },
      ]);
      if (choice !== NONE) {
        resolvedWorkspace = resolvedOrg.workspaces.find((w) => w.slug === choice);
      }
    } else if (resolvedOrg.workspaces.length === 1) {
      // --org passed without --workspace, and the org has exactly one workspace.
      resolvedWorkspace = resolvedOrg.workspaces[0];
    }

    const next: CliConfig = { ...existing, defaultOrg: resolvedOrg.slug };
    if (resolvedWorkspace) {
      next.defaultWorkspace = resolvedWorkspace.slug;
    } else {
      delete next.defaultWorkspace;
    }
    saveConfig(next);

    process.stderr.write(`Default org: ${resolvedOrg.name} (${resolvedOrg.slug})\n`);
    if (resolvedWorkspace) {
      process.stderr.write(`Default workspace: ${resolvedWorkspace.name} (${resolvedWorkspace.slug})\n`);
    } else {
      process.stderr.write('Default workspace: (none)\n');
    }
    process.stderr.write('Configuration saved.\n');
  } catch (error) {
    handleError(error);
  }
};
