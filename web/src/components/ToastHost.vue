<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="toast"
          :class="`toast-${t.type}`"
        >
          <span class="toast-icon">{{ iconMap[t.type] }}</span>
          <span class="toast-text">{{ t.text }}</span>
          <button class="toast-close" @click="remove(t.id)">✕</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  text: string;
  type: ToastType;
  duration: number;
}

const iconMap: Record<ToastType, string> = {
  success: '✓',
  error: '✗',
  info: 'ℹ',
  warning: '⚠',
};

const toasts = ref<ToastItem[]>([]);
let nextId = 1;

function add(text: string, type: ToastType = 'info', duration = 3000) {
  const id = nextId++;
  toasts.value.push({ id, text, type, duration });
  if (duration > 0) {
    setTimeout(() => remove(id), duration);
  }
  return id;
}

function remove(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

defineExpose({ add, remove });

// 暴露全局方法
defineOptions({ name: 'ToastHost' });
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  min-width: 200px;
  max-width: 360px;
  pointer-events: all;
}

.toast-success { border-left: 3px solid var(--green); }
.toast-error { border-left: 3px solid var(--red); }
.toast-info { border-left: 3px solid var(--accent); }
.toast-warning { border-left: 3px solid var(--yellow); }

.toast-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.toast-success .toast-icon { color: var(--green); }
.toast-error .toast-icon { color: var(--red); }
.toast-info .toast-icon { color: var(--accent); }
.toast-warning .toast-icon { color: var(--yellow); }

.toast-text { flex: 1; word-break: break-word; }

.toast-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px;
  flex-shrink: 0;
}
.toast-close:hover { color: var(--text); }

/* Transition */
.toast-enter-active { transition: all 0.3s ease; }
.toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from { opacity: 0; transform: translateX(30px); }
.toast-leave-to { opacity: 0; transform: translateX(30px); }
</style>
