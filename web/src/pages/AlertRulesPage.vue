<template>
  <div class="alert-rules-page">
    <h1>告警规则</h1>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">总规则</div>
        <div class="stat-value">{{ stats.total ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已启用</div>
        <div class="stat-value">{{ stats.enabled ?? 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">触发次数</div>
        <div class="stat-value warn">{{ stats.totalTriggers ?? 0 }}</div>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="toolbar">
      <button @click="showCreateModal = true">+ 新建规则</button>
      <button @click="evaluateRules">手动评估</button>
      <button @click="loadAll">刷新</button>
    </div>

    <!-- 规则列表 -->
    <div v-if="loading" class="skeleton">加载中...</div>
    <div v-else-if="rules.length === 0" class="empty">
      <p>暂无告警规则</p>
      <button @click="showCreateModal = true">创建第一个</button>
    </div>
    <div v-else class="rules-grid">
      <div v-for="rule in rules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
        <div class="rule-header">
          <span class="rule-name">{{ rule.name }}</span>
          <span :class="['badge', rule.enabled ? 'active' : 'inactive']">
            {{ rule.enabled ? '启用' : '禁用' }}
          </span>
        </div>
        <div class="rule-desc">{{ rule.description || '无描述' }}</div>
        <div class="rule-condition">
          <code>{{ rule.metric }} {{ rule.operator }} {{ rule.threshold }}</code>
        </div>
        <div class="rule-meta">
          <span>窗口 {{ rule.windowSeconds }}s</span>
          <span>冷却 {{ rule.cooldownSeconds }}s</span>
          <span>触发 {{ rule.triggerCount }} 次</span>
        </div>
        <div class="rule-actions">
          <button @click="toggleRule(rule)">{{ rule.enabled ? '禁用' : '启用' }}</button>
          <button @click="editRule(rule)" class="secondary">编辑</button>
          <button @click="deleteRule(rule.id)" class="danger">删除</button>
        </div>
      </div>
    </div>

    <!-- 创建/编辑 Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h2>{{ editingRule ? '编辑规则' : '新建规则' }}</h2>
        <div class="form-row">
          <label>规则名称</label>
          <input type="text" v-model="form.name" placeholder="例如: Token 预算超限" />
        </div>
        <div class="form-row">
          <label>描述</label>
          <input type="text" v-model="form.description" placeholder="可选" />
        </div>
        <div class="form-row">
          <label>监控指标</label>
          <select v-model="form.metric">
            <option value="token_budget">Token 预算 (费用)</option>
            <option value="error_rate">错误率 (%)</option>
            <option value="latency">延迟 (ms)</option>
            <option value="connection_health">连接健康 (%)</option>
            <option value="run_failure">运行失败次数</option>
          </select>
        </div>
        <div class="form-row">
          <label>条件</label>
          <div class="row-gap">
            <select v-model="form.operator">
              <option value="gt">大于 (&gt;)</option>
              <option value="gte">大于等于 (&ge;)</option>
              <option value="lt">小于 (&lt;)</option>
              <option value="lte">小于等于 (&le;)</option>
              <option value="eq">等于 (=)</option>
            </select>
            <input type="number" v-model.number="form.threshold" placeholder="阈值" />
          </div>
        </div>
        <div class="form-row">
          <label>评估窗口 (秒)</label>
          <input type="number" v-model.number="form.windowSeconds" min="60" />
        </div>
        <div class="form-row">
          <label>冷却时间 (秒)</label>
          <input type="number" v-model.number="form.cooldownSeconds" min="0" />
        </div>
        <div class="form-actions">
          <button @click="submitRule" :disabled="!form.name">{{ editingRule ? '保存' : '创建' }}</button>
          <button @click="showCreateModal = false" class="secondary">取消</button>
        </div>
      </div>
    </div>

    <!-- 评估结果 Modal -->
    <div v-if="showEvalModal" class="modal-overlay" @click.self="showEvalModal = false">
      <div class="modal">
        <h2>规则评估结果</h2>
        <div v-if="evalResults.length === 0" class="empty-sm">无结果</div>
        <div v-else class="eval-list">
          <div v-for="r in evalResults" :key="r.ruleId" class="eval-item" :class="{ triggered: r.triggered }">
            <span class="eval-name">{{ r.ruleName }}</span>
            <span v-if="r.triggered" class="eval-triggered">🔔 {{ r.message }}</span>
            <span v-else class="eval-ok">✓ 正常 ({{ r.currentValue?.toFixed(2) }})</span>
          </div>
        </div>
        <div class="form-actions">
          <button @click="showEvalModal = false" class="secondary">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/client';

const rules = ref<any[]>([]);
const stats = ref<any>({ total: 0, enabled: 0, totalTriggers: 0 });
const loading = ref(false);
const showCreateModal = ref(false);
const showEvalModal = ref(false);
const evalResults = ref<any[]>([]);
const editingRule = ref<any>(null);
const form = ref({
  name: '', description: '', metric: 'token_budget',
  operator: 'gt', threshold: 0, windowSeconds: 300, cooldownSeconds: 3600,
});

async function loadRules() {
  rules.value = await api.get<any[]>('/api/alert-rules');
}

async function loadStats() {
  stats.value = await api.get<any>('/api/alert-rules/stats');
}

async function loadAll() {
  loading.value = true;
  await Promise.all([loadRules(), loadStats()]);
  loading.value = false;
}

function editRule(rule: any) {
  editingRule.value = rule;
  form.value = {
    name: rule.name, description: rule.description || '',
    metric: rule.metric, operator: rule.operator,
    threshold: rule.threshold, windowSeconds: rule.windowSeconds,
    cooldownSeconds: rule.cooldownSeconds,
  };
  showCreateModal.value = true;
}

async function submitRule() {
  if (editingRule.value) {
    await api.patch(`/api/alert-rules/${editingRule.value.id}`, form.value);
  } else {
    await api.post('/api/alert-rules', form.value);
  }
  showCreateModal.value = false;
  editingRule.value = null;
  form.value = { name: '', description: '', metric: 'token_budget', operator: 'gt', threshold: 0, windowSeconds: 300, cooldownSeconds: 3600 };
  await loadAll();
}

async function toggleRule(rule: any) {
  await api.patch(`/api/alert-rules/${rule.id}`, { enabled: !rule.enabled });
  await loadRules();
}

async function deleteRule(id: string) {
  await api.delete(`/api/alert-rules/${id}`);
  await loadAll();
}

async function evaluateRules() {
  const data = await api.post<any>('/api/alert-rules/evaluate', {});
  evalResults.value = data.results || [];
  showEvalModal.value = true;
  await loadAll();
}

onMounted(loadAll);
</script>

<style scoped>
.alert-rules-page { max-width: 960px; }
.stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
.stat-card { flex: 1; padding: 14px; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
.stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 700; }
.stat-value.warn { color: var(--warn); }
.toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
.rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.rule-card { padding: 16px; background: var(--surface); border-radius: 10px; border: 1px solid var(--border); transition: all 0.2s; }
.rule-card.disabled { opacity: 0.6; }
.rule-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.rule-name { font-weight: 600; font-size: 14px; }
.badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
.badge.active { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.badge.inactive { background: rgba(156, 163, 175, 0.2); color: #9ca3af; }
.rule-desc { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; min-height: 18px; }
.rule-condition code { font-size: 12px; padding: 4px 8px; background: var(--bg); border-radius: 4px; color: var(--accent); }
.rule-meta { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); margin: 10px 0; }
.rule-actions { display: flex; gap: 6px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 400px; padding: 24px; background: var(--surface); border-radius: 12px; border: 1px solid var(--border); max-height: 80vh; overflow-y: auto; }
.modal h2 { margin: 0 0 16px; font-size: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.form-row input, .form-row select { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); box-sizing: border-box; }
.row-gap { display: flex; gap: 8px; }
.row-gap select { width: auto; }
.form-actions { display: flex; gap: 8px; margin-top: 16px; }

.eval-list { display: flex; flex-direction: column; gap: 8px; }
.eval-item { display: flex; justify-content: space-between; padding: 10px; border-radius: 6px; border: 1px solid var(--border); font-size: 13px; }
.eval-item.triggered { border-color: var(--warn); background: rgba(239, 68, 68, 0.05); }
.eval-ok { color: #22c55e; }
.eval-triggered { color: var(--warn); font-weight: 600; }
.empty-sm { color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px; }
.empty { text-align: center; padding: 40px; color: var(--text-muted); }
.empty p { margin-bottom: 12px; }
</style>
