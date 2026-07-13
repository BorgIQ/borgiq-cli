import { describe, expect, it } from 'vitest';

import { orderKeys, parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';

describe('orderKeys', () => {
  it('puts known keys first and unknown keys after alphabetically', () => {
    const input = { zeta: 1, name: 'x', alpha: 2, id: 'a' };
    expect(Object.keys(orderKeys(input, ['id', 'name']))).toEqual(['id', 'name', 'alpha', 'zeta']);
  });

  it('skips undefined values but keeps null values', () => {
    const input = { id: 'a', name: undefined, imagePath: null };
    const out = orderKeys(input, ['id', 'name', 'imagePath']);
    expect(Object.keys(out)).toEqual(['id', 'imagePath']);
    expect(out.imagePath).toBeNull();
  });
});

describe('stringifyYamlDoc', () => {
  it('is deterministic', () => {
    const value = { a: 'x'.repeat(300), b: ['one', 'two'], c: { nested: true } };
    expect(stringifyYamlDoc(value)).toBe(stringifyYamlDoc(value));
  });

  it('never folds long lines', () => {
    const url = `https://example.com/${'a'.repeat(300)}`;
    expect(stringifyYamlDoc({ url }).trimEnd().split('\n')).toHaveLength(1);
  });

  it('emits multiline strings as literal blocks and round-trips them exactly', () => {
    const code = 'line one\nline two\n\nline four\n';
    const text = stringifyYamlDoc({ code });
    expect(text).toContain('|');
    expect((parseYamlDoc(text) as { code: string }).code).toBe(code);
  });

  it('quotes strings that would parse as other scalar types', () => {
    const value = { v: '1', t: 'true', n: 'null' };
    expect(parseYamlDoc(stringifyYamlDoc(value))).toEqual(value);
  });

  it('never emits anchors or aliases for duplicate object references', () => {
    const shared = { k: 'v' };
    const text = stringifyYamlDoc({ a: shared, b: shared });
    expect(text).not.toContain('&');
    expect(text).not.toContain('*');
  });

  it('ends with exactly one trailing newline', () => {
    const text = stringifyYamlDoc({ a: 1 });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});
