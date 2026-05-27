import type { Command } from 'commander';

import type { ListFilterParams } from '../client/types.js';

export interface ListOptionFlags {
  page?: string;
  pageSize?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface WithListOptionsConfig {
  /** Set to false when the underlying API does not honor the `search` query param. */
  search?: boolean;
  /**
   * Sort field samples shown in `--sort-by` help text. Backed by the entity's
   * sortable columns in borgiq-platform. Omit (or pass an empty array) to hide
   * sort flags entirely.
   */
  sortFields?: string[];
  /** Default `sortBy` documented for the user (purely informational; the API also applies its own default). */
  defaultSortBy?: string;
  /** Default `sortOrder` documented for the user. */
  defaultSortOrder?: 'asc' | 'desc';
}

/**
 * Attach the standard pagination/search/sort options shared by every list command.
 * Returns the command for chaining.
 */
export const withListOptions = (cmd: Command, config: WithListOptionsConfig = {}): Command => {
  const includeSearch = config.search ?? true;
  const sortFields = config.sortFields ?? [];
  const includeSort = sortFields.length > 0;

  cmd
    .option('--page <page>', 'Page number (1-based)')
    .option('--page-size <size>', 'Results per page (max 100)');

  if (includeSearch) {
    cmd.option('--search <query>', 'Case-insensitive search filter');
  }

  if (includeSort) {
    const sortFieldsHint = sortFields.join(', ');
    const sortByDescription = config.defaultSortBy
      ? `Field to sort by (e.g. ${sortFieldsHint}; default: ${config.defaultSortBy})`
      : `Field to sort by (e.g. ${sortFieldsHint})`;
    const sortOrderDescription = config.defaultSortOrder
      ? `Sort direction: asc or desc (default: ${config.defaultSortOrder})`
      : 'Sort direction: asc or desc';
    cmd
      .option('--sort-by <field>', sortByDescription)
      .option('--sort-order <order>', sortOrderDescription);
  }

  return cmd;
};

/** Parse the raw string options into the ListFilterParams shape the API client expects. */
export const parseListOptions = (options: ListOptionFlags): ListFilterParams => {
  const sortOrder = options.sortOrder?.toLowerCase();
  if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new Error('--sort-order must be either "asc" or "desc"');
  }
  return {
    page: options.page ? parseInt(options.page, 10) : undefined,
    pageSize: options.pageSize ? parseInt(options.pageSize, 10) : undefined,
    search: options.search,
    sortBy: options.sortBy,
    sortOrder: sortOrder as 'asc' | 'desc' | undefined,
  };
};
