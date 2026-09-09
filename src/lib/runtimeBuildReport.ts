import type { RuntimeBuildSummary } from '../client/types.js';

/**
 * Rendering shared by every command that reports a finished canvas runtime build
 * (`canvases runtime-build` and the deployed-workspace path of `bundle build`).
 */

/** Render one build's per-actor outcome — the part a user acts on. */
export function runtimeBuildActorRows(build: RuntimeBuildSummary): Record<string, unknown>[] {
  return Object.entries(build.actors ?? {}).map(([actorId, actor]) => ({
    actor: actor.path ?? actorId,
    type: actor.type,
    status: actor.status,
    // `warm: failed` means the dependencies installed but the actor's own code threw at start-up.
    // Recorded rather than fatal, and worth surfacing: it will throw at run time too.
    note: actor.status !== 'ok' ? (actor.error ?? '') : actor.warm === 'failed' ? 'installed, but did not start' : '',
  }));
}

export const RUNTIME_BUILD_COLUMNS = [
  { key: 'actor', header: 'ACTOR' },
  { key: 'type', header: 'TYPE' },
  { key: 'status', header: 'STATUS' },
  { key: 'note', header: 'NOTE' },
];

/** How many of the build's actors did not build. */
export function failedActorCount(build: RuntimeBuildSummary): number {
  return Object.values(build.actors ?? {}).filter((actor) => actor.status !== 'ok').length;
}

/**
 * The stderr warning for a `partially_ready` build. Only a build where EVERY actor built can serve
 * runs, so a partial build changes nothing: the canvas keeps running its previous full build, or
 * refuses runs if it never had one.
 */
export function partialBuildWarning(build: RuntimeBuildSummary): string {
  return `${failedActorCount(build)} actor(s) did not build. A partly built canvas serves nothing — `
    + 'the previous full build keeps running (or runs fail if there is none). '
    + 'Fix the failures and build again.';
}
