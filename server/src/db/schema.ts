// ── SQLite schema (§3.1 存储层) ──

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- kind 合法性由应用层 zod 校验 (routes/connections.ts), 不放 CHECK — 新增 kind 时无需重建表
  kind TEXT NOT NULL,
  endpoint_base_url TEXT NOT NULL,
  endpoint_openai_path TEXT,
  auth_type TEXT NOT NULL CHECK(auth_type IN ('token','basic','password','none')),
  auth_encrypted TEXT,
  auth_iv TEXT,
  auth_tag TEXT,
  profile TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('disconnected','connecting','connected','error')),
  cap_sessions INTEGER NOT NULL DEFAULT 0,
  cap_teams INTEGER NOT NULL DEFAULT 0,
  cap_skills INTEGER NOT NULL DEFAULT 0,
  cap_plugins INTEGER NOT NULL DEFAULT 0,
  cap_mcp INTEGER NOT NULL DEFAULT 0,
  cap_streaming INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  team_id TEXT,
  project_id TEXT,
  remote_session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','streaming','done','error')),
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sessions_conn ON sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_sessions_team ON sessions(team_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(last_active_at DESC);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  members TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  session_ids TEXT NOT NULL DEFAULT '[]',
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  strategy TEXT NOT NULL DEFAULT 'serial',
  context TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('skill','plugin','mcp')),
  name TEXT NOT NULL,
  version TEXT,
  source_kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  checksum TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  installed_on TEXT NOT NULL DEFAULT '[]',
  last_synced_at TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  description TEXT,
  default_model TEXT,
  default_agent TEXT,
  context_hint TEXT,
  sessions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_conn ON projects(connection_id);
CREATE INDEX IF NOT EXISTS idx_runs_team ON runs(team_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS sync_tasks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'local',
  target_connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  capability_names TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','cancelled')),
  diff_result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);

-- ── M14: Token 用量分析 ──
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_token_session ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_team ON token_usage(team_id);
CREATE INDEX IF NOT EXISTS idx_token_created ON token_usage(created_at DESC);

-- ── M14: 告警规则引擎 ──
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  metric TEXT NOT NULL CHECK(metric IN ('token_budget','error_rate','latency','connection_health','run_failure')),
  operator TEXT NOT NULL CHECK(operator IN ('gt','lt','gte','lte','eq')),
  threshold REAL NOT NULL,
  window_seconds INTEGER NOT NULL DEFAULT 300,
  channels TEXT NOT NULL DEFAULT '["ui"]',
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600,
  last_triggered_at INTEGER,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── M14: Agent 编排工作流 ──
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
  nodes_status TEXT NOT NULL DEFAULT '{}',
  nodes_result TEXT NOT NULL DEFAULT '{}',
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wf_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_wf_runs_created ON workflow_runs(created_at DESC);

-- ── M15: 多模型路由 ──
CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic','deepseek','gemini','ollama','custom')),
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  api_key_iv TEXT,
  api_key_tag TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  default_model TEXT,
  max_tokens INTEGER DEFAULT 4096,
  cost_per_1k_input REAL DEFAULT 0,
  cost_per_1k_output REAL DEFAULT 0,
  weight INTEGER DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','rate_limited','error','disabled')),
  latency_ms INTEGER,
  success_rate REAL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  provider_id TEXT REFERENCES model_providers(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  condition_type TEXT NOT NULL DEFAULT 'default' CHECK(condition_type IN ('default','complexity','cost','latency','keyword')),
  condition_value TEXT,
  priority INTEGER DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_priority ON model_routing_rules(priority DESC);

-- ── M15: 智能体监控 ──
CREATE TABLE IF NOT EXISTS agent_metrics (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL CHECK(metric_type IN ('latency','throughput','error_rate','token_rate','queue_depth','active_tasks')),
  value REAL NOT NULL,
  labels TEXT DEFAULT '{}',
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_conn ON agent_metrics(connection_id);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_type ON agent_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_ts ON agent_metrics(recorded_at DESC);

-- ── M15/M16: 仪表盘自定义 ──
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('stat','chart','list','activity','health','alerts','custom')),
  config TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dash_widgets_user ON dashboard_widgets(user_id);
CREATE INDEX IF NOT EXISTS idx_dash_widgets_pos ON dashboard_widgets(user_id, position);

-- ── M15: 插件生态 2.0 ──
CREATE TABLE IF NOT EXISTS plugin_reviews (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_plugin ON plugin_reviews(capability_id);

CREATE TABLE IF NOT EXISTS plugin_dependencies (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL,
  version_constraint TEXT DEFAULT '*',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deps_plugin ON plugin_dependencies(capability_id);

-- ── M16: Agent 聊天中心 ──
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  model TEXT,
  system_prompt TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  message_count INTEGER NOT NULL DEFAULT 0,
  total_tokens_in INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_conn ON chat_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  model TEXT,
  finish_reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at);

-- ── M16: 通知中心 ──
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('alert','system','info','warning','error')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  link TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  read INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);

-- ── M16: 数据备份记录 ──
CREATE TABLE IF NOT EXISTS backup_records (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','running','completed','failed','restored')),
  size_bytes INTEGER DEFAULT 0,
  checksum TEXT,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_created ON backup_records(created_at DESC);

-- ── M16: 报告模板 ──
CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK(type IN ('token_usage','cost_analysis','performance','trend','custom')),
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_type ON report_templates(type);
`;
