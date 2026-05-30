import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { loadConfig } from '../../config/index.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { collectAllPages, type ListOptionFlags } from '../../lib/listOptions.js';

export const workspacesList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const config = loadConfig();
    const org = globalOpts.org || process.env.BORGIQ_ORG || config?.defaultOrg;

    if (!org) {
      throw new CliUsageError(
        "Organization is required. Use --org, set BORGIQ_ORG, or run 'borgiq auth login' with a default org.",
      );
    }

    const client = createClient(globalOpts);
    const result = await collectAllPages(options, (params) => client.listWorkspaces(org, params));

    output(result, globalOpts, {
      columns: [
        { key: 'slug', header: 'SLUG' },
        { key: 'name', header: 'NAME' },
        { key: 'description', header: 'DESCRIPTION' },
      ],
      title: 'Workspaces',
    });
  } catch (error) {
    handleError(error);
  }
};
