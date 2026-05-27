import { Option, InvalidArgumentError, type Command } from 'commander';

import type { ListFilterParams } from '../client/types.js';

export interface ListOptionFlags {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
    .option('--page-size <size>', `Results per page (max ${MAX_PAGE_SIZE})`, parsePageSize);

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
