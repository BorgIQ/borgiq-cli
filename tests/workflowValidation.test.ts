import { describe, expect, it } from 'vitest';

import { validateYaml } from '../src/lib/workflowValidation.js';

const SCHEDULED_ID = 'ACTR01hrsq62h5dd6v7e2zf1h7nnrd';
const HTTP_ID = 'ACTR01hrsq62h5dd6v7e2zf1h7nnre';

function scheduledWorkflow(configuration: string): string {
  return `metadata:
  schemaVersion: v1.0
  source: BIQCanvas
actors:
  ${SCHEDULED_ID}:
    type: ScheduledTriggerActor
    version: 1
    name: Every Hour
    description: Fires once an hour
    msgVar: every_hour
    isActive: true
    continueOnError: false
    enableLTM: false
    enableSTM: false
    sourcePorts:
      - id: SPRTdefault
    configuration:
${configuration}
    id: ${SCHEDULED_ID}
    position:
      x: 0
      'y': 0
    edges: {}
`;
}

function httpWorkflow(connection: string): string {
  return `metadata:
  schemaVersion: v1.0
  source: BIQCanvas
actors:
  ${HTTP_ID}:
    type: HttpRequestActor
    version: 1
    name: Fetch Profile
    description: Fetches the current user profile
    msgVar: fetch_profile
    isActive: true
    continueOnError: false
    enableLTM: false
    enableSTM: false
    sourcePorts:
      - id: SPRTdefault
    configuration:
      options:
        url: https://api.example.com/me
        method: GET
        auth: \${{ connection.auth }}
${connection}
    id: ${HTTP_ID}
    position:
      x: 0
      'y': 0
    edges: {}
`;
}

describe('ScheduledTriggerActor schedule config', () => {
  it('accepts the cron on the static configuration.schedule sibling', async () => {
    const result = await validateYaml(
      scheduledWorkflow(`      options: {}\n      schedule:\n        cron: '0 * * * *'`),
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a timezone alongside the cron', async () => {
    const result = await validateYaml(
      scheduledWorkflow(
        `      options: {}\n      schedule:\n        cron: '0 9 * * 1-5'\n        timezone: America/New_York`,
      ),
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a cron placed in the interpolated options blob', async () => {
    const result = await validateYaml(
      scheduledWorkflow(`      options:\n        schedule: '0 * * * *'`),
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain("Missing required 'configuration.schedule'");
  });

  it('rejects an invalid cron expression', async () => {
    const result = await validateYaml(
      scheduledWorkflow(`      options: {}\n      schedule:\n        cron: 'not-a-cron'`),
      true,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('Invalid cron expression');
  });
});

describe('connection key', () => {
  it('warns rather than errors when a connection has no key', async () => {
    const result = await validateYaml(httpWorkflow(`      connection:\n        type: gmail`), true);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.join('\n')).toContain("'connection' has no 'key'");
  });

  it('is silent when the connection is fully bound', async () => {
    const result = await validateYaml(
      httpWorkflow(`      connection:\n        key: my-gmail\n        type: gmail`),
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings.join('\n')).not.toContain("'connection' has no 'key'");
  });

  it('accepts an array of acceptable connection types', async () => {
    const result = await validateYaml(
      httpWorkflow(`      connection:\n        key: my-github\n        type:\n          - github-oauth2\n          - github-pat`),
      true,
    );

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
