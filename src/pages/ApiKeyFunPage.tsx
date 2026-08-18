import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookmarkPlus,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  ListFilter,
  RadioTower,
  Trash2,
  Copy,
  Pencil,
  X,
} from 'lucide-react';
import {
  classifyModelProviderUsageError,
  listModelProviderModels,
  queryModelProviderUsage,
  type ModelProviderModel,
  type ModelProviderUsageSummary,
} from '../services/modelProviderUsageService';
import {
  GMD_RELAY_BASE_URL_STORAGE_KEY,
  GMD_RELAY_ENDPOINTS_STORAGE_KEY,
  GMD_RELAY_LEGACY_KEYS_STORAGE_KEY,
  GMD_RELAY_MANAGED_KEYS_STORAGE_KEY,
  gmdRelayEndpointDisplayName,
  isSameGmdRelayBaseUrl,
  normalizeGmdRelayEndpointProfiles,
  normalizeGmdRelayBaseUrl,
  resolveGmdRelayIntegrationType,
  upsertGmdRelayEndpointProfile,
  validateGmdRelayBaseUrl,
  type GmdRelayEndpointProfile,
} from '../utils/gmdRelayConfig';
import {
  dispatchApiKeyFunPrefillEvent,
  buildGmdRelayPrefillPayload,
  getApiKeyFunPrefillPage,
  type ApiKeyFunPrefillTarget,
} from '../utils/apiKeyFunPrefill';
import './ApiKeyFunPage.css';

type ManagedApiKey = {
  id: string;
  key: string;
  baseUrl: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  lastStatus?: 'ok' | 'bad' | 'unknown';
  lastRemaining?: string;
  addedToCodexAt?: number;
  codexProviderName?: string;
  addedToClaudeAt?: number;
  claudeAccountName?: string;
};

const APIKEY_FUN_AUTO_QUERY_DELAY_MS = 650;

function maskKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}****`;
  return `${trimmed.slice(0, 6)}****${trimmed.slice(-4)}`;
}

function formatNumber(value?: number | null, suffix = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 4,
  }).format(value);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function usagePrimaryValue(summary: ModelProviderUsageSummary | null): string {
  if (!summary) return '--';
  const unit = summary.unit ?? '';
  if (summary.quotaUnlimited) return 'Unlimited';
  if (typeof summary.remaining === 'number') return formatNumber(summary.remaining, unit);
  if (typeof summary.quotaRemaining === 'number') return formatNumber(summary.quotaRemaining, unit);
  if (typeof summary.balance === 'number') return formatNumber(summary.balance, unit);
  return '--';
}

function usageValidityTone(summary: ModelProviderUsageSummary | null): 'ok' | 'bad' | 'unknown' {
  if (!summary || typeof summary.isValid !== 'boolean') return 'unknown';
  return summary.isValid ? 'ok' : 'bad';
}

function providerFriendlyError(error: unknown, t: ReturnType<typeof useTranslation>['t'], models = false): string {
  switch (classifyModelProviderUsageError(error)) {
    case 'authorization':
      return t(
        models ? 'apiKeyFun.models.authorizationFailed' : 'apiKeyFun.error.authorizationFailed',
        models
          ? '模型列表读取失败，请检查 API Key 与中转站 URL 是否对应。'
          : '额度查询失败，请检查 API Key 与中转站 URL 是否对应。',
      );
    case 'network':
      return t(
        models ? 'apiKeyFun.models.networkFailed' : 'apiKeyFun.error.networkFailed',
        models ? '模型列表暂时无法读取，请检查网络或中转站状态。' : '额度服务暂时无法连接，请稍后重试。',
      );
    case 'invalid_url':
      return t('apiKeyFun.baseUrlInvalid', '请输入有效的 http/https URL。');
    case 'unavailable':
      return t(
        models ? 'apiKeyFun.models.unavailable' : 'apiKeyFun.error.unavailable',
        models
          ? '模型列表服务暂时不可用，请稍后重试。'
          : '额度服务暂时不可用，不影响密钥保存和模型使用。',
      );
    default:
      return t(
        models ? 'apiKeyFun.models.queryFailedGeneric' : 'apiKeyFun.error.queryFailedGeneric',
        models ? '模型列表读取失败，请稍后重试。' : '额度读取失败，请稍后重试。',
      );
  }
}

function loadManagedApiKeys(): ManagedApiKey[] {
  try {
    const raw =
      window.localStorage.getItem(GMD_RELAY_MANAGED_KEYS_STORAGE_KEY) ??
      window.localStorage.getItem(GMD_RELAY_LEGACY_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => (
        typeof item?.id === 'string' &&
        typeof item?.key === 'string' &&
        typeof item?.name === 'string' &&
        typeof item?.createdAt === 'number' &&
        typeof item?.lastUsedAt === 'number'
      ))
      .map((item) => ({
        ...item,
        baseUrl: normalizeGmdRelayBaseUrl(item.baseUrl),
      })) as ManagedApiKey[];
  } catch {
    return [];
  }
}

function loadSavedRelayBaseUrl(): string {
  try {
    return normalizeGmdRelayBaseUrl(
      window.localStorage.getItem(GMD_RELAY_BASE_URL_STORAGE_KEY),
    );
  } catch {
    return '';
  }
}

function loadSavedRelayEndpointProfiles(): GmdRelayEndpointProfile[] {
  try {
    const raw = window.localStorage.getItem(GMD_RELAY_ENDPOINTS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeGmdRelayEndpointProfiles(JSON.parse(raw));
  } catch {
    return [];
  }
}

function buildManagedKeyName(key: string): string {
  return maskKey(key);
}

function formatManagedKeyTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function normalizeModelCatalog(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  values.forEach((value) => {
    const model = value.trim();
    const key = model.toLowerCase();
    if (!model || seen.has(key)) return;
    seen.add(key);
    models.push(model);
  });
  return models;
}

function isClaudeModelId(value: string): boolean {
  const model = value.trim().toLowerCase();
  return model.startsWith('claude-') || model.startsWith('anthropic/claude-');
}

export function ApiKeyFunPage() {
  const { t } = useTranslation();
  const [relayBaseUrlInput, setRelayBaseUrlInput] = useState(() => loadSavedRelayBaseUrl());
  const [relayEndpointProfiles, setRelayEndpointProfiles] = useState<GmdRelayEndpointProfile[]>(
    () => loadSavedRelayEndpointProfiles(),
  );
  const [showRelayBaseUrlError, setShowRelayBaseUrlError] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [usage, setUsage] = useState<ModelProviderUsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [queryingUsage, setQueryingUsage] = useState(false);
  const [apiKeyModels, setApiKeyModels] = useState<ModelProviderModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [queryingModels, setQueryingModels] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [managedKeys, setManagedKeys] = useState<ManagedApiKey[]>(() => loadManagedApiKeys());
  const [keyActionState, setKeyActionState] = useState<Record<string, {
    target: ApiKeyFunPrefillTarget;
    status: 'success' | 'error';
    message?: string;
  }>>({});
  const initialManagedKeySelectedRef = useRef(false);

  // 别名编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // 复制状态
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const relayBaseUrlValidation = useMemo(
    () => validateGmdRelayBaseUrl(relayBaseUrlInput),
    [relayBaseUrlInput],
  );
  const providerBaseUrl = relayBaseUrlValidation.ok ? relayBaseUrlValidation.baseUrl : '';
  const relayIntegrationType = useMemo(
    () => resolveGmdRelayIntegrationType(providerBaseUrl),
    [providerBaseUrl],
  );
  const selectedRelayEndpoint = useMemo(
    () => relayEndpointProfiles.find((item) => isSameGmdRelayBaseUrl(item.baseUrl, providerBaseUrl)) ?? null,
    [providerBaseUrl, relayEndpointProfiles],
  );
  const relayEndpointOptions = useMemo(
    () => relayEndpointProfiles.map((item) => ({
      ...item,
      label: item.name || gmdRelayEndpointDisplayName(item.baseUrl),
    })),
    [relayEndpointProfiles],
  );
  const relayBaseUrlErrorMessage = useMemo(() => {
    if (relayBaseUrlValidation.ok) return '';
    switch (relayBaseUrlValidation.error) {
      case 'required':
        return t('apiKeyFun.baseUrlRequired', '请输入中转站 URL。');
      case 'https_required':
        return t(
          'apiKeyFun.baseUrlHttpsRequired',
          '远程中转站必须使用 HTTPS；HTTP 仅允许 localhost 或 127.0.0.1。',
        );
      case 'credentials_not_allowed':
        return t('apiKeyFun.baseUrlCredentialsNotAllowed', 'URL 中不能包含用户名或密码。');
      default:
        return t('apiKeyFun.baseUrlInvalid', '请输入有效的 http/https URL。');
    }
  }, [relayBaseUrlValidation, t]);
  const maskedApiKey = useMemo(() => maskKey(apiKey), [apiKey]);
  const currentKey = apiKey.trim();
  const currentSavedKey = useMemo(
    () => managedKeys.find((item) => (
      item.key === currentKey && isSameGmdRelayBaseUrl(item.baseUrl, providerBaseUrl)
    )),
    [currentKey, managedKeys, providerBaseUrl],
  );
  const apiKeyFunModelCatalog = useMemo(
    () => normalizeModelCatalog(apiKeyModels.map((model) => model.id)),
    [apiKeyModels],
  );
  const modelCatalogText = useMemo(
    () => apiKeyFunModelCatalog.join('\n').toLowerCase(),
    [apiKeyFunModelCatalog],
  );
  const canAddCurrentKeyToCodex = modelCatalogText.includes('gpt');
  const canAddCurrentKeyToClaude = apiKeyFunModelCatalog.some(isClaudeModelId);
  const canShowTargetActions = canAddCurrentKeyToCodex || canAddCurrentKeyToClaude;
  const canPrefillCurrentKey =
    Boolean(currentSavedKey) && !queryingModels && apiKeyFunModelCatalog.length > 0;

  useEffect(() => {
    if (initialManagedKeySelectedRef.current) return;
    initialManagedKeySelectedRef.current = true;
    if (apiKey.trim()) return;
    const firstEntry = managedKeys[0];
    if (firstEntry?.key.trim()) {
      setApiKey(firstEntry.key);
      if (firstEntry.baseUrl) {
        setRelayBaseUrlInput(firstEntry.baseUrl);
      }
    }
  }, [apiKey, managedKeys]);

  useEffect(() => {
    window.localStorage.setItem(GMD_RELAY_MANAGED_KEYS_STORAGE_KEY, JSON.stringify(managedKeys));
  }, [managedKeys]);

  useEffect(() => {
    if (relayEndpointProfiles.length > 0 || managedKeys.length === 0) return;
    const seeded = managedKeys.reduce(
      (profiles, item) => upsertGmdRelayEndpointProfile(profiles, item.baseUrl, null, item.createdAt),
      [] as GmdRelayEndpointProfile[],
    );
    if (seeded.length > 0) setRelayEndpointProfiles(seeded);
  }, [managedKeys, relayEndpointProfiles.length]);

  useEffect(() => {
    window.localStorage.setItem(
      GMD_RELAY_ENDPOINTS_STORAGE_KEY,
      JSON.stringify(relayEndpointProfiles),
    );
  }, [relayEndpointProfiles]);

  useEffect(() => {
    if (!providerBaseUrl) return;
    window.localStorage.setItem(GMD_RELAY_BASE_URL_STORAGE_KEY, providerBaseUrl);
  }, [providerBaseUrl]);

  useEffect(() => {
    if (!saveFlash) return undefined;
    const timer = window.setTimeout(() => setSaveFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [saveFlash]);

  // 自动额度查询
  useEffect(() => {
    const key = apiKey.trim();
    if (!key || !providerBaseUrl) {
      setUsage(null);
      setUsageError(null);
      setQueryingUsage(false);
      setApiKeyModels([]);
      setModelsError(null);
      setQueryingModels(false);
      return undefined;
    }

    let cancelled = false;
    setUsageError(null);
    setModelsError(null);
    setApiKeyModels([]);
    setQueryingUsage(true);
    setQueryingModels(true);

    const timer = window.setTimeout(() => {
      void queryModelProviderUsage({
        baseUrl: providerBaseUrl,
        apiKey: key,
        integrationType: relayIntegrationType,
      })
        .then((nextUsage) => {
          if (cancelled) return;
          const nextStatus = usageValidityTone(nextUsage);
          const nextRemaining = usagePrimaryValue(nextUsage);
          setUsage(nextUsage);
          setManagedKeys((items) => items.map((item) => (
            item.key === key
              ? {
                  ...item,
                  lastUsedAt: Date.now(),
                  lastStatus: nextStatus,
                  lastRemaining: nextRemaining,
                }
              : item
          )));
        })
        .catch((error) => {
          if (cancelled) return;
          setUsage(null);
          setUsageError(providerFriendlyError(error, t));
          setManagedKeys((items) => items.map((item) => (
            item.key === key
              ? {
                  ...item,
                  lastUsedAt: Date.now(),
                  lastStatus: 'bad',
                  lastRemaining: '--',
                }
              : item
          )));
        })
        .finally(() => {
          if (!cancelled) setQueryingUsage(false);
        });
      void listModelProviderModels({
        baseUrl: providerBaseUrl,
        apiKey: key,
      })
        .then((result) => {
          if (cancelled) return;
          setApiKeyModels(result.models);
          setModelsError(
            result.models.length === 0
              ? t('apiKeyFun.models.emptyFromKey', '当前 API Key 未返回模型列表。')
              : null,
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setApiKeyModels([]);
          setModelsError(providerFriendlyError(error, t, true));
        })
        .finally(() => {
          if (!cancelled) setQueryingModels(false);
        });
    }, APIKEY_FUN_AUTO_QUERY_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiKey, providerBaseUrl, relayIntegrationType, t]);

  // 保存密钥
  const handleSaveCurrentKey = useCallback(() => {
    const key = apiKey.trim();
    if (!key) {
      setUsageError(t('apiKeyFun.error.missingApiKey', '请输入 API Key。'));
      return;
    }
    if (!relayBaseUrlValidation.ok) {
      setShowRelayBaseUrlError(true);
      return;
    }
    const baseUrl = relayBaseUrlValidation.baseUrl;
    const now = Date.now();
    const nextStatus = usageValidityTone(usage);
    const nextRemaining = usagePrimaryValue(usage);
    setManagedKeys((items) => {
      const existing = items.find((item) => (
        item.key === key && isSameGmdRelayBaseUrl(item.baseUrl, baseUrl)
      ));
      if (existing) {
        return items.map((item) => (
          item.id === existing.id
            ? {
                ...item,
                baseUrl,
                lastUsedAt: now,
                lastStatus: nextStatus,
                lastRemaining: nextRemaining,
              }
            : item
        ));
      }
      return [
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          key,
          baseUrl,
          name: buildManagedKeyName(key),
          createdAt: now,
          lastUsedAt: now,
          lastStatus: nextStatus,
          lastRemaining: nextRemaining,
        },
        ...items,
      ];
    });
    setRelayEndpointProfiles((profiles) => upsertGmdRelayEndpointProfile(profiles, baseUrl, null, now));
    setUsageError(null);
    setRelayBaseUrlInput(baseUrl);
    setShowRelayBaseUrlError(false);
    setSaveFlash(true);
  }, [apiKey, relayBaseUrlValidation, t, usage]);

  const handleSelectRelayEndpoint = useCallback((value: string) => {
    if (!value) return;
    setRelayBaseUrlInput(value);
    setShowRelayBaseUrlError(false);
    setUsageError(null);
    setModelsError(null);
  }, []);

  const handleSaveRelayEndpoint = useCallback(() => {
    if (!relayBaseUrlValidation.ok) {
      setShowRelayBaseUrlError(true);
      return;
    }
    const baseUrl = relayBaseUrlValidation.baseUrl;
    setRelayEndpointProfiles((profiles) => upsertGmdRelayEndpointProfile(profiles, baseUrl));
    setRelayBaseUrlInput(baseUrl);
    setShowRelayBaseUrlError(false);
  }, [relayBaseUrlValidation]);

  const handleDeleteRelayEndpoint = useCallback(() => {
    if (!selectedRelayEndpoint) return;
    setRelayEndpointProfiles((profiles) => profiles.filter((item) => item.id !== selectedRelayEndpoint.id));
  }, [selectedRelayEndpoint]);

  const setManagedKeyAction = useCallback((
    id: string,
    state: { target: ApiKeyFunPrefillTarget; status: 'success' | 'error'; message?: string },
  ) => {
    setKeyActionState((items) => ({ ...items, [id]: state }));
  }, []);

  const handlePrefillTarget = useCallback((
    target: ApiKeyFunPrefillTarget,
    item: ManagedApiKey,
  ) => {
    const key = item.key.trim();
    if (!key) {
      setManagedKeyAction(item.id, {
        target,
        status: 'error',
        message: t('apiKeyFun.error.missingApiKey', '请输入 API Key。'),
      });
      return;
    }
    const page = getApiKeyFunPrefillPage(target);
    const targetName = target === 'codex'
      ? 'Codex'
      : target === 'claude_desktop'
        ? 'Claude'
        : 'Claude CLI';
    window.dispatchEvent(new CustomEvent<typeof page>('app-request-navigate', { detail: page }));
    window.setTimeout(() => {
      const payload = buildGmdRelayPrefillPayload({
        target,
        apiKey: key,
        apiKeyName: item.name || buildManagedKeyName(key),
        providerName: 'GMD API',
        relayBaseUrl: providerBaseUrl,
        integrationType:
          usage?.mode === 'sub2api' || usage?.mode === 'new_api' ? usage.mode : null,
        modelCatalog: apiKeyFunModelCatalog,
      });
      if (payload) dispatchApiKeyFunPrefillEvent(payload);
    }, 0);
    setManagedKeyAction(item.id, {
      target,
      status: 'success',
      message: t('apiKeyFun.keyManager.prefillOpened', {
        defaultValue: '已打开 {{target}} 添加弹窗，请确认保存',
        target: targetName,
      }),
    });
  }, [apiKeyFunModelCatalog, providerBaseUrl, setManagedKeyAction, t, usage?.mode]);

  // 切换密钥
  const handleUseManagedKey = useCallback((item: ManagedApiKey) => {
    setApiKey(item.key);
    setRelayBaseUrlInput(item.baseUrl);
    setShowRelayBaseUrlError(false);
    setUsageError(null);
    setManagedKeys((items) => items.map((nextItem) => (
      nextItem.id === item.id ? { ...nextItem, lastUsedAt: Date.now() } : nextItem
    )));
  }, []);

  // 删除密钥
  const handleDeleteManagedKey = useCallback((id: string) => {
    setManagedKeys((items) => items.filter((item) => item.id !== id));
  }, []);

  // 行内重命名密钥管理
  const handleStartRename = useCallback((item: ManagedApiKey, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditNameValue(item.name);
  }, []);

  const handleSaveRename = useCallback((id: string, e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editNameValue.trim();
    if (!trimmed) return;
    setManagedKeys((items) => items.map((item) => (
      item.id === id ? { ...item, name: trimmed } : item
    )));
    setEditingId(null);
  }, [editNameValue]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  // 复制剪贴板逻辑
  const handleCopyToClipboard = useCallback((text: string, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          setCopiedId(id);
          setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
          console.error('Failed to copy key', err);
        }
      });
  }, []);

  return (
    <div className="apikey-fun-page">
      <header className="apikey-fun-header-brand">
        <div className="apikey-fun-brand-main">
          <div className="apikey-fun-brand-logo" aria-hidden="true">
            <RadioTower size={22} />
            <span>GMD</span>
          </div>
          <div className="apikey-fun-brand-text">
            <div className="apikey-fun-eyebrow-container">
              <span className="apikey-fun-eyebrow">{t('apiKeyFun.eyebrow', '中转站')}</span>
            </div>
            <h1>{t('apiKeyFun.title', 'GMD API 中转站')}</h1>
            <p>
              {t(
                'apiKeyFun.description',
                'GMD API 提供 OpenAI Responses 兼容接口，可在这里保存和管理 API Key，并一键添加或切换到 Codex。可用模型和额度以当前 API Key 的实际返回结果为准。',
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="apikey-fun-dashboard-grid">
        <main className="apikey-fun-main-col">
          <section
            className="apikey-fun-dashboard-panel apikey-fun-config-panel"
            data-tour="gmd-relay-config"
          >
            <div className="apikey-fun-panel-head">
              <div>
                <h2>{t('apiKeyFun.queryTitle', '密钥额度查询')}</h2>
              </div>
              <div className="apikey-fun-key-preview">
                <KeyRound size={14} />
                <span>{maskedApiKey || t('apiKeyFun.keyNotSet', '未输入秘钥')}</span>
              </div>
            </div>

            <div className="apikey-fun-form-grid apikey-fun-form-grid-single">
              <label className="apikey-fun-field apikey-fun-field-wide">
                <span>{t('apiKeyFun.baseUrlLabel', '中转站 URL（支持中国/海外地址）')}</span>
                <div className="apikey-fun-endpoint-toolbar">
                  <div className="apikey-fun-endpoint-select">
                    <ListFilter size={15} aria-hidden="true" />
                    <select
                      value={selectedRelayEndpoint?.baseUrl ?? ''}
                      onChange={(event) => handleSelectRelayEndpoint(event.target.value)}
                      aria-label={t('apiKeyFun.endpoint.selectLabel', '选择已保存的中转地址')}
                    >
                      <option value="">
                        {relayEndpointOptions.length > 0
                          ? t('apiKeyFun.endpoint.selectPlaceholder', '选择已保存的中转地址')
                          : t('apiKeyFun.endpoint.noSaved', '暂无已保存地址')}
                      </option>
                      {relayEndpointOptions.map((item) => (
                        <option key={item.id} value={item.baseUrl}>
                          {item.label} · {item.baseUrl}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="apikey-fun-endpoint-action"
                    disabled={!providerBaseUrl}
                    onClick={handleSaveRelayEndpoint}
                    title={t('apiKeyFun.endpoint.save', '保存当前中转地址')}
                  >
                    <BookmarkPlus size={14} />
                    <span>{t('apiKeyFun.endpoint.save', '保存地址')}</span>
                  </button>
                  <button
                    type="button"
                    className="apikey-fun-endpoint-action danger"
                    disabled={!selectedRelayEndpoint}
                    onClick={handleDeleteRelayEndpoint}
                    title={t('apiKeyFun.endpoint.delete', '删除当前地址')}
                  >
                    <Trash2 size={14} />
                    <span>{t('apiKeyFun.endpoint.delete', '删除地址')}</span>
                  </button>
                </div>
                <div className={`apikey-fun-secret-input apikey-fun-url-input${showRelayBaseUrlError && !relayBaseUrlValidation.ok ? ' invalid' : ''}`}>
                  <Link2 size={16} aria-hidden="true" />
                  <input
                    value={relayBaseUrlInput}
                    type="url"
                    placeholder={t('apiKeyFun.baseUrlPlaceholder', '例如 https://relay.example.cn 或 https://relay.example.cn/v1')}
                    spellCheck={false}
                    autoComplete="url"
                    onChange={(event) => {
                      setRelayBaseUrlInput(event.target.value);
                      setShowRelayBaseUrlError(false);
                      setUsageError(null);
                      setModelsError(null);
                    }}
                    onBlur={() => {
                      setShowRelayBaseUrlError(true);
                      if (relayBaseUrlValidation.ok) {
                        setRelayBaseUrlInput(relayBaseUrlValidation.baseUrl);
                      }
                    }}
                  />
                </div>
                {showRelayBaseUrlError && !relayBaseUrlValidation.ok ? (
                  <small className="apikey-fun-field-message error">{relayBaseUrlErrorMessage}</small>
                ) : providerBaseUrl ? (
                  <small className="apikey-fun-field-message">
                    {t('apiKeyFun.baseUrlResolved', {
                      defaultValue: '模型接口：{{url}}',
                      url: providerBaseUrl,
                    })}
                  </small>
                ) : null}
              </label>
              <label className="apikey-fun-field apikey-fun-field-wide">
                <span>{t('apiKeyFun.apiKeyLabel', 'API Key')}</span>
                <div className="apikey-fun-secret-input">
                  <input
                    value={apiKey}
                    type={showApiKey ? 'text' : 'password'}
                    name="gmd-api-key"
                    autoComplete="new-password"
                    placeholder={t('apiKeyFun.apiKeyPlaceholder', '粘贴从 GMD API 获取的 API Key')}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setUsageError(null);
                    }}
                  />
                  {apiKey && (
                    <button
                      type="button"
                      className="apikey-fun-icon-button copy-btn"
                      onClick={(e) => handleCopyToClipboard(apiKey, 'input', e)}
                      title={t('apiKeyFun.copyKey', '复制密钥')}
                    >
                      {copiedId === 'input' ? <CheckCircle2 size={16} className="success-icon" /> : <Copy size={16} />}
                    </button>
                  )}
                  {apiKey && (
                    <button
                      type="button"
                      className="apikey-fun-icon-button clear-btn"
                      onClick={() => {
                      setApiKey('');
                      setUsageError(null);
                      setUsage(null);
                      setApiKeyModels([]);
                      setModelsError(null);
                      setQueryingModels(false);
                    }}
                    title={t('apiKeyFun.clearKey', '清空输入')}
                  >
                      <X size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="apikey-fun-icon-button"
                    onClick={() => setShowApiKey((value) => !value)}
                    title={showApiKey ? t('apiKeyFun.hideKey', '隐藏') : t('apiKeyFun.showKey', '显示')}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            </div>

            <div className="apikey-fun-action-row apikey-fun-key-actions">
              <div className="apikey-fun-primary-actions">
                <button className="btn apikey-fun-save-btn" disabled={!currentKey} onClick={handleSaveCurrentKey}>
                  {currentSavedKey ? <CheckCircle2 size={16} /> : <BookmarkPlus size={16} />}
                  <span>
                    {currentSavedKey
                      ? t('apiKeyFun.keyManager.savedButton', '已保存')
                      : t('apiKeyFun.keyManager.saveButton', '保存密钥')}
                  </span>
                </button>
                {saveFlash && (
                  <span className="apikey-fun-save-flash">
                    {t('apiKeyFun.keyManager.saveFlash', '刚刚保存')}
                  </span>
                )}
              </div>
              {canShowTargetActions && (
                <div className="apikey-fun-target-actions">
                  {canAddCurrentKeyToCodex && (
                    <button
                      type="button"
                      className="btn apikey-fun-target-btn"
                      disabled={!canPrefillCurrentKey}
                      onClick={() => {
                        if (currentSavedKey) handlePrefillTarget('codex', currentSavedKey);
                      }}
                    >
                      <span>{t('apiKeyFun.keyManager.addToCodex', '添加到 Codex')}</span>
                    </button>
                  )}
                  {canAddCurrentKeyToClaude && (
                    <button
                      type="button"
                      className="btn apikey-fun-target-btn"
                      disabled={!canPrefillCurrentKey}
                      onClick={() => {
                        if (currentSavedKey) handlePrefillTarget('claude_desktop', currentSavedKey);
                      }}
                    >
                      <span>{t('apiKeyFun.keyManager.addToClaudeDesktop', '添加到 Claude')}</span>
                    </button>
                  )}
                  {canAddCurrentKeyToClaude && (
                    <button
                      type="button"
                      className="btn apikey-fun-target-btn"
                      disabled={!canPrefillCurrentKey}
                      onClick={() => {
                        if (currentSavedKey) handlePrefillTarget('claude_cli', currentSavedKey);
                      }}
                    >
                      <span>{t('apiKeyFun.keyManager.addToClaudeCli', '添加到 Claude CLI')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {usageError && (
              <div className="apikey-fun-message error">
                {usageError}
              </div>
            )}
          </section>

          {/* 数值卡片展示 */}
          <div className="apikey-fun-usage-grid">
            <div className={`apikey-fun-usage-card primary ${queryingUsage ? 'loading' : ''}`}>
              <span>{t('apiKeyFun.usage.remaining', '剩余额度')}</span>
              {queryingUsage ? (
                <div className="apikey-fun-skeleton-text" />
              ) : (
                <strong>{usagePrimaryValue(usage)}</strong>
              )}
            </div>
            <div className={`apikey-fun-usage-card ${queryingUsage ? 'loading' : ''}`}>
              <span>{t('apiKeyFun.usage.used', '已用额度')}</span>
              {queryingUsage ? (
                <div className="apikey-fun-skeleton-text" />
              ) : (
                <strong>{formatNumber(usage?.quotaUsed ?? usage?.totalCost, usage?.unit ?? '')}</strong>
              )}
            </div>
            <div className={`apikey-fun-usage-card ${queryingUsage ? 'loading' : ''}`}>
              <span>{t('apiKeyFun.usage.todayRequests', '今日请求')}</span>
              {queryingUsage ? (
                <div className="apikey-fun-skeleton-text" />
              ) : (
                <strong>{formatNumber(usage?.todayRequests)}</strong>
              )}
            </div>
             <div className={`apikey-fun-usage-card ${queryingUsage ? 'loading' : ''}`}>
               <span>{t('apiKeyFun.usage.totalRequests', '总请求')}</span>
              {queryingUsage ? (
                <div className="apikey-fun-skeleton-text" />
              ) : (
                <strong>{formatNumber(usage?.totalRequests)}</strong>
              )}
            </div>
          </div>

          <section className="apikey-fun-dashboard-panel apikey-fun-models-panel">
            <div className="apikey-fun-panel-head">
              <div>
                <h2>{t('apiKeyFun.models.title', '可用模型')}</h2>
              </div>
              <div className="apikey-fun-model-count">
                {queryingModels
                  ? t('apiKeyFun.models.loading', '读取中')
                  : t('apiKeyFun.models.count', {
                      defaultValue: '{{count}} 个模型',
                      count: apiKeyFunModelCatalog.length,
                    })}
              </div>
            </div>
            {queryingModels ? (
              <div className="apikey-fun-model-empty">
                {t('apiKeyFun.models.loadingDesc', '正在从当前 API Key 读取模型列表...')}
              </div>
            ) : modelsError ? (
              <div className="apikey-fun-model-empty">
                {modelsError}
              </div>
            ) : apiKeyFunModelCatalog.length === 0 ? (
              <div className="apikey-fun-model-empty">
                {currentKey
                  ? t('apiKeyFun.models.emptyFromKey', '当前 API Key 未返回模型列表。')
                  : t('apiKeyFun.models.empty', '输入 API Key 后读取可用模型。')}
              </div>
            ) : (
              <div className="apikey-fun-model-list">
                {apiKeyFunModelCatalog.map((model) => (
                  <span className="apikey-fun-model-chip" key={model}>{model}</span>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="apikey-fun-sidebar-col">
          <section className="apikey-fun-dashboard-panel apikey-fun-manager-panel">
            <div className="apikey-fun-panel-head">
              <div>
                <h2>{t('apiKeyFun.keyManager.title', '密钥管理')}</h2>
                <p>{t('apiKeyFun.keyManager.desc', '保存常用 API Key，点击即可切换并自动查询额度。')}</p>
              </div>
            </div>
            {managedKeys.length === 0 ? (
              <div className="apikey-fun-empty-keys">
                <KeyRound size={16} />
                <span>{t('apiKeyFun.keyManager.empty', '暂无保存的密钥。')}</span>
              </div>
            ) : (
              <div className="apikey-fun-key-list">
                {managedKeys.map((item) => {
                  const isEditing = editingId === item.id;
                  const actionState = keyActionState[item.id];
                  return (
                    <div className={`apikey-fun-key-item ${item.key === currentKey ? 'active' : ''} ${isEditing ? 'editing' : ''}`} key={item.id}>
                      {isEditing ? (
                        <form className="apikey-fun-rename-form" onSubmit={(e) => handleSaveRename(item.id, e)}>
                          <input
                            ref={(el) => el?.focus()}
                            className="apikey-fun-rename-input"
                            value={editNameValue}
                            placeholder={t('apiKeyFun.keyManager.renamePlaceholder', '输入新别名...')}
                            onChange={(e) => setEditNameValue(e.target.value)}
                            onBlur={() => handleSaveRename(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') handleCancelRename();
                            }}
                          />
                        </form>
                      ) : (
                        <button className="apikey-fun-key-select" onClick={() => handleUseManagedKey(item)}>
                          <span className="apikey-fun-key-name-row">
                            <span className="name-text">{item.name}</span>
                            <span
                              className="edit-icon-btn"
                              title={t('apiKeyFun.keyManager.editAlias', '修改别名')}
                              onClick={(e) => handleStartRename(item, e)}
                            >
                              <Pencil size={12} />
                            </span>
                          </span>
                            <span className="apikey-fun-key-meta">
                            <small title={item.baseUrl}>
                              {item.baseUrl || t('apiKeyFun.keyManager.urlRequired', '需要补充中转站 URL')}
                            </small>
                            <small>
                              {item.lastRemaining
                                ? t('apiKeyFun.keyManager.lastRemaining', {
                                    defaultValue: '上次余额 {{value}}',
                                    value: item.lastRemaining,
                                  })
                                : t('apiKeyFun.keyManager.notQueried', '未查询')}
                            </small>
                            <small>
                              {t('apiKeyFun.keyManager.createdAt', {
                                defaultValue: '添加于 {{time}}',
                                time: formatManagedKeyTime(item.createdAt),
                              })}
                            </small>
                            {actionState?.message && (
                              <small className={`apikey-fun-key-action-state ${actionState.status}`}>
                                {actionState.message}
                              </small>
                            )}
                          </span>
                        </button>
                      )}
                      
                      <div className="apikey-fun-key-item-actions">
                        <button
                          type="button"
                          className="apikey-fun-key-copy"
                          onClick={(e) => handleCopyToClipboard(item.key, item.id, e)}
                          title={t('apiKeyFun.copyKey', '复制密钥')}
                        >
                          {copiedId === item.id ? (
                            <CheckCircle2 size={14} className="success-icon" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="apikey-fun-key-delete"
                          disabled={isEditing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteManagedKey(item.id);
                          }}
                          title={t('apiKeyFun.keyManager.deleteButton', '删除')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
