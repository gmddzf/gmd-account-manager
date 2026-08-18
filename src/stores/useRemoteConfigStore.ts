import { create } from 'zustand';
import type { PlatformId } from '../types/platform';
import type { RemoteConfigState } from '../types/remoteConfig';

const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

const EMPTY_STATE: RemoteConfigState = {
  version: '',
  updatedAt: 0,
  currentOs: '',
  hiddenPlatformIds: [],
  appliedRules: [],
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  updatePromptMode: 'normal',
};

interface RemoteConfigStoreState {
  state: RemoteConfigState;
  hiddenPlatformIds: PlatformId[];
  loading: boolean;
  initialized: boolean;
  lastError: string | null;
  fetchState: (force?: boolean) => Promise<RemoteConfigState>;
}

export const useRemoteConfigStore = create<RemoteConfigStoreState>((set) => ({
  state: EMPTY_STATE,
  hiddenPlatformIds: [],
  loading: false,
  initialized: false,
  lastError: null,

  fetchState: async (force = false) => {
    void force;
    set({
      state: EMPTY_STATE,
      hiddenPlatformIds: [],
      loading: false,
      initialized: true,
      lastError: null,
    });
    return EMPTY_STATE;
  },
}));
