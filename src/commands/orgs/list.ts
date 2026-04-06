import { createClient } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError } from '../../lib/errors.js';

export const orgsList = async (_options: unknown, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const client = createClient(globalOpts);

    const orgsAndWorkspaces = await client.getOrgsAndWorkspaces();

    // Flatten for table display
    const rows = Object.values(orgsAndWorkspaces).map((org) => ({
      ...org,
      workspaceCount: org.workspaces.length,
    }));

    output(globalOpts.json ? orgsAndWorkspaces : rows, globalOpts, {
      columns: [
        { key: 'slug', header: 'SLUG' },
        { key: 'name', header: 'NAME' },
        { key: 'role', header: 'ROLE' },
        { key: 'workspaceCount', header: 'WORKSPACES' },
      ],
      title: 'Organizations',
    });
  } catch (error) {
    handleError(error);
  }
};
