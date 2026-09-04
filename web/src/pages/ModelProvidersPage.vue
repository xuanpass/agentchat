<template>
  <div class="model-providers-page">
    <h1>多模型路由</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">提供商</div>
        <div class="stat-value">{{ stats.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">活跃</div>
        <div class="stat-value">{{ stats.active ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">路由规则</div>
        <div class="stat-value">{{ stats.totalRules ?? 0 }}</div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <button @click="showProviderModal = true; editingProvider = null; resetForm()">+ 添加提供商</button>
      <button @click="showRuleModal = true; editingRule = null; resetRuleForm()">+ 添加规则</button>
      <button @click="testRoute">🧪 测试路由</button>
      <button @click="loadAll">刷新</button>
    </div>

    <!-- 提供商列表 -->
    <div class="card">
      <h3>模型提供商</h3>
      <div v-if="providers.length === 0" class="empty-sm">暂无提供商</div>
      <div v-else class="provider-grid">
        <div v-for="p in providers" :key="p.id" class="provider-card" :class="{ disabled: !p.enabled }">
          <div class="provider-header">
            <span class="provider-name">{{ p.name }}</span>
            <span :class="['badge', 'prov-' + p.provider]">{{ p.provider }}</span>
          </div>
          <div class="provider-meta">
            <span>模型: {{ p.models?.join(', ') || '-' }}</span>
            <span>权重: {{ p.weight }}</span>
            <span>费用: \${{ p.costPer1kInput }}/\${{ p.costPer1kOutput }} per 1K</span>
          </div>
          <div class="provider-actions">
            <button @click="editProvider(p)" class="secondary small">编辑</button>
            <button @click="toggleProvider(p)" class="secondary small">{{ p.enabled ? '禁用' : '启用' }}</button>
            <button @click="deleteProvider(p.id)" class="danger small">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 路由规则 -->
    <div class="card">
      <h3>路由规则</h3>
      <div v-if="rules.length === 0" class="empty-sm">暂无路由规则</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>名称</th><th>模型</th><th>条件</th><th>优先级</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id" :class="{ disabled: !r.enabled }">
            <td>{{ r.name }}</td>
            <td class="mono">{{ r.model }}</td>
            <td><span class="badge cond">{{ r.condition_type }}</span></td>
            <td>{{ r.priority }}</td>
            <td><span :class="['badge', r.enabled ? 'active' : 'inactive']">{{ r.enabled ? '启用' : '禁用' }}</span></td>
            <td>
              <button @click="editRule(r)" class="secondary small">编辑</button>
              <button @click="deleteRule(r.id)" class="danger small">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 路由测试结果 -->
    <div v-if="routeResult" class="card">
      <h3>路由结果</h3>
      <div class="route-result">
        <div class="route-item"><strong>提供商:</strong> {{ routeResult.provider?.name }} ({{ routeResult.provider?.provider }})</div>
        <div class="route-item"><strong>模型:</strong> {{ routeResult.model }}</div>
        <div class="route-item"><strong>规则:</strong> {{ routeResult.rule }}</div>
        <div class="route-item"><strong>原因:</strong> {{ routeResult.reason }}</div>
      </div>
    </div>

    <!-- 提供商 Modal -->
    <div v-if="showProviderModal" class="modal-overlay" @click.self="showProviderModal = false">
      <div class="modal">
        <h2>{{ editingProvider ? '编辑提供商' : '添加提供商' }}</h2>
        <div class="form-row"><label>名称</label><input v-model="providerForm.name" placeholder="例如: OpenAI 官方" /></div>
        <div class="form-row"><label>类型</label>
          <select v-model="providerForm.provider">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="deepseek">DeepSeek</option>
            <option value="gemini">Gemini</option>
            <option value="ollama">Ollama</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="form-row"><label>Base URL</label><input v-model="providerForm.baseUrl" placeholder="https://api.openai.com/v1" /></div>
        <div class="form-row"><label>模型 (逗号分隔)</label><input v-model="providerForm.modelsText" placeholder="gpt-4,gpt-3.5-turbo" /></div>
        <div class="form-row"><label>默认模型</label><input v-model="providerForm.defaultModel" placeholder="gpt-4" /></div>
        <div class="form-row"><label>权重</label><input type="number" v-model.number="providerForm.weight" min="1" /></div>
        <div class="form-row"><label>输入费用 / 1K tokens ($)</label><input type="number" step="0.001" v-model.number="providerForm.costPer1kInput" /></div>
        <div class="form-row"><label>输出费用 / 1K tokens ($)</label><input type="number" step="0.001" v-model.number="providerForm.costPer1kOutput" /></div>
        <div class="form-actions">
          <button @click="submitProvider" :disabled="!providerForm.name">{{ editingProvider ? '保存' : '添加' }}</button>
          <button @click="showProviderModal = false" class="secondary">取消</button>
        </div>
      </div>
    </div>

    <!-- 规则 Modal -->
    <div v-if="showRuleModal" class="modal-overlay" @click.self="showRuleModal = false">
      <div class="modal">
        <h2>{{ editingRule ? '编辑规则' : '添加规则' }}</h2>
        <div class="form-row"><label>名称</label><input v-model="ruleForm.name" placeholder="例如: 高复杂度任务" /></div>
        <div class="form-row"><label>模型</label><input v-model="ruleForm.model" placeholder="gpt-4" /></div>
        <div class="form-row"><label>条件类型</label>
          <select v-model="ruleForm.conditionType">
            <option value="default">默认</option>
            <option value="complexity">复杂度</option>
            <option value="cost">成本优先</option>
            <option value="latency">低延迟</option>
            <option value="keyword">关键词</option>
          </select>
        </div>
        <div class="form-row"><label>条件值</label><input v-model="ruleForm.conditionValue" placeholder="high 或 关键词1,关键词2" /></div>
        <div class="form-row"><label>优先级</label><input type="number" v-model.number="ruleForm.priority" /></div>
        <div class="form-actions">
          <button @click="submitRule" :disabled="!ruleForm.name">{{ editingRule ? '保存' : '添加' }}</button>
          <button @click="showRuleModal = false" class="secondary">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';

const providers = ref<any[]>([]);
const rules = ref<any[]>([]);
const stats = ref<any>({ total: 0, active: 0, totalRules: 0 });
const showProviderModal = ref(false);
const showRuleModal = ref(false);
const editingProvider = ref<any>(null);
const editingRule = ref<any>(null);
const routeResult = ref<any>(null);
const providerForm = ref({ name: '', provider: 'openai', baseUrl: '', modelsText: '', defaultModel: '', weight: 1, costPer1kInput: 0, costPer1kOutput: 0 });
const ruleForm = ref({ name: '', model: '', conditionType: 'default', conditionValue: '', priority: 100 });

function resetForm() {
  providerForm.value = { name: '', provider: 'openai', baseUrl: '', modelsText: '', defaultModel: '', weight: 1, costPer1kInput: 0, costPer1kOutput: 0 };
}
function resetRuleForm() {
  ruleForm.value = { name: '', model: '', conditionType: 'default', conditionValue: '', priority: 100 };
}

async function loadProviders() { providers.value = await api.get<any[]>('/api/model-providers'); }
async function loadRules() { rules.value = await api.get<any[]>('/api/routing-rules'); }
async function loadStats() { stats.value = await api.get<any>('/api/model-providers/stats'); }
async function loadAll() { await Promise.all([loadProviders(), loadRules(), loadStats()]); }

function editProvider(p: any) {
  editingProvider.value = p;
  providerForm.value = { name: p.name, provider: p.provider, baseUrl: p.base_url, modelsText: p.models?.join(', ') || '', defaultModel: p.default_model || '', weight: p.weight, costPer1kInput: p.cost_per_1k_input, costPer1kOutput: p.cost_per_1k_output };
  showProviderModal.value = true;
}

async function submitProvider() {
  const payload = { ...providerForm.value, models: providerForm.value.modelsText.split(',').map((s: string) => s.trim()).filter(Boolean) };
  const { modelsText, ...payloadClean } = payload;
  if (editingProvider.value) {
    await api.patch(`/api/model-providers/${editingProvider.value.id}`, payload);
  } else {
    await api.post('/api/model-providers', payload);
  }
  showProviderModal.value = false;
  await loadAll();
}

async function toggleProvider(p: any) { await api.patch(`/api/model-providers/${p.id}`, { enabled: !p.enabled }); await loadProviders(); }
async function deleteProvider(id: string) { await api.delete(`/api/model-providers/${id}`); await loadAll(); }

function editRule(r: any) {
  editingRule.value = r;
  ruleForm.value = { name: r.name, model: r.model, conditionType: r.condition_type, conditionValue: r.condition_value || '', priority: r.priority };
  showRuleModal.value = true;
}

async function submitRule() {
  if (editingRule.value) {
    await api.patch(`/api/routing-rules/${editingRule.value.id}`, ruleForm.value);
  } else {
    await api.post('/api/routing-rules', ruleForm.value);
  }
  showRuleModal.value = false;
  await loadAll();
}

async function deleteRule(id: string) { await api.delete(`/api/routing-rules/${id}`); await loadAll(); }

async function testRoute() {
  routeResult.value = await api.post<any>('/api/model-providers/route', { prompt: '测试路由', complexity: 'high' });
}

onMounted(loadAll);
</script>

<style scoped>
.model-providers-page { max-width: 960px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; padding: 14px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
.stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
.card { background: var(--surface); border-radius: 8px; border: 1px solid var(--border); padding: 16px; margin-bottom: 16px; }
.card h3 { margin: 0 0 12px; font-size: 14px; }
.provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.provider-card { padding: 14px; background: var(--bg); border-radius: 8px; border: 1px solid var(--border); }
.provider-card.disabled { opacity: 0.6; }
.provider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.provider-name { font-weight: 600; font-size: 13px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.badge.prov-openai { background: rgba(16, 163, 127, 0.2); color: #10a37f; }
.badge.prov-anthropic { background: rgba(204, 120, 50, 0.2); color: #cc7832; }
.badge.prov-deepseek { background: rgba(66, 133, 244, 0.2); color: #4285f4; }
.badge.prov-gemini { background: rgba(234, 67, 53, 0.2); color: #ea4335; }
.badge.prov-ollama { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }
.badge.prov-custom { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
.badge.cond { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.badge.active { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.inactive { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }
.provider-meta { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
.provider-actions { display: flex; gap: 6px; }
.empty-sm { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }
.mono { font-family: monospace; font-size: 11px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 420px; padding: 24px; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); max-height: 80vh; overflow-y: auto; }
.modal h2 { margin: 0 0 16px; font-size: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); box-sizing: border-box; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }

.route-result { display: flex; flex-direction: column; gap: 8px; }
.route-item { font-size: 13px; padding: 8px; background: var(--bg); border-radius: 6px; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th, .data-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
.data-table th { color: var(--text-muted); font-weight: 600; font-size: 11px; }
.data-table tr.disabled { opacity: 0.6; }
</style>
