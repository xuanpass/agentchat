import { ref, onMounted, onUnmounted } from 'vue';
import { getApiKey } from '../api/client';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  ts: number;
}

const NOTIFICATION_MAP: Record<string, { type: Notification['type']; title: string; msgKey: string }> = {
  'connection.status':       { type: 'warning', title: '连接状态',     msgKey: 'status' },
  'connection.health':       { type: 'info',    title: '健康检查',     msgKey: 'ok' },
  'session.created':         { type: 'success', title: '会话创建',     msgKey: 'title' },
  'session.deleted':         { type: 'info',    title: '会话删除',     msgKey: 'title' },
  'session.status':          { type: 'info',    title: '会话更新',     msgKey: 'title' },
  'message.received':        { type: 'success', title: '新消息',       msgKey: 'preview' },
  'sync.started':            { type: 'info',    title: '同步开始',     msgKey: 'names' },
  'sync.completed':          { type: 'success', title: '同步完成',     msgKey: 'count' },
};

let eventSource: EventSource | null = null;
let reconnectTimer: any = null;
let connected = ref(false);
const notifications = ref<Notification[]>([]);
let messageHandler: ((event: any) => void) | null = null;

export function useEventSource() {
  function connect() {
    if (eventSource?.readyState === EventSource.OPEN) return;

    const key = getApiKey();
    if (!key) return;

    // 使用 query param 传递 key (EventSource 不支持 header)
    eventSource = new EventSource(`/api/events?key=${encodeURIComponent(key)}`);

    eventSource.onopen = () => {
      connected.value = true;
      console.log('[SSE] 实时事件已连接');
    };

    eventSource.onerror = () => {
      connected.value = false;
      eventSource?.close();
      // 自动重连 (3s 后)
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };

    // 监听所有事件类型
    eventSource.addEventListener('connected', () => { connected.value = true; });
    eventSource.addEventListener('connection.status', onEvent);
    eventSource.addEventListener('connection.health', onEvent);
    eventSource.addEventListener('session.created', onEvent);
    eventSource.addEventListener('session.deleted', onEvent);
    eventSource.addEventListener('session.status', onEvent);
    eventSource.addEventListener('message.received', onEvent);
    eventSource.addEventListener('sync.started', onEvent);
    eventSource.addEventListener('sync.completed', onEvent);
    eventSource.addEventListener('team.message', onEvent);
    eventSource.addEventListener('team.message.error', onEvent);
    eventSource.addEventListener('alert.created', onEvent);
  }

  function onEvent(evt: Event) {
    try {
      const data = JSON.parse((evt as MessageEvent).data);
      handleEvent(data);
    } catch { /* ignore */ }
  }

  function handleEvent(event: any) {
    const mapping = NOTIFICATION_MAP[event.type];
    if (!mapping) return;

    // 过滤掉过于频繁的健康检查事件
    if (event.type === 'connection.health') return;

    const msgData = event.data || {};
    let message = '';
    switch (mapping.msgKey) {
      case 'status':
        message = `${msgData.name}: ${msgData.prevStatus} → ${msgData.status}`;
        break;
      case 'ok':
        message = msgData.ok ? '通过' : '失败';
        break;
      default:
        message = msgData[mapping.msgKey] || JSON.stringify(msgData).slice(0, 80);
    }

    const notification: Notification = {
      id: `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: mapping.type,
      title: mapping.title,
      message,
      ts: event.ts || Date.now(),
    };

    notifications.value.unshift(notification);
    // 最多保留 50 条
    if (notifications.value.length > 50) {
      notifications.value = notifications.value.slice(0, 50);
    }

    // 通知外部处理器
    if (messageHandler) messageHandler(notification);
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    eventSource?.close();
    eventSource = null;
    connected.value = false;
  }

  function clearNotifications() {
    notifications.value = [];
  }

  function onNotification(handler: (n: Notification) => void) {
    messageHandler = handler;
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return {
    connected,
    notifications,
    connect,
    disconnect,
    clearNotifications,
    onNotification,
  };
}
