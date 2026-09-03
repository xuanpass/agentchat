<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <h1>🔐 Agent Ops Console</h1>
        <p>请输入 API Key 以继续</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="apiKey">API Key</label>
          <input
            id="apiKey"
            v-model="apiKey"
            type="password"
            placeholder="aoc_..."
            autocomplete="off"
            :disabled="loading"
            ref="inputRef"
          />
          <span class="hint" v-if="hint">提示: {{ hint }}</span>
        </div>

        <button type="submit" :disabled="loading || !apiKey.trim()" class="btn-primary">
          {{ loading ? '验证中...' : '登录' }}
        </button>

        <p v-if="error" class="error-msg">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, setApiKey } from '../api/client.ts';
import { useRouter } from 'vue-router';

const router = useRouter();
const apiKey = ref('');
const hint = ref('');
const error = ref('');
const loading = ref(false);
const inputRef = ref<HTMLInputElement>();

onMounted(async () => {
  inputRef.value?.focus();
  // 获取 key 提示
  try {
    const info = await api.get<{ required: boolean; hint: string }>('/auth/key-info');
    if (info.hint) hint.value = info.hint;
  } catch { /* ignore */ }
});

async function handleLogin() {
  error.value = '';
  loading.value = true;
  try {
    const res = await api.post<{ ok: boolean; key: string }>('/auth/verify', { apiKey: apiKey.value.trim() });
    if (res.ok && res.key) {
      setApiKey(res.key);
      router.push('/dashboard');
    }
  } catch (e: any) {
    error.value = e.message || '验证失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-base);
}

.login-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 2.5rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-header h1 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.login-header p {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input {
  padding: 0.7rem 0.9rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: monospace;
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
}

.hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.btn-primary {
  padding: 0.7rem;
  border-radius: 8px;
  border: none;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg {
  color: var(--danger, #ef4444);
  font-size: 0.85rem;
  text-align: center;
}
</style>
