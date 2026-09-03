import { describe, it, expect, beforeEach } from 'vitest';

// ── 设置 Store 测试 (纯逻辑, mock localStorage) ──

// Mock localStorage
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { for (const k in storage) delete storage[k]; },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

interface Settings {
  theme: 'dark' | 'light';
  healthCheckInterval: number;
  autoRefreshConnections: boolean;
  autoRefreshDashboard: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  healthCheckInterval: 30,
  autoRefreshConnections: true,
  autoRefreshDashboard: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('aoc-settings');
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: Settings) {
  localStorage.setItem('aoc-settings', JSON.stringify(s));
}

function resetSettings(): Settings {
  localStorage.removeItem('aoc-settings');
  return { ...DEFAULT_SETTINGS };
}

describe('Settings Store', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('should return defaults when no settings saved', () => {
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('should save and load settings', () => {
    const custom: Settings = {
      theme: 'light',
      healthCheckInterval: 60,
      autoRefreshConnections: false,
      autoRefreshDashboard: true,
    };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it('should merge partial settings with defaults', () => {
    mockLocalStorage.setItem('aoc-settings', JSON.stringify({ theme: 'light' }));
    const s = loadSettings();
    expect(s.theme).toBe('light');
    expect(s.healthCheckInterval).toBe(30);
    expect(s.autoRefreshConnections).toBe(true);
  });

  it('should reset to defaults', () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    const s = resetSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(mockLocalStorage.getItem('aoc-settings')).toBeNull();
  });

  it('should handle corrupted JSON gracefully', () => {
    mockLocalStorage.setItem('aoc-settings', '{bad json}');
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('should support dark and light themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      saveSettings({ ...DEFAULT_SETTINGS, theme });
      expect(loadSettings().theme).toBe(theme);
    }
  });

  it('should support various health check intervals', () => {
    for (const interval of [10, 30, 60, 120, 300]) {
      saveSettings({ ...DEFAULT_SETTINGS, healthCheckInterval: interval });
      expect(loadSettings().healthCheckInterval).toBe(interval);
    }
  });
});
