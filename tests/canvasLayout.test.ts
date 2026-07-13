import { describe, expect, it } from 'vitest';

import { canvasSlugOrIdFromCreateResult, layoutSourceActorIds, shouldAutoLayout } from '../src/lib/canvasLayout.js';

describe('canvas auto-layout helpers', () => {
  it('enables layout when requested directly or by source actor ids', () => {
    expect(shouldAutoLayout({})).toBe(false);
    expect(shouldAutoLayout({ autoLayout: true })).toBe(true);
    expect(shouldAutoLayout({ layoutSourceActorId: ['ACTR01kx1s177z1fye5zr5vs4dqhqp'] })).toBe(true);
    expect(layoutSourceActorIds({ layoutSourceActorId: ['ACTR01kx1s177z1fye5zr5vs4dqhqp'] })).toEqual(['ACTR01kx1s177z1fye5zr5vs4dqhqp']);
  });

  it('resolves a created canvas target from response first and input fallback second', () => {
    expect(canvasSlugOrIdFromCreateResult({ slug: 'created-slug' }, { slug: 'input-slug' })).toBe('created-slug');
    expect(canvasSlugOrIdFromCreateResult({ metadata: { id: 'CNVS01created' } }, { slug: 'input-slug' })).toBe('CNVS01created');
    expect(canvasSlugOrIdFromCreateResult({}, { metadata: { slug: 'input-slug' } })).toBe('input-slug');
  });
});
