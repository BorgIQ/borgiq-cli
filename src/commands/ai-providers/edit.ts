import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import { catalogOf, mergeCatalog, parseCatalogFlags, resolveAiProvider, resolveConnectionId, splitIds, validateBaseUrl } from './shared.js';

interface EditOptions {
  name?: string;
  connection?: string | false;
  /** a URL sets the override; `false` (--no-base-url) removes it */
  baseUrl?: string | false;
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
    const baseUrlEdit = options.baseUrl !== undefined;
    if (options.dataFile && (catalogEdit || baseUrlEdit)) {
      throw new CliUsageError('--data-file replaces the whole data object; do not combine it with the model flags or --base-url.');
    }

    // `data` is stored whole, so an edit of one part resends the rest unchanged.
    let data: unknown | undefined;
    if (options.dataFile) {
      data = await readInput(options.dataFile);
    } else if (catalogEdit || baseUrlEdit) {
      const currentData = (current.data && typeof current.data === 'object' && !Array.isArray(current.data)) ? current.data as Record<string, unknown> : {};
      const next: Record<string, unknown> = { ...currentData };
      if (catalogEdit) {
        const replace = await parseCatalogFlags(options);
        next.models = mergeCatalog(catalogOf(current), { replace, add: splitIds(options.addModel), remove: splitIds(options.removeModel) });
      }
      if (options.baseUrl === false) {
        // an empty override is what the API treats as "none"
        next.baseURL = '';
      } else if (typeof options.baseUrl === 'string') {
        next.baseURL = validateBaseUrl(options.baseUrl);
      }
      data = next;
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
