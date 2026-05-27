import { ApiError } from './errors.js';
import type {
  BIQUser,
  BIQUserAccessibleWorkspaceInfo,
  BIQCanvasMetadata,
  BIQCanvasResponse,
  BIQConnectionMetadata,
  BIQSecretMetadata,
  BIQApiToken,
  BIQApiTokenCreated,
  BIQFlowrun,
  BIQFlowrunDetail,
  BIQFlowrunStatus,
  BIQFlowrunSummary,
  PaginatedResponse,
  ListFilterParams,
  ManualTriggerRequest,
  BIQActorType,
  BIQActorSchema,
  BIQActorActionSchema,
  BIQCanvasValidation,
  BIQCanvasLayout,
  BatchActorOperationsResponse,
  BIQFlowrunJob,
  BIQFlowrunJobResultSummary,
  BIQFlowrunMessage,
  BIQAssetMetadata,
  BIQConnectionType,
  RuntimeDataRootPath,
  BIQCanvasActor,
  BIQCanvasActorFlow,
  BIQActorVerification,
  BIQAssetCreateBody,
  BIQAssetUpdateBody,
  BIQAssetCreateResponse,
  BIQFileUploadStatusBody,
  BIQFileMetadata,
  BIQConnectionFormData,
  BIQKeysListResponse,
  BIQActorTemplateMetadata,
  BIQActorTemplateDetail,
  BIQTemplateApp,
  TemplateListFilters,
} from './types.js';

