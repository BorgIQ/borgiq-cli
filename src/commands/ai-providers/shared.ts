import type { createClientWithContext } from '../../lib/context.js';
import { CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import type { BIQAiModelCatalogEntry, BIQAiSettingMetadata } from '../../client/types.js';

type Client = ReturnType<typeof createClientWithContext>['client'];
type Ctx = ReturnType<typeof createClientWithContext>['ctx'];

/** Find an AI provider setting by id or by name (a custom provider's slug, or a built-in provider id). */
export const resolveAiProvider = async (client: Client, ctx: Ctx, idOrName: string): Promise<BIQAiSettingMetadata> => {
  const settings = await client.listAiSettings(ctx.org, ctx.workspace);
  const found = settings.find((s) => s.id === idOrName) ?? settings.find((s) => s.name === idOrName);
  if (!found) {
    throw new CliUsageError(`AI provider '${idOrName}' not found in workspace. Run \`borgiq ai-providers list\` to see the configured providers.`);
  }
  return found;
};

/** Resolve a connection key to its id; an unknown key is passed through as an id for the server to check. */
export const resolveConnectionId = async (client: Client, ctx: Ctx, keyOrId: string): Promise<string> => {
  const list = await client.listConnections(ctx.org, ctx.workspace, { search: keyOrId, pageSize: 20 });
  return list.data.find((c) => c.key === keyOrId)?.id ?? keyOrId;
};

/** The model catalog carried in a setting's `data` (empty when absent or not a list). */
export const catalogOf = (setting: { data?: unknown }): BIQAiModelCatalogEntry[] => {
  const data = setting.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const models = (data as { models?: unknown }).models;
  return Array.isArray(models) ? models as BIQAiModelCatalogEntry[] : [];
};

/** Parse `--models a,b` and `--models-file` (an array of entries, or `{ models: [...] }`) into catalog entries. */
export const parseCatalogFlags = async (options: { models?: string; modelsFile?: string }): Promise<BIQAiModelCatalogEntry[] | undefined> => {
  if (options.models !== undefined && options.modelsFile) {
    throw new CliUsageError('Use either --models or --models-file, not both.');
  }
  if (options.models !== undefined) {
    return splitIds(options.models).map((id) => ({ id }));
  }
  if (options.modelsFile) {
    const parsed = await readInput(options.modelsFile);
    const list = Array.isArray(parsed) ? parsed : (parsed as { models?: unknown })?.models;
    if (!Array.isArray(list)) {
      throw new CliUsageError(`Expected ${options.modelsFile} to hold an array of model entries or { models: [...] }.`);
    }
    return list.map((entry) => {
      if (typeof entry === 'string') return { id: entry };
      if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') return entry as BIQAiModelCatalogEntry;
      throw new CliUsageError(`Every model entry in ${options.modelsFile} needs an "id".`);
    });
  }
  return undefined;
};

/** Split a comma-separated id list (repeatable flags arrive as arrays). */
export const splitIds = (value: string | string[] | undefined): string[] => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v.length > 0);
};

/** Apply catalog edits: a full replacement, then additions (kept if already listed) and removals. */
export const mergeCatalog = (
  current: BIQAiModelCatalogEntry[],
  edits: { replace?: BIQAiModelCatalogEntry[]; add?: string[]; remove?: string[] },
): BIQAiModelCatalogEntry[] => {
  let next = edits.replace ? [...edits.replace] : [...current];
  for (const id of edits.add ?? []) {
    if (!next.some((entry) => entry.id === id)) next.push({ id });
  }
  if (edits.remove?.length) {
    const removed = new Set(edits.remove);
    next = next.filter((entry) => !removed.has(entry.id));
  }
  return next;
};

/** Reject a base URL that is not an absolute http(s) URL before the API does, with a usage error. */
export const validateBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  let url: URL | undefined;
  try {
    url = new URL(trimmed);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new CliUsageError(`--base-url must be an absolute http:// or https:// URL, e.g. https://api.groq.com/openai/v1 (got "${value}").`);
  }
  return trimmed.replace(/\/+$/, '');
};
