
/**
 * Unified validation and post-processing script for BorgIQ actor YAML files.
 *
 * Commands:
 *   validate-and-post-process.ts validate [options] <file.yaml>   - Validate YAML structure and content
 *   validate-and-post-process.ts post-process [options] <file.yaml> - Clean up unnecessary fields
 *
 * Validate options:
 *   --skip-typecheck  Skip TypeScript/Python validation for DenoActor/PythonActor code
 *
 * Post-process options:
 *   -i, --in-place    Modify the file in place
 *
 * Examples:
 *   npx tsx scripts/validate-and-post-process.ts validate workflow.yaml
 *   npx tsx scripts/validate-and-post-process.ts validate --skip-typecheck workflow.yaml
 *   npx tsx scripts/validate-and-post-process.ts post-process -i workflow.yaml
 *   cat workflow.yaml | npx tsx scripts/validate-and-post-process.ts validate
 */

import { parse, stringify } from "yaml";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";

/**
 * Returns true if `bin` is runnable on this machine. Used to make the
 * Deno/Python code typecheck best-effort: if the runtime is not installed we
 * skip (warn) instead of reporting a spurious validation failure.
 */
function commandExists(bin: string): boolean {
  const res = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return !res.error;
}

// ============================================================
// Shared Interfaces
// ============================================================

interface SourcePort {
  id?: string;
  name?: string;
  description?: string;
}

interface InterfacePageChild {
  key?: string;
  type?: string;
  value?: unknown;
  label?: string;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ label?: string; value?: unknown }>;
  // webViewer properties
  html?: string;
  src?: string;
  fullScreen?: boolean;
  allowedStyleDomains?: string[];
  allowedScriptDomains?: string[];
  allowAllStyling?: boolean;
  allowAllScripts?: boolean;
  allowedPermissions?: string[];
}

interface FlowEdge {
  id?: string;
  sourceActorId?: string;
  sourcePortId?: string;
  targetActorId?: string;
  targetPortId?: string;
  label?: string;
  type?: string;
}

interface InterfacePage {
  children?: InterfacePageChild[];
}

interface InterfaceTriggerOptions {
  page?: InterfacePage;
  onSubmit?: {
    type?: string;
    successMessage?: string;
    loadingMessage?: string;
    url?: string;
  };
  defaultValues?: Record<string, unknown>;
  autoSubmitAfterSeconds?: number;
}

interface AppTriggerOptions {
  html?: string | Record<string, unknown>;  // string or BIQFile
  css?: string | Record<string, unknown>;   // string or BIQFile
  script?: string | Record<string, unknown>; // string or BIQFile
  allowedScriptDomains?: string[];
  allowedStyleDomains?: string[];
  allowAllScripts?: boolean;
  allowAllStyling?: boolean;
  allowedPermissions?: string[];
}

interface MessageProcessorOptions {
  action?: string;
  // inject
  payload?: unknown;
  // delayBySeconds
  seconds?: number;
  // delayUntil
  until?: string;
  // filter
  filter?: boolean;
  // split
  valueToSplit?: unknown[];
  emitKey?: string;
  limit?: number;
  // collect
  splitId?: string;
  size?: number;
  captureValue?: unknown;
  if?: boolean;
  // fork - no additional options
  // forkJoin
  forkId?: string;
  // dedupeByCount / dedupeByTime
  dedupeKey?: unknown;
  lookbackAsCount?: number;
  lookbackInSeconds?: number;
  emitAlways?: boolean;
  // issueCallbackToken
  expiresAfterInSeconds?: number;
  multipleResponse?: boolean;
  // waitForCallbackToken / notifyCallbackToken
  token?: string;
  timeoutInSeconds?: number;
  // renderTemplate
  template?: string;
  // regexExtract
  rules?: Array<{
    regex?: string;
    regexOptions?: string;
    extractFrom?: unknown;
    extractTo?: string;
  }>;
  // downloadFileUrl / downloadFileAsBase64
  file?: unknown;
  expiresInMinutes?: number;
  downloadAsAttachment?: boolean;
}


export interface ActorConfig {
  metadata?: {
    schemaVersion?: string;
    source?: string;
  };
  actors?: Record<string, {
    type?: string;
    version?: number;
    name?: string;
    msgVar?: string;
    description?: string;
    isActive?: boolean;
    enableLTM?: boolean;
    enableSTM?: boolean;
    sourcePorts?: SourcePort[];
    configuration?: {
      inputs?: Record<string, unknown>;
      vars?: Array<Record<string, unknown>>;
      webhook?: {
        triggerKey?: string;
        authorizationLevel?: string;
        allowedMethods?: string[];
        responseTimeout?: number;
      };
      webhookTriggerKey?: string;
      options?: {
        // HttpRequestActor options
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        queryParams?: Record<string, unknown>;
        body?: unknown;
        auth?: string;
        webhook?: {
          respondImmediately?: boolean;
          emitRawBody?: boolean;
          response?: { statusCode?: number; body?: unknown; headers?: unknown };
        };
        // DenoActor options (code is at configuration.code, NOT here)
        allowNet?: boolean;
        allowNetList?: string[];
        denyNetList?: string[];
        allowFs?: boolean;
        emitArrayAsSingleMessage?: boolean;
        // PythonActor options (code is at configuration.code, NOT here)
        dependencies?: string[];
        env?: Array<{ name: string; value?: string }>;
        // NOTE: 'code' should NOT be here - it belongs at configuration.code level
        code?: string; // Only for detection of incorrect placement
      };
      outputs?: unknown;
      connection?: {
        key?: string;
        type?: string;
      };
      error?: {
        if?: string;
        retryIf?: string;
        message?: string;
        includeResult?: boolean;
      };
      code?: string;
    };
    schemas?: {
      inputs?: Record<string, unknown>;
    };
    edges?: Record<string, FlowEdge>;
  }>;
}

// ============================================================
// Validation Constants
// ============================================================

const VALID_ACTOR_TYPES = [
  // Task Actors
  "HttpRequestActor",
  "DenoActor",
  "DenoTestActor",
  "PythonActor",
  "AiRouterActor",
  "RouterActor",
  "AiActor",
  "AiAgentActor",
  "AgentHarnessActor",
  "MessageProcessorActor",
  "WebhookResponseActor",
  "CallableResponseActor",
  "CallFlowActor",
  "InterfaceActor",
  "InterfaceStatusActor",
  "SendEmailActor",
  "DataStoreActor",
  "CollectionActor",
  // Trigger Actors
  "ButtonTriggerActor",
  "WebhookTriggerActor",
  "EmailTriggerActor",
  "InterfaceTriggerActor",
  "AppTriggerActor",
  "ScheduledTriggerActor",
  "CallableTriggerActor",
  "UniversalTriggerActor",
  "McpServerActor",
  // Non-functional Actors
  "CommentActor",
  "EchoActor",
] as const;

// Actors that require sourcePorts
const ACTORS_WITH_SOURCE_PORTS = ["AiRouterActor", "RouterActor", "InterfaceActor", "AiAgentActor"];

// InterfaceActor required source port IDs
const INTERFACE_ACTOR_EVENT_PORT = "SPRTevent00";
const INTERFACE_ACTOR_META_PORT = "SPRTdefault";

// AiAgentActor required source port IDs
const AI_AGENT_DONE_PORT = "SPRTdone000";
const AI_AGENT_STATUS_PORT = "SPRTdefault";

// Source port ID validation constants
const SOURCE_PORT_DEFAULT_ID = "SPRTdefault";
const SOURCE_PORT_PREFIX = "SPRT";
const SOURCE_PORT_ID_LENGTH = 11; // SPRT (4) + 7 random chars

// Target port ID validation constants
const TARGET_PORT_DEFAULT_ID = "TPRTdefault";

// Edge ID validation constants
const EDGE_PREFIX = "EDGE";
const EDGE_ID_LENGTH = 30; // EDGE (4) + 26 ULID chars

// Actor ID validation constants
const ACTOR_PREFIX = "ACTR";
const ACTOR_ID_LENGTH = 30; // ACTR (4) + 26 ULID chars

// ULID character set (Crockford's Base32 - excludes I, L, O, U)
const ULID_CHARS = "0123456789abcdefghjkmnpqrstvwxyz";
const ULID_REGEX = new RegExp(`^[${ULID_CHARS}]{26}$`);

