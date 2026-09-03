import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface AppSettings {
  theme: 'dark' | 'light';
  healthCheckInterval: number; // 秒
  autoRefreshConnections: boolean;
  autoRefreshDashboard: boolean;
}

const STORAGE_KEY = 'aoc-settings';

function loadDefaults(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {
    theme: 'dark',
    healthCheckInterval: 30,
    autoRefreshConnections: true,
    autoRefreshDashboard: true,
  };
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadDefaults());

  // 持久化
  watch(settings, (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    applyTheme(val.theme);
  }, { deep: true, immediate: true });

  function setTheme(theme: 'dark' | 'light') {
    settings.value.theme = theme;
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value[key] = value;
  }

  function reset() {
    settings.value = {
      theme: 'dark',
      healthCheckInterval: 30,
      autoRefreshConnections: true,
      autoRefreshDashboard: true,
    };
  }

  return { settings, setTheme, updateSetting, reset };
});

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
}
