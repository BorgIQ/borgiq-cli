export interface TableConfig {
  columns: { key: string; header: string }[];
  title?: string;
}

export const formatTable = (rows: Record<string, unknown>[], config: TableConfig): void => {
  if (config.title) {
    process.stdout.write(`\n${config.title}\n\n`);
  }

  if (rows.length === 0) {
    process.stdout.write('No results found.\n');
    return;
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of config.columns) {
    widths[col.key] = col.header.length;
  }
  for (const row of rows) {
    for (const col of config.columns) {
      const val = String(row[col.key] ?? '');
      widths[col.key] = Math.max(widths[col.key], val.length);
    }
  }

  // Print header
  const headerLine = config.columns
    .map((col) => col.header.padEnd(widths[col.key]))
    .join('  ');
  process.stdout.write(headerLine + '\n');

  // Print separator
  const separator = config.columns
    .map((col) => '─'.repeat(widths[col.key]))
    .join('  ');
  process.stdout.write(separator + '\n');

  // Print rows
  for (const row of rows) {
    const line = config.columns
      .map((col) => String(row[col.key] ?? '').padEnd(widths[col.key]))
      .join('  ');
    process.stdout.write(line + '\n');
  }

  process.stdout.write('\n');
};
