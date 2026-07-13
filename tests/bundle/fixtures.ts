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
