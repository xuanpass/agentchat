import type {
  AgentConnection,
  AgentConnectionDriver,
  AgentSession,
  Capability,
  CapabilityMeta,
  DiffResult,
  HealthProbe,
  SessionCreateOpts,
  StreamHandle,
  SyncResult,
} from '../types.js';

/** 注册中心: 按 kind 取驱动 */
const registry = new Map<string, AgentConnectionDriver>();

export function registerDriver(driver: AgentConnectionDriver): void {
  registry.set(driver.kind, driver);
}



export function getDriver(kind: string): AgentConnectionDriver {
  const d = registry.get(kind);
  if (!d) throw new Error(`未找到 kind="${kind}" 的适配器`);
  return d;
}

export function allDrivers(): AgentConnectionDriver[] {
  return [...registry.values()];
}

/** 工具方法: 为 fetch 注入 auth header */
export function buildAuthHeaders(conn: AgentConnection): Record<string, string> {
  // 凭据在 adapter 内部解密(各 adapter 自行实现 decryptIfNeeded)
  return {};
}
