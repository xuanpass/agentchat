<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">智能体</h1>
      <button class="btn btn-primary" @click="showWizard = true">+ 接入智能体</button>
    </div>

    <SkeletonScreen v-if="store.loading" type="cards" :count="6" />

    <template v-else>
      <div v-for="(conns, kind) in store.grouped" :key="kind" class="kind-group">
        <div class="kind-header">
          <span class="kind-badge" :class="`kind-${kind}`">{{ kind }}</span>
          <span class="kind-count">{{ conns.length }} 个实例</span>
        </div>

        <div v-if="conns.length === 0" class="kind-empty">暂无 {{ kind }} 实例</div>

        <div v-else class="conn-grid">
          <div v-for="c in conns" :key="c.id" class="card conn-card">
            <div class="conn-head">
              <span class="status-dot" :class="`status-${c.status}`"></span>
              <span class="conn-name">{{ c.name }}</span>
            </div>
            <div class="conn-endpoint">{{ c.endpoint.baseUrl }}</div>
            <div class="conn-meta">
              <span v-if="c.capabilities.sessions" class="cap-tag">会话</span>
              <span v-if="c.capabilities.skills" class="cap-tag">技能</span>
              <span v-if="c.capabilities.plugins" class="cap-tag">插件</span>
              <span v-if="c.capabilities.mcp" class="cap-tag">MCP</span>
            </div>
            <div class="conn-actions">
              <button class="btn btn-sm" @click="viewConfig(c)">查看配置</button>
              <button class="btn btn-sm" @click="testConnection(c)">测试</button>
              <button class="btn btn-sm" @click="store.remove(c.id)">移除</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 接入向导 Modal -->
    <div v-if="showWizard" class="modal-overlay" @click.self="showWizard = false">
      <div class="card modal">
        <h2>接入智能体</h2>
        <div class="form-row">
          <label>类型</label>
          <select v-model="form.kind">
            <option value="a2a">A2A (通用协议 — OpenClaw / Hermes 等)</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
            <option value="opencode">OpenCode</option>
          </select>
          <span v-if="form.kind === 'a2a'" class="field-hint">
            对接任何 A2A v1.0 端点, 自动从 Agent Card 发现 JSON-RPC 地址
          </span>
        </div>
        <div class="form-row">
          <label>名称 <span class="required">*</span></label>
          <input v-model="form.name" placeholder="如: 研发组 openclaw 主节点" />
        </div>
        <div class="form-row">
          <label>Endpoint <span class="required">*</span></label>
          <input
            v-model="form.baseUrl"
            :placeholder="form.kind === 'a2a' ? 'http://host:18789 或 http://host:9900 (服务根地址)' : 'ws://host:port 或 http://host:port'"
          />
          <span v-if="form.baseUrl && !isValidUrl" class="field-error">URL 格式无效</span>
          <span v-else-if="form.kind === 'a2a'" class="field-hint">
            填 A2A 服务根地址即可, 驱动会自动读取 /.well-known/agent-card.json 定位真实 JSON-RPC 端点
          </span>
        </div>
        <div class="form-row">
          <label>认证类型</label>
          <select v-model="form.authType">
            <option value="token">Token (Bearer)</option>
            <option value="basic">Basic (user:pass)</option>
            <option value="password">Password</option>
            <option value="none">无</option>
          </select>
        </div>
        <div class="form-row" v-if="form.authType !== 'none'">
          <label>密钥 / 密码</label>
          <input v-model="form.secret" type="password" placeholder="明文凭据, 服务端加密存储" />
          <span v-if="form.kind === 'a2a'" class="field-hint">
            填对端配置的 Bearer token (OpenClaw: channels.a2a.peers.*.token / Hermes: ~/.hermes/a2a_bearer_token.txt)
          </span>
        </div>
        <div class="form-row" v-if="form.kind === 'hermes'">
          <label>Profile (可选)</label>
          <input v-model="form.profile" placeholder="Hermes profile 名, 如 default" />
        </div>
        <div class="form-row" v-if="form.kind === 'hermes' || form.kind === 'opencode'">
          <label>OpenAI API 路径 (可选)</label>
          <input v-model="form.openaiPath" placeholder="如: http://host:8642/v1" />
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showWizard = false" :disabled="submitting">取消</button>
          <button class="btn btn-primary" @click="submit" :disabled="!canSubmit || submitting">
            <span v-if="submitting" class="spinner"></span>
            {{ submitting ? '测试中...' : '测试并保存' }}
          </button>
        </div>
        <div v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'fail'">
          {{ testResult.ok ? `✓ 连通 (${testResult.latencyMs}ms)` : `✗ ${testResult.error || '失败'}` }}
        </div>
      </div>
    </div>

    <!-- 配置详情 Modal -->
    <div v-if="showConfig" class="modal-overlay" @click.self="showConfig = false">
      <div class="card modal config-modal">
        <div class="config-header">
          <h2>智能体配置</h2>
          <button class="btn btn-sm" @click="showConfig = false">✕</button>
        </div>
        <div v-if="configDetail" class="config-body">
          <div class="config-section">
            <h3>基本信息</h3>
            <div class="config-grid">
              <div class="config-item">
                <span class="config-label">名称</span>
                <span class="config-value">{{ configDetail.name }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">类型</span>
                <span class="config-value">
                  <span class="kind-badge" :class="`kind-${configDetail.kind}`">{{ configDetail.kind }}</span>
                </span>
              </div>
              <div class="config-item">
                <span class="config-label">ID</span>
                <span class="config-value mono">{{ configDetail.id }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">状态</span>
                <span class="config-value">
                  <span class="status-dot" :class="`status-${configDetail.status}`"></span>
                  {{ configDetail.status }}
                </span>
              </div>
            </div>
          </div>

          <div class="config-section">
            <h3>端点配置</h3>
            <div class="config-grid">
              <div class="config-item">
                <span class="config-label">Base URL</span>
                <span class="config-value mono">{{ configDetail.endpoint.baseUrl }}</span>
              </div>
              <div class="config-item" v-if="configDetail.endpoint.openaiPath">
                <span class="config-label">OpenAI 路径</span>
                <span class="config-value mono">{{ configDetail.endpoint.openaiPath }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">认证类型</span>
                <span class="config-value">{{ configDetail.auth.type }}</span>
              </div>
              <div class="config-item" v-if="configDetail.profile">
                <span class="config-label">Profile</span>
                <span class="config-value">{{ configDetail.profile }}</span>
              </div>
            </div>
          </div>

          <div class="config-section">
            <h3>能力标志</h3>
            <div class="config-caps">
              <span class="cap-tag" :class="configDetail.capabilities.sessions ? 'cap-on' : 'cap-off'">会话</span>
              <span class="cap-tag" :class="configDetail.capabilities.teams ? 'cap-on' : 'cap-off'">团队</span>
              <span class="cap-tag" :class="configDetail.capabilities.skills ? 'cap-on' : 'cap-off'">技能</span>
              <span class="cap-tag" :class="configDetail.capabilities.plugins ? 'cap-on' : 'cap-off'">插件</span>
              <span class="cap-tag" :class="configDetail.capabilities.mcp ? 'cap-on' : 'cap-off'">MCP</span>
              <span class="cap-tag" :class="configDetail.capabilities.streaming ? 'cap-on' : 'cap-off'">流式</span>
            </div>
          </div>

          <div class="config-section">
            <h3>运行时状态</h3>
            <div class="config-grid">
              <div class="config-item">
                <span class="config-label">内存中</span>
                <span class="config-value">{{ configDetail.inMemory ? '是' : '否' }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">重试次数</span>
                <span class="config-value">{{ configDetail.retryCount }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">最后在线</span>
                <span class="config-value">{{ configDetail.lastSeenAt ? new Date(configDetail.lastSeenAt).toLocaleString() : '从未' }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">创建时间</span>
                <span class="config-value">{{ new Date(configDetail.createdAt).toLocaleString() }}</span>
              </div>
              <div class="config-item">
                <span class="config-label">最后更新</span>
                <span class="config-value">{{ new Date(configDetail.updatedAt).toLocaleString() }}</span>
              </div>
              <div class="config-item" v-if="configDetail.lastError">
                <span class="config-label">最后错误</span>
                <span class="config-value error-text">{{ configDetail.lastError }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="empty"><div class="empty-icon">⟳</div><div>加载中...</div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useConnectionStore } from '../stores/connections';
import { api } from '../api/client';
import { useToast } from '../composables/useToast';
import SkeletonScreen from '../components/SkeletonScreen.vue';

const toast = useToast();

const store = useConnectionStore();
const showWizard = ref(false);
const testResult = ref<any>(null);
const submitting = ref(false);

const showConfig = ref(false);
const configDetail = ref<any>(null);

const form = reactive({
  kind: 'openclaw',
  name: '',
  baseUrl: '',
  authType: 'token',
  secret: '',
  profile: '',
  openaiPath: '',
});

const canSubmit = computed(() => form.name && form.baseUrl && form.kind);
const isValidUrl = computed(() => {
  if (!form.baseUrl) return true;
  try { new URL(form.baseUrl); return true; } catch { return false; }
});

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  testResult.value = null;
  try {
    const payload: any = {
      name: form.name,
      kind: form.kind,
      endpoint: { baseUrl: form.baseUrl },
      auth: { type: form.authType, secret: form.secret || undefined },
    };
    if (form.profile) payload.profile = form.profile;
    if (form.openaiPath) payload.endpoint.openaiPath = form.openaiPath;

    const created = await store.create(payload) as any;
    testResult.value = await store.testConnection(created.id);
    if (testResult.value.ok) {
      setTimeout(() => { showWizard.value = false; resetForm(); }, 800);
    }
  } catch (err: any) {
    testResult.value = { ok: false, error: err.message };
  } finally {
    submitting.value = false;
  }
}

function resetForm() {
  form.name = ''; form.baseUrl = ''; form.authType = 'token'; form.secret = '';
  form.profile = ''; form.openaiPath = '';
  testResult.value = null;
}

async function testConnection(c: any) {
  const r = await store.testConnection(c.id) as any;
  if (r.ok) {
    toast.success(`连通 (${r.latencyMs}ms)`);
  } else {
    toast.error(r.error || '连通测试失败');
  }
}

async function viewConfig(c: any) {
  configDetail.value = { ...c };
  showConfig.value = true;
  // 从 status 端点拉取运行时状态
  try {
    const status = await api.get(`/connections/${c.id}/status`);
    configDetail.value = { ...c, ...status };
  } catch { /* 忽略 */ }
}

onMounted(() => {
  store.fetch();
  store.startAutoRefresh();
});

onUnmounted(() => store.stopAutoRefresh());
</script>

<style scoped>
.kind-group { margin-bottom: 28px; }
.kind-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.kind-count { color: var(--text-muted); font-size: 13px; }
.kind-empty { color: var(--text-muted); padding: 16px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }

.conn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.conn-card { padding: 14px; }
.conn-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.conn-name { font-weight: 600; }
.conn-endpoint { font-size: 12px; color: var(--text-muted); font-family: monospace; word-break: break-all; margin-bottom: 10px; }
.conn-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.cap-tag { background: var(--accent-light); color: var(--accent); font-size: 11px; padding: 1px 6px; border-radius: 3px; }
.conn-actions { display: flex; gap: 6px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 460px; padding: 24px; }
.modal h2 { margin-bottom: 18px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.form-row input:focus, .form-row select:focus { outline: none; border-color: var(--accent); }
.form-row .required { color: var(--red); }
.form-row .field-error { font-size: 11px; color: var(--red); margin-top: 2px; }
.form-row .field-hint { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.spinner {
  display: inline-block;
  width: 12px; height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }
.test-result { margin-top: 12px; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
.test-result.ok { background: var(--green-dim); color: var(--green); }
.test-result.fail { background: var(--red-dim); color: var(--red); }

.config-modal { width: 560px; max-height: 80vh; overflow-y: auto; }
.config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.config-header h2 { font-size: 18px; margin: 0; }
.config-section { margin-bottom: 20px; }
.config-section h3 { font-size: 13px; color: var(--text-muted); margin-bottom: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.config-item { display: flex; flex-direction: column; gap: 2px; }
.config-label { font-size: 11px; color: var(--text-muted); }
.config-value { font-size: 13px; }
.config-value.mono { font-family: monospace; word-break: break-all; }
.config-value.error-text { color: var(--red); }
.config-caps { display: flex; gap: 8px; flex-wrap: wrap; }
.config-caps .cap-tag { font-size: 12px; padding: 3px 8px; border-radius: 4px; }
.config-caps .cap-on { background: var(--accent-light); color: var(--accent); }
.config-caps .cap-off { background: var(--bg-hover); color: var(--text-muted); }
</style>