// Valid MessageProcessorActor action types
const VALID_MESSAGE_PROCESSOR_ACTIONS = [
  "inject",
  "dedupeByCount",
  "dedupeByTime",
  "delayBySeconds",
  "delayUntil",
  "filter",
  "fork",
  "forkJoin",
  "collect",
  "split",
  "issueCallbackToken",
  "waitForCallbackToken",
  "notifyCallbackToken",
  "renderTemplate",
  "regexExtract",
  "downloadFileUrl",
  "downloadFileAsBase64",
];

// Actions that require LTM
const MESSAGE_PROCESSOR_LTM_ACTIONS = ["dedupeByCount", "dedupeByTime"];

// Actions that require STM
const MESSAGE_PROCESSOR_STM_ACTIONS = ["collect", "forkJoin"];


// Valid interface component types (BIQFormComponentType)
const VALID_INTERFACE_COMPONENT_TYPES = [
  // string type inputs
  "text",
  "textarea",
  "password",
  "pin",
  "code",
  "codeDiff",
  "markdownInput",
  // select type inputs
  "select",
  "suggest",
  "radio",
  "buttonGroup",
  // date inputs
  "dateTime",
  "date",
  "time",
  "calendar",
  "dateRange",
  "calendarRange",
  // number type inputs
  "number",
  "currency",
  "phoneNumber",
  "percentage",
  "rating",
  "slider",
  // boolean type inputs
  "checkbox",
  "switch",
  // any type inputs
  "anyCodeInput",
  "anyModal",
  // file inputs
  "fileInput",
  "fileButton",
  "audioRecordingInput",
  "fileDropzone",
  // object inputs
  "section",
  "collapse",
  "union",
  "conditional",
  // array inputs
  "arrayParent",
  "multiSelect",
  "multiCheckbox",
  "table",
  // display components
  "header",
  "divider",
  "progress",
  "formButton",
  "urlButton",
  "image",
  "markdown",
  "codeViewer",
  "pdfViewer",
  "fileDownload",
  "webViewer",
];

// ============================================================
// Post-Processing Logic
// ============================================================

// Actors that use edge labels (UI provides mechanism to edit them)
const ACTORS_WITH_EDGE_LABELS = ["AiRouterActor", "RouterActor"];

export interface PostProcessResult {
  modified: boolean;
  changes: string[];
  content: string;
}

export function postProcess(content: string): PostProcessResult {
  const changes: string[] = [];
  let modified = false;

  let parsed: ActorConfig;
  try {
    parsed = parse(content) as ActorConfig;
  } catch (e) {
    console.error(`YAML parse error: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!parsed.actors) {
    return { modified: false, changes: [], content };
  }

  for (const [actorId, actor] of Object.entries(parsed.actors)) {
    // Skip actors that use edge labels
    if (actor.type && ACTORS_WITH_EDGE_LABELS.includes(actor.type)) {
      continue;
    }

    // Insert empty schemas if missing
    if (actor.schemas === undefined || actor.schemas === null) {
      actor.schemas = {};
      changes.push(
        `Added empty 'schemas: {}' to actor '${actorId}'`
      );
      modified = true;
    }

    // Remove labels from edges for non-router actors
    if (actor.edges) {
      for (const [edgeId, edge] of Object.entries(actor.edges)) {
        if (edge.label !== undefined) {
          delete edge.label;
          changes.push(
            `Removed 'label' from edge '${edgeId}' in actor '${actorId}' (${actor.type})`
          );
          modified = true;
        }
      }
    }
  }

  // Stringify with consistent formatting
  const output = stringify(parsed, {
    lineWidth: 0, // Don't wrap lines
    defaultKeyType: "PLAIN",
    blockQuote: "literal",
  });

  return { modified, changes, content: output };
}

// ============================================================
// Validation Logic
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed?: ActorConfig;
}

/**
 * Extracts message variable references from code (e.g., msg.xxx, msg.xxx?., msg.xxx.)
 * Returns the list of variable names referenced (the "xxx" part)
 */
function extractMsgVarReferences(code: string): string[] {
  const msgVarPattern = /\bmsg\.(\w+)/g;
  const references: string[] = [];
  let match;

  while ((match = msgVarPattern.exec(code)) !== null) {
    const varName = match[1];
    if (!references.includes(varName)) {
      references.push(varName);
    }
  }

  return references;
}

/**
 * Validates that message variable references in code exist in the flow's defined msgVars
 */
function validateMsgVarReferences(
  actorId: string,
  code: string,
  allMsgVars: Set<string>,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;
  const referencedVars = extractMsgVarReferences(code);

  for (const varName of referencedVars) {
    if (!allMsgVars.has(varName)) {
      warnings.push(
        `${prefix}: Code references 'msg.${varName}' but no actor defines msgVar '${varName}'. ` +
        `Defined msgVars: ${[...allMsgVars].join(", ") || "(none)"}`,
      );
    }
  }
}

/**
 * Validates TypeScript/JavaScript code using deno check (called via Node.js child_process)
 */
async function validateDenoCode(
  code: string,
  actorId: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Actor '${actorId}'`;

  if (!commandExists("deno")) {
    warnings.push(`${prefix}: 'deno' not found on PATH — skipping TypeScript validation.`);
    return { errors, warnings };
  }

  // Strip out @borgiq/* imports and replace with local type definitions
  const processedCode = code
    .replace(/import\s+.*\s+from\s+["']@borgiq\/[^"']+["'];?\s*/g, "")
    .replace(/import\s+type\s+.*\s+from\s+["']@borgiq\/[^"']+["'];?\s*/g, "");

  // Create a wrapper that provides the BorgIQ type definitions
  const wrappedCode = `
// BorgIQ type definitions for validation
interface RuntimeContext {
  org: { id: string; name: string };
  workspace: { id: string; slug: string; name: string; denoActorTimeoutInSeconds: number };
  flow: { id: string; slug: string; name: string };
  flowrun: { id: string; createdAt: string };
  actor: { id: string; type: string; name: string; msgVar: string };
  trigger: { id: string; type: string; name: string };
  sourceActor?: { id: string; type: string; name: string; msgVar: string };
  sourceType: 'actor' | 'trigger';
  sourceMsgId?: string;
}

interface Actor {
  setSignal: (signal: any) => any;
  stm: { [key: string]: any };
  ltm: { [key: string]: any };
  ctx: RuntimeContext;
  connection: { auth: { values: { token?: string } } } & { [key: string]: any };
  credentials: { [key: string]: any };
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

// User code starts here
${processedCode}
`;

  // Create temp file for validation
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validate-"));
  const tempFile = path.join(tempDir, `validate_${actorId}.ts`);

  try {
    await fs.writeFile(tempFile, wrappedCode);

    // Run deno check
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn("deno", ["check", "--quiet", tempFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        resolve({ exitCode: 1, stdout: "", stderr: err.message });
      });

      proc.on("close", (exitCode: number | null) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });

    if (result.exitCode !== 0) {
      const output = result.stderr || result.stdout;

      const cleanedErrors = output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          let cleaned = line.replace(
            new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            "<code>",
          );
          cleaned = cleaned.replace(
            /<code>:(\d+):(\d+)/g,
            (_match, lineNum, colNum) => {
              const adjustedLine = Math.max(1, parseInt(lineNum) - 32);
              return `<code>:${adjustedLine}:${colNum}`;
            },
          );
          return cleaned;
        })
        .join("\n");

      errors.push(`${prefix}: TypeScript validation failed:\n${cleanedErrors}`);
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "ENOENT") {
      warnings.push(
        `${prefix}: Could not run 'deno check' - Deno binary not found. Skipping TypeScript validation.`,
      );
    } else {
      warnings.push(
        `${prefix}: TypeScript validation error: ${err.message}`,
      );
    }
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return { errors, warnings };
}

