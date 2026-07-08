import request from '@/api';
import { AxiosPromise } from 'axios';

export interface WssRelayClient {
  id: string;
  name?: string;
  connectedAt?: string;
  lastSeenAt?: string;
  pendingCount?: number;
  remoteAddress?: string;
}

export function useSettingsApi() {
  return {
    getSettings: (): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/settings',
        method: 'get',
      });
    },
    setSettings: (data: SettingsPostData): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/settings',
        method: 'patch',
        data,
      });
    },
    syncSettings: (query: 'download' | 'upload', options?: { keep?: string[], encode?: GistUploadMode }): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/utils/backup`,
        method: 'get',
        params: {
          action: query,
          keep: options?.keep?.join(','),
          encode: options?.encode
        }
      });
    },
    restoreSettings: (data: StoragePostData): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/storage',
        method: 'post',
        data,
      });
    },
    getWssRelayClients: (token: string): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/wss/clients',
        method: 'get',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    createWssRelayToken: (token = '', rotate = false): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/wss/token',
        method: 'post',
        data: { rotate },
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : undefined,
      });
    },
  };
}
