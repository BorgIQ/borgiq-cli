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
  ReactAppBuildStartResponse,
  WorkspaceDeploymentStatus,
  BuildAllRuntimeBuildsResult,
  RuntimeBuildSummary,
  CanvasRuntimeBuildState,
  ReactAppBuildResultPayload,
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

  /**
   * Like request(), but surfaces the HTTP status alongside the parsed body so callers can
   * distinguish a 200 (terminal) from a 202 (still working) on long-poll endpoints — request()
   * treats both as success and hides which one it was. A 202 body is not parsed (it may be empty).
   */
  private async requestWithStatus<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/json',
    };

    let requestBody: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(url, { method, headers, body: requestBody });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { message?: string; details?: { path: (string | number)[]; message: string }[] } | null;
      throw new ApiError(
        response.status,
        errorBody?.message || response.statusText,
        errorBody?.details || [],
      );
    }

    if (response.status === 202 || response.status === 204) {
      return { status: response.status, data: undefined as T };
    }

    return { status: response.status, data: await response.json() as T };
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

  async listFlowruns(org: string, workspace: string, canvasSlugOrId: string, params?: ListFilterParams): Promise<PaginatedResponse<BIQFlowrun>> {
    const base = this.buildQueryString(params);
    const sep = base ? '&' : '?';
    const raw = await this.request<{ flowruns: BIQFlowrun[] }>('GET', `${this.wkspPath(org, workspace)}/flowruns${base}${sep}canvasSlugOrId=${canvasSlugOrId}`);
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

  // ── React App build ───────────────────────────────────

  /** Starts a ReactAppTriggerActor build (fire-and-forget flowrun). Body is empty — the config comes
   *  from the actor's stored configuration server-side; poll getReactAppBuildResult with the flowrun id. */
  async startReactAppBuild(org: string, workspace: string, canvasSlugOrId: string, actorId: string): Promise<ReactAppBuildStartResponse> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/apps/${actorId}/build`, {});
  }

  /** Long-polls the build result. 202 → still building (returns `{ pending: true }`); 200 → terminal. */
  async getReactAppBuildResult(
    org: string,
    workspace: string,
    canvasSlugOrId: string,
    actorId: string,
    opts: { flowrunId: string; waitSeconds: number },
  ): Promise<{ pending: true } | ReactAppBuildResultPayload> {
    const qs = new URLSearchParams({ flowrunId: opts.flowrunId, waitSeconds: String(opts.waitSeconds) });
    const { status, data } = await this.requestWithStatus<ReactAppBuildResultPayload>(
      'GET',
      `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/apps/${actorId}/build?${qs.toString()}`,
    );
    if (status === 202) return { pending: true };
    return data;
  }

  // ── Workspace deployment and runtime builds ───────────

  /**
   * Like request(), but over `node:http(s)` with no timeouts, for the build endpoints: the server
   * runs a build inside the request, so the response can start many minutes after the request —
   * past fetch's default header timeout. An optional AbortSignal is the caller's own deadline; note
   * that aborting only stops the wait, never the server-side build.
   */
  private async longRequest<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    const { request } = url.protocol === 'https:' ? await import('node:https') : await import('node:http');
    const payload = JSON.stringify(body ?? {});
    return new Promise<T>((resolve, reject) => {
      const req = request(url, {
        method,
        signal,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          let parsed: unknown = undefined;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = undefined;
            }
          }
          if (status < 200 || status >= 300) {
            const errorBody = parsed as { message?: string; details?: { path: (string | number)[]; message: string }[] } | undefined;
            reject(new ApiError(status, errorBody?.message || res.statusMessage || `HTTP ${status}`, errorBody?.details || []));
            return;
          }
          resolve(parsed as T);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /** The workspace's deployment setting and every canvas's build state. */
  async getWorkspaceDeployment(org: string, workspace: string): Promise<WorkspaceDeploymentStatus> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/deployment`);
  }

  /** Turn deployment on or off. Changes what triggers execute across every canvas in the workspace. */
  async updateWorkspaceDeployment(org: string, workspace: string, isDeployed: boolean): Promise<void> {
    await this.request('PUT', `${this.wkspPath(org, workspace)}/deployment`, { isDeployed });
  }

  /**
   * Build every buildable canvas in the workspace. Synchronous: the call returns when every build
   * has finished, with each build's terminal status.
   */
  async buildAllRuntimeBuilds(org: string, workspace: string, opts?: { signal?: AbortSignal }): Promise<BuildAllRuntimeBuildsResult> {
    return this.longRequest('POST', `${this.wkspPath(org, workspace)}/deployment/build-all`, {}, opts?.signal);
  }

  /**
   * Build one canvas. Synchronous: the call blocks for the whole build (typically minutes) and
   * resolves with the finished build — ready, partially_ready, or failed.
   */
  async startRuntimeBuild(org: string, workspace: string, canvasSlugOrId: string, opts?: { signal?: AbortSignal }): Promise<{ build: RuntimeBuildSummary | null }> {
    return this.longRequest('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/runtime-build`, {}, opts?.signal);
  }

  /**
   * The canvas's build state: which build its triggers run, the latest one, and whether the canvas
   * has been edited since its running build.
   */
  async getRuntimeBuild(org: string, workspace: string, canvasSlugOrId: string): Promise<CanvasRuntimeBuildState> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/runtime-build`);
  }

  /** The canvas's build history, newest first. */
  async listRuntimeBuilds(org: string, workspace: string, canvasSlugOrId: string, limit?: number): Promise<{ builds: RuntimeBuildSummary[] }> {
    const qs = limit ? `?limit=${limit}` : '';
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/runtime-builds${qs}`);
  }

  /** Make an earlier build the one the canvas's triggers run. */
  async activateRuntimeBuild(org: string, workspace: string, canvasSlugOrId: string, buildId: string): Promise<{ build: RuntimeBuildSummary }> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/runtime-build/${buildId}/activate`, {});
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

  async batchActorOperations(
    org: string,
    workspace: string,
    canvasSlugOrId: string,
    body: unknown,
    options?: { strict?: boolean },
  ): Promise<BatchActorOperationsResponse> {
    const qs = options?.strict ? '?strict=true' : '';
    return this.request('PATCH', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors${qs}`, body);
  }

  async importCanvasData(org: string, workspace: string, canvasSlugOrId: string, body: unknown): Promise<unknown> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/import`, body);
  }

  async validateCanvas(org: string, workspace: string, canvasSlugOrId: string): Promise<BIQCanvasValidation> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/validate`);
  }

  async layoutCanvas(org: string, workspace: string, canvasSlugOrId: string, options?: { sourceActorIds?: string[]; pinnedActorPositions?: Record<string, { x?: number; y?: number }> }): Promise<BIQCanvasLayout> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/layout`, options);
  }

  async verifyImportData(org: string, workspace: string, body: unknown): Promise<unknown> {
    return this.request('PUT', `${this.wkspPath(org, workspace)}/canvases/verifyCanvasImportData`, body);
  }

  // ── Flowrun Jobs ──────────────────────────────────────

  async listFlowrunJobs(org: string, workspace: string, params: { canvasSlugOrId: string; actorId: string; flowrunId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunJob>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    searchParams.set('canvasSlugOrId', params.canvasSlugOrId);
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

  async listFlowrunMessages(org: string, workspace: string, params: { canvasSlugOrId: string; actorId: string; flowrunId?: string } & ListFilterParams): Promise<PaginatedResponse<BIQFlowrunMessage>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    searchParams.set('canvasSlugOrId', params.canvasSlugOrId);
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

  async listCanvasActors(org: string, workspace: string, canvasSlugOrId: string, params?: ListFilterParams & { actorType?: string; isActive?: string }): Promise<{ total: number; actors: BIQCanvasActor[] }> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
    if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
    if (params?.actorType) searchParams.set('actorType', params.actorType);
    if (params?.isActive) searchParams.set('isActive', params.isActive);
    const qs = searchParams.toString();
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors${qs ? `?${qs}` : ''}`);
  }

  async getCanvasActor(org: string, workspace: string, canvasSlugOrId: string, actorId: string): Promise<BIQCanvasActor> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/${actorId}`);
  }

  async getCanvasActorFlow(org: string, workspace: string, canvasSlugOrId: string, actorId: string): Promise<BIQCanvasActorFlow> {
    return this.request('GET', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/${actorId}/flow`);
  }

  async verifyCanvasActor(org: string, workspace: string, canvasSlugOrId: string, body: unknown): Promise<BIQActorVerification> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/verify`, body);
  }

  async createCanvasActor(org: string, workspace: string, canvasSlugOrId: string, actorId: string, body: unknown): Promise<BatchActorOperationsResponse> {
    return this.request('POST', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/${actorId}`, body);
  }

  async updateCanvasActor(org: string, workspace: string, canvasSlugOrId: string, actorId: string, body: unknown, editVersion?: number): Promise<BatchActorOperationsResponse> {
    const qs = editVersion !== undefined ? `?editVersion=${editVersion}` : '';
    return this.request('PATCH', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/${actorId}${qs}`, body);
  }

  async deleteCanvasActor(org: string, workspace: string, canvasSlugOrId: string, actorId: string, editVersion?: number): Promise<BatchActorOperationsResponse> {
    const qs = editVersion !== undefined ? `?editVersion=${editVersion}` : '';
    return this.request('DELETE', `${this.wkspPath(org, workspace)}/canvases/${canvasSlugOrId}/actors/${actorId}${qs}`);
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