export class BorgIQClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/json',
    };

    let requestBody: string | FormData | undefined;
    if (body instanceof FormData) {
      // Let fetch set the multipart boundary automatically — do not set Content-Type.
      requestBody = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { message?: string; details?: { path: (string | number)[]; message: string }[] } | null;
      throw new ApiError(
        response.status,
        errorBody?.message || response.statusText,
        errorBody?.details || [],
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /** GET that returns a plain string body instead of JSON. Used for /publicKey. */
  private async requestText(method: string, path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'text/plain, application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { message?: string; details?: { path: (string | number)[]; message: string }[] } | null;
      throw new ApiError(
        response.status,
        errorBody?.message || response.statusText,
        errorBody?.details || [],
      );
    }

    return response.text();
  }

  private buildQueryString(params?: ListFilterParams): string {
    if (!params) return '';
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.search) searchParams.set('search', params.search);
    if (params.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    const qs = searchParams.toString();
    return qs ? `?${qs}` : '';
  }

  private wkspPath(org: string, workspace: string): string {
    return `/orgs/${org}/workspaces/${workspace}`;
  }

  // ── User ──────────────────────────────────────────────

  async getProfile(): Promise<BIQUser> {
    return this.request<BIQUser>('GET', '/apiUser/profile');
  }

  async getOrgsAndWorkspaces(): Promise<{ [orgId: string]: BIQUserAccessibleWorkspaceInfo }> {
    return this.request<{[orgId: string]: BIQUserAccessibleWorkspaceInfo }>('GET', '/apiUser/orgsAndWorkspaces');
  }

  async createSessionHandoff(redirectPath?: string): Promise<{ url: string; expiresAt: number }> {
    return this.request('POST', '/apiUser/sessionHandoff', { redirectPath });
  }

  // ── Workspaces ────────────────────────────────────────

  async listWorkspaces(org: string, params?: ListFilterParams): Promise<PaginatedResponse<{ id: string; name: string; slug: string; description: string }>> {
    const raw = await this.request<{ total: number; workspaces: { id: string; name: string; slug: string; description: string }[] }>('GET', `/orgs/${org}/workspaces${this.buildQueryString(params)}`);
    return { total: raw.total, data: raw.workspaces };
  }

  // ── Canvases ──────────────────────────────────────────

  async listCanvases(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQCanvasMetadata>> {
    const raw = await this.request<{ total: number; canvases: BIQCanvasMetadata[] }>('GET', `${this.wkspPath(org, workspace)}/canvases/${this.buildQueryString(params)}`);
    return { total: raw.total, data: raw.canvases };
  }

  async getCanvas(org: string, workspace: string, id: string, includeData?: boolean): Promise<BIQCanvasResponse> {
    const qs = includeData ? '?includeData=true' : '';
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${id}${qs}`);
  }

  async createCanvas(org: string, workspace: string, body: { name: string; slug: string; messageTTLInDays: number; description?: string; tags?: string; runtimeSlug?: string }): Promise<BIQCanvasMetadata> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases`, body);
  }

  async updateCanvas(org: string, workspace: string, id: string, body: { name?: string; slug?: string; description?: string; tags?: string; messageTTLInDays?: number; runtimeSlug?: string }): Promise<BIQCanvasMetadata> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/${id}`, body);
  }

  async deleteCanvas(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/canvases/${id}`);
  }

  async exportCanvas(org: string, workspace: string, id: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${id}/exportData`);
  }

  // ── Flow Runs ─────────────────────────────────────────

  async listFlowruns(org: string, workspace: string, canvasId: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQFlowrun>> {
    const base = this.buildQueryString(params);
    const sep = base ? '&' : '?';
    const raw = await this.request<{ flowruns: BIQFlowrun[] }>('GET', `${this.wkspPath(org, workspace)}/flowruns${base}${sep}canvasId=${canvasId}`);
    return { total: raw.flowruns.length, data: raw.flowruns };
  }

  async getFlowrun(org: string, workspace: string, id: string): Promise<BIQFlowrunDetail> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowruns/${id}`);
  }

  async getFlowrunStatus(org: string, workspace: string, id: string): Promise<BIQFlowrunStatus> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowruns/${id}/status`);
  }

  async getFlowrunSummary(org: string, workspace: string, id: string): Promise<BIQFlowrunSummary> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowruns/${id}/summary`);
  }

  async interruptFlowrun(org: string, workspace: string, id: string): Promise<void> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/flowruns/${id}/interrupt`);
  }

  async getChildFlowruns(org: string, workspace: string, id: string): Promise<BIQFlowrun[]> {
    const raw = await this.request<{ flowruns: BIQFlowrun[] }>('GET', `${this.wkspPath(org, workspace)}/flowruns/${id}/children`);
    return raw.flowruns;
  }

  // ── Triggers ──────────────────────────────────────────

  async triggerManual(org: string, workspace: string, body: ManualTriggerRequest): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/triggers/manual`, body);
  }

  // ── Connections ───────────────────────────────────────

  async listConnections(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQConnectionMetadata>> {
    const raw = await this.request<{ total: number; connections: BIQConnectionMetadata[] }>('GET', `${this.wkspPath(org, workspace)}/connections${this.buildQueryString(params)}`);
    return { total: raw.total, data: raw.connections };
  }

  async deleteConnection(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/connections/${id}`);
  }

  async getConnectionFormData(org: string, workspace: string, type: string): Promise<BIQConnectionFormData> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/connections/${type}/data`);
  }

  async createConnectionMultipart(org: string, workspace: string, form: FormData): Promise<BIQConnectionMetadata> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/connections`, form);
  }

  async listConnectionKeys(org: string, workspace: string, search?: string): Promise<BIQKeysListResponse> {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    qs.set('page', '1');
    qs.set('pageSize', '20');
    return this.request('GET', `${this.wkspPath(org, workspace)}/connectionsKeys?${qs.toString()}`);
  }

  // ── Secrets ───────────────────────────────────────────

  async listSecrets(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQSecretMetadata>> {
    const raw = await this.request<{ total: number; secrets: BIQSecretMetadata[] }>('GET', `${this.wkspPath(org, workspace)}/secrets${this.buildQueryString(params)}`);
    return { total: raw.total, data: raw.secrets };
  }

  async deleteSecret(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/secrets/${id}`);
  }

  async createSecretMultipart(org: string, workspace: string, form: FormData): Promise<BIQSecretMetadata> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/secrets`, form);
  }

  async listSecretKeys(org: string, workspace: string, search?: string): Promise<{ keys: { key: string; type: string }[]; nextPage?: number }> {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    qs.set('page', '1');
    qs.set('pageSize', '20');
    return this.request('GET', `${this.wkspPath(org, workspace)}/secretsKeys?${qs.toString()}`);
  }

  async getAwsRoleData(org: string, workspace: string): Promise<{ awsAccountId: string; externalId: string }> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/secrets/awsRoleData`);
  }

  // ── Workspace Public Key ──────────────────────────────

  async getWorkspacePublicKey(org: string, workspace: string): Promise<string> {
    const raw = await this.requestText('GET', `${this.wkspPath(org, workspace)}/publicKey`);
    // Server may return the key as a JSON string ("...") or as a plain text body.
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return JSON.parse(trimmed) as string;
    }
    return trimmed;
  }

  // ── API Tokens ────────────────────────────────────────

  async listTokens(params?: ListFilterParams): Promise<PaginatedResponse<BIQApiToken>> {
    return this.request('GET', `/apiTokens${this.buildQueryString(params)}`);
  }

  async createToken(body: { name: string; scopes: string[]; expiresAt?: string }): Promise<BIQApiTokenCreated> {
    return this.request('POST', '/apiTokens', body);
  }

  async revokeToken(id: string): Promise<void> {
    return this.request('DELETE', `/apiTokens/${id}`);
  }

  // ── Actors ────────────────────────────────────────────

  async listActors(): Promise<Record<string, BIQActorType>> {
    return this.request('GET', '/actors');
  }

  async getActorSchema(actorType: string, action?: string): Promise<BIQActorSchema | BIQActorActionSchema> {
    const qs = action ? `?action=${action}` : '';
    return this.request('GET', `/actors/${actorType}/schema${qs}`);
  }

  // ── Canvas Data Operations ────────────────────────────

  async createCanvasWithData(org: string, workspace: string, body: unknown): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/data`, body);
  }

  async batchActorOperations(org: string, workspace: string, canvasId: string, body: unknown): Promise<BatchActorOperationsResponse> {
    return this.request('PATCH', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors`, body);
  }

  async importCanvasData(org: string, workspace: string, canvasId: string, body: unknown): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/import`, body);
  }

  async validateCanvas(org: string, workspace: string, canvasId: string): Promise<BIQCanvasValidation> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/validate`);
  }

  async layoutCanvas(org: string, workspace: string, canvasId: string, options?: { sourceActorIds?: string[]; pinnedActorPositions?: Record<string, { x?: number; y?: number }> }): Promise<BIQCanvasLayout> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/layout`, options);
  }

  async verifyImportData(org: string, workspace: string, body: unknown): Promise<unknown> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/verifyCanvasImportData`, body);
  }

  // ── Flowrun Jobs ──────────────────────────────────────

  async listFlowrunJobs(org: string, workspace: string, params: { canvasId: string; actorId: string; flowrunId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunJob>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    searchParams.set('canvasId', params.canvasId);
    searchParams.set('actorId', params.actorId);
    if (params.flowrunId) searchParams.set('flowrunId', params.flowrunId);
    const qs = searchParams.toString();
    const raw = await this.request<{ flowrunJobs: BIQFlowrunJob[] }>('GET', `${this.wkspPath(org, workspace)}/flowrunJobs${qs ? `?${qs}` : ''}`);
    return { total: raw.flowrunJobs.length, data: raw.flowrunJobs };
  }

  async testRunJob(org: string, workspace: string, body: { canvasId: string; actorId: string; publishEmittedMessageToConnectedActors: boolean }): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/flowrunJobs/testRun`, body);
  }

  async reRunJob(org: string, workspace: string, body: { flowrunJobId: string; publishEmittedMessageToConnectedActors: boolean }): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/flowrunJobs/reRun`, body);
  }

  async getJobRuntimeData(org: string, workspace: string, jobId: string, rootPath: RuntimeDataRootPath): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/runtimeData?rootPath=${rootPath}`);
  }

  async getJobAiTimeline(org: string, workspace: string, jobId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/aiAgentTimeline`);
  }

  async getJobSourceMessage(org: string, workspace: string, jobId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/sourceFlowrunMessage`);
  }

  // ── Flowrun Job Results ───────────────────────────────

  async getJobResultSummaries(org: string, workspace: string, jobId: string): Promise<BIQFlowrunJobResultSummary[]> {
    const raw = await this.request<{ summary: BIQFlowrunJobResultSummary[] }>('GET', `${this.wkspPath(org, workspace)}/flowrunJobResults/summaries?flowrunJobId=${jobId}`);
    return raw.summary;
  }

  async getJobResultData(org: string, workspace: string, resultId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobResults/${resultId}/data`);
  }

  // ── Flowrun Messages ──────────────────────────────────

  async listFlowrunMessages(org: string, workspace: string, params: { canvasId: string; actorId: string; flowrunId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunMessage>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    searchParams.set('canvasId', params.canvasId);
    searchParams.set('actorId', params.actorId);
    if (params.flowrunId) searchParams.set('flowrunId', params.flowrunId);
    const qs = searchParams.toString();
    const raw = await this.request<{ flowrunEmittedMessages: BIQFlowrunMessage[] }>('GET', `${this.wkspPath(org, workspace)}/flowrunMessages${qs ? `?${qs}` : ''}`);
    return { total: raw.flowrunEmittedMessages.length, data: raw.flowrunEmittedMessages };
  }

  async getFlowrunMessageData(org: string, workspace: string, messageId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunMessages/${messageId}/emittedData`);
  }

  // ── Connection Types ──────────────────────────────────

  async listConnectionTypes(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQConnectionType>> {
    const raw = await this.request<{ types: BIQConnectionType[]; nextPage?: number }>('GET', `${this.wkspPath(org, workspace)}/connections/types${this.buildQueryString(params)}`);
    return { total: raw.types.length, data: raw.types };
  }

  // ── Assets ────────────────────────────────────────────

  async listAssets(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQAssetMetadata>> {
    const raw = await this.request<{ total: number; assets: BIQAssetMetadata[] }>('GET', `${this.wkspPath(org, workspace)}/assets${this.buildQueryString(params)}`);
    return { total: raw.total, data: raw.assets };
  }

  async createAsset(org: string, workspace: string, body: BIQAssetCreateBody): Promise<BIQAssetCreateResponse> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/assets`, body);
  }

  async getAssetData(org: string, workspace: string, id: string): Promise<string> {
    const raw = await this.request<{ data: string }>('GET', `${this.wkspPath(org, workspace)}/assets/${id}/data`);
    return raw.data;
  }

  async updateAsset(org: string, workspace: string, id: string, body: BIQAssetUpdateBody): Promise<BIQAssetCreateResponse> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/assets/${id}`, body);
  }

  async updateFileUpload(org: string, workspace: string, fileId: string, body: BIQFileUploadStatusBody): Promise<BIQFileMetadata> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/files/${fileId}/updateUpload`, body);
  }

  async deleteAsset(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/assets/${id}`);
  }

  // ── Canvas Actors ──────────────────────────────────────

  async listCanvasActors(org: string, workspace: string, canvasId: string, params?: ListFilterParams & { actorType?: string; isActive?: string }): Promise<{ total: number; actors: BIQCanvasActor[] }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.actorType) searchParams.set('actorType', params.actorType);
    if (params?.isActive) searchParams.set('isActive', params.isActive);
    const qs = searchParams.toString();
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors${qs ? `?${qs}` : ''}`);
  }

  async getCanvasActor(org: string, workspace: string, canvasId: string, actorId: string): Promise<BIQCanvasActor> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/${actorId}`);
  }

  async getCanvasActorFlow(org: string, workspace: string, canvasId: string, actorId: string): Promise<BIQCanvasActorFlow> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/${actorId}/flow`);
  }

  async verifyCanvasActor(org: string, workspace: string, canvasId: string, body: unknown): Promise<BIQActorVerification> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/verify`, body);
  }

  async createCanvasActor(org: string, workspace: string, canvasId: string, actorId: string, body: unknown): Promise<BatchActorOperationsResponse> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/${actorId}`, body);
  }

  async updateCanvasActor(org: string, workspace: string, canvasId: string, actorId: string, body: unknown, editVersion?: number): Promise<BatchActorOperationsResponse> {
    const qs = editVersion !== undefined ? `?editVersion=${editVersion}` : '';
    return this.request('PATCH', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/${actorId}${qs}`, body);
  }

  async deleteCanvasActor(org: string, workspace: string, canvasId: string, actorId: string, editVersion?: number): Promise<BatchActorOperationsResponse> {
    const qs = editVersion !== undefined ? `?editVersion=${editVersion}` : '';
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors/${actorId}${qs}`);
  }

  // ── Templates ─────────────────────────────────────────

  async listTemplates(org: string, workspace: string, params?: ListFilterParams & TemplateListFilters): Promise<PaginatedResponse<BIQActorTemplateMetadata>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.types?.length) {
      // Use array notation (types[]=…) so Express's qs parser produces an array
      // even when only one value is provided. A bare `types=…` arrives as a string
      // and fails the server-side `z.array(...)` schema.
      for (const t of params.types) searchParams.append('types[]', t);
    }
    if (params?.appId) searchParams.set('appId', params.appId);
    const qs = searchParams.toString();
    const raw = await this.request<{ total: number; templates: BIQActorTemplateMetadata[] }>('GET', `${this.wkspPath(org, workspace)}/templates${qs ? `?${qs}` : ''}`);
    return { total: raw.total, data: raw.templates };
  }

  async getTemplate(org: string, workspace: string, id: string): Promise<BIQActorTemplateDetail> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/templates/${id}`);
  }

  async listTemplateApps(org: string, workspace: string, params?: ListFilterParams & { categoryId?: string }): Promise<PaginatedResponse<BIQTemplateApp>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.categoryId) searchParams.set('categoryId', params.categoryId);
    const qs = searchParams.toString();
    const raw = await this.request<{ total: number; templateApps: BIQTemplateApp[] }>('GET', `${this.wkspPath(org, workspace)}/template/apps${qs ? `?${qs}` : ''}`);
    return { total: raw.total, data: raw.templateApps };
  }
}

export { ApiError } from './errors.js';
export type * from './types.js';
