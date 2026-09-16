import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { handleError } from '../../lib/errors.js';
import { confirmDestructive } from '../../lib/prompt.js';
import { resolveAiProvider, warnAboutReferences } from './shared.js';

export const aiProvidersDelete = async (
  idOrName: string,
  options: { yes?: boolean; force?: boolean },
  command: { parent: { parent: { opts: () => GlobalOptions } } },
): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    const setting = await resolveAiProvider(client, ctx, idOrName);
    await warnAboutReferences(client, ctx, setting.id, 'delete');
    await confirmDestructive(`Delete AI provider ${setting.name} (${setting.id})? Actors referencing its models will fail until reconfigured. This cannot be undone.`, options);
    await client.deleteAiSetting(ctx.org, ctx.workspace, setting.id);
    process.stderr.write(`AI provider deleted: ${setting.name} (${setting.id})\n`);
  } catch (error) {
    handleError(error);
  }
};
