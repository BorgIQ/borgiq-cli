/** Authenticated user profile */
export interface BIQUser {
  id: string;
  name: string;
  profilePictureUrl: string | null;
  email: string;
}

/** Organization */
export interface BIQOrg {
  id: string;
  name: string;
  slug: string;
  description: string;
  logoPath: string | null;
}

/** Workspace */
export interface BIQWorkspace {
  id: string;
  name: string;
  slug: string;
  description: string;
}

/** Workspace with user access info */
export interface BIQUserWorkspaceAccessInfo extends BIQWorkspace {
  isOwner: boolean;
  role: string;
  aiSettingsAvailability?: Record<string, boolean>;
}

/** Org with workspaces the user has access to */
export interface BIQUserAccessibleWorkspaceInfo extends BIQOrg {
  workspaces: BIQUserWorkspaceAccessInfo[];
  role: string;
  isOwner: boolean;
}

/** Canvas metadata */
export interface BIQCanvasMetadata {
  id: string;
  name: string;
  slug: string;
  messageTTLInDays: number;
  description: string | null;
  tags: string | null;
  imagePath: string | null;
  runtimeSlug: string | null;
  triggerActors?: Record<string, number>;
}

/** Canvas response (returned by getCanvas) */
export interface BIQCanvasResponse {
  metadata: BIQCanvasMetadata;
  version: number;
  data?: unknown;
  actorVersions?: Record<string, number>;
}

/** Connection metadata */
export interface BIQConnectionMetadata {
  id: string;
  key: string;
  description: string;
  type: string;
  createdAt: string;
  exposureMode?: string;
  metadata?: { type: string; value: string }[];
}

/** Secret metadata */
export interface BIQSecretMetadata {
  id: string;
  key: string;
  description: string;
  type: string;
  createdAt: string;
  exposureMode?: string;
}

/** API token metadata */
export interface BIQApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** API token returned on creation (includes raw token) */
export interface BIQApiTokenCreated extends BIQApiToken {
  rawToken: string;
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  total: number;
  data: T[];
}

