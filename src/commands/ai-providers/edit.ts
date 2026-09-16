import { createClientWithContext } from '../../lib/context.js';
import type { GlobalOptions } from '../../lib/context.js';
import { output } from '../../output/index.js';
import { handleError, CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import {
  catalogOf, flagsGiven, mergeCatalog, parseCatalogFlags, resolveAiProvider, resolveConnectionId, splitIds, validateBaseUrl, warnAboutReferences,
} from './shared.js';

interface EditOptions {
  name?: string;
  /** a key or id sets the connection; `false` (--no-connection) removes it */
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

    // Commander keeps only the last of `--x <v>` / `--no-x`, so both together would silently drop one.
    if (flagsGiven('--connection', '--no-connection')) {
      throw new CliUsageError('Use either --connection <key-or-id> or --no-connection, not both.');
    }
    if (flagsGiven('--base-url', '--no-base-url')) {
      throw new CliUsageError('Use either --base-url <url> or --no-base-url, not both.');
    }

    const catalogEdit = Boolean(options.models !== undefined || options.modelsFile || options.addModel?.length || options.removeModel?.length);
    const baseUrlEdit = options.baseUrl !== undefined;
    const connectionEdit = options.connection !== undefined;
    if (options.dataFile && (catalogEdit || baseUrlEdit)) {
      throw new CliUsageError('--data-file replaces the whole data object; do not combine it with the model flags or --base-url.');
    }

    // The PUT contract requires the connection field, so fetch the current row and resend what
    // is unchanged (a full replacement, not a patch).
    const current = await resolveAiProvider(client, ctx, idOrName);

    if (options.name === undefined && !connectionEdit && !baseUrlEdit && !catalogEdit && !options.dataFile) {
      process.stderr.write('Nothing to update.\n');
      return;
    }

    // The base URL and the model catalog are parts of a custom provider; on a built-in provider's
    // setting they would be stored and ignored.
    if (current.provider !== 'custom' && (catalogEdit || baseUrlEdit)) {
      const flag = baseUrlEdit
        ? (options.baseUrl === false ? '--no-base-url' : '--base-url')
        : options.models !== undefined ? '--models' : options.modelsFile ? '--models-file' : options.addModel?.length ? '--add-model' : '--remove-model';
      throw new CliUsageError(`${flag} applies to custom providers only; '${current.name}' is a built-in provider (${current.provider}) with no base URL or model catalog of its own.`);
    }

    let connectionId: string | null | undefined = current.connectionId ?? null;
    if (options.connection === false) {
      connectionId = null;
    } else if (typeof options.connection === 'string') {
      connectionId = await resolveConnectionId(client, ctx, options.connection);
    }

    // `data` is stored whole, so an edit of one part resends the rest unchanged.
    let data: unknown | undefined;
    if (options.dataFile) {
      data = await readInput(options.dataFile);
      const currentCount = catalogOf(current).length;
      if (currentCount > 0) {
        process.stderr.write(`Warning: --data-file replaces the whole data object; the current catalog of ${currentCount} model(s) is replaced by the file's contents.\n`);
      }
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

    // Renaming a custom provider orphans every `<old-slug>/<model-id>` reference in the workspace.
    if (options.name !== undefined && options.name !== current.name) {
      await warnAboutReferences(client, ctx, current.id, 'rename');
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
