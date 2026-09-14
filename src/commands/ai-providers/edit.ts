import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { catalogOf, mergeCatalog, parseCatalogFlags, resolveAiProvider, resolveConnectionId, splitIds } from './shared.js';

interface EditOptions {
  name?: string;
  connection?: string | false;
  models?: string;
  modelsFile?: string;
  addModel?: string[];
  removeModel?: string[];
  dataFile?: string;
}

export const aiProvidersEdit = async (idOrName: string, options: EditOptions, command: { parent: { parent: { opts: () => GlobalOptions } } }): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);

    // The PUT contract requires the connection field, so fetch the current row and resend what
    // is unchanged (a full replacement, not a patch).
    const current = await resolveAiProvider(client, ctx, idOrName);

    let connectionId: string | null | undefined = current.connectionId ?? null;
    if (options.connection === false) {
      connectionId = null;
    } else if (typeof options.connection === 'string') {
      connectionId = await resolveConnectionId(client, ctx, options.connection);
    }

    const catalogEdit = options.models !== undefined || options.modelsFile || options.addModel?.length || options.removeModel?.length;
    if (options.dataFile && catalogEdit) {
      throw new CliUsageError('--data-file replaces the whole data object; do not combine it with the model flags.');
    }

    let data: unknown | undefined;
    if (options.dataFile) {
      data = await readInput(options.dataFile);
    } else if (catalogEdit) {
      const replace = await parseCatalogFlags(options);
      const currentData = (current.data && typeof current.data === 'object' && !Array.isArray(current.data)) ? current.data as Record<string, unknown> : {};
      data = {
        ...currentData,
        models: mergeCatalog(catalogOf(current), { replace, add: splitIds(options.addModel), remove: splitIds(options.removeModel) }),
      };
    }

    const form = new FormData();
    if (options.name !== undefined) form.append('name', options.name);
    form.append('connectionId', connectionId ?? '');
    if (data !== undefined) form.append('data', JSON.stringify(data));

    const setting = await client.updateAiSettingMultipart(ctx.org, ctx.workspace, current.id, form);

    if (!globalOpts.json && process.stderr.isTTY) {
      process.stderr.write(`AI provider updated: ${setting.name} (${setting.id})\n`);
    }
    output(setting, globalOpts);
  } catch (error) {
    handleError(error);
  }
};
