import { ApiError } from '../../client/errors.js';
import type { ReactAppBuildResultPayload } from '../../client/types.js';
import { isReactAppActor } from '../../lib/bundle/reactApp.js';
import { readBundleDirDetailed } from '../../lib/bundleFs.js';
import type { GlobalOptions } from '../../lib/context.js';
import { createClientWithContext } from '../../lib/context.js';
import { CliUsageError, ExitCode, handleError } from '../../lib/errors.js';
import { output } from '../../output/index.js';
import { assembleOrFail } from './shared.js';
import { bundlePush } from './push.js';

type CommandCtx = { parent: { parent: { opts: () => GlobalOptions } } };

interface BuildOptions {
  canvas?: string;
  /** Variadic: build only these react-app actors. Omitted → build every react-app actor in the bundle. */
  actor?: string[];
  timeout?: string;
  /** Commander sets this to false when --no-push is passed; true otherwise. */
  push?: boolean;
  /** Forwarded to the auto-push: resolve sync conflicts by applying the local actor version. */
  forceLocal?: boolean;
  strict?: boolean;
}

/** One actor's build result, as reported on stdout (under `builds`) and used to derive the exit code. */
interface BuildOutcome {
  actorId: string;
  status: 'success' | 'error';
  flowrunId: string;
  buildId?: string;
  builtAt?: string;
  fileCount?: number;
  totalSizeInBytes?: number;
  error?: string;
  details?: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEOUT_SEC = 420;
// The GET build endpoint long-polls up to ~25 s per request, so each poll blocks server-side and we
// re-issue immediately on a 202 rather than sleeping between rounds.
const POLL_WAIT_SEC = 25;

/**
 * `borgiq bundle build <dir>` — build a bundle's ReactAppTriggerActor(s) without the web editor.
 *
 * A canvas can host several react-app actors, so by default this builds every one in the bundle
 * (pass `--actor` to build a subset). It auto-pushes the local bundle first (the CLI analogue of the
 * editor's save-then-build), then reuses the platform's existing build endpoints — `POST …/apps/:actorId/build`
 * to start and the `GET …/build?flowrunId=…&waitSeconds=…` long-poll to await each result — so no new API is needed.
 */
export const bundleBuild = async (dir: string, options: BuildOptions, command: CommandCtx): Promise<void> => {
  try {
    const globalOpts = command.parent.parent.opts();
    const { client, ctx } = createClientWithContext(globalOpts);
    const verbose = !globalOpts.json && process.stderr.isTTY;

    // Resolve the react-app actor(s) + canvas from the local bundle before mutating anything.
    const contents = readBundleDirDetailed(dir);
    const local = assembleOrFail(contents.files, options.strict ?? false);
    const { doc } = local;

    const actorIds = resolveActorIds(doc, options.actor);
    const canvas = options.canvas ?? (typeof doc.metadata.slug === 'string' ? doc.metadata.slug : '');
    if (!canvas) {
      throw new CliUsageError('No canvas target - pass --canvas <canvas> or set canvas.slug in the bundle.');
    }
    const timeoutSec = parseTimeout(options.timeout);

    if (options.push === false && options.forceLocal) {
      process.stderr.write('Note: --force-local has no effect with --no-push (nothing is pushed).\n');
    }

    // 1. Auto-push (unless --no-push) so the build reads the config we just synced. One push covers
    //    every actor in the bundle, so it runs once regardless of how many actors we then build.
    if (options.push !== false) {
      const pushed = await autoPush(dir, { canvas: options.canvas, forceLocal: options.forceLocal, strict: options.strict }, command);
      if (!pushed) {
        process.stderr.write('Aborting build: the push did not complete cleanly (see the errors above).\n');
        return; // the push already set process.exitCode and reported the failure
      }
    }

    // 2. Build each actor in turn, reporting per-actor progress (sequential keeps the streamed
    //    progress readable and avoids firing several concurrent builds at the same workspace).
    if (verbose && actorIds.length > 1) {
      process.stderr.write(`Building ${actorIds.length} react app(s) on canvas '${canvas}'...\n`);
    }
    const builds: BuildOutcome[] = [];
    for (const actorId of actorIds) {
      try {
        builds.push(await buildOne(client, ctx, verbose, canvas, actorId, timeoutSec));
      } catch (err) {
        // Auth failures are fatal for the whole command; anything else fails just this actor.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`✖ Build for '${actorId}' failed to start: ${message}\n`);
        builds.push({ actorId, status: 'error', flowrunId: '', error: message, details: [] });
      }
    }

    // 3. Report. The command fails if any single actor's build failed.
    const anyFailed = builds.some((build) => build.status === 'error');
    if (anyFailed) process.exitCode = ExitCode.GENERAL;
    output({ status: anyFailed ? 'error' : 'success', canvas, builds }, globalOpts);
  } catch (error) {
    handleError(error);
  }
};

/** Start, poll, and report a single actor's build. Throws only on fatal (auth) errors from `startReactAppBuild`. */
const buildOne = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  verbose: boolean,
  canvas: string,
  actorId: string,
  timeoutSec: number,
): Promise<BuildOutcome> => {
  if (verbose) process.stderr.write(`Building react app '${actorId}' on canvas '${canvas}'...\n`);
  const start = await client.startReactAppBuild(ctx.org, ctx.workspace, canvas, actorId);
  const flowrunId = start.flowrun.id;
  const flowrunJobId = start.flowrunJob.id;
  if (verbose) process.stderr.write(`Build started (flowrun ${flowrunId}).\n`);

  const result = await pollBuild(client, ctx, verbose, canvas, actorId, flowrunId, timeoutSec);
  if (!result) {
    process.stderr.write(`✖ Build for '${actorId}' timed out after ${timeoutSec}s. Check the build log in the web editor and try again.\n`);
    return { actorId, status: 'error', flowrunId, error: `Build timed out after ${timeoutSec}s.`, details: [] };
  }

  if (result.status === 'success') {
    if (verbose) {
      process.stderr.write(`✔ Built '${actorId}' — ${result.fileCount} file(s), ${formatBytes(result.totalSizeInBytes)} (buildId ${result.buildId}).\n`);
    }
    return { actorId, status: 'success', flowrunId, buildId: result.buildId, builtAt: result.builtAt, fileCount: result.fileCount, totalSizeInBytes: result.totalSizeInBytes };
  }

  // status === 'error': the endpoint gives the compiler-output tail; the job-result summaries carry
  // the structured error + validation details (same source as the editor's build-failure panel).
  process.stderr.write(`✖ Build for '${actorId}' failed.\n`);
  if (result.error) process.stderr.write(`${result.error}\n`);
  const details = await fetchBuildErrorDetails(client, ctx, flowrunJobId);
  if (verbose) for (const detail of details) process.stderr.write(`  ${detail}\n`);
  return { actorId, status: 'error', flowrunId, error: result.error, details };
};