export async function validateYaml(
  content: string,
  skipTypecheck = false,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: ActorConfig;
  try {
    parsed = parse(content) as ActorConfig;
  } catch (e) {
    return {
      valid: false,
      errors: [`YAML parse error: ${(e as Error).message}`],
      warnings,
    };
  }

  if (!parsed.metadata) {
    errors.push("Missing 'metadata' section");
  } else {
    if (!parsed.metadata.schemaVersion) {
      errors.push("Missing 'metadata.schemaVersion'");
    }
  }

  if (!parsed.actors) {
    errors.push("Missing 'actors' section");
  } else {
    const actorIds = Object.keys(parsed.actors);
    if (actorIds.length === 0) {
      errors.push("No actors defined");
    }

    // Collect all msgVars from all actors for cross-reference validation
    const allMsgVars = new Set<string>();
    for (const actorId of actorIds) {
      const actor = parsed.actors[actorId];
      if (actor.msgVar) {
        allMsgVars.add(actor.msgVar);
      }
    }

    // Collect all actor IDs that are used as tools in AiAgentActors
    const toolActorIds = new Set<string>();
    for (const actorId of actorIds) {
      const actor = parsed.actors[actorId];
      if (actor.type === "AiAgentActor") {
        const aiAgentToolActorIds = (actor.configuration as { aiAgentToolActorIds?: string[] })?.aiAgentToolActorIds;
        if (aiAgentToolActorIds && Array.isArray(aiAgentToolActorIds)) {
          for (const toolId of aiAgentToolActorIds) {
            toolActorIds.add(toolId);
          }
        }
      }
    }

    for (const actorId of actorIds) {
      const actor = parsed.actors[actorId];
      const prefix = `Actor '${actorId}'`;

      // Validate actor ID format (must be ACTR + 26 valid ULID characters)
      if (!actorId.startsWith(ACTOR_PREFIX)) {
        errors.push(`${prefix}: ID must start with '${ACTOR_PREFIX}'`);
      } else if (actorId.length !== ACTOR_ID_LENGTH) {
        errors.push(
          `${prefix}: ID must be ${ACTOR_ID_LENGTH} characters (${ACTOR_PREFIX} + 26 ULID chars), got ${actorId.length}`,
        );
      } else {
        const ulidPart = actorId.substring(ACTOR_PREFIX.length);
        if (!ULID_REGEX.test(ulidPart)) {
          errors.push(
            `${prefix}: ID ULID part '${ulidPart}' contains invalid characters. ` +
            `ULID uses Crockford's Base32 (0-9, a-z excluding i, l, o, u). ` +
            `Use 'npx tsx generate.ts id actor' to generate a valid ID.`,
          );
        }
      }

      // Validate actor type
      if (!actor.type) {
        errors.push(`${prefix}: Missing 'type'`);
      } else if (!(VALID_ACTOR_TYPES as readonly string[]).includes(actor.type)) {
        errors.push(
          `${prefix}: Invalid type '${actor.type}'. Valid types: ${
            VALID_ACTOR_TYPES.join(", ")
          }`,
        );
      }

      // Common validations
      if (!actor.name) {
        errors.push(`${prefix}: Missing 'name'`);
      }

      if (!actor.description && actor.type !== "CommentActor") {
        errors.push(`${prefix}: Missing 'description'. Every actor must have a description explaining its purpose.`);
      }

      if (!actor.msgVar) {
        errors.push(`${prefix}: Missing 'msgVar'`);
      }

      if (!actor.configuration) {
        errors.push(`${prefix}: Missing 'configuration'`);
      } else {
        const config = actor.configuration;

        // Type-specific validations
        if (actor.type === "HttpRequestActor") {
          validateHttpRequestActor(actorId, config, errors, warnings);
        } else if (actor.type === "DenoActor") {
          const result = await validateDenoActor(
            actorId,
            config,
            skipTypecheck,
            allMsgVars,
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        } else if (actor.type === "PythonActor") {
          const result = await validatePythonActor(
            actorId,
            config,
            skipTypecheck,
            allMsgVars,
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        } else if (actor.type === "InterfaceTriggerActor") {
          validateInterfaceTriggerActor(actorId, config, errors, warnings);
        } else if (actor.type === "AppTriggerActor") {
          validateAppTriggerActor(actorId, config, errors, warnings);
        } else if (actor.type === "InterfaceActor") {
          validateInterfaceActor(actorId, config, actor.sourcePorts, errors, warnings);
        } else if (actor.type === "MessageProcessorActor") {
          validateMessageProcessorActor(
            actorId,
            config,
            actor,
            actor.sourcePorts,
            errors,
            warnings,
          );
        } else if (actor.type === "CallableTriggerActor") {
          validateCallableTriggerActor(actorId, config, errors, warnings);
        } else if (actor.type === "WebhookTriggerActor") {
          validateWebhookTriggerActor(actorId, config, errors, warnings);
        } else if (actor.type === "SendEmailActor") {
          validateSendEmailActor(actorId, config, errors, warnings);
        } else if (actor.type === "CommentActor") {
          validateCommentActor(actorId, config, actor, errors, warnings);
        } else if (actor.type === "ScheduledTriggerActor") {
          validateScheduledTriggerActor(actorId, config, errors, warnings);
        } else if (actor.type === "AiAgentActor") {
          validateAiAgentActor(actorId, config, actor.sourcePorts, errors, warnings);
        } else if (actor.type === "CallFlowActor") {
          validateCallFlowActor(actorId, config, actor.schemas, toolActorIds.has(actorId), errors, warnings);
        }
      }

      // Validate source ports for router actors
      if (actor.type && ACTORS_WITH_SOURCE_PORTS.includes(actor.type)) {
        validateSourcePorts(actorId, actor.sourcePorts, errors, warnings);
      }

      // Validate edges field exists (canvas parser requires 'edges' as a record, even if empty)
      if (actor.edges === undefined) {
        errors.push(`${prefix}: Missing 'edges' field. Add 'edges: {}' even for terminal actors with no outgoing connections`);
      }

      // Validate edges
      validateEdges(
        actorId,
        actor.edges,
        actor.sourcePorts,
        actorIds,
        errors,
        warnings,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings, parsed };
}

type ActorConfiguration = NonNullable<
  NonNullable<ActorConfig["actors"]>[string]["configuration"]
>;

function validateHttpRequestActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  if (!config.options.url) {
    errors.push(`${prefix}: Missing 'configuration.options.url'`);
  }

  if (!config.options.method) {
    errors.push(`${prefix}: Missing 'configuration.options.method'`);
  }

  // Validate auth/connection consistency
  if (config.options.auth && !config.connection) {
    errors.push(`${prefix}: 'auth' is set but 'connection' is missing`);
  }

  if (config.connection && !config.connection.key) {
    errors.push(
      `${prefix}: 'connection' is set but 'connection.key' is missing`,
    );
  }
}

function validateSourcePorts(
  actorId: string,
  sourcePorts: SourcePort[] | undefined,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!sourcePorts || sourcePorts.length === 0) {
    errors.push(
      `${prefix}: Missing 'sourcePorts' - router actors require at least one source port`,
    );
    return;
  }

  // Check for default port
  const hasDefaultPort = sourcePorts.some((port) =>
    port.id === SOURCE_PORT_DEFAULT_ID
  );
  if (!hasDefaultPort) {
    errors.push(
      `${prefix}: Missing default source port with id '${SOURCE_PORT_DEFAULT_ID}'`,
    );
  }

  // Validate each source port
  for (let i = 0; i < sourcePorts.length; i++) {
    const port = sourcePorts[i];
    const portPrefix = `${prefix} sourcePorts[${i}]`;

    if (!port.id) {
      errors.push(`${portPrefix}: Missing 'id'`);
      continue;
    }

    if (!port.name) {
      errors.push(`${portPrefix}: Missing 'name'`);
    }

    // Validate ID format
    const knownSpecialPortIds = [
      SOURCE_PORT_DEFAULT_ID,      // SPRTdefault
      INTERFACE_ACTOR_EVENT_PORT,  // SPRTevent00
      AI_AGENT_DONE_PORT,          // SPRTdone000
    ];

    if (!port.id.startsWith(SOURCE_PORT_PREFIX)) {
      errors.push(
        `${portPrefix}: ID '${port.id}' must start with '${SOURCE_PORT_PREFIX}'`,
      );
    } else if (knownSpecialPortIds.includes(port.id)) {
      // Known special port IDs are valid
    } else if (port.id.length !== SOURCE_PORT_ID_LENGTH) {
      errors.push(
        `${portPrefix}: ID '${port.id}' must be ${SOURCE_PORT_ID_LENGTH} characters (${SOURCE_PORT_PREFIX} + 7 random chars), got ${port.id.length}`,
      );
    } else {
      const randomPart = port.id.substring(SOURCE_PORT_PREFIX.length);
      if (!/^[a-z0-9]{7}$/.test(randomPart)) {
        errors.push(
          `${portPrefix}: ID '${port.id}' random part must be 7 lowercase alphanumeric characters`,
        );
      }
    }

    // Warn if description is missing
    if (!port.description) {
      warnings.push(
        `${portPrefix}: Missing 'description' for port '${port.name}'`,
      );
    }
  }

  // Check for duplicate IDs
  const ids = sourcePorts.map((p) => p.id).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    errors.push(
      `${prefix}: Duplicate source port IDs: ${
        [...new Set(duplicateIds)].join(", ")
      }`,
    );
  }

  // Check for duplicate names
  const names = sourcePorts.map((p) => p.name).filter(Boolean);
  const duplicateNames = names.filter((name, index) =>
    names.indexOf(name) !== index
  );
  if (duplicateNames.length > 0) {
    errors.push(
      `${prefix}: Duplicate source port names: ${
        [...new Set(duplicateNames)].join(", ")
      }`,
    );
  }
}

/**
 * Validates Python code using Python's syntax checker
 */
async function validatePythonCode(
  code: string,
  actorId: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Actor '${actorId}'`;

  if (!commandExists("python3")) {
    warnings.push(`${prefix}: 'python3' not found on PATH — skipping Python validation.`);
    return { errors, warnings };
  }

  // Create temp file for validation
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "validate-py-"));
  const tempFile = path.join(tempDir, `validate_${actorId}.py`);

  try {
    await fs.writeFile(tempFile, code);

    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
      const proc = spawn("python3", ["-m", "py_compile", tempFile], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("error", (err: Error) => {
        resolve({ exitCode: 1, stdout: "", stderr: err.message });
      });

      proc.on("close", (exitCode: number | null) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });

    if (result.exitCode !== 0) {
      const output = result.stderr || result.stdout;

      const cleanedErrors = output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          return line.replace(
            new RegExp(tempFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
            "<code>",
          );
        })
        .join("\n");

      errors.push(`${prefix}: Python syntax validation failed:\n${cleanedErrors}`);
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "ENOENT") {
      warnings.push(
        `${prefix}: Could not run 'python3' - Python binary not found. Skipping Python validation.`,
      );
    } else {
      warnings.push(
        `${prefix}: Python validation error: ${err.message}`,
      );
    }
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return { errors, warnings };
}

/**
 * Validates a PythonActor configuration
 */
async function validatePythonActor(
  actorId: string,
  config: ActorConfiguration,
  skipTypecheck = false,
  allMsgVars?: Set<string>,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Actor '${actorId}'`;

  // Check if code is incorrectly placed inside options
  if (config?.options?.code) {
    errors.push(
      `${prefix}: 'code' must be at 'configuration.code', NOT inside 'configuration.options.code'. Move 'code' to the same level as 'options'.`,
    );
    return { errors, warnings };
  }

  const code = config?.code;

  if (!code) {
    errors.push(
      `${prefix}: Missing 'configuration.code'. Code must be at the same level as 'options', not inside it.`,
    );
    return { errors, warnings };
  }

  // Basic structure checks for Python
  if (!code.includes("def receive")) {
    warnings.push(
      `${prefix}: Code should define a 'receive' function with signature: def receive(inputs: Dict[str, Any] = {}, actor = None) -> Any`,
    );
  }

  if (!code.includes("from typing import")) {
    warnings.push(
      `${prefix}: Consider importing 'Dict' and 'Any' from 'typing' module`,
    );
  }

  if (code.includes("mount_file") && !code.includes("from borgiq.actor import")) {
    warnings.push(
      `${prefix}: Using 'mount_file' but missing 'from borgiq.actor import mount_file'`,
    );
  }

  if (code.includes("stash_file") && !code.includes("from borgiq.actor import")) {
    warnings.push(
      `${prefix}: Using 'stash_file' but missing 'from borgiq.actor import stash_file'`,
    );
  }

  if (code.includes("RetryableError") && !code.includes("from borgiq.errors import")) {
    warnings.push(
      `${prefix}: Using 'RetryableError' but missing 'from borgiq.errors import RetryableError'`,
    );
  }

  // Validate dependencies format if present
  const dependencies = config?.options?.dependencies;
  if (dependencies && Array.isArray(dependencies)) {
    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      if (typeof dep !== "string") {
        errors.push(`${prefix}: dependencies[${i}] must be a string`);
        continue;
      }
      if (dep.trim().length === 0) {
        errors.push(`${prefix}: dependencies[${i}] is empty`);
      }
      if (!/^[a-zA-Z0-9\-_\[\],<>=!~.@]+$/.test(dep)) {
        warnings.push(
          `${prefix}: dependencies[${i}] '${dep}' contains unusual characters`,
        );
      }
    }
  }

  // Validate env variables format if present
  const envVars = config?.options?.env;
  if (envVars && Array.isArray(envVars)) {
    const reservedEnvNames = [
      "TMPDIR",
      "HOME",
      "PYTHONUNBUFFERED",
      "UV_CACHE_DIR",
      "UV_PROJECT_ENVIRONMENT",
      "PYTHONUSERBASE",
    ];
    const envNamePattern = /^[A-Z0-9_]+$/;

    for (let i = 0; i < envVars.length; i++) {
      const envVar = envVars[i];
      if (!envVar.name) {
        errors.push(`${prefix}: env[${i}] missing 'name'`);
        continue;
      }
      if (!envNamePattern.test(envVar.name)) {
        errors.push(
          `${prefix}: env[${i}].name '${envVar.name}' must contain only uppercase letters, numbers, and underscores`,
        );
      }
      if (reservedEnvNames.includes(envVar.name)) {
        errors.push(
          `${prefix}: env[${i}].name '${envVar.name}' is a reserved environment variable`,
        );
      }
    }

    const envNames = envVars.map((e) => e.name).filter(Boolean);
    const duplicateEnvNames = envNames.filter((name, index) =>
      envNames.indexOf(name) !== index
    );
    if (duplicateEnvNames.length > 0) {
      errors.push(
        `${prefix}: Duplicate environment variable names: ${
          [...new Set(duplicateEnvNames)].join(", ")
        }`,
      );
    }
  }

  // Validate message variable references in code
  if (allMsgVars) {
    validateMsgVarReferences(actorId, code, allMsgVars, errors, warnings);
  }

  // Validate Python syntax using Python compiler (unless skipped)
  if (!skipTypecheck) {
    const codeValidation = await validatePythonCode(code, actorId);
    errors.push(...codeValidation.errors);
    warnings.push(...codeValidation.warnings);
  }

  return { errors, warnings };
}

