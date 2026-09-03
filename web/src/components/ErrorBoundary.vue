<template>
  <div v-if="error" class="error-boundary">
    <div class="error-content">
      <div class="error-icon">⚠</div>
      <h2>页面出现错误</h2>
      <p class="error-message">{{ error.message || String(error) }}</p>
      <div class="error-actions">
        <button class="btn btn-primary" @click="reload">刷新页面</button>
        <button class="btn" @click="reset">重试</button>
        <router-link to="/" class="btn">返回首页</router-link>
      </div>
      <details v-if="error.stack" class="error-details">
        <summary>技术详情</summary>
        <pre>{{ error.stack }}</pre>
      </details>
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';

const error = ref<Error | null>(null);

onErrorCaptured((err: Error) => {
  error.value = err;
  console.error('[ErrorBoundary]', err);
  return false; // 阻止错误继续传播
});

function reset() {
  error.value = null;
}

function reload() {
  window.location.reload();
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 40px;
}
.error-content {
  text-align: center;
  max-width: 500px;
}
.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
.error-content h2 {
  font-size: 18px;
  margin-bottom: 8px;
}
.error-message {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 20px;
  word-break: break-word;
}
.error-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 16px;
}
.error-details {
  text-align: left;
  margin-top: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}
.error-details summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
}
.error-details pre {
  margin-top: 8px;
  font-size: 11px;
  color: var(--red);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
</style>
