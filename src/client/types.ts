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
}

/** Connection metadata */
export interface BIQConnectionMetadata {
  id: string;
  key: string;
  description: string;
  type: string;
  createdAt: string;
}

/** Secret metadata */
export interface BIQSecretMetadata {
  id: string;
  key: string;
  description: string;
  type: string;
  createdAt: string;
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

/** Flowrun data */
export interface BIQFlowrun {
  id: string;
  canvasId: string;
  canvasName?: string;
  state: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

/** Flowrun status */
export interface BIQFlowrunStatus {
  id: string;
  state: string;
  actors: Record<string, unknown>[];
  counters?: Record<string, number>;
}

/** Flowrun summary */
export interface BIQFlowrunSummary {
  id: string;
  state: string;
  actors: Record<string, unknown>[];
  jobs: Record<string, unknown>[];
  results: Record<string, unknown>[];
  errors: Record<string, unknown>[];
}

/** Manual trigger request */
export interface ManualTriggerRequest {
  canvasId: string;
  actorId: string;
  data?: Record<string, unknown>;
}

/** Actor type definition */
export interface BIQActorType {
  type: string;
  name: string;
  description: string;
  category: string;
  [key: string]: unknown;
}

/** Actor type schema */
export interface BIQActorSchema {
  actorType: string;
  name: string;
  description: string;
  category: string;
  configurationSchema: Record<string, unknown>;
  sourcePorts: { id: string; name: string; description?: string }[];
  features: Record<string, boolean>;
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
export interface PatchActorsOperation {
  type: 'add' | 'update' | 'remove';
  actorId: string;
  editVersion?: number;
  data?: Record<string, unknown>;
}

/** Patch actors response */
export interface PatchActorsResponse {
  appliedOperations: { type: string; actorId: string; status: string }[];
  conflicts: unknown[];
  updatedAt: string;
}

/** Flowrun job */
export interface BIQFlowrunJob {
  id: string;
  flowrunId: string;
  canvasId: string;
  actorId: string;
  actorType: string;
  actorName: string;
  state: string;
  createdAt: string;
  updatedAt?: string;
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
  canvasId: string;
  actorId: string;
  portId: string;
  createdAt: string;
  [key: string]: unknown;
}

/** Asset metadata */
export interface BIQAssetMetadata {
  id: string;
  key: string;
  description?: string;
  type: string;
  createdAt: string;
  updatedAt?: string;
}

/** Connection type */
export interface BIQConnectionType {
  type: string;
  name: string;
  [key: string]: unknown;
}