async function validateDenoActor(
  actorId: string,
  config: ActorConfiguration,
  skipTypecheck = false,
  allMsgVars?: Set<string>,
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `Actor '${actorId}'`;

  // Check if code is incorrectly placed inside options
  if (config?.options?.code) {
    errors.push(
      `${prefix}: 'code' must be at 'configuration.code', NOT inside 'configuration.options.code'. Move 'code' to the same level as 'options'.`,
    );
    return { errors, warnings };
  }

  const code = config?.code;

  if (!code) {
    errors.push(
      `${prefix}: Missing 'configuration.code'. Code must be at the same level as 'options', not inside it.`,
    );
    return { errors, warnings };
  }

  // Basic structure checks
  if (!code.includes("export default")) {
    warnings.push(
      `${prefix}: Code should have 'export default async function receive'`,
    );
  }

  if (!code.includes("receive")) {
    warnings.push(`${prefix}: Code should define a 'receive' function`);
  }

  if (code.includes("deno.land")) {
    warnings.push(`${prefix}: Use 'jsr:' imports instead of deno.land URLs`);
  }

  if (
    config?.options?.allowNet &&
    (!config?.options?.allowNetList || config.options.allowNetList.length === 0)
  ) {
    warnings.push(
      `${prefix}: 'allowNet' is true but 'allowNetList' is empty - all network access allowed`,
    );
  }

  const usesMountFile = code.includes("mountFile");
  const usesStashFile = code.includes("stashFile");
  if ((usesMountFile || usesStashFile) && !config?.options?.allowNet) {
    const functions = [
      usesMountFile ? "mountFile" : null,
      usesStashFile ? "stashFile" : null,
    ].filter(Boolean).join(" and ");
    errors.push(
      `${prefix}: Code uses ${functions} which requires network access. Set 'allowNet: true' in configuration.options.`,
    );
  }

  // Validate message variable references in code
  if (allMsgVars) {
    validateMsgVarReferences(actorId, code, allMsgVars, errors, warnings);
  }

  // Validate TypeScript/JavaScript syntax using Deno (unless skipped)
  if (!skipTypecheck) {
    const codeValidation = await validateDenoCode(code, actorId);
    errors.push(...codeValidation.errors);
    warnings.push(...codeValidation.warnings);
  }

  return { errors, warnings };
}

