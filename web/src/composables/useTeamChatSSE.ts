import { ref, onMounted, onUnmounted } from 'vue';
import { getApiKey } from '../api/client';

/**
 * 团队聊天 SSE — 监听 team.message / team.message.error 事件
 * 独立于全局 useEventSource, 避免污染通知系统
 */
export function useTeamChatSSE(teamId: string, handler: (event: any) => void) {
  let eventSource: EventSource | null = null;
  let reconnectTimer: any = null;

  function connect() {
    if (eventSource?.readyState === EventSource.OPEN) return;
    const key = getApiKey();
    if (!key) return;

    eventSource = new EventSource(`/api/events?key=${encodeURIComponent(key)}`);

    eventSource.onopen = () => console.log(`[TeamChatSSE] 团队 ${teamId} 已连接`);

    eventSource.onerror = () => {
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };

    // 只监听团队消息事件
    eventSource.addEventListener('team.message', (evt: Event) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data);
        if (data.data?.teamId === teamId) handler(data);
      } catch { /* ignore */ }
    });
    eventSource.addEventListener('team.message.error', (evt: Event) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data);
        if (data.data?.teamId === teamId) handler(data);
      } catch { /* ignore */ }
    });
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    eventSource?.close();
    eventSource = null;
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return { connect, disconnect };
}