/** List filter parameters */
export interface ListFilterParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Flowrun list item (returned by list/children endpoints) */
export interface BIQFlowrun {
  id: string;
  state: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Flowrun detail (returned by getFlowrun) */
export interface BIQFlowrunDetail {
  flowrunMetadata: {
    id: string;
    createdAt: string;
    updatedAt?: string;
    triggerActor: { id: string; type: string };
    isSubFlowrun: boolean;
    data?: unknown;
    parentFlowrun?: { actorId: string; flowrunId: string; canvasId: string; workspaceId: string };
  };
  emittedMessageCount: Record<string, Record<string, number>>;
}

/** Flowrun status */
export interface BIQFlowrunStatus {
  id: string;
  state: string;
  actors: string[];
  counters?: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

/** Flowrun summary */
export interface BIQFlowrunSummary {
  id: string;
  state: string;
  triggerActor: { id: string; type: string; name: string };
  createdAt: string;
  actors: {
    actorId: string;
    actorName: string;
    actorType: string;
    jobs: {
      jobId: string;
      state: string;
      resultId: string | null;
      status: string | null;
      startedAt: string | null;
      endedAt: string | null;
      error: unknown;
      emittedMessageCount: Record<string, number>;
    }[];
  }[];
  errors: {
    actorId: string;
    actorName: string;
    jobId: string;
    error: unknown;
  }[];
}

/** Manual trigger request */
export interface ManualTriggerRequest {
  canvasId: string;
  actorId: string;
}

/** Valid root paths for job runtime data */
export type RuntimeDataRootPath = 'ctx' | 'request' | 'inputs' | 'user';

/** Actor type definition */
export interface BIQActorType {
  type: string;
  name: string;
  description: string;
  category: string;
  [key: string]: unknown;
}

/** Actor type schema (base response) */
export interface BIQActorSchema {
  actorType: string;
  name: string;
  description: string;
  category: string;
  optionsSchema: Record<string, unknown> | null;
  actions: { selectorSchema: Record<string, unknown> } | null;
  defaultOptions: Record<string, unknown> | null;
  sourcePorts: {
    type: 'none' | 'singleDefault' | 'fixedMulti' | 'dynamic';
    fixedPorts: Array<{ id: string; name?: string }>;
    canAddPorts: boolean;
  };
  code: { supported: boolean; language: 'typescript' | 'python' | null };
  canReceiveMessage: boolean;
  canEmitMessage: boolean;
  supportsConnection: boolean;
  enableLTM: boolean;
  enableSTM: boolean;
}

/** Actor action schema (response for ?action=<action>) */
export interface BIQActorActionSchema {
  actorType: string;
  action: string;
  label: string;
  group?: string;
  optionsSchema: Record<string, unknown>;
  memory: { ltm?: boolean; stm?: boolean };
}

/** Canvas validation result */
export interface BIQCanvasValidation {
  valid: boolean;
  errors: { actorId: string; actorName: string; field: string; message: string }[];
  warnings: { message: string }[];
}

/** Canvas layout result */
export interface BIQCanvasLayout {
  id: string;
  version: number;
  actors: Record<string, { x: number; y: number }>;
}

/** Patch actors operation */
export interface BatchActorOperation {
  type: 'add' | 'update' | 'remove';
  actorId: string;
  editVersion?: number;
  data?: Record<string, unknown>;
}

/** Patch actors response */
export interface BatchActorOperationsResponse {
  appliedOperations: { type: string; actorId: string; status: string }[];
  conflicts: unknown[];
  updatedAt: string;
}

/** Flowrun job */
export interface BIQFlowrunJob {
  id: string;
  flowrunId: string;
  state: string;
  createdAt: string;
  sourceFlowrunMessage?: { id: string; messageType: string };
  [key: string]: unknown;
}

/** Flowrun job result summary */
export interface BIQFlowrunJobResultSummary {
  id: string;
  flowrunJobId: string;
  status: string;
  startedAt: string;
  endedAt: string;
  error: unknown;
  [key: string]: unknown;
}

/** Flowrun message */
export interface BIQFlowrunMessage {
  id: string;
  flowrunId: string;
  emittedAt: string;
  sourcePortId: string;
  flowrunJobId: string;
  [key: string]: unknown;
}

/** File metadata */
export interface BIQFileMetadata {
  id: string;
  fileName: string;
  sizeInBytes: number;
  mimeType: string;
  status: string;
  storageEngine: string;
  md5?: string;
  sha256?: string;
}

/** Asset metadata */
export interface BIQAssetMetadata {
  id: string;
  key: string;
  description?: string;
  type: string;
  createdAt: string;
  updatedAt?: string;
  file?: BIQFileMetadata;
  org?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  data?: string;
}

/**
 * Connection type list item returned by GET /connections/types. Mirrors
 * `BIQConnectionTypeList` in the platform (`packages/types`).
 *
 * - `name` — the stable slug used when creating a connection
 *   (`borgiq connections create --type <name>`).
 * - `title` — the human-readable label shown in the web UI.
 * - `icon` — optional CDN icon slug.
 * - `authType` — the auth scheme (e.g. `oauth2`, `apiKey`). Useful for
 *   grouping or for picking the right `connections create` flow.
 */
export interface BIQConnectionType {
  name: string;
  title: string;
  icon?: string;
  authType: BIQConnectionAuthType;
}

/** Canvas actor instance */
export interface BIQCanvasActor {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  msgVar: string;
  description: string;
  version: number;
  continueOnError: boolean;
  enableLTM: boolean;
  enableSTM: boolean;
  showInWorkspaceApps: boolean;
  configuration: Record<string, unknown>;
  schemas: Record<string, unknown>;
  sourcePorts: { id: string; name?: string; description?: string }[];
  edges: Record<string, unknown>;
  position: { x: number; y: number };
  runtimeSlug?: string;
  icon?: Record<string, unknown>;
  template?: Record<string, unknown>;
}

/** Canvas actor flow response */
export interface BIQCanvasActorFlow {
  sourceActorId: string;
  actors: BIQCanvasActor[];
  actorCount: number;
}

/** Actor options verification response */
export interface BIQActorVerification {
  valid: boolean;
  errors: { path: (string | number)[]; message: string }[];
}

/** S3 presigned POST used to upload file assets directly to storage */
export interface S3PresignedPost {
  url: string;
  fields: Record<string, string>;
}

/** The four asset types supported by the platform */
export type BIQAssetType = 'plainText' | 'json' | 'yaml' | 'file';

/** Input for the `file` field when creating a file-type asset */
export interface BIQAssetFileInput {
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
}

/**
 * Body for creating an asset. Discriminated on `type`:
 * - text types require `data` and forbid `file`
 * - file type requires `file` and forbids `data`
 */
export type BIQAssetCreateBody =
  | { type: 'plainText' | 'json' | 'yaml'; key: string; description?: string; data: string }
  | { type: 'file'; key: string; description?: string; file: BIQAssetFileInput };

/**
 * Body for updating an asset. The platform's PUT endpoint uses the same
 * schema as POST (full replacement, not a patch), so the shape matches
 * BIQAssetCreateBody plus an optional `updateFile` flag that signals the
 * underlying file should be replaced.
 */
export type BIQAssetUpdateBody =
  | { type: 'plainText' | 'json' | 'yaml'; key: string; description?: string; data: string }
  | { type: 'file'; key: string; description?: string; file: BIQAssetFileInput; updateFile?: boolean };

/**
 * Response from creating or updating an asset. File-type assets always
 * return a presigned URL; text-type assets never do.
 */
export type BIQAssetCreateResponse =
  | { asset: BIQAssetMetadata; presignedUrl: S3PresignedPost }
  | { asset: BIQAssetMetadata };

/**
 * Body for updating a file's upload status after S3 upload completes.
 * Success requires md5 and sha256; failure carries no additional fields.
 * Status values are the wire-format snake_case strings (matching BIQFileStatus
 * in the platform's runtime-types).
 */
export type BIQFileUploadStatusBody =
  | { status: 'upload_success'; md5: string; sha256: string }
  | { status: 'upload_failure' };

/** Supported auth types for a connection (mirrors BIQConnectionAuthType in the platform) */
export type BIQConnectionAuthType =
  | 'oauth2'
  | 'oauth1'
  | 'apiKey'
  | 'bearer'
  | 'basic'
  | 'awsKeyBased'
  | 'awsRoleBased'
  | 'custom'
  | 'none';

/**
 * Minimal JSON schema shape used by connection form data and interactive
 * prompts. Narrowed to the leaf types the schema-walker handles — nested
 * objects or arrays force the caller into --inputs-file territory.
 */
export interface BIQJsonSchemaLike {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, BIQJsonSchemaProperty>;
  required?: string[];
}

/** A single property inside a BIQJsonSchemaLike */
export interface BIQJsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean';
  enum?: unknown[];
  description?: string;
  title?: string;
  default?: unknown;
  format?: string;
  writeOnly?: boolean;
}

/** Form data returned by GET /connections/:type/data */
export interface BIQConnectionFormData {
  authType: BIQConnectionAuthType;
  appInstructions?: string;
  hasBorgIQManagedOptions: boolean;
  userManagedAppInstructions?: string;
  userManagedOptionsJsonSchema?: BIQJsonSchemaLike;
  inputsJsonSchema?: BIQJsonSchemaLike;
  secretInputsJsonSchema?: BIQJsonSchemaLike;
  webAuthData?: string;
  webEnvData?: Record<string, unknown>;
}

/** Keys-listing response used for polling after OAuth2 web handoff */
export interface BIQKeysListResponse {
  keys: { key: string; type: string }[];
  nextPage?: number;
}

