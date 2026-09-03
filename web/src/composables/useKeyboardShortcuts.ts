import { ref, onMounted, onUnmounted } from 'vue';

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
  action: () => void;
}

const shortcuts = ref<Shortcut[]>([]);
const showHelp = ref(false);

function handleKeyDown(e: KeyboardEvent) {
  // Ctrl+K / Cmd+K → 搜索
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const searchInput = document.querySelector('.topbar .search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  // Escape → 关闭弹窗/帮助
  if (e.key === 'Escape') {
    showHelp.value = false;
    return;
  }

  // Ctrl+/ → 显示快捷键帮助
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    showHelp.value = !showHelp.value;
    return;
  }

  // 仅在非输入区域响应字母快捷键
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // 数字键 1-9 → 导航
  const num = parseInt(e.key);
  if (!isNaN(num) && num >= 1 && num <= 9) {
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems[num - 1]) {
      (navItems[num - 1] as HTMLElement).click();
    }
    return;
  }

  // G → 仪表盘, T → 团队, R → 运行记录, S → 会话, C → 实例, P → 能力, M → 技能市场
  switch (e.key.toLowerCase()) {
    case 'g': window.location.hash = '/dashboard'; break;
    case 't': window.location.hash = '/teams'; break;
    case 'r': window.location.hash = '/runs'; break;
    case 's': window.location.hash = '/sessions'; break;
    case 'c': window.location.hash = '/connections'; break;
    case 'p': window.location.hash = '/capabilities'; break;
    case 'm': window.location.hash = '/skill-market'; break;
    case 'a': window.location.hash = '/alerts'; break;
  }
}

export function useKeyboardShortcuts() {
  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown);
  });
  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return {
    showHelp,
    shortcuts: [
      { key: 'K', ctrl: true, label: '聚焦搜索', action: () => {} },
      { key: '/', ctrl: true, label: '快捷键帮助', action: () => {} },
      { key: 'G', label: '仪表盘', action: () => {} },
      { key: 'T', label: '团队', action: () => {} },
      { key: 'R', label: '运行记录', action: () => {} },
      { key: 'S', label: '会话', action: () => {} },
      { key: 'C', label: '实例', action: () => {} },
      { key: 'P', label: '能力', action: () => {} },
      { key: 'M', label: '技能市场', action: () => {} },
      { key: 'A', label: '告警', action: () => {} },
      { key: '1-9', label: '导航切换', action: () => {} },
      { key: 'Esc', label: '关闭弹窗', action: () => {} },
    ],
  };
}
