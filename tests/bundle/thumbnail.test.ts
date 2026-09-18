import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assembleBundle, BundleValidationError } from '../../src/lib/bundle/assemble.js';
import { actorContentHash, diffCanvas, toBatchOperations } from '../../src/lib/bundle/diff.js';
import { disassemble } from '../../src/lib/bundle/disassemble.js';
import {
  THUMBNAIL_MAX_BYTES,
  anyBytesDataUrl,
  decodeDataUrl,
  sniffThumbnailMimeType,
  thumbnailBytesProblem,
  thumbnailDataUrl,
} from '../../src/lib/bundle/thumbnail.js';
import { validateBundle } from '../../src/lib/bundle/validate.js';
import { parseYamlDoc, stringifyYamlDoc } from '../../src/lib/bundle/yaml.js';
import { readBundleDir, writeBundleDir, writeBundleDirIncremental } from '../../src/lib/bundleFs.js';
import { REACT_APP_DIR, REACT_APP_ID, makeDoc, makeReactAppActor } from './fixtures.js';

/** A real 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;
/** JPEG signature is all the sniffer needs. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JPEG_DATA_URL = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

const THUMBNAIL_PATH = `${REACT_APP_DIR}/thumbnail.png`;
const ACTOR_PATH = `${REACT_APP_DIR}/actor.yaml`;

const appWithThumbnail = (dataUrl = PNG_DATA_URL) => makeDoc([makeReactAppActor({ thumbnail: { dataUrl } })]);

const actorYaml = (files: Record<string, string>): Record<string, unknown> =>
  parseYamlDoc(files[ACTOR_PATH]) as Record<string, unknown>;

const withActorYaml = (files: Record<string, string>, change: (doc: Record<string, unknown>) => void): Record<string, string> => {
  const doc = actorYaml(files);
  change(doc);
  return { ...files, [ACTOR_PATH]: stringifyYamlDoc(doc) };
};

describe('thumbnail image helpers', () => {
  it('sniffs the four accepted formats and nothing else', () => {
    expect(sniffThumbnailMimeType(PNG)).toBe('image/png');
    expect(sniffThumbnailMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffThumbnailMimeType(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffThumbnailMimeType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffThumbnailMimeType(SVG)).toBeNull();
  });

  it('builds the data URL from the bytes, not the file name', () => {
    expect(thumbnailDataUrl(JPEG, 'shot.png')).toBe(JPEG_DATA_URL);
  });

  it('falls back to the extension, and refuses only when neither names an image', () => {
    expect(thumbnailDataUrl(Buffer.from('not sniffable'), 'shot.webp')).toMatch(/^data:image\/webp;base64,/);
    expect(() => thumbnailDataUrl(SVG, 'logo.svg')).toThrow(/not a PNG, JPEG, WebP, or GIF/);
  });

  it('flags what the API is likely to refuse', () => {
    expect(thumbnailBytesProblem(PNG, 'a.png')).toBeUndefined();
    expect(thumbnailBytesProblem(Buffer.alloc(0), 'a.png')).toMatch(/empty/);
    expect(thumbnailBytesProblem(SVG, 'a.png')).toMatch(/SVG is not accepted/);
    const huge = Buffer.concat([PNG, Buffer.alloc(THUMBNAIL_MAX_BYTES)]);
    expect(thumbnailBytesProblem(huge, 'a.png')).toMatch(/at most 2\.00 MiB/);
  });

  it('decodes a data URL back to its bytes', () => {
    expect(decodeDataUrl(PNG_DATA_URL)).toEqual({ mimeType: 'image/png', bytes: PNG });
    expect(decodeDataUrl('https://example.com/a.png')).toBeUndefined();
  });
});

describe('bundle thumbnail externalization', () => {
  it('writes the thumbnail beside actor.yaml and leaves the file name as the marker', () => {
    const { files } = disassemble(appWithThumbnail());
    expect(files[THUMBNAIL_PATH]).toBe(PNG_DATA_URL);
    expect(actorYaml(files).thumbnail).toBe('thumbnail.png');
    expect(files[ACTOR_PATH]).not.toContain('base64');
  });

  it('names the file after the image type', () => {
    const { files } = disassemble(appWithThumbnail(JPEG_DATA_URL));
    expect(files[`${REACT_APP_DIR}/thumbnail.jpg`]).toBe(JPEG_DATA_URL);
    expect(actorYaml(files).thumbnail).toBe('thumbnail.jpg');
  });

  it('round-trips to the exported document, so pull-then-push is not an edit', () => {
    const doc = appWithThumbnail();
    const { doc: packed } = assembleBundle(disassemble(doc).files);
    expect(packed).toEqual(doc);
    expect(actorContentHash(packed.data.actors[REACT_APP_ID])).toBe(actorContentHash(doc.data.actors[REACT_APP_ID]));
  });

  it('keeps an inline image that would not round-trip byte for byte', () => {
    const odd = 'data:image/png;base64,' + 'iVBORw0KGgo'; // truncated base64 re-encodes differently
    const { files, warnings } = disassemble(appWithThumbnail(odd));
    expect(actorYaml(files).thumbnail).toEqual({ dataUrl: odd });
    expect(Object.keys(files).some((file) => file.endsWith('/thumbnail.png'))).toBe(false);
    expect(warnings.some((warning) => warning.includes('left inline'))).toBe(true);
  });

  it('passes a file reference through untouched', () => {
    const { files } = disassemble(makeDoc([makeReactAppActor({ thumbnail: { fileId: 'FILE01' } })]));
    expect(actorYaml(files).thumbnail).toEqual({ fileId: 'FILE01' });
  });

  it('packs a replaced image in place of the pulled one', () => {
    const files = { ...disassemble(appWithThumbnail()).files };
    delete files[THUMBNAIL_PATH];
    files[`${REACT_APP_DIR}/thumbnail.jpg`] = JPEG_DATA_URL;
    const edited = withActorYaml(files, (doc) => { doc.thumbnail = 'thumbnail.jpg'; });
    expect(assembleBundle(edited).doc.data.actors[REACT_APP_ID].thumbnail).toEqual({ dataUrl: JPEG_DATA_URL });
  });
});

describe('bundle thumbnail validation', () => {
  it('rejects a marker naming a missing file', () => {
    const files = { ...disassemble(appWithThumbnail()).files };
    delete files[THUMBNAIL_PATH];
    const { errors } = validateBundle(files);
    expect(errors).toContainEqual({ path: ACTOR_PATH, message: expect.stringContaining('no such file') });
    expect(() => assembleBundle(files)).toThrow(BundleValidationError);
  });

  it('rejects a marker that is not a thumbnail file name', () => {
    const files = withActorYaml(disassemble(appWithThumbnail()).files, (doc) => { doc.thumbnail = 'code/shot.png'; });
    expect(validateBundle(files).errors).toContainEqual({ path: ACTOR_PATH, message: expect.stringContaining('must name an image') });
  });

  it('only warns about an image the API is likely to refuse - the API decides', () => {
    const files = { ...disassemble(appWithThumbnail()).files, [THUMBNAIL_PATH]: anyBytesDataUrl(SVG) };
    const { errors, warnings } = validateBundle(files);
    expect(errors).toEqual([]);
    expect(warnings).toContainEqual({ path: THUMBNAIL_PATH, message: expect.stringContaining('SVG is not accepted') });
  });

  it('points at the marker for a thumbnail file actor.yaml does not name', () => {
    const files = withActorYaml(disassemble(appWithThumbnail()).files, (doc) => { delete doc.thumbnail; });
    expect(validateBundle(files).warnings).toContainEqual({ path: THUMBNAIL_PATH, message: expect.stringContaining('set `thumbnail: thumbnail.png`') });
  });
});

describe('bundle thumbnail on disk', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-thumbnail-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the image as bytes and reads it back as the same data URL', () => {
    const { files } = disassemble(appWithThumbnail());
    writeBundleDir(dir, files);
    expect(fs.readFileSync(path.join(dir, THUMBNAIL_PATH)).equals(PNG)).toBe(true);
    expect(readBundleDir(dir)).toEqual(files);
  });

  it('reads a screenshot dropped into the bundle, whatever its extension claims', () => {
    writeBundleDir(dir, disassemble(makeDoc([makeReactAppActor()])).files);
    fs.writeFileSync(path.join(dir, THUMBNAIL_PATH), JPEG);
    expect(readBundleDir(dir)[THUMBNAIL_PATH]).toBe(JPEG_DATA_URL);
  });

  it('leaves an unchanged image alone and deletes one the server no longer has', () => {
    const { files } = disassemble(appWithThumbnail());
    writeBundleDir(dir, files);
    expect(writeBundleDirIncremental(dir, files).write).toEqual([]);

    const plan = writeBundleDirIncremental(dir, disassemble(makeDoc([makeReactAppActor()])).files);
    expect(plan.delete).toContain(THUMBNAIL_PATH);
    expect(fs.existsSync(path.join(dir, THUMBNAIL_PATH))).toBe(false);
  });
});

describe('pushing a removed thumbnail', () => {
  it('sends thumbnail: null when the server has one and the bundle does not', () => {
    const server = appWithThumbnail();
    const local = makeDoc([makeReactAppActor()]);
    const baseline = { [REACT_APP_ID]: { editVersion: 1, contentHash: actorContentHash(server.data.actors[REACT_APP_ID]) } };
    const diff = diffCanvas(local, server, { localActorStates: baseline, serverActorVersions: { [REACT_APP_ID]: 1 } });

    const [operation] = toBatchOperations(diff, local, false, 0, server);
    expect(operation).toMatchObject({ type: 'update', actorId: REACT_APP_ID, data: { thumbnail: null } });
  });

  it('says nothing about thumbnails when the server has none', () => {
    const server = makeDoc([makeReactAppActor({ name: 'Old name' })]);
    const local = makeDoc([makeReactAppActor()]);
    const baseline = { [REACT_APP_ID]: { editVersion: 1, contentHash: actorContentHash(server.data.actors[REACT_APP_ID]) } };
    const diff = diffCanvas(local, server, { localActorStates: baseline, serverActorVersions: { [REACT_APP_ID]: 1 } });

    const [operation] = toBatchOperations(diff, local, false, 0, server);
    expect(operation.data).not.toHaveProperty('thumbnail');
  });
});
