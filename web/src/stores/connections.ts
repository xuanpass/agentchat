import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '../api/client';

const AUTO_REFRESH_MS = 10_000; // 连接状态自动刷新间隔
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

export interface Connection {
  id: string;
  name: string;
  kind: 'openclaw' | 'hermes' | 'opencode' | 'a2a';
  endpoint: { baseUrl: string; openaiPath?: string };
  auth: { type: string };
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  capabilities: { sessions: boolean; teams: boolean; skills: boolean; plugins: boolean; mcp: boolean; streaming: boolean };
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const useConnectionStore = defineStore('connections', () => {
  const list = ref<Connection[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const grouped = computed(() => {
    const g: Record<string, Connection[]> = { a2a: [], openclaw: [], hermes: [], opencode: [] };
    for (const c of list.value) g[c.kind]?.push(c);
    return g;
  });

  async function fetch() {
    loading.value = true; error.value = null;
    try { list.value = await api.get('/connections'); }
    catch (e: any) { error.value = e.message; }
    finally { loading.value = false; }
  }

  async function create(payload: Partial<Connection> & { name: string; kind: string; endpoint: any; auth: any }) {
    const c = await api.post<Connection>('/connections', payload);
    list.value.unshift(c);
    return c;
  }

  async function testConnection(id: string): Promise<{ ok: boolean; latencyMs: number; capabilities: any; error?: string }> {
    const r = await api.post<{ ok: boolean; latencyMs: number; capabilities: any; error?: string }>(`/connections/${id}/test`, {});
    const idx = list.value.findIndex((c) => c.id === id);
    if (idx >= 0) list.value[idx] = { ...list.value[idx], status: r.ok ? 'connected' : 'error', capabilities: r.capabilities };
    return r;
  }

  async function remove(id: string) {
    await api.delete(`/connections/${id}`);
    list.value = list.value.filter((c) => c.id !== id);
  }

  /** 启动自动刷新（页面挂载时调用） */
  function startAutoRefresh() {
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(async () => {
      try {
        const fresh = await api.get<Connection[]>('/connections');
        // 只在数据变化时更新，避免不必要的重渲染
        if (JSON.stringify(fresh) !== JSON.stringify(list.value)) {
          list.value = fresh;
        }
      } catch { /* 静默失败，下次再试 */ }
    }, AUTO_REFRESH_MS);
  }

  /** 停止自动刷新（页面卸载时调用） */
  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  return { list, loading, error, grouped, fetch, create, testConnection, remove, startAutoRefresh, stopAutoRefresh };
});
