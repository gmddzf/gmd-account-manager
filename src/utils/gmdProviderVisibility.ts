export interface GmdProviderPresetLike {
  id: string;
  isPartner?: boolean;
  website?: string;
  apiKeyUrl?: string;
}

const GMD_PROVIDER_IDS = new Set(['gmd_api', 'apikey_fun']);
const LEGACY_PROMOTION_QUERY_KEYS = new Set([
  'ac',
  'aff',
  'ch',
  'code',
  'from',
  'invite',
  'invitecode',
  'rc',
  'ref',
  'source',
  'ytag',
]);

function hasLegacyPromotionTracking(value?: string): boolean {
  const raw = value?.trim();
  if (!raw) return false;

  try {
    const url = new URL(raw);
    for (const key of url.searchParams.keys()) {
      if (LEGACY_PROMOTION_QUERY_KEYS.has(key.toLowerCase())) return true;
    }
    const pathSegments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return pathSegments.some(
      (segment, index) => segment.toLowerCase() === 'i' && Boolean(pathSegments[index + 1]),
    );
  } catch {
    const normalized = raw.toLowerCase();
    return /\/i\/[^/?#]+/.test(normalized);
  }
}

export function isGmdCustomerProviderPreset(
  preset: GmdProviderPresetLike,
): boolean {
  if (GMD_PROVIDER_IDS.has(preset.id)) return true;
  if (preset.isPartner === true) return false;
  return ![preset.website, preset.apiKeyUrl].some(hasLegacyPromotionTracking);
}
