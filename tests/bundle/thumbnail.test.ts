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
  isThumbnailBundlePath,
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
/** Signatures only, as for JPEG. */
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ');
const GIF = Buffer.from('GIF89a......');
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}`;

const THUMBNAIL_PATH = `${REACT_APP_DIR}/thumbnail.png`;
const ACTOR_PATH = `${REACT_APP_DIR}/actor.yaml`;

const appWithThumbnail = (dataUrl = PNG_DATA_URL) => makeDoc([makeReactAppActor({ thumbnail: { dataUrl } })]);
const appWithoutThumbnail = () => makeDoc([makeReactAppActor()]);

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

  it('sniffs both GIF versions, and not a RIFF container that is not WebP', () => {
    expect(sniffThumbnailMimeType(Buffer.from('GIF87a......'))).toBe('image/gif');
    expect(sniffThumbnailMimeType(Buffer.from('GIF88a......'))).toBeNull();
    expect(sniffThumbnailMimeType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffThumbnailMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('reads .jpeg and an upper-case extension as the type when the bytes do not say', () => {
    expect(thumbnailDataUrl(Buffer.from('not sniffable'), 'shot.jpeg')).toMatch(/^data:image\/jpeg;base64,/);
    expect(thumbnailDataUrl(Buffer.from('not sniffable'), 'SHOT.PNG')).toMatch(/^data:image\/png;base64,/);
    expect(() => thumbnailDataUrl(Buffer.from('not sniffable'), 'thumbnail')).toThrow(/not a PNG, JPEG, WebP, or GIF/);
  });

  it('labels bytes that are not an image as octet-stream rather than dropping them', () => {
    expect(anyBytesDataUrl(SVG)).toBe(`data:application/octet-stream;base64,${SVG.toString('base64')}`);
    expect(anyBytesDataUrl(WEBP)).toMatch(/^data:image\/webp;base64,/);
  });

  it.each([
    [`${REACT_APP_DIR}/thumbnail.png`, true],
    [`${REACT_APP_DIR}/thumbnail.jpg`, true],
    [`${REACT_APP_DIR}/thumbnail.jpeg`, true],
    [`${REACT_APP_DIR}/thumbnail.webp`, true],
    [`${REACT_APP_DIR}/thumbnail.gif`, true],
    [`${REACT_APP_DIR}/thumbnail.svg`, false],
    [`${REACT_APP_DIR}/thumbnail.PNG`, false],
    [`${REACT_APP_DIR}/screenshot.png`, false],
    // a project's own image of the same name is project source, not the actor's thumbnail
    [`${REACT_APP_DIR}/code/thumbnail.png`, false],
    [`${REACT_APP_DIR}/code/public/thumbnail.png`, false],
    ['actors/triggers/react-app/thumbnail.png', false],
    ['actors/thumbnail.png', false],
    ['thumbnail.png', false],
    [`bundle/${REACT_APP_DIR}/thumbnail.png`, false],
  ])('isThumbnailBundlePath(%s) is %s', (bundlePath, expected) => {
    expect(isThumbnailBundlePath(bundlePath)).toBe(expected);
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

  it.each([
    ['WebP', WEBP, 'image/webp', 'thumbnail.webp'],
    ['GIF', GIF, 'image/gif', 'thumbnail.gif'],
  ])('externalizes a %s image and packs it back to the same document', (_label, bytes, mimeType, fileName) => {
    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
    const doc = appWithThumbnail(dataUrl);
    const { files, warnings } = disassemble(doc);
    expect(files[`${REACT_APP_DIR}/${fileName}`]).toBe(dataUrl);
    expect(actorYaml(files).thumbnail).toBe(fileName);
    expect(warnings).toEqual([]);
    expect(assembleBundle(files).doc).toEqual(doc);
  });

  it('keeps a data URL that is not an image inline, even though it round-trips', () => {
    const { files, warnings } = disassemble(appWithThumbnail(PDF_DATA_URL));
    expect(actorYaml(files).thumbnail).toEqual({ dataUrl: PDF_DATA_URL });
    expect(Object.keys(files).filter((file) => file.includes('/thumbnail.'))).toEqual([]);
    expect(warnings.some((warning) => warning.includes(REACT_APP_ID) && warning.includes('left inline'))).toBe(true);
  });

  it('keeps an image whose declared type is not what its bytes are inline', () => {
    const mislabelled = `data:image/png;base64,${JPEG.toString('base64')}`; // the reader would rebuild it as image/jpeg
    const { files, warnings } = disassemble(appWithThumbnail(mislabelled));
    expect(actorYaml(files).thumbnail).toEqual({ dataUrl: mislabelled });
    expect(warnings.some((warning) => warning.includes('left inline'))).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'thumbnail.png'],
    ['a data URL with other keys beside it', { dataUrl: PNG_DATA_URL, fileId: 'FILE01' }],
  ])('passes %s through untouched, writing no image and warning about nothing', (_label, thumbnail) => {
    const { files, warnings } = disassemble(makeDoc([makeReactAppActor({ thumbnail } as Record<string, unknown>)]));
    expect(actorYaml(files).thumbnail).toEqual(thumbnail);
    expect(files[THUMBNAIL_PATH]).toBeUndefined();
    expect(warnings).toEqual([]);
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

  it('accepts a pulled thumbnail without a finding', () => {
    expect(validateBundle(disassemble(appWithThumbnail()).files)).toMatchObject({ errors: [], warnings: [] });
  });

  it('accepts thumbnail.jpeg as a marker', () => {
    const files = { ...disassemble(appWithoutThumbnail()).files, [`${REACT_APP_DIR}/thumbnail.jpeg`]: JPEG_DATA_URL };
    const named = withActorYaml(files, (doc) => { doc.thumbnail = 'thumbnail.jpeg'; });
    expect(validateBundle(named)).toMatchObject({ errors: [], warnings: [] });
    expect(assembleBundle(named).doc.data.actors[REACT_APP_ID].thumbnail).toEqual({ dataUrl: JPEG_DATA_URL });
  });

  it.each([
    ['an inline data URL', { dataUrl: PNG_DATA_URL }],
    ['a file reference', { fileId: 'FILE01' }],
    ['null', null],
  ])('leaves %s in actor.yaml to the API, and packs it as written', (_label, thumbnail) => {
    const files = withActorYaml(disassemble(appWithoutThumbnail()).files, (doc) => { doc.thumbnail = thumbnail; });
    expect(validateBundle(files)).toMatchObject({ errors: [], warnings: [] });
    expect(assembleBundle(files).doc.data.actors[REACT_APP_ID].thumbnail).toEqual(thumbnail);
  });

  it('only warns about an image over the size cap', () => {
    const huge = anyBytesDataUrl(Buffer.concat([PNG, Buffer.alloc(THUMBNAIL_MAX_BYTES)]));
    const { errors, warnings } = validateBundle({ ...disassemble(appWithThumbnail()).files, [THUMBNAIL_PATH]: huge });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([{ path: THUMBNAIL_PATH, message: expect.stringMatching(/^thumbnail\.png is 2\.00 MiB; a thumbnail may be at most 2\.00 MiB\..* The push will likely be refused\.$/) }]);
  });

  it('warns when the image entry is not a data URL at all', () => {
    const { errors, warnings } = validateBundle({ ...disassemble(appWithThumbnail()).files, [THUMBNAIL_PATH]: 'not a data URL' });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([{ path: THUMBNAIL_PATH, message: 'thumbnail.png could not be read as an image. The push will likely be refused.' }]);
  });

  // Pins today's report: the bad marker is the error, and the image it failed to name is called
  // out as unused rather than as "not referenced by canvas.yaml".
  it('reports a bad marker and the now-unused image beside it', () => {
    const files = withActorYaml(disassemble(appWithThumbnail()).files, (doc) => { doc.thumbnail = 'Thumbnail.PNG'; });
    const { errors, warnings } = validateBundle(files);
    expect(errors).toEqual([{ path: ACTOR_PATH, message: expect.stringContaining("thumbnail 'Thumbnail.PNG' must name an image") }]);
    expect(warnings).toEqual([{ path: THUMBNAIL_PATH, message: expect.stringContaining('Thumbnail image is not used') }]);
  });

  it('still reports any other stray file as ignored', () => {
    const files = { ...disassemble(appWithThumbnail()).files, [`${REACT_APP_DIR}/thumbnail.svg`]: '<svg/>' };
    expect(validateBundle(files).warnings).toEqual([{ path: `${REACT_APP_DIR}/thumbnail.svg`, message: 'File is not referenced by canvas.yaml - it will be ignored.' }]);
  });

  // Validation gates assembly, so a marker without its image never packs as `{ dataUrl: undefined }`.
  it('refuses to pack a marker whose image is missing, naming the file', () => {
    const files = { ...disassemble(appWithThumbnail()).files };
    delete files[THUMBNAIL_PATH];
    const packing = () => assembleBundle(files);
    expect(packing).toThrow(BundleValidationError);
    try {
      packing();
    } catch (error) {
      expect((error as BundleValidationError).errors).toEqual([{ path: ACTOR_PATH, message: 'thumbnail names thumbnail.png, but there is no such file beside actor.yaml.' }]);
    }
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

  it('swaps the file when the server image changes type, leaving no stale thumbnail.png', () => {
    writeBundleDir(dir, disassemble(appWithThumbnail()).files);

    const pulled = disassemble(appWithThumbnail(JPEG_DATA_URL)).files;
    const plan = writeBundleDirIncremental(dir, pulled);

    expect(plan.write).toContain(`${REACT_APP_DIR}/thumbnail.jpg`);
    expect(plan.write).toContain(ACTOR_PATH);
    expect(plan.delete).toEqual([THUMBNAIL_PATH]);
    expect(fs.existsSync(path.join(dir, THUMBNAIL_PATH))).toBe(false);
    expect(fs.readFileSync(path.join(dir, REACT_APP_DIR, 'thumbnail.jpg')).equals(JPEG)).toBe(true);
    expect(readBundleDir(dir)).toEqual(pulled);
  });

  it('rewrites an image whose bytes changed under the same name', () => {
    writeBundleDir(dir, disassemble(appWithThumbnail()).files);
    fs.writeFileSync(path.join(dir, THUMBNAIL_PATH), JPEG);

    const plan = writeBundleDirIncremental(dir, disassemble(appWithThumbnail()).files);

    expect(plan.write).toEqual([THUMBNAIL_PATH]);
    expect(fs.readFileSync(path.join(dir, THUMBNAIL_PATH)).equals(PNG)).toBe(true);
  });

  it('replaces the thumbnail of an existing bundle under --force, and refuses without it', () => {
    writeBundleDir(dir, disassemble(appWithThumbnail()).files);
    const replacement = disassemble(appWithThumbnail(JPEG_DATA_URL)).files;

    expect(() => writeBundleDir(dir, replacement)).toThrow(/pass --force/);
    expect(fs.readFileSync(path.join(dir, THUMBNAIL_PATH)).equals(PNG)).toBe(true);

    writeBundleDir(dir, replacement, { force: true });
    expect(fs.existsSync(path.join(dir, THUMBNAIL_PATH))).toBe(false);
    expect(readBundleDir(dir)).toEqual(replacement);
  });

  it('writes an entry at a thumbnail path that is not a data URL as the text it is', () => {
    const files = { ...disassemble(appWithThumbnail()).files, [THUMBNAIL_PATH]: 'not a data URL' };
    writeBundleDir(dir, files);
    expect(fs.readFileSync(path.join(dir, THUMBNAIL_PATH), 'utf-8')).toBe('not a data URL');
    expect(writeBundleDirIncremental(dir, files).write).toEqual([]);
  });

  it('reads a file that is not an image so validate can name it, instead of dropping it', () => {
    writeBundleDir(dir, disassemble(appWithThumbnail()).files);
    fs.writeFileSync(path.join(dir, THUMBNAIL_PATH), SVG);

    const files = readBundleDir(dir);
    expect(files[THUMBNAIL_PATH]).toBe(anyBytesDataUrl(SVG));
    expect(validateBundle(files).warnings).toContainEqual({ path: THUMBNAIL_PATH, message: expect.stringContaining('SVG is not accepted') });
  });

  it("reads a project's own thumbnail.png as project source, not as the actor's thumbnail", () => {
    writeBundleDir(dir, disassemble(appWithoutThumbnail()).files);
    fs.writeFileSync(path.join(dir, REACT_APP_DIR, 'code', 'thumbnail.png'), PNG);
    const files = readBundleDir(dir);
    expect(Object.values(files).some((content) => content.startsWith('data:image/png'))).toBe(false);
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

  const baselineOf = (doc: ReturnType<typeof makeDoc>) => ({ [REACT_APP_ID]: { editVersion: 1, contentHash: actorContentHash(doc.data.actors[REACT_APP_ID]) } });
  const pushDiff = (local: ReturnType<typeof makeDoc>, server: ReturnType<typeof makeDoc>, baseline = server, serverVersion = 1) =>
    diffCanvas(local, server, { localActorStates: baselineOf(baseline), serverActorVersions: { [REACT_APP_ID]: serverVersion } });

  it('says nothing about thumbnails when it is not given the server document', () => {
    const local = appWithoutThumbnail();
    const [operation] = toBatchOperations(pushDiff(local, appWithThumbnail()), local, false, 0);
    expect(operation.type).toBe('update');
    expect(operation.data).not.toHaveProperty('thumbnail');
  });

  it('says nothing about thumbnails when the server has it as null', () => {
    const server = makeDoc([makeReactAppActor({ name: 'Old name', thumbnail: null } as Record<string, unknown>)]);
    const local = appWithoutThumbnail();
    const [operation] = toBatchOperations(pushDiff(local, server), local, false, 0, server);
    expect(operation.type).toBe('update');
    expect(operation.data).not.toHaveProperty('thumbnail');
  });

  it('sends thumbnail: null under --force-local when the server gained one the bundle never had', () => {
    const local = appWithoutThumbnail();
    const server = appWithThumbnail();
    const diff = pushDiff(local, server, local, 2);
    expect(diff.entries.map((entry) => entry.verdict)).toEqual(['server-edit']);

    expect(toBatchOperations(diff, local, false, 0, server)).toEqual([]);
    const [operation] = toBatchOperations(diff, local, true, 0, server);
    expect(operation).toMatchObject({ type: 'update', actorId: REACT_APP_ID, editVersion: 2, data: { thumbnail: null } });
  });

  it('sends thumbnail: null under --force-local over a concurrent edit', () => {
    const local = makeDoc([makeReactAppActor({ name: 'Renamed locally' })]);
    const server = appWithThumbnail();
    const diff = pushDiff(local, server, appWithoutThumbnail(), 2);
    expect(diff.entries.map((entry) => entry.verdict)).toEqual(['concurrent-edit']);

    const [operation] = toBatchOperations(diff, local, true, 0, server);
    expect(operation).toMatchObject({ type: 'update', data: { name: 'Renamed locally', thumbnail: null } });
  });

  it('never puts thumbnail: null on an add', () => {
    const local = appWithoutThumbnail();
    const server = makeDoc([]);
    const diff = diffCanvas(local, server, {});
    expect(diff.entries.map((entry) => entry.verdict)).toEqual(['new-local']);

    const [operation] = toBatchOperations(diff, local, false, 0, server);
    expect(operation.type).toBe('add');
    expect(operation.data).not.toHaveProperty('thumbnail');
  });

  it('sees a thumbnail added to the bundle as a local edit, and sends the image', () => {
    const server = appWithoutThumbnail();
    const local = appWithThumbnail();
    const diff = pushDiff(local, server);
    expect(diff.entries.map((entry) => entry.verdict)).toEqual(['local-edit']);

    const [operation] = toBatchOperations(diff, local, false, 0, server);
    expect(operation.data).toMatchObject({ thumbnail: { dataUrl: PNG_DATA_URL } });
  });

  it('sees a PNG swapped for a JPEG in the bundle as a local edit', () => {
    const server = appWithThumbnail();
    const files = { ...disassemble(server).files };
    delete files[THUMBNAIL_PATH];
    files[`${REACT_APP_DIR}/thumbnail.jpg`] = JPEG_DATA_URL;
    const local = assembleBundle(withActorYaml(files, (doc) => { doc.thumbnail = 'thumbnail.jpg'; })).doc;

    const diff = pushDiff(local, server);
    expect(diff.entries.map((entry) => entry.verdict)).toEqual(['local-edit']);
    const [operation] = toBatchOperations(diff, local, false, 0, server);
    expect(operation.data).toMatchObject({ thumbnail: { dataUrl: JPEG_DATA_URL } });
  });
});
