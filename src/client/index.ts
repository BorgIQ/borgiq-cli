import { ApiError } from './errors.js';
import type {
  BIQUser,
  BIQUserAccessibleWorkspaceInfo,
  BIQCanvasMetadata,
  BIQConnectionMetadata,
  BIQSecretMetadata,
  BIQApiToken,
  BIQApiTokenCreated,
  BIQFlowrun,
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
  PatchActorsResponse,
  BIQFlowrunJob,
  BIQFlowrunJobResultSummary,
  BIQFlowrunMessage,
  BIQAssetMetadata,
  BIQConnectionType,
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

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

  async getOrgsAndWorkspaces(): Promise<BIQUserAccessibleWorkspaceInfo[]> {
    return this.request<BIQUserAccessibleWorkspaceInfo[]>('GET', '/apiUser/orgsAndWorkspaces');
  }

  // ── Workspaces ────────────────────────────────────────

  async listWorkspaces(org: string, params?: ListFilterParams): Promise<PaginatedResponse<{ id: string; name: string; slug: string; description: string }>> {
    return this.request('GET', `/orgs/${org}/workspaces${this.buildQueryString(params)}`);
  }

  // ── Canvases ──────────────────────────────────────────

  async listCanvases(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQCanvasMetadata>> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${this.buildQueryString(params)}`);
  }

  async getCanvas(org: string, workspace: string, id: string, includeData?: boolean): Promise<BIQCanvasMetadata> {
    const qs = includeData ? '?includeData=true' : '';
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${id}${qs}`);
  }

  async createCanvas(org: string, workspace: string, body: { name: string; slug: string; description?: string }): Promise<BIQCanvasMetadata> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases`, body);
  }

  async updateCanvas(org: string, workspace: string, id: string, body: { name?: string; description?: string }): Promise<BIQCanvasMetadata> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/${id}`, body);
  }

  async deleteCanvas(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/canvases/${id}`);
  }

  async exportCanvas(org: string, workspace: string, id: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${id}/exportData`);
  }

  // ── Flow Runs ─────────────────────────────────────────

  async listFlowruns(org: string, workspace: string, params?: ListFilterParams & { canvasId?: string }): Promise<PaginatedResponse<BIQFlowrun>> {
    const base = this.buildQueryString(params);
    const sep = base ? '&' : '?';
    const canvasFilter = params?.canvasId ? `${sep}canvasId=${params.canvasId}` : '';
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowruns${base}${canvasFilter}`);
  }

  async getFlowrun(org: string, workspace: string, id: string): Promise<BIQFlowrun> {
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
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowruns/${id}/children`);
  }

  // ── Triggers ──────────────────────────────────────────

  async triggerManual(org: string, workspace: string, body: ManualTriggerRequest): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/triggers/manual`, body);
  }

  // ── Connections ───────────────────────────────────────

  async listConnections(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQConnectionMetadata>> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/connections${this.buildQueryString(params)}`);
  }

  async deleteConnection(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/connections/${id}`);
  }

  // ── Secrets ───────────────────────────────────────────

  async listSecrets(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQSecretMetadata>> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/secrets${this.buildQueryString(params)}`);
  }

  async deleteSecret(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/secrets/${id}`);
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

  async listActors(): Promise<BIQActorType[]> {
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

  async patchActors(org: string, workspace: string, canvasId: string, body: unknown): Promise<PatchActorsResponse> {
    return this.request('PATCH', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/actors`, body);
  }

  async updateCanvasData(org: string, workspace: string, canvasId: string, body: unknown): Promise<unknown> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/data`, body);
  }

  async validateCanvas(org: string, workspace: string, canvasId: string): Promise<BIQCanvasValidation> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/validate`);
  }

  async layoutCanvas(org: string, workspace: string, canvasId: string, sourceActorId?: string): Promise<BIQCanvasLayout> {
    const qs = sourceActorId ? `?sourceActorId=${sourceActorId}` : '';
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasId}/layout${qs}`);
  }

  async verifyImportData(org: string, workspace: string, body: unknown): Promise<unknown> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/verifyCanvasImportData`, body);
  }

  // ── Flowrun Jobs ──────────────────────────────────────

  async listFlowrunJobs(org: string, workspace: string, params: { canvasId?: string; actorId?: string; flowrunId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunJob>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.canvasId) searchParams.set('canvasId', params.canvasId);
    if (params.actorId) searchParams.set('actorId', params.actorId);
    if (params.flowrunId) searchParams.set('flowrunId', params.flowrunId);
    const qs = searchParams.toString();
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs${qs ? `?${qs}` : ''}`);
  }

  async testRunJob(org: string, workspace: string, body: { canvasId: string; actorId: string; publishEmittedMessageToConnectedActors?: boolean }): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/flowrunJobs/testRun`, body);
  }

  async reRunJob(org: string, workspace: string, body: { flowrunJobId: string; publishEmittedMessagesToConnectedActors?: boolean }): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/flowrunJobs/reRun`, body);
  }

  async getJobRuntimeData(org: string, workspace: string, jobId: string, rootPath?: string): Promise<unknown> {
    const qs = rootPath ? `?rootPath=${rootPath}` : '';
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/runtimeData${qs}`);
  }

  async getJobAiTimeline(org: string, workspace: string, jobId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/aiAgentTimeline`);
  }

  async getJobSourceMessage(org: string, workspace: string, jobId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobs/${jobId}/sourceFlowrunMessage`);
  }

  // ── Flowrun Job Results ───────────────────────────────

  async getJobResultSummaries(org: string, workspace: string, jobId: string): Promise<BIQFlowrunJobResultSummary[]> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobResults/summaries?flowrunJobId=${jobId}`);
  }

  async getJobResultData(org: string, workspace: string, resultId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunJobResults/${resultId}/data`);
  }

  // ── Flowrun Messages ──────────────────────────────────

  async listFlowrunMessages(org: string, workspace: string, params: { canvasId?: string; flowrunId?: string; actorId?: string; portId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunMessage>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.canvasId) searchParams.set('canvasId', params.canvasId);
    if (params.flowrunId) searchParams.set('flowrunId', params.flowrunId);
    if (params.actorId) searchParams.set('actorId', params.actorId);
    if (params.portId) searchParams.set('portId', params.portId);
    const qs = searchParams.toString();
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunMessages${qs ? `?${qs}` : ''}`);
  }

  async getFlowrunMessageData(org: string, workspace: string, messageId: string): Promise<unknown> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/flowrunMessages/${messageId}/emittedData`);
  }

  // ── Connection Types ──────────────────────────────────

  async listConnectionTypes(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQConnectionType>> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/connections/types${this.buildQueryString(params)}`);
  }

  // ── Assets ────────────────────────────────────────────

  async listAssets(org: string, workspace: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQAssetMetadata>> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/assets${this.buildQueryString(params)}`);
  }

  async deleteAsset(org: string, workspace: string, id: string): Promise<void> {
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/assets/${id}`);
  }
}

export { ApiError } from './errors.js';
export type * from './types.js';
