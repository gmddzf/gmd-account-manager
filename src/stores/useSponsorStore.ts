import { create } from 'zustand';
import type { SponsorModuleState } from '../types/sponsor';

// 客户版只使用本地 GMD API 配置，不从原项目的远程赞助或推广接口拉取内容。
const LOCAL_GMD_STATE: SponsorModuleState = {
  sponsorModule: {
    enabled: true,
    entryVisible: true,
    title: 'GMD 中转站',
    subtitle: '管理自定义中转地址和 API Key。',
    targetVersions: '*',
    targetLanguages: ['*'],
    createdAt: '2026-08-14T00:00:00Z',
    expiresAt: null,
    sponsors: [],
  },
};

interface SponsorStoreState {
  state: SponsorModuleState;
  loading: boolean;
  initialized: boolean;
  fetchState: (force?: boolean) => Promise<SponsorModuleState>;
}

export const useSponsorStore = create<SponsorStoreState>((set) => ({
  state: LOCAL_GMD_STATE,
  loading: false,
  initialized: true,

  fetchState: async (force = false) => {
    void force;
    set({ state: LOCAL_GMD_STATE, loading: false, initialized: true });
    return LOCAL_GMD_STATE;
  },
}));