function validateMessageProcessorActor(
  actorId: string,
  config: ActorConfiguration,
  actor: { enableLTM?: boolean; enableSTM?: boolean },
  sourcePorts: SourcePort[] | undefined,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  // MessageProcessorActor must only have SPRTdefault sourcePort
  if (sourcePorts && sourcePorts.length > 0) {
    const invalidPorts = sourcePorts.filter(port => port.id !== SOURCE_PORT_DEFAULT_ID);
    if (invalidPorts.length > 0) {
      const invalidIds = invalidPorts.map(p => p.id).join(", ");
      errors.push(
        `${prefix}: MessageProcessorActor must only have '${SOURCE_PORT_DEFAULT_ID}' sourcePort. ` +
        `Found invalid sourcePorts: ${invalidIds}. ` +
        `Fork parallel paths are created via multiple edges, not multiple sourcePorts.`
      );
    }
    if (sourcePorts.length > 1) {
      errors.push(
        `${prefix}: MessageProcessorActor must have exactly one sourcePort (${SOURCE_PORT_DEFAULT_ID}), ` +
        `but found ${sourcePorts.length} sourcePorts.`
      );
    }
  }

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as MessageProcessorOptions;

  if (!options.action) {
    errors.push(`${prefix}: Missing 'configuration.options.action'`);
    return;
  }

  if (!VALID_MESSAGE_PROCESSOR_ACTIONS.includes(options.action)) {
    errors.push(
      `${prefix}: Invalid action '${options.action}'. Valid actions: ${
        VALID_MESSAGE_PROCESSOR_ACTIONS.join(", ")
      }`,
    );
    return;
  }

  // Check memory requirements
  if (
    MESSAGE_PROCESSOR_LTM_ACTIONS.includes(options.action) && !actor.enableLTM
  ) {
    warnings.push(
      `${prefix}: Action '${options.action}' requires 'enableLTM: true'`,
    );
  }

  if (
    MESSAGE_PROCESSOR_STM_ACTIONS.includes(options.action) && !actor.enableSTM
  ) {
    warnings.push(
      `${prefix}: Action '${options.action}' requires 'enableSTM: true'`,
    );
  }

  // Action-specific validations
  switch (options.action) {
    case "inject":
      if (options.payload === undefined) {
        errors.push(`${prefix}: Action 'inject' requires 'payload'`);
      }
      break;

    case "delayBySeconds":
      if (options.seconds === undefined) {
        errors.push(`${prefix}: Action 'delayBySeconds' requires 'seconds'`);
      } else if (typeof options.seconds === "number" && options.seconds <= 0) {
        errors.push(`${prefix}: 'seconds' must be greater than 0`);
      }
      break;

    case "delayUntil":
      if (!options.until) {
        errors.push(`${prefix}: Action 'delayUntil' requires 'until'`);
      }
      break;

    case "filter":
      if (options.filter === undefined) {
        errors.push(`${prefix}: Action 'filter' requires 'filter'`);
      }
      break;

    case "split":
      if (options.valueToSplit === undefined) {
        errors.push(`${prefix}: Action 'split' requires 'valueToSplit'`);
      }
      break;

    case "collect":
      if (!options.splitId) {
        errors.push(`${prefix}: Action 'collect' requires 'splitId'`);
      }
      if (options.size === undefined) {
        errors.push(`${prefix}: Action 'collect' requires 'size'`);
      }
      if (options.captureValue === undefined) {
        errors.push(`${prefix}: Action 'collect' requires 'captureValue'`);
      }
      break;

    case "forkJoin":
      if (!options.forkId) {
        errors.push(`${prefix}: Action 'forkJoin' requires 'forkId'`);
      }
      if (options.size === undefined) {
        errors.push(`${prefix}: Action 'forkJoin' requires 'size'`);
      }
      break;

    case "dedupeByCount":
      if (options.dedupeKey === undefined) {
        errors.push(`${prefix}: Action 'dedupeByCount' requires 'dedupeKey'`);
      }
      if (options.lookbackAsCount === undefined) {
        errors.push(
          `${prefix}: Action 'dedupeByCount' requires 'lookbackAsCount'`,
        );
      }
      if (options.emitAlways === undefined) {
        errors.push(`${prefix}: Action 'dedupeByCount' requires 'emitAlways'`);
      }
      break;

    case "dedupeByTime":
      if (options.dedupeKey === undefined) {
        errors.push(`${prefix}: Action 'dedupeByTime' requires 'dedupeKey'`);
      }
      if (options.lookbackInSeconds === undefined) {
        errors.push(
          `${prefix}: Action 'dedupeByTime' requires 'lookbackInSeconds'`,
        );
      }
      if (options.emitAlways === undefined) {
        errors.push(`${prefix}: Action 'dedupeByTime' requires 'emitAlways'`);
      }
      break;

    case "waitForCallbackToken":
      if (!options.token) {
        errors.push(
          `${prefix}: Action 'waitForCallbackToken' requires 'token'`,
        );
      }
      if (options.timeoutInSeconds === undefined) {
        errors.push(
          `${prefix}: Action 'waitForCallbackToken' requires 'timeoutInSeconds'`,
        );
      }
      break;

    case "notifyCallbackToken":
      if (!options.token) {
        errors.push(`${prefix}: Action 'notifyCallbackToken' requires 'token'`);
      }
      if (options.payload === undefined) {
        errors.push(
          `${prefix}: Action 'notifyCallbackToken' requires 'payload'`,
        );
      }
      break;

    case "renderTemplate":
      if (!options.template) {
        errors.push(`${prefix}: Action 'renderTemplate' requires 'template'`);
      }
      break;

    case "regexExtract":
      if (
        !options.rules || !Array.isArray(options.rules) ||
        options.rules.length === 0
      ) {
        errors.push(`${prefix}: Action 'regexExtract' requires 'rules' array`);
      } else {
        for (let i = 0; i < options.rules.length; i++) {
          const rule = options.rules[i];
          if (!rule.regex) {
            errors.push(`${prefix}: regexExtract rules[${i}] requires 'regex'`);
          }
          if (rule.extractFrom === undefined) {
            errors.push(
              `${prefix}: regexExtract rules[${i}] requires 'extractFrom'`,
            );
          }
          if (!rule.extractTo) {
            errors.push(
              `${prefix}: regexExtract rules[${i}] requires 'extractTo'`,
            );
          }
        }
      }
      break;

    case "downloadFileUrl":
    case "downloadFileAsBase64":
      if (options.file === undefined) {
        errors.push(`${prefix}: Action '${options.action}' requires 'file'`);
      }
      break;

      // fork and issueCallbackToken have no required fields beyond action
  }
}

function validateCallableTriggerActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  _warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (config?.options && Object.keys(config.options).length > 0) {
    errors.push(
      `${prefix}: CallableTriggerActor should not have 'configuration.options'. Remove the options field.`,
    );
  }
}

function validateWebhookTriggerActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  _warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  const webhookConfig = config.webhook;
  const webhookTriggerKey = webhookConfig?.triggerKey ?? config.webhookTriggerKey;
  if (!webhookTriggerKey) {
    errors.push(
      `${prefix}: Missing required 'configuration.webhook.triggerKey'. ` +
      `Generate a 26-character ULID and store it at configuration.webhook.triggerKey.`,
    );
  } else if (typeof webhookTriggerKey !== "string") {
    errors.push(
      `${prefix}: 'configuration.webhook.triggerKey' must be a string`,
    );
  } else if (webhookTriggerKey.length !== 26) {
    errors.push(
      `${prefix}: 'configuration.webhook.triggerKey' must be 26 characters (ULID format), got ${webhookTriggerKey.length}`,
    );
  }

  if (webhookConfig?.responseTimeout !== undefined) {
    if (typeof webhookConfig.responseTimeout === "number") {
      if (webhookConfig.responseTimeout < 1 || webhookConfig.responseTimeout > 60) {
        errors.push(
          `${prefix}: 'configuration.webhook.responseTimeout' must be between 1 and 60 seconds, got ${webhookConfig.responseTimeout}`,
        );
      }
    }
  }

  if (webhookConfig?.allowedMethods && Array.isArray(webhookConfig.allowedMethods)) {
    const validMethods = ["get", "post", "put", "patch", "delete"];
    for (const method of webhookConfig.allowedMethods) {
      if (!validMethods.includes(method)) {
        errors.push(
          `${prefix}: Invalid HTTP method '${method}' in 'configuration.webhook.allowedMethods'. ` +
          `Valid methods: ${validMethods.join(", ")}`,
        );
      }
    }
  }

  if (config?.options) {
    const options = (config.options.webhook ?? config.options) as {
      respondImmediately?: boolean;
      response?: { statusCode?: number; body?: unknown; headers?: unknown };
    };

    if (options.respondImmediately === true && !options.response) {
      errors.push(
        `${prefix}: 'response' is required when 'respondImmediately' is true`,
      );
    }
  }
}

