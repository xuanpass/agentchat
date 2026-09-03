import { EventEmitter } from 'node:events';

/**
 * 全局事件总线 — ConnectionManager 和路由层通过此传递实时事件
 */
export interface AocEvent {
  type: 'connection.status' | 'connection.health' | 'session.created' | 'session.deleted' | 'session.status' | 'message.received' | 'sync.started' | 'sync.completed' | 'team.message' | 'team.message.error' | 'alert.created';
  data: any;
  ts: number;
}

class EventBus extends EventEmitter {
  emitEvent(event: Omit<AocEvent, 'ts'>): void {
    this.emit('event', { ...event, ts: Date.now() });
  }

  subscribe(listener: (event: AocEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const eventBus = new EventBus();
// 增加最大监听器限制 (SSE 连接可能很多)
eventBus.setMaxListeners(100);
