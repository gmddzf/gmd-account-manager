import type { SponsorModuleState } from '../types/sponsor';

export async function getSponsorModuleState(): Promise<SponsorModuleState> {
  return { sponsorModule: null };
}

export async function forceRefreshSponsorModuleState(): Promise<SponsorModuleState> {
  return getSponsorModuleState();
}