function validateCallFlowActor(
  actorId: string,
  config: ActorConfiguration,
  schemas: { inputs?: Record<string, unknown> } | undefined,
  isToolActor: boolean,
  errors: string[],
  _warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (schemas?.inputs && Object.keys(schemas.inputs).length > 0) {
    errors.push(
      `${prefix}: CallFlowActor must have empty 'schemas.inputs'. ` +
      `The schema is inherited from the target Callable Trigger actor.`,
    );
  }

  if (isToolActor) {
    if (config?.inputs && Object.keys(config.inputs).length > 0) {
      errors.push(
        `${prefix}: CallFlowActor used as a tool must have empty 'configuration.inputs'. ` +
        "Use '${{aiInput}}' in 'configuration.options.payload' instead to receive values from the agent.",
      );
    }
  }

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as {
    workspaceSlug?: string;
    canvasSlug?: string;
    callableTriggerActorId?: string;
    payload?: Record<string, unknown>;
    waitForResponse?: boolean;
    timeoutInSeconds?: number;
  };

  if (!options.workspaceSlug) {
    errors.push(`${prefix}: Missing 'configuration.options.workspaceSlug'`);
  }

  if (!options.canvasSlug) {
    errors.push(`${prefix}: Missing 'configuration.options.canvasSlug'`);
  }

  if (!options.callableTriggerActorId) {
    errors.push(`${prefix}: Missing 'configuration.options.callableTriggerActorId'`);
  }
}

// Common timezone identifiers (subset of IANA timezones)
const COMMON_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Madrid",
  "Europe/Amsterdam", "Europe/Brussels", "Europe/Zurich", "Europe/Stockholm",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Seoul",
  "Asia/Mumbai", "Asia/Dubai", "Asia/Jakarta", "Asia/Bangkok",
  "Australia/Sydney", "Australia/Melbourne", "Australia/Perth",
  "Pacific/Auckland", "Pacific/Honolulu",
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos",
];

/**
 * Validates a cron expression format
 */
function isValidCronExpression(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return false;
  }

  const cronFieldPattern = /^(\*|(\d+(-\d+)?)(,(\d+(-\d+)?))*)(\/\d+)?$/;
  const dayOfWeekPattern = /^(\*|(\d+(-\d+)?)(,(\d+(-\d+)?))*|[A-Za-z]{3}(-[A-Za-z]{3})?)(\/\d+)?$/;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 4) {
      if (!dayOfWeekPattern.test(part) && part !== "?" && part !== "L") {
        return false;
      }
    } else {
      if (!cronFieldPattern.test(part) && part !== "?" && part !== "L" && part !== "W") {
        return false;
      }
    }
  }

  return true;
}

function validateScheduledTriggerActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as {
    schedule?: string;
    timezone?: string;
  };

  if (!options.schedule) {
    errors.push(`${prefix}: Missing required 'configuration.options.schedule' (cron expression)`);
  } else if (typeof options.schedule !== "string") {
    errors.push(`${prefix}: 'configuration.options.schedule' must be a string`);
  } else if (!isValidCronExpression(options.schedule)) {
    errors.push(
      `${prefix}: Invalid cron expression '${options.schedule}'. Expected format: 'minute hour day-of-month month day-of-week' (e.g., '* * * * *' or '0 9 * * MON-FRI')`,
    );
  }

  if (options.timezone !== undefined) {
    if (typeof options.timezone !== "string") {
      errors.push(`${prefix}: 'configuration.options.timezone' must be a string`);
    } else if (options.timezone.trim() === "") {
      errors.push(`${prefix}: 'configuration.options.timezone' cannot be empty`);
    } else if (!COMMON_TIMEZONES.includes(options.timezone)) {
      warnings.push(
        `${prefix}: 'timezone' '${options.timezone}' is not a commonly used timezone. Ensure it's a valid IANA timezone identifier.`,
      );
    }
  }
}

function validateInterfaceTriggerActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as InterfaceTriggerOptions;

  if (!options.page) {
    errors.push(`${prefix}: Missing 'configuration.options.page'`);
    return;
  }

  if (!options.page.children || !Array.isArray(options.page.children)) {
    errors.push(
      `${prefix}: Missing or invalid 'configuration.options.page.children'`,
    );
    return;
  }

  // Check for duplicate keys in page.children
  const keys = options.page.children
    .map((child) => child.key)
    .filter((key): key is string => typeof key === "string" && key.length > 0);

  const keyCounts = new Map<string, number>();
  for (const key of keys) {
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([_, count]) => count > 1)
    .map(([key, _]) => key);

  if (duplicateKeys.length > 0) {
    errors.push(
      `${prefix}: Duplicate keys in page.children: ${duplicateKeys.join(", ")}`,
    );
  }

  // Check for invalid component types and validate webViewer components
  const invalidTypes: Array<{ key: string; type: string }> = [];
  for (const child of options.page.children) {
    if (child.type && !VALID_INTERFACE_COMPONENT_TYPES.includes(child.type)) {
      invalidTypes.push({ key: child.key || "(no key)", type: child.type });
    }
    if (child.type === "webViewer") {
      validateWebViewerComponent(actorId, child, errors, warnings);
    }
  }

  if (invalidTypes.length > 0) {
    const invalidList = invalidTypes
      .map(({ key, type }) => `'${type}' (key: ${key})`)
      .join(", ");
    errors.push(
      `${prefix}: Invalid component types in page.children: ${invalidList}`,
    );
  }

  if (!options.onSubmit) {
    errors.push(`${prefix}: Missing 'configuration.options.onSubmit'`);
  } else if (!options.onSubmit.type) {
    errors.push(`${prefix}: Missing 'configuration.options.onSubmit.type'`);
  }
}

function validateAppTriggerActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as AppTriggerOptions;

  if (!options.html) {
    errors.push(
      `${prefix}: Missing 'configuration.options.html'. AppTriggerActor requires an 'html' field.`,
    );
  }

  if ((config.options as Record<string, unknown>).page) {
    errors.push(
      `${prefix}: AppTriggerActor does not use 'page' configuration. Use 'html', 'css', and 'script' fields instead. For form-based workflows, use InterfaceTriggerActor.`,
    );
  }
  if ((config.options as Record<string, unknown>).onSubmit) {
    errors.push(
      `${prefix}: AppTriggerActor does not use 'onSubmit'. It has no form submission semantics.`,
    );
  }

  if (typeof options.html === "string") {
    const pseudoChild: InterfacePageChild = {
      key: "app",
      type: "webViewer",
      html: options.html,
      allowedScriptDomains: options.allowedScriptDomains,
      allowedStyleDomains: options.allowedStyleDomains,
      allowAllScripts: options.allowAllScripts,
      allowAllStyling: options.allowAllStyling,
      allowedPermissions: options.allowedPermissions,
    };
    validateWebViewerComponent(actorId, pseudoChild, errors, warnings);
  }
}

