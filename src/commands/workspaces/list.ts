import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { loadConfig } from '../../config/index.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';
import { parseListOptions, type ListOptionFlags } from '../../lib/listOptions.js';

export const workspacesList = async (options: ListOptionFlags, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const config = loadConfig();
    const org = globalOpts.org || process.env.BORGIQ_ORG || config?.defaultOrg;

    if (!org) {
      process.stderr.write('Error: Organization is required. Use --org, set BORGIQ_ORG, or run \'borgiq auth login\' with a default org.\n');
      process.exit(1);
    }

    const client = createClient(globalOpts);
    const result = await client.listWorkspaces(org, parseListOptions(options));

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
