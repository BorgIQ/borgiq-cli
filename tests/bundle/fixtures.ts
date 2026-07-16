import type { CanvasExportDocument, ExportedActor } from '../../src/lib/bundle/types.js';

export const makeActor = (over: Partial<ExportedActor> & { id: string; type: string }): ExportedActor => ({
  version: 1,
  name: over.id,
  msgVar: over.id.toLowerCase(),
  description: '',
  isActive: true,
  sourcePorts: [{ id: 'SPRTdefault' }],
  continueOnError: false,
  enableLTM: false,
  enableSTM: false,
  configuration: { options: {} },
  schemas: {},
  edges: {},
  position: { x: 0, y: 0 },
  ...over,
});

export const makeDoc = (actors: ExportedActor[], metadata?: Record<string, unknown>): CanvasExportDocument => ({
  metadata: {
    id: 'CNVS01aaaaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'test-canvas',
    name: 'Test Canvas',
    description: '',
    tags: '',
    imagePath: null,
    messageTTLInDays: 7,
    runtimeSlug: '',
    ...metadata,
  },
  data: {
    schemaVersion: '1',
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
  },
});

export const TRIGGER_ID = 'ACTR01trigger00000000000000000';
export const TASK_ID = 'ACTR01task000000000000000000000';
export const EDGE_ID = 'EDGE01edge000000000000000000000';
export const REACT_APP_ID = 'ACTR01reactapp000000000000000';
export const REACT_APP_DIR = `actors/triggers/react-app/${REACT_APP_ID}`;

/**
 * A minimal project tree that passes every template heuristic the checker warns on.
 * Kept sorted by path: that is the canonical order a normalized export and a bundle
 * rebuilt from disk both produce.
 */
export const REACT_APP_PROJECT: { path: string; content: string }[] = [
  { path: 'index.html', content: '<!doctype html>\n<div id="root"></div>\n' },
  {
    path: 'package.json',
    content: '{\n  "name": "app",\n  "scripts": { "build": "tsc -b && vite build" }\n}\n',
  },
  { path: 'src/App.tsx', content: 'export default function App() {\n  return <h1>hi</h1>\n}\n' },
  { path: 'src/main.tsx', content: "import App from './App.tsx'\n" },
  {
    path: 'vite.config.ts',
    content: [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      "  base: './',",
      '  build: {',
      '    cssCodeSplit: false,',
      '    assetsInlineLimit: 0,',
      '    rollupOptions: { output: { inlineDynamicImports: true } },',
      '  },',
      '})',
      '',
    ].join('\n'),
  },
];

export const makeReactAppActor = (over: Partial<ExportedActor> = {}): ExportedActor =>
  makeActor({
    id: REACT_APP_ID,
    type: 'ReactAppTriggerActor',
    name: 'My App',
    sourcePorts: [],
    configuration: {
      codeDir: REACT_APP_PROJECT.map((file) => ({ ...file })),
      options: { files: [], endpoints: [] },
    },
    ...over,
  });

export const makeWiredDoc = (): CanvasExportDocument =>
  makeDoc([
    makeActor({
      id: TRIGGER_ID,
      type: 'WebhookTriggerActor',
      name: 'Incoming hook',
      webhookTriggerKey: '01hxxxxxxxxxxxxxxxxxxxxxxxxx',
      edges: {
        [EDGE_ID]: {
          id: EDGE_ID,
          sourceActorId: TRIGGER_ID,
          sourcePortId: 'SPRTdefault',
          targetActorId: TASK_ID,
          targetPortId: 'TPRTdefault',
          type: 'borgiqEdge',
        },
      },
    }),
    makeActor({
      id: TASK_ID,
      type: 'DenoActor',
      name: 'Process',
      position: { x: 320, y: 0 },
      configuration: {
        code: 'export default async function receive(req) {\n  return { results: {}, memory: req.memory };\n}\n',
        inputs: {},
        options: { allowNet: true, allowFs: true },
      },
    }),
  ]);
