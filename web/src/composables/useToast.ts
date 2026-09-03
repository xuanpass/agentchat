import { ref, readonly } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

const toastHandler = ref<{
  add: (text: string, type?: ToastType, duration?: number) => number;
  remove: (id: number) => void;
} | null>(null);

export function registerToast(handler: typeof toastHandler.value) {
  toastHandler.value = handler;
}

export function useToast() {
  function success(text: string, duration?: number) {
    return toastHandler.value?.add(text, 'success', duration);
  }
  function error(text: string, duration?: number) {
    return toastHandler.value?.add(text, 'error', duration);
  }
  function info(text: string, duration?: number) {
    return toastHandler.value?.add(text, 'info', duration);
  }
  function warning(text: string, duration?: number) {
    return toastHandler.value?.add(text, 'warning', duration);
  }

  return { success, error, info, warning, toast: info };
}