function validateInterfaceActor(
  actorId: string,
  config: ActorConfiguration,
  sourcePorts: SourcePort[] | undefined,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!sourcePorts || sourcePorts.length === 0) {
    errors.push(
      `${prefix}: InterfaceActor requires two source ports: '${INTERFACE_ACTOR_EVENT_PORT}' (Event) and '${INTERFACE_ACTOR_META_PORT}' (Meta)`,
    );
  } else {
    const hasEventPort = sourcePorts.some((port) => port.id === INTERFACE_ACTOR_EVENT_PORT);
    const hasMetaPort = sourcePorts.some((port) => port.id === INTERFACE_ACTOR_META_PORT);

    if (!hasEventPort) {
      errors.push(
        `${prefix}: Missing required Event source port with id '${INTERFACE_ACTOR_EVENT_PORT}'`,
      );
    }
    if (!hasMetaPort) {
      errors.push(
        `${prefix}: Missing required Meta source port with id '${INTERFACE_ACTOR_META_PORT}'`,
      );
    }

    const eventPort = sourcePorts.find((port) => port.id === INTERFACE_ACTOR_EVENT_PORT);
    const metaPort = sourcePorts.find((port) => port.id === INTERFACE_ACTOR_META_PORT);

    if (eventPort && eventPort.name !== "Event") {
      warnings.push(
        `${prefix}: Event port (${INTERFACE_ACTOR_EVENT_PORT}) should have name 'Event', got '${eventPort.name}'`,
      );
    }
    if (metaPort && metaPort.name !== "Meta") {
      warnings.push(
        `${prefix}: Meta port (${INTERFACE_ACTOR_META_PORT}) should have name 'Meta', got '${metaPort.name}'`,
      );
    }
  }

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as InterfaceTriggerOptions;

  if (!options.page) {
    errors.push(`${prefix}: Missing 'configuration.options.page'`);
    return;
  }

  if (!options.page.children || !Array.isArray(options.page.children)) {
    errors.push(
      `${prefix}: Missing or invalid 'configuration.options.page.children'`,
    );
    return;
  }

  const keys = options.page.children
    .map((child) => child.key)
    .filter((key): key is string => typeof key === "string" && key.length > 0);

  const keyCounts = new Map<string, number>();
  for (const key of keys) {
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  const duplicateKeys = [...keyCounts.entries()]
    .filter(([_, count]) => count > 1)
    .map(([key, _]) => key);

  if (duplicateKeys.length > 0) {
    errors.push(
      `${prefix}: Duplicate keys in page.children: ${duplicateKeys.join(", ")}`,
    );
  }

  const invalidTypes: Array<{ key: string; type: string }> = [];
  for (const child of options.page.children) {
    if (child.type && !VALID_INTERFACE_COMPONENT_TYPES.includes(child.type)) {
      invalidTypes.push({ key: child.key || "(no key)", type: child.type });
    }
    if (child.type === "webViewer") {
      validateWebViewerComponent(actorId, child, errors, warnings);
    }
  }

  if (invalidTypes.length > 0) {
    const invalidList = invalidTypes
      .map(({ key, type }) => `'${type}' (key: ${key})`)
      .join(", ");
    errors.push(
      `${prefix}: Invalid component types in page.children: ${invalidList}`,
    );
  }
}

function validateAiAgentActor(
  actorId: string,
  config: ActorConfiguration,
  sourcePorts: SourcePort[] | undefined,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!sourcePorts || sourcePorts.length === 0) {
    errors.push(
      `${prefix}: AiAgentActor requires two source ports: '${AI_AGENT_DONE_PORT}' (Done) and '${AI_AGENT_STATUS_PORT}' (Status)`,
    );
  } else {
    const hasDonePort = sourcePorts.some((port) => port.id === AI_AGENT_DONE_PORT);
    const hasStatusPort = sourcePorts.some((port) => port.id === AI_AGENT_STATUS_PORT);

    if (!hasDonePort) {
      errors.push(
        `${prefix}: Missing required Done source port with id '${AI_AGENT_DONE_PORT}'`,
      );
    }
    if (!hasStatusPort) {
      errors.push(
        `${prefix}: Missing required Status source port with id '${AI_AGENT_STATUS_PORT}'`,
      );
    }

    const donePort = sourcePorts.find((port) => port.id === AI_AGENT_DONE_PORT);
    const statusPort = sourcePorts.find((port) => port.id === AI_AGENT_STATUS_PORT);

    if (donePort && donePort.name !== "Done") {
      warnings.push(
        `${prefix}: Done port (${AI_AGENT_DONE_PORT}) should have name 'Done', got '${donePort.name}'`,
      );
    }
    if (statusPort && statusPort.name !== "Status") {
      warnings.push(
        `${prefix}: Status port (${AI_AGENT_STATUS_PORT}) should have name 'Status', got '${statusPort.name}'`,
      );
    }
  }

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as {
    model?: string;
    prompt?: string;
    systemPrompt?: string;
    messages?: unknown[];
    temperature?: number;
    maxTokens?: number;
    maxLoopCount?: number;
  };

  if (!options.prompt && (!options.messages || (Array.isArray(options.messages) && options.messages.length === 0))) {
    errors.push(
      `${prefix}: Either 'prompt' or 'messages' must be provided in configuration.options`,
    );
  }

  if (options.temperature !== undefined) {
    if (typeof options.temperature === "number") {
      if (options.temperature < 0 || options.temperature > 1) {
        errors.push(
          `${prefix}: 'temperature' must be between 0 and 1, got ${options.temperature}`,
        );
      }
    }
  }

  if (options.maxLoopCount !== undefined) {
    if (typeof options.maxLoopCount === "number") {
      if (options.maxLoopCount < 1) {
        errors.push(
          `${prefix}: 'maxLoopCount' must be at least 1, got ${options.maxLoopCount}`,
        );
      }
    }
  }

  if (options.maxTokens !== undefined) {
    if (typeof options.maxTokens === "number") {
      if (options.maxTokens < 1) {
        errors.push(
          `${prefix}: 'maxTokens' must be at least 1, got ${options.maxTokens}`,
        );
      }
    }
  }
}

// Email regex for validation
const EMAIL_REGEX = /^(?:"?([^"]*)"?\s)?(?:<)?([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)(>)?$/;

function validateEmailAddresses(value: string): boolean {
  const emails = value.split(",");
  return emails.every((email) => EMAIL_REGEX.test(email.trim()));
}

function validateSendEmailActor(
  actorId: string,
  config: ActorConfiguration,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!config?.options) {
    errors.push(`${prefix}: Missing 'configuration.options'`);
    return;
  }

  const options = config.options as {
    to?: string;
    subject?: string;
    cc?: string;
    bcc?: string;
    textBody?: string;
    htmlBody?: string;
    attachments?: unknown;
  };

  if (!options.to) {
    errors.push(`${prefix}: Missing required 'configuration.options.to'`);
  } else if (typeof options.to === "string" && !options.to.includes("${{")) {
    if (!validateEmailAddresses(options.to)) {
      errors.push(
        `${prefix}: Invalid email address(es) in 'to': ${options.to}`,
      );
    }
  }

  if (!options.subject) {
    errors.push(`${prefix}: Missing required 'configuration.options.subject'`);
  }

  if (!options.textBody && !options.htmlBody) {
    errors.push(
      `${prefix}: Either 'textBody' or 'htmlBody' must be provided in configuration.options`,
    );
  }

  if (options.cc && typeof options.cc === "string" && !options.cc.includes("${{")) {
    if (!validateEmailAddresses(options.cc)) {
      errors.push(
        `${prefix}: Invalid email address(es) in 'cc': ${options.cc}`,
      );
    }
  }

  if (options.bcc && typeof options.bcc === "string" && !options.bcc.includes("${{")) {
    if (!validateEmailAddresses(options.bcc)) {
      errors.push(
        `${prefix}: Invalid email address(es) in 'bcc': ${options.bcc}`,
      );
    }
  }

  if (options.htmlBody && !options.textBody) {
    warnings.push(
      `${prefix}: Consider providing 'textBody' along with 'htmlBody' for email clients that don't support HTML`,
    );
  }
}


function validateCommentActor(
  actorId: string,
  config: ActorConfiguration,
  actor: { sourcePorts?: SourcePort[]; edges?: Record<string, FlowEdge> },
  _errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (actor.sourcePorts && actor.sourcePorts.length > 0) {
    warnings.push(
      `${prefix}: CommentActor should have empty 'sourcePorts' array`,
    );
  }

  if (actor.edges && Object.keys(actor.edges).length > 0) {
    warnings.push(
      `${prefix}: CommentActor should have empty 'edges' object (it doesn't participate in workflow)`,
    );
  }

  if (config?.options) {
    const options = config.options as {
      width?: string;
      height?: string;
      bgColor?: string;
      textColor?: string;
    };

    if (options.width && typeof options.width === "string") {
      if (!/^\d+(\.\d+)?(px|em|rem|%|vh|vw)$/.test(options.width)) {
        warnings.push(
          `${prefix}: 'width' should be a valid CSS dimension (e.g., "510px"), got "${options.width}"`,
        );
      }
    }

    if (options.height && typeof options.height === "string") {
      if (!/^\d+(\.\d+)?(px|em|rem|%|vh|vw)$/.test(options.height)) {
        warnings.push(
          `${prefix}: 'height' should be a valid CSS dimension (e.g., "115px"), got "${options.height}"`,
        );
      }
    }

    if (options.bgColor && typeof options.bgColor === "string") {
      const isHexColor = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(options.bgColor);
      const isCssColorName = /^[a-zA-Z]+$/.test(options.bgColor);
      if (!isHexColor && !isCssColorName) {
        warnings.push(
          `${prefix}: 'bgColor' should be a hex color (e.g., "#ffe066") or CSS color name, got "${options.bgColor}"`,
        );
      }
    }

    if (options.textColor && typeof options.textColor === "string") {
      const isHexColor = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(options.textColor);
      const isCssColorName = /^[a-zA-Z]+$/.test(options.textColor);
      if (!isHexColor && !isCssColorName) {
        warnings.push(
          `${prefix}: 'textColor' should be a hex color (e.g., "#000000") or CSS color name, got "${options.textColor}"`,
        );
      }
    }
  }
}

