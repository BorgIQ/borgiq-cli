import { formatJson } from './json.js';
import { formatTable } from './table.js';
import type { TableConfig } from './table.js';

export interface OutputOptions {
  json?: boolean;
}

export const output = (data: unknown, opts: OutputOptions, tableConfig?: TableConfig): void => {
  const useJson = opts.json || !process.stdout.isTTY;

  if (useJson) {
    formatJson(data);
    return;
  }

  if (tableConfig && Array.isArray(data)) {
    formatTable(data as Record<string, unknown>[], tableConfig);
    return;
  }

  // Fallback: if data has a .data array (paginated response), render that
  const paginated = data as { total?: number; data?: unknown[] };
  if (tableConfig && paginated.data && Array.isArray(paginated.data)) {
    if (tableConfig.title && paginated.total !== undefined) {
      tableConfig.title = `${tableConfig.title} (${paginated.total} total)`;
    }
    formatTable(paginated.data as Record<string, unknown>[], tableConfig);
    return;
  }

  // Default: JSON
  formatJson(data);
};

export { formatJson } from './json.js';
export { formatTable } from './table.js';
export type { TableConfig } from './table.js';
