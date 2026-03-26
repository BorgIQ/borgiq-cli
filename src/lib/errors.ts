import { ApiError } from '../client/errors.js';

export const handleError = (error: unknown): never => {
  if (error instanceof ApiError) {
    process.stderr.write(`Error: ${error.message} (HTTP ${error.status})\n`);

    if (error.status === 401) {
      process.stderr.write('Run \'borgiq auth login\' to reconfigure your credentials.\n');
    } else if (error.status === 403) {
      process.stderr.write('Your token may lack the required scope for this operation.\n');
    } else if (error.status === 429) {
      process.stderr.write('Rate limited. Please wait and try again.\n');
    }

    if (error.details.length > 0) {
      for (const detail of error.details) {
        process.stderr.write(`  ${detail.path.join('.')}: ${detail.message}\n`);
      }
    }

    process.exit(1);
  }

  if (error instanceof Error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      process.stderr.write(`Error: Could not connect to the API. Check your API URL and network connection.\n`);
      process.exit(1);
    }
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(`Error: ${String(error)}\n`);
  process.exit(1);
};
