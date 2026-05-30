import { ApiError, type ErrorDetail } from '../client/errors.js';

/**
 * Thrown for user-facing validation failures (missing required flag,
 * invalid type value, etc). handleError formats these without a stack
 * trace and without API-specific hints.
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/**
 * Process exit codes, chosen so scripts and agents can branch on the
 * failure category without parsing stderr text. Documented in the README.
 */
export const ExitCode = {
  GENERAL: 1,
  USAGE: 2, // bad flags / missing input / 400 / 422
  AUTH: 3, // 401 — not authenticated
  FORBIDDEN: 4, // 403 — authenticated but not authorized
  NOT_FOUND: 5, // 404
  CONFLICT: 6, // 409
  RATE_LIMIT: 7, // 429
  SERVER: 8, // 5xx
  NETWORK: 9, // could not reach the API
} as const;

const statusToExitCode = (status: number): number => {
  switch (status) {
    case 400:
    case 422:
      return ExitCode.USAGE;
    case 401:
      return ExitCode.AUTH;
    case 403:
      return ExitCode.FORBIDDEN;
    case 404:
      return ExitCode.NOT_FOUND;
    case 409:
      return ExitCode.CONFLICT;
    case 429:
      return ExitCode.RATE_LIMIT;
    default:
      return status >= 500 ? ExitCode.SERVER : ExitCode.GENERAL;
  }
};

const statusToCode = (status: number): string => {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_error';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'error';
  }
};

const statusHint = (status: number): string | undefined => {
  if (status === 401) return "Run 'borgiq auth login' to reconfigure your credentials.";
  if (status === 403) return 'Your token may lack the required scope for this operation.';
  if (status === 429) return 'Rate limited. Please wait and try again.';
  return undefined;
};

interface ErrorPayload {
  code: string;
  status: number | null;
  exitCode: number;
  message: string;
  details?: ErrorDetail[];
  hint?: string;
}

/**
 * Whether errors should be emitted as machine-readable JSON. Mirrors the
 * output() heuristic so success and failure use the same format: explicit
 * --json, or any non-TTY stdout (piped into a script or agent).
 */
const useJsonOutput = (override?: boolean): boolean =>
  override ?? (process.argv.includes('--json') || !process.stdout.isTTY);

const emit = (payload: ErrorPayload, json: boolean): never => {
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: payload }, null, 2)}\n`);
    process.exit(payload.exitCode);
  }

  if (payload.status !== null) {
    process.stderr.write(`Error: ${payload.message} (HTTP ${payload.status})\n`);
  } else {
    process.stderr.write(`Error: ${payload.message}\n`);
  }
  if (payload.hint) {
    process.stderr.write(`${payload.hint}\n`);
  }
  if (payload.details && payload.details.length > 0) {
    for (const detail of payload.details) {
      process.stderr.write(`  ${detail.path.join('.')}: ${detail.message}\n`);
    }
  }
  process.exit(payload.exitCode);
};

/**
 * Central error handler. Writes a diagnostic to stderr (JSON when in JSON
 * mode, otherwise human text) and exits with a category-specific code.
 *
 * `opts.json` can force the format; when omitted it is inferred the same way
 * output() infers it, so callers that already write data as JSON also report
 * errors as JSON without threading the flag through every catch block.
 */
export const handleError = (error: unknown, opts?: { json?: boolean }): never => {
  const json = useJsonOutput(opts?.json);

  if (error instanceof CliUsageError) {
    return emit({ code: 'usage', status: null, exitCode: ExitCode.USAGE, message: error.message }, json);
  }

  if (error instanceof ApiError) {
    return emit(
      {
        code: statusToCode(error.status),
        status: error.status,
        exitCode: statusToExitCode(error.status),
        message: error.message,
        details: error.details.length > 0 ? error.details : undefined,
        hint: statusHint(error.status),
      },
      json,
    );
  }

  if (error instanceof Error) {
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      return emit(
        {
          code: 'network',
          status: null,
          exitCode: ExitCode.NETWORK,
          message: 'Could not connect to the API. Check your API URL and network connection.',
        },
        json,
      );
    }
    return emit({ code: 'error', status: null, exitCode: ExitCode.GENERAL, message: error.message }, json);
  }

  return emit({ code: 'error', status: null, exitCode: ExitCode.GENERAL, message: String(error) }, json);
};
