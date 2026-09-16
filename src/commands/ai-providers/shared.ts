import type { createClientWithContext } from '../../lib/context.js';
import { ApiError } from '../../client/errors.js';
import { CliNotFoundError, CliUsageError } from '../../lib/errors.js';
import { readInput } from '../../lib/input.js';
import type { BIQAiModelCatalogEntry, BIQAiSettingMetadata } from '../../client/types.js';

type Client = ReturnType<typeof createClientWithContext>['client'];
type Ctx = ReturnType<typeof createClientWithContext>['ctx'];

/** Find an AI provider setting by id or by name (a custom provider's slug, or a built-in provider id). */
export const resolveAiProvider = async (client: Client, ctx: Ctx, idOrName: string): Promise<BIQAiSettingMetadata> => {
  const settings = await client.listAiSettings(ctx.org, ctx.workspace);
  const found = settings.find((s) => s.id === idOrName) ?? settings.find((s) => s.name === idOrName);
  if (!found) {
    throw new CliNotFoundError(`AI provider '${idOrName}' not found in workspace. Run \`borgiq ai-providers list\` to see the configured providers.`);
  }
  return found;
};

/** Resolve a connection key or id to the connection's id. Only a 404 is relabelled as a usage error;
 * anything else (auth, network, 5xx) surfaces as-is so the user sees the real cause. */
export const resolveConnectionId = async (client: Client, ctx: Ctx, keyOrId: string): Promise<string> => {
  try {
    const connection = await client.getConnection(ctx.org, ctx.workspace, keyOrId);
    return connection.id;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new CliUsageError(`Connection '${keyOrId}' not found. Run \`borgiq connections list\` to see available connections.`);
    }
    throw err;
  }
};

const MAX_REFERENCE_NAMES = 5;

/** Warn on stderr when canvases reference the provider's models, since a rename or delete orphans
 * their `<slug>/<model-id>` references. An API without the references route (404) is tolerated silently. */
export const warnAboutReferences = async (client: Client, ctx: Ctx, id: string, action: 'rename' | 'delete'): Promise<void> => {
  let references: { count: number; canvases: { id: string; name: string }[] };
  try {
    references = await client.getAiSettingReferences(ctx.org, ctx.workspace, id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
  if (!references || !(references.count > 0)) return;
  const names = references.canvases.slice(0, MAX_REFERENCE_NAMES).map((c) => c.name);
  const hidden = references.count - names.length;
  const listed = `${names.join(', ')}${hidden > 0 ? `, +${hidden} more` : ''}`;
  process.stderr.write(`Warning: ${references.count} canvas(es) reference this provider (${listed}) — their "<slug>/<model-id>" models will stop resolving after the ${action}.\n`);
};

/** Whether each of the given long flags (`--flag` or `--flag=value`) was passed on the command line.
 * Commander folds `--x <v>` and `--no-x` into one option value (last wins), so a conflict between the two
 * is only visible in argv — the same source handleError reads `--json` from. */
export const flagsGiven = (...flags: string[]): boolean => {
  const argv = process.argv;
  const end = argv.indexOf('--');
  const given = end === -1 ? argv : argv.slice(0, end);
  return flags.every((flag) => given.some((arg) => arg === flag || arg.startsWith(`${flag}=`)));
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
