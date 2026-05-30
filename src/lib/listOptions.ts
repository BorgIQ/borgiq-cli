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