// Inline event handler attribute names (HTML on* attributes)
const INLINE_EVENT_HANDLERS = [
  "onclick", "ondblclick", "onmousedown", "onmouseup", "onmouseover", "onmouseout",
  "onmousemove", "onmouseenter", "onmouseleave", "onkeydown", "onkeyup", "onkeypress",
  "onfocus", "onblur", "onchange", "oninput", "onsubmit", "onreset", "onselect",
  "onload", "onerror", "onresize", "onscroll", "onunload", "onbeforeunload",
  "ondrag", "ondragstart", "ondragend", "ondragover", "ondragenter", "ondragleave",
  "ondrop", "ontouchstart", "ontouchend", "ontouchmove", "oncontextmenu",
];

/**
 * Extracts the origin (scheme + host) from a URL string.
 */
function extractOrigin(url: string): string | null {
  if (url.includes("${{")) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Validates a webViewer component within an InterfaceTriggerActor or InterfaceActor.
 */
function validateWebViewerComponent(
  actorId: string,
  child: InterfacePageChild,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}' webViewer '${child.key || "(no key)"}'`;
  const html = child.html;

  if (!html) return;

  // 1. Check external script domains
  const scriptSrcRegex = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let match;
  const scriptDomains = new Set<string>();

  while ((match = scriptSrcRegex.exec(html)) !== null) {
    const origin = extractOrigin(match[1]);
    if (origin) scriptDomains.add(origin);
  }

  const allowedScripts = new Set(
    (child.allowedScriptDomains || []).map((d) => {
      try {
        const parsed = new URL(d);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return d;
      }
    }),
  );

  for (const domain of scriptDomains) {
    if (!allowedScripts.has(domain)) {
      errors.push(
        `${prefix}: HTML loads a script from '${domain}' but it is not in 'allowedScriptDomains'. ` +
        `Add '${domain}' to the allowedScriptDomains array.`,
      );
    }
  }

  // 2. Check external stylesheet/font domains
  const linkHrefRegex = /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const styleDomains = new Set<string>();

  while ((match = linkHrefRegex.exec(html)) !== null) {
    const tag = match[0];
    if (tag.includes('rel="stylesheet"') || tag.includes("rel='stylesheet'") ||
        tag.includes('rel="preconnect"') || tag.includes("rel='preconnect'") ||
        /fonts\.(googleapis|gstatic)\.com/.test(match[1])) {
      const origin = extractOrigin(match[1]);
      if (origin) styleDomains.add(origin);
    }
  }

  const allowedStyles = new Set(
    (child.allowedStyleDomains || []).map((d) => {
      try {
        const parsed = new URL(d);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return d;
      }
    }),
  );

  for (const domain of styleDomains) {
    if (!allowedStyles.has(domain)) {
      errors.push(
        `${prefix}: HTML loads a stylesheet/font from '${domain}' but it is not in 'allowedStyleDomains'. ` +
        `Add '${domain}' to the allowedStyleDomains array.`,
      );
    }
  }

  // 3. Check for inline event handlers (require allowAllScripts)
  if (!child.allowAllScripts) {
    const inlineHandlerRegex = new RegExp(
      `\\s(${INLINE_EVENT_HANDLERS.join("|")})\\s*=\\s*["']`,
      "gi",
    );
    const foundHandlers = new Set<string>();

    while ((match = inlineHandlerRegex.exec(html)) !== null) {
      foundHandlers.add(match[1].toLowerCase());
    }

    if (foundHandlers.size > 0) {
      const handlerList = [...foundHandlers].join(", ");
      warnings.push(
        `${prefix}: HTML contains inline event handlers (${handlerList}) but 'allowAllScripts' is not enabled. ` +
        `Either set 'allowAllScripts: true' or use addEventListener() instead.`,
      );
    }
  }

  // 4. Check for inline style attributes (require allowAllStyling)
  if (!child.allowAllStyling) {
    const inlineStyleRegex = /<[a-z][^>]*\sstyle\s*=\s*["'][^"']+["']/gi;

    if (inlineStyleRegex.test(html)) {
      warnings.push(
        `${prefix}: HTML contains inline style attributes but 'allowAllStyling' is not enabled. ` +
        `Either set 'allowAllStyling: true' or use CSS classes in <style> tags instead.`,
      );
    }
  }
}

function validateEdges(
  actorId: string,
  edges: Record<string, FlowEdge> | undefined,
  sourcePorts: SourcePort[] | undefined,
  allActorIds: string[],
  errors: string[],
  warnings: string[],
): void {
  const prefix = `Actor '${actorId}'`;

  if (!edges || Object.keys(edges).length === 0) {
    return;
  }

  const validSourcePortIds = new Set<string>();
  if (sourcePorts) {
    for (const port of sourcePorts) {
      if (port.id) {
        validSourcePortIds.add(port.id);
      }
    }
  }
  validSourcePortIds.add(SOURCE_PORT_DEFAULT_ID);

  for (const [edgeKey, edge] of Object.entries(edges)) {
    const edgePrefix = `${prefix} edge '${edgeKey}'`;

    if (!edge.id) {
      errors.push(`${edgePrefix}: Missing 'id' field`);
    }

    if (edge.id && edge.id !== edgeKey) {
      errors.push(
        `${edgePrefix}: Edge key '${edgeKey}' does not match edge.id '${edge.id}'`,
      );
    }

    const edgeId = edge.id || edgeKey;
    if (!edgeId.startsWith(EDGE_PREFIX)) {
      errors.push(`${edgePrefix}: Edge ID must start with '${EDGE_PREFIX}'`);
    } else if (edgeId.length !== EDGE_ID_LENGTH) {
      errors.push(
        `${edgePrefix}: Edge ID must be ${EDGE_ID_LENGTH} characters (${EDGE_PREFIX} + 26 ULID chars), got ${edgeId.length}`,
      );
    } else {
      const ulidPart = edgeId.substring(EDGE_PREFIX.length);
      if (!ULID_REGEX.test(ulidPart)) {
        errors.push(
          `${edgePrefix}: Edge ID ULID part must be 26 valid ULID characters (Crockford's Base32: 0-9, a-z excluding i, l, o, u)`,
        );
      }
    }

    if (!edge.sourceActorId) {
      errors.push(`${edgePrefix}: Missing 'sourceActorId'`);
    } else if (edge.sourceActorId !== actorId) {
      errors.push(
        `${edgePrefix}: 'sourceActorId' must match parent actor ID '${actorId}'`,
      );
    }

    if (!edge.sourcePortId) {
      errors.push(`${edgePrefix}: Missing 'sourcePortId'`);
    } else if (!validSourcePortIds.has(edge.sourcePortId)) {
      errors.push(
        `${edgePrefix}: 'sourcePortId' '${edge.sourcePortId}' is not a valid source port for this actor`,
      );
    }

    if (!edge.targetActorId) {
      errors.push(`${edgePrefix}: Missing 'targetActorId'`);
    } else if (!allActorIds.includes(edge.targetActorId)) {
      warnings.push(
        `${edgePrefix}: 'targetActorId' '${edge.targetActorId}' not found in actors (may be defined in another file)`,
      );
    }

    if (!edge.targetPortId) {
      errors.push(`${edgePrefix}: Missing 'targetPortId'`);
    } else if (edge.targetPortId !== TARGET_PORT_DEFAULT_ID) {
      warnings.push(
        `${edgePrefix}: 'targetPortId' should typically be '${TARGET_PORT_DEFAULT_ID}', got '${edge.targetPortId}'`,
      );
    }

    if (!edge.type) {
      errors.push(`${edgePrefix}: Missing 'type'`);
    } else if (edge.type !== "borgiqEdge") {
      errors.push(
        `${edgePrefix}: 'type' must be 'borgiqEdge', got '${edge.type}'`,
      );
    }
  }

  // Check for duplicate edge IDs within this actor
  const edgeIds = Object.values(edges).map((e) => e.id).filter(
    Boolean,
  ) as string[];
  const duplicateEdgeIds = edgeIds.filter((id, index) =>
    edgeIds.indexOf(id) !== index
  );
  if (duplicateEdgeIds.length > 0) {
    errors.push(
      `${prefix}: Duplicate edge IDs: ${
        [...new Set(duplicateEdgeIds)].join(", ")
      }`,
    );
  }
}
