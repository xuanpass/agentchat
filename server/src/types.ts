// ── Core domain types (mirrors ARCHITECTURE.md §4) ──

export type AgentKind = 'openclaw' | 'hermes' | 'opencode' | 'a2a';

export interface AgentConnection {
  id: string;
  name: string;
  kind: AgentKind;
  endpoint: {
    baseUrl: string;
    openaiPath?: string;
  };
  auth: {
    type: 'token' | 'basic' | 'password' | 'none';
    // 加密后的凭据, 明文不落地
    encrypted: string;
    iv: string;
    tag: string;
  };
  profile?: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  capabilities: CapabilityFlags;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CapabilityFlags {
  sessions: boolean;
  teams: boolean;
  skills: boolean;
  plugins: boolean;
  mcp: boolean;
  streaming: boolean;
}

export interface AgentSession {
  id: string;
  connectionId: string;
  teamId?: string;
  projectId?: string;
  remoteSessionId: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  status: 'idle' | 'running' | 'streaming' | 'done' | 'error';
  meta: Record<string, unknown>;
}

export interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  members: TeamMember[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type InteropMechanism = 'bff-bus' | 'native-tool' | 'channel-webhook';
export type MemberRole = 'lead' | 'worker' | 'reviewer' | 'observer';
export type MemberStatus = 'online' | 'busy' | 'offline' | 'error';

export interface TeamMember {
  connectionId: string;
  role: MemberRole;
  status: MemberStatus;
  interop: InteropMechanism[];
}

export interface AgentRun {
  id: string;
  teamId?: string;
  sessionIds: string[];
  traceId: string;
  status: 'queued' | 'dispatch' | 'running' | 'awaiting' | 'done' | 'failed' | 'cancelled';
  strategy: 'serial' | 'fanout' | 'review';
  context?: { goal: string; instructions?: string; injectedTeamContext?: string };
  events: RunEvent[];
  createdAt: number;
  updatedAt: number;
}

export type RunEvent =
  | { kind: 'dispatch'; to: string; text: string; ts: number }
  | { kind: 'respond'; from: string; text: string; ts: number }
  | { kind: 'approval'; action: string; by: 'human' | 'agent'; decision: 'approve' | 'reject'; ts: number }
  | { kind: 'finish'; to: string; result: string; ts: number };

export interface Capability {
  id: string;
  type: 'skill' | 'plugin' | 'mcp';
  name: string;
  version?: string;
  sourceKind: 'openclaw' | 'hermes' | 'opencode' | 'a2a' | 'local';
  payload: CapabilityPayload;
  checksum: string;
  sizeBytes: number;
  installedOn: string[];
  lastSyncedAt?: Record<string, number>;
  createdAt: number;
}

export type CapabilityPayload =
  | { kind: 'file'; path: string; encoding: 'utf8' | 'base64'; content: string }
  | { kind: 'dir'; tree: { path: string; encoding: 'utf8' | 'base64'; content: string }[] }
  | { kind: 'config'; config: Record<string, unknown> };

export interface AgentProject {
  id: string;
  name: string;
  connectionId: string;
  rootPath: string;
  description?: string;
  defaultModel?: string;
  defaultAgent?: string;
  contextHint?: string;
  sessions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MemberDescriptor {
  id: string;
  connectionId: string;
  name: string;
  kind: AgentKind;
  teamId?: string;
  status: MemberStatus;
  interop: InteropMechanism[];
  callableEndpoint?: string;
  capabilities: string[];
}

export interface HealthProbe {
  ok: boolean;
  latencyMs: number;
  capabilities: CapabilityFlags;
  remoteInfo?: { version?: string; model?: string; [k: string]: unknown };
  error?: string;
}

// ── Driver contract (§5.1) ──

export interface SessionCreateOpts {
  title?: string;
  projectId?: string;
  teamId?: string;
  instructions?: string;
  model?: string;
}

export interface StreamHandle {
  sessionId: string;
  // 返回原生流(WS/SSE), BFF 把它桥为统一 SSE 给前端
  [k: string]: unknown;
}

export interface SyncResult {
  ok: boolean;
  targetConnectionId: string;
  capabilityName: string;
  action: 'pushed' | 'skipped' | 'failed';
  previousChecksum?: string;
  newChecksum?: string;
  error?: string;
}

export interface CapabilityMeta {
  name: string;
  type: string;
  version?: string;
  checksum: string;
  sizeBytes: number;
}

export interface DiffResult {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}

export interface AgentConnectionDriver {
  kind: AgentKind;
  test(baseUrl: string, auth: AgentConnection['auth']): Promise<HealthProbe>;
  listSessions(conn: AgentConnection): Promise<AgentSession[]>;
  createSession(conn: AgentConnection, opts: SessionCreateOpts): Promise<AgentSession>;
  resumeSession(conn: AgentConnection, sessionId: string): Promise<void>;
  deleteSession(conn: AgentConnection, sessionId: string): Promise<void>;
  sendMessage(conn: AgentConnection, sessionId: string, text: string): Promise<StreamHandle>;
  stopSession(conn: AgentConnection, sessionId: string): Promise<void>;
  listCapabilities(conn: AgentConnection): Promise<CapabilityMeta[]>;
  pushCapability(conn: AgentConnection, cap: Capability): Promise<SyncResult>;
  pullCapability(conn: AgentConnection, name: string): Promise<Capability>;
  diffCapability(conn: AgentConnection, cap: Capability): Promise<DiffResult>;
  deleteCapability(conn: AgentConnection, name: string): Promise<void>;
}
