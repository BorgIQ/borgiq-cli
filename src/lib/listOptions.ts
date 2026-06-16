import { Option, InvalidArgumentError, type Command } from 'commander';

import type { ListFilterParams } from '../client/types.js';

export interface ListOptionFlags {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  all?: boolean;
}

export interface WithListOptionsConfig {
  /** Set to false when the API ignores `search`. */
  search?: boolean;
  /** Omit to hide sort flags entirely. */
  sort?: {
    fields: [string, ...string[]];
    defaultBy?: string;
    defaultOrder?: 'asc' | 'desc';
  };
}

const MAX_PAGE_SIZE = 100;

/** Full invocation path of a command, e.g. `borgiq canvases list`. Walks the
 *  parent chain so examples stay correct if a command is ever re-parented. */
const commandPath = (cmd: Command): string => {
  const parts: string[] = [];
  let cur: Command | undefined = cmd;
  while (cur) {
    const name = cur.name();
    if (name) parts.unshift(name);
    cur = cur.parent ?? undefined;
  }
  return parts.join(' ');
};

/** Required positional args (`<canvasId>`) and required options (`--canvas-id
 *  <id>`) as a copy-pasteable suffix. Read lazily at help-render time so
 *  options the caller chains *after* `withListOptions` (e.g. flowruns'
 *  `requiredOption('--canvas-id')`) are included. */
const requiredSuffix = (cmd: Command): string => {
  const args = cmd.registeredArguments
    .filter((arg) => arg.required)
    .map((arg) => `<${arg.name()}>`);

  const flags = cmd.options
    .filter((opt) => opt.mandatory)
    .map((opt) => {
      const valueToken = opt.flags.match(/\s(<[^>]+>|\[[^\]]+\])$/);
      return valueToken ? `${opt.long} ${valueToken[1]}` : opt.long;
    });

  const all = [...args, ...flags];
  return all.length ? ` ${all.join(' ')}` : '';
};

/**
 * Build a tailored `Examples:` help block for a list command, derived from
 * what the command actually supports — so an agent reading `--help` sees how
 * to combine the flags, not just that they exist. Pagination examples are
 * always shown; search/sort examples appear only when that command enables
 * them (the flowrun endpoints, which ignore sort/search, get just the
 * pagination pair).
 */
const buildListExamples = (cmd: Command, config: WithListOptionsConfig): string => {
  const base = `${commandPath(cmd)}${requiredSuffix(cmd)}`;
  const lines: string[] = ['', 'Examples:'];

  lines.push('  Page through results (1-based):');
  lines.push(`    $ ${base} --page 2 --page-size 50`);
  lines.push('  Fetch every page in one call (auto-paginates, ignores --page):');
  lines.push(`    $ ${base} --all --json`);

  const searchEnabled = config.search ?? true;
  if (searchEnabled || config.sort) {
    const parts: string[] = [];
    if (searchEnabled) parts.push('--search "<text>"');
    if (config.sort) {
      const field = config.sort.defaultBy ?? config.sort.fields[0];
      parts.push(`--sort-by ${field} --sort-order desc`);
    }
    lines.push(`  ${searchEnabled && config.sort ? 'Search and sort' : config.sort ? 'Sort' : 'Search'}:`);
    lines.push(`    $ ${base} ${parts.join(' ')}`);
  }

  return lines.join('\n');
};

const parsePositiveInt = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return n;
};

const parsePageSize = (raw: string): number => {
  const n = parsePositiveInt(raw);
  if (n > MAX_PAGE_SIZE) {
    throw new InvalidArgumentError(`cannot exceed ${MAX_PAGE_SIZE}`);
  }
  return n;
};

export const withListOptions = (cmd: Command, config: WithListOptionsConfig = {}): Command => {
  cmd
    .option('--page <page>', 'Page number (1-based)', parsePositiveInt)
    .option('--page-size <size>', `Results per page (max ${MAX_PAGE_SIZE})`, parsePageSize)
    .option('--all', `Fetch every page and return all results (ignores --page)`);

  if (config.search ?? true) {
    cmd.option('--search <query>', 'Case-insensitive search filter');
  }

  if (config.sort) {
    const { fields, defaultBy, defaultOrder } = config.sort;
    const hint = fields.join(', ');
    cmd.option(
      '--sort-by <field>',
      defaultBy ? `Field to sort by (e.g. ${hint}; default: ${defaultBy})` : `Field to sort by (e.g. ${hint})`,
    );
    cmd.addOption(
      new Option(
        '--sort-order <order>',
        defaultOrder ? `Sort direction (default: ${defaultOrder})` : 'Sort direction',
      ).choices(['asc', 'desc']),
    );
  }

  // Deferred so required options the caller chains *after* this call (e.g.
  // `--canvas-id` on flowruns) are reflected in the example invocations.
  cmd.addHelpText('after', () => buildListExamples(cmd, config));

  return cmd;
};

export const parseListOptions = (options: ListOptionFlags): ListFilterParams => ({
  page: options.page,
  pageSize: options.pageSize,
  search: options.search,
  sortBy: options.sortBy,
  sortOrder: options.sortOrder,
});

/**
 * Run a list query, transparently following pagination when `--all` is set.
 *
 * Without `--all`, this is a single call with the user's flags. With `--all`,
 * it walks every page (at the max page size) and returns one response whose
 * `data` holds the full result set — so callers and the output layer stay
 * unchanged. This spares agents from hand-rolling page loops.
 */
export const collectAllPages = async <R extends { total: number; data: unknown[] }>(
  options: ListOptionFlags,
  fetchPage: (params: ListFilterParams) => Promise<R>,
): Promise<R> => {
  if (!options.all) {
    return fetchPage(parseListOptions(options));
  }

  const base = parseListOptions(options);
  const pageSize = options.pageSize ?? MAX_PAGE_SIZE;
  const collected: unknown[] = [];
  let page = 1;
  let last: R | undefined;

  for (;;) {
    last = await fetchPage({ ...base, page, pageSize });
    collected.push(...last.data);
    if (last.data.length === 0 || collected.length >= last.total) break;
    page += 1;
  }

  return { ...(last as R), data: collected, total: last.total };
};
