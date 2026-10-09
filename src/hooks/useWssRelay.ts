import { onScopeDispose, reactive, toRefs, watch } from 'vue';
import { useSettingsApi } from '@/api/settings';
import { useGlobalStore } from '@/store/global';
import { createWssRelaySession, type WssRelayState } from '@/utils/wssRelay';

export function useWssRelay(includeClients = false) {
  const globalStore = useGlobalStore();
  const state = reactive<WssRelayState>({
    token: '', initialized: null, loading: false, creating: false, clients: [],
  });
  const session = createWssRelaySession(state, useSettingsApi(), () => globalStore.ishostApi);
  // 清理旧版全局缓存。即使浏览器禁止本地存储，仍可从后端查看和使用 Token。
  try {
    localStorage.removeItem('wss-relay-token');
    localStorage.removeItem('wss-relay-admin-token');
  } catch {}
  watch(() => globalStore.ishostApi, () => {
    session.reset();
    void session.refresh(includeClients);
  }, { flush: 'sync' });
  onScopeDispose(session.reset);
  return { ...toRefs(state), refresh: () => session.refresh(includeClients), initialize: session.initialize };
}