/**
 * Picks the actors to build: `--actor` selects a subset (validated against the bundle's react-app
 * actors); otherwise every ReactAppTriggerActor in the bundle is built.
 */
const resolveActorIds = (doc: ReturnType<typeof assembleOrFail>['doc'], actorFlags: string[] | undefined): string[] => {
  const reactAppActors = Object.values(doc.data.actors).filter((actor) => isReactAppActor(actor));
  if (reactAppActors.length === 0) {
    throw new CliUsageError('No ReactAppTriggerActor found in this bundle. Add one to the canvas first.');
  }
  const available = new Map(reactAppActors.map((actor) => [actor.id, actor]));

  if (actorFlags && actorFlags.length > 0) {
    const requested = [...new Set(actorFlags)];
    const unknown = requested.filter((id) => !available.has(id));
    if (unknown.length > 0) {
      const candidates = reactAppActors.map((actor) => `${actor.id}${actor.name ? ` (${actor.name})` : ''}`).join(', ');
      throw new CliUsageError(`Unknown --actor ${unknown.join(', ')} - this bundle's react-app actors are: ${candidates}.`);
    }
    return requested;
  }

  return reactAppActors.map((actor) => actor.id);
};

const parseTimeout = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_TIMEOUT_SEC;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new CliUsageError(`Invalid --timeout '${raw}' - use a positive number of seconds.`);
  }
  return Math.floor(seconds);
};

/**
 * Runs the existing push command, suppressing its stdout so `build` owns the single result on stdout
 * (push still writes its human progress + any errors to stderr). Returns false when push reported a
 * non-fatal failure (it sets a non-zero process.exitCode); a thrown push error exits via handleError.
 */
const autoPush = async (
  dir: string,
  pushOptions: { canvas?: string; forceLocal?: boolean; strict?: boolean },
  command: CommandCtx,
): Promise<boolean> => {
  const restore = silenceStdout();
  try {
    await bundlePush(dir, pushOptions, command);
  } finally {
    restore();
  }
  return !(process.exitCode && process.exitCode !== 0);
};

const silenceStdout = (): (() => void) => {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  return () => { process.stdout.write = original; };
};

const pollBuild = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  verbose: boolean,
  canvas: string,
  actorId: string,
  flowrunId: string,
  timeoutSec: number,
): Promise<ReactAppBuildResultPayload | null> => {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await client.getReactAppBuildResult(ctx.org, ctx.workspace, canvas, actorId, { flowrunId, waitSeconds: POLL_WAIT_SEC });
      if ('pending' in res) {
        if (verbose) process.stderr.write('.'); // 202 — the wait window elapsed; re-issue immediately
        continue;
      }
      if (verbose) process.stderr.write('\n');
      return res;
    } catch (err) {
      // Auth failures are fatal; transient errors (5xx, network blip) should not kill the wait.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) throw err;
      if (verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\nTransient error during build poll, retrying: ${msg}\n`);
      }
      await sleep(2000);
    }
  }
  if (verbose) process.stderr.write('\n');
  return null;
};

/** Best-effort structured build-error details from the build flowrun-job's result summaries. */
const fetchBuildErrorDetails = async (
  client: ReturnType<typeof createClientWithContext>['client'],
  ctx: ReturnType<typeof createClientWithContext>['ctx'],
  flowrunJobId: string,
): Promise<string[]> => {
  try {
    const summaries = await client.getJobResultSummaries(ctx.org, ctx.workspace, flowrunJobId);
    return summaries
      .filter((summary) => summary.error !== undefined && summary.error !== null)
      .map((summary) => (typeof summary.error === 'string' ? summary.error : JSON.stringify(summary.error)));
  } catch {
    return []; // the primary error string already printed; details are a bonus
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
};
