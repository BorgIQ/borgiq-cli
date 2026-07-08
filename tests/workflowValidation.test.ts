import { describe, expect, it } from 'vitest';

import { validateYaml } from '../src/lib/workflowValidation.js';

const webhookActorYaml = (webhookConfig: string): string => `metadata:
  schemaVersion: v1.0
  source: BIQCanvas
actors:
  ACTR01kx1s177z1fye5zr5vs4dqhqp:
    type: WebhookTriggerActor
    version: 1
    name: Incoming webhook
    msgVar: incoming_webhook
    description: The Webhook Actor will create messages by receiving webhooks from any source to the actor"s webhook URL.
    isActive: true
    sourcePorts:
      - id: SPRTdefault
    continueOnError: false
    enableLTM: false
    enableSTM: false
    showInWorkspaceApps: true
    runtimeSlug: ''
    configuration:
${webhookConfig}
      options:
        webhook:
          respondImmediately: true
          emitRawBody: false
          response:
            statusCode: 200
            headers:
              content-type: text/plain; charset=utf-8
            body: OK
    schemas: {}
    edges: {}
`;

describe('validateYaml webhook trigger config', () => {
  it('accepts the platform nested webhook trigger key', async () => {
    const result = await validateYaml(webhookActorYaml(`      webhook:
        triggerKey: 01KX1S1781SRQVT71ZQN2YBYZ6
        authorizationLevel: public
        allowedMethods:
          - get
          - post
        responseTimeout: 30`), true);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports the current nested trigger key path when missing', async () => {
    const result = await validateYaml(webhookActorYaml(`      webhook:
        authorizationLevel: public
        allowedMethods:
          - get
          - post
        responseTimeout: 30`), true);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('configuration.webhook.triggerKey');
  });
});
