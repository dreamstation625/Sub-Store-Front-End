import type { WssRelayClient } from '@/api/settings';

export interface WssRelayState {
  token: string;
  initialized: boolean | null;
  loading: boolean;
  creating: boolean;
  clients: WssRelayClient[];
}

interface RelayApi {
  getSettings: (backend?: string) => Promise<any>;
  getWssRelayClients: (token: string, backend?: string) => Promise<any>;
  createWssRelayToken: (token?: string, rotate?: boolean, backend?: string) => Promise<any>;
}

// Token 的唯一来源是当前后端；请求序号和地址同时校验，防止切换后端后旧响应回写。
export function createWssRelaySession(state: WssRelayState, api: RelayApi, getBackend: () => string) {
  let version = 0;
  const isCurrent = (requestId: number, backend: string) => (
    requestId === version && backend === getBackend()
  );
  const reset = () => {
    version++;
    state.token = '';
    state.initialized = null;
    state.loading = false;
    state.creating = false;
    state.clients = [];
  };
  const refresh = async (includeClients = false) => {
    reset();
    const requestId = version;
    const backend = getBackend();
    state.loading = true;
    try {
      const res = await api.getSettings(backend);
      if (!isCurrent(requestId, backend) || res?.data?.status !== 'success') return false;
      const token = res.data.data?.wssRelayToken;
      state.initialized = Boolean(token);
      state.token = typeof token === 'string' && token !== '***' ? token.trim() : '';
      if (includeClients && state.token) {
        const clientsRes = await api.getWssRelayClients(state.token, backend);
        if (!isCurrent(requestId, backend)) return false;
        if (clientsRes?.data?.status === 'success') {
          const data = clientsRes.data.data;
          const clients = Array.isArray(data) ? data : Array.isArray(data?.clients) ? data.clients : [];
          state.clients = clients.filter((client: WssRelayClient) => client?.id);
        }
      }
      return true;
    } catch {
      // 接口层已显示错误；不再读取浏览器缓存，也不保留旧节点列表。
      return false;
    } finally {
      if (isCurrent(requestId, backend)) state.loading = false;
    }
  };
  const initialize = async () => {
    if (state.creating || state.loading) return false;
    const requestId = ++version;
    const backend = getBackend();
    const currentToken = state.token;
    state.creating = true;
    try {
      const res = await api.createWssRelayToken(currentToken, false, backend);
      if (!isCurrent(requestId, backend) || res?.data?.status !== 'success') return false;
      const token = res.data.data?.token;
      if (typeof token !== 'string' || !token.trim()) return false;
      state.token = token.trim();
      state.initialized = true;
      return true;
    } catch {
      return false;
    } finally {
      if (isCurrent(requestId, backend)) state.creating = false;
    }
  };
  return { reset, refresh, initialize };
}

export function getWssRelayClientColumns(clients: WssRelayClient[], selectedId = '') {
  const columns = [
    { text: '本机拉取', value: '' },
    ...clients.map((client) => ({
      text: client.pendingCount
        ? `${client.name || client.id} (${client.pendingCount} pending)`
        : client.name || client.id,
      value: client.id,
    })),
  ];
  if (selectedId && !clients.some((client) => client.id === selectedId)) {
    columns.push({ text: `${selectedId}（离线或状态未确认）`, value: selectedId });
  }
  return columns;
}

export function normalizeRelayNodeId(data: Record<string, any>, isRemote: boolean) {
  // PATCH 省略字段表示保留旧值，必须显式提交空字符串才能恢复本机拉取。
  data.relayNodeId = isRemote ? `${data.relayNodeId || ''}`.trim() : '';
}

// 仅标记当前来源直接配置的远端拉取；本地来源中的历史节点字段不能作为依据。
export function getConfiguredRelayNodeId(data: { relayNodeId?: string } | undefined, sourceMode?: string) {
  return sourceMode === 'remote' && typeof data?.relayNodeId === 'string'
    ? data.relayNodeId.trim()
    : '';
}
