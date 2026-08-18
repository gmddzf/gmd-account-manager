const ZH_SECTION_HEADER = '## 更新日志（中文）';
const EN_SECTION_HEADER = '## Changelog (English)';
const GMD_RELEASE_PATH_PREFIX = '/gmd-account-manager/releases/';
const GMD_RELEASES_URL = 'https://subapi.gmd.ink/gmd-account-manager/releases/';

export interface ParsedUpdaterReleaseNotes {
  releaseNotes: string;
  releaseNotesZh: string;
}

const LEGACY_RELAY_BRAND = ['apikey', '.', 'fun'].join('');
const PROMOTIONAL_MARKERS = [
  LEGACY_RELAY_BRAND,
  'affiliate',
  'aff=',
  'invitecode',
  'referral',
  'ref=',
  'utm_',
  'discount',
  'coupon',
  'promotion',
  'sponsor',
  'partner relay',
  'github.com/jlcodes99/cockpit-tools',
  '邀请码',
  '专属链接',
  '折扣',
  '返利',
  '推广',
  '赞助',
  '优惠',
  '选购',
  '合作中转',
];

function sanitizeReleaseNotes(value: string): string {
  return value
    .split('\n')
    .filter((line) => {
      const normalized = line.toLowerCase();
      return !PROMOTIONAL_MARKERS.some((marker) => normalized.includes(marker));
    })
    .map((line) =>
      line
        .replace(/Antigravity Cockpit Tools/gi, 'GMD 账号管理')
        .replace(/Cockpit Tools/gi, 'GMD 账号管理')
        .replace(/Cockpit API/gi, 'GMD API')
        .replace(/cockpit/gi, 'GMD'),
    )
    .join('\n')
    .trim();
}

function normalizeNotes(notes?: string): string {
  if (!notes) {
    return '';
  }
  return sanitizeReleaseNotes(notes.replace(/\r\n/g, '\n').trim());
}

export function getUpdaterReleaseHighlightLines(
  version: string,
  language: string,
): string[] {
  void version;
  void language;
  return [];
}

export function parseUpdaterReleaseNotes(notes?: string): ParsedUpdaterReleaseNotes {
  const normalized = normalizeNotes(notes);
  if (!normalized) {
    return {
      releaseNotes: '',
      releaseNotesZh: '',
    };
  }

  const zhIndex = normalized.indexOf(ZH_SECTION_HEADER);
  const enIndex = normalized.indexOf(EN_SECTION_HEADER);

  if (zhIndex >= 0 && enIndex >= 0) {
    if (zhIndex < enIndex) {
      return {
        releaseNotesZh: normalized
          .slice(zhIndex + ZH_SECTION_HEADER.length, enIndex)
          .trim(),
        releaseNotes: normalized.slice(enIndex + EN_SECTION_HEADER.length).trim(),
      };
    }

    return {
      releaseNotes: normalized
        .slice(enIndex + EN_SECTION_HEADER.length, zhIndex)
        .trim(),
      releaseNotesZh: normalized.slice(zhIndex + ZH_SECTION_HEADER.length).trim(),
    };
  }

  // 没有中英文分段时，直接复用同一份说明。
  return {
    releaseNotes: normalized,
    releaseNotesZh: normalized,
  };
}

export function prependUpdaterReleaseHighlights(
  version: string,
  notes: string,
  language: string,
): string {
  void version;
  void language;
  return normalizeNotes(notes);
}

function getStringFromRawJson(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed;
}

function isTrustedGmdReleaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'subapi.gmd.ink'
      && parsed.port === ''
      && parsed.pathname.startsWith(GMD_RELEASE_PATH_PREFIX);
  } catch {
    return false;
  }
}

export function resolveUpdaterDownloadUrl(
  version: string,
  rawJson?: Record<string, unknown>,
): string {
  const raw = rawJson ?? {};
  const preferredKeys = ['html_url', 'download_url', 'url', 'details_url'];
  for (const key of preferredKeys) {
    const url = getStringFromRawJson(raw, key);
    if (url && isTrustedGmdReleaseUrl(url)) {
      return url;
    }
  }

  void version;
  return GMD_RELEASES_URL;
}
