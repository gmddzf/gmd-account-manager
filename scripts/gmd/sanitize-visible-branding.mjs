import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const localeDir = path.join(projectRoot, 'src', 'locales');

function replaceLegacyBranding(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll('Antigravity Cockpit Tools', 'GMD Account Manager')
      .replaceAll('Cockpit Tools', 'GMD Account Manager')
      .replaceAll('Cockpit Api', 'GMD API')
      .replaceAll('Cockpit API', 'GMD API')
      .replaceAll('Cockpit', 'GMD')
      .replaceAll('APIKEY.FUN', 'GMD API')
      .replaceAll('apikey.fun', 'GMD API')
      .replaceAll('apikeyfun', 'gmd_relay');
  }
  if (Array.isArray(value)) return value.map(replaceLegacyBranding);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceLegacyBranding(item)]),
    );
  }
  return value;
}

function removePromotionSettings(value) {
  if (Array.isArray(value)) {
    value.forEach(removePromotionSettings);
    return;
  }
  if (!value || typeof value !== 'object') return;
  delete value.topRightAdVisible;
  delete value.topRightAdVisibleDesc;
  Object.values(value).forEach(removePromotionSettings);
}

function sanitizePromotionCopy(data, filename) {
  const simplifiedChinese = filename === 'zh-CN.json';
  const traditionalChinese = filename === 'zh-tw.json';
  const nav = data.nav && typeof data.nav === 'object' ? data.nav : null;
  const sponsors = data.sponsors && typeof data.sponsors === 'object'
    ? data.sponsors
    : null;
  const about = data.settings?.about && typeof data.settings.about === 'object'
    ? data.settings.about
    : null;
  const modelProviders = data.codex?.modelProviders && typeof data.codex.modelProviders === 'object'
    ? data.codex.modelProviders
    : null;
  const apiKeyFun = data.apiKeyFun && typeof data.apiKeyFun === 'object'
    ? data.apiKeyFun
    : null;

  if (data.common && typeof data.common === 'object') {
    delete data.common.topRightAd;
  }

  if (nav) {
    nav.sponsors = 'GMD API';
    nav.sponsorAppreciation = 'GMD API';
    nav.apiRelay = simplifiedChinese
      ? 'GMD 中转站'
      : traditionalChinese
        ? 'GMD 中轉站'
        : 'GMD Relay';
  }

  if (sponsors) {
    sponsors.listAriaLabel = simplifiedChinese
      ? 'GMD API 服务列表'
      : traditionalChinese
        ? 'GMD API 服務清單'
        : 'GMD API service list';
  }

  if (about) {
    about.sponsor = simplifiedChinese
      ? '客户服务'
      : traditionalChinese
        ? '客戶服務'
        : 'Customer service';
    about.sponsorDesc = simplifiedChinese
      ? '通过购买渠道联系 GMD 客服'
      : traditionalChinese
        ? '透過購買管道聯絡 GMD 客服'
        : 'Contact GMD through your purchase channel';
    about.supportDev = about.sponsor;
    delete about.alipay;
    delete about.wechatpay;
  }

  if (modelProviders) {
    modelProviders.sponsorRecommended = 'GMD API';
    modelProviders.sponsorHint = simplifiedChinese
      ? '使用当前填写的中转站 URL 和 API Key 创建连接。'
      : traditionalChinese
        ? '使用目前填寫的中轉站 URL 與 API Key 建立連線。'
        : 'Create the connection with the current relay URL and API key.';
  }

  if (apiKeyFun) {
    apiKeyFun.queryDesc = simplifiedChinese
      ? '输入中转站 URL 和 API Key 后自动查询额度。'
      : traditionalChinese
        ? '輸入中轉站 URL 與 API Key 後自動查詢額度。'
        : 'Enter a relay URL and API key to query usage automatically.';
    apiKeyFun.toolsDesc = simplifiedChinese
      ? '使用当前 URL、API Key 和模型列表写入本机客户端配置。'
      : traditionalChinese
        ? '使用目前 URL、API Key 與模型清單寫入本機用戶端設定。'
        : 'Write the current URL, API key, and model list to local client configuration.';
    delete apiKeyFun.docTool;
    delete apiKeyFun.apply;
  }
}

function sanitizeRelayCopy(data, filename) {
  const apiKeyFun = data.apiKeyFun && typeof data.apiKeyFun === 'object'
    ? data.apiKeyFun
    : null;
  const apiRelay = data.relay && typeof data.relay === 'object'
    ? data.relay
    : null;
  const sponsors = data.sponsors && typeof data.sponsors === 'object'
    ? data.sponsors
    : null;

  if (filename === 'zh-CN.json') {
    if (apiKeyFun) {
      apiKeyFun.description =
        '在这里管理 GMD 中转地址和对应的 API Key；可用模型与额度以当前地址和密钥的实际返回为准。';
      apiKeyFun.apiKeyPlaceholder = '粘贴当前中转站的 API Key';
      apiKeyFun.baseUrlLabel = '中转站 URL';
      apiKeyFun.baseUrlPlaceholder = '例如 https://relay.example.cn 或 https://relay.example.cn/v1';
      apiKeyFun.baseUrlRequired = '请输入中转站 URL。';
      apiKeyFun.baseUrlHttpsRequired = '远程中转站必须使用 HTTPS；HTTP 仅允许 localhost 或 127.0.0.1。';
      apiKeyFun.baseUrlCredentialsNotAllowed = 'URL 中不能包含用户名或密码。';
      apiKeyFun.baseUrlInvalid = '请输入有效的 http/https URL。';
      apiKeyFun.baseUrlResolved = '模型接口：{{url}}';
      delete apiKeyFun.register;
      delete apiKeyFun.docs;
      delete apiKeyFun.viewNow;
    }
    if (apiRelay) {
      apiRelay.pageTitle = 'GMD API';
      apiRelay.pageDesc = '管理用于 Codex API Key 账号的 GMD API 凭据和连接配置。';
      apiRelay.loading = '正在加载 GMD API...';
      apiRelay.emptyTitle = 'GMD API 暂不可用';
      apiRelay.emptyDesc = '本地 GMD API 配置不可用。';
      apiRelay.defaultDescription = 'GMD API 中转服务。';
      apiRelay.getApiKey = '打开 GMD API';
    }
    if (sponsors) {
      sponsors.pageTitle = 'GMD API';
      sponsors.pageDesc = '管理 GMD API 服务连接。';
      sponsors.loading = '正在加载 GMD API...';
      sponsors.emptyTitle = 'GMD API 暂不可用';
      sponsors.emptyDesc = '本地 GMD API 配置不可用。';
      sponsors.defaultDescription = 'GMD API 中转服务。';
      sponsors.openSponsor = '打开 GMD API';
    }
    return;
  }
  if (filename === 'zh-tw.json') {
    if (apiKeyFun) {
      apiKeyFun.description =
        '在這裡管理 GMD 中轉位址與對應的 API Key；可用模型與額度以目前位址和金鑰的實際回傳為準。';
      apiKeyFun.apiKeyPlaceholder = '貼上目前中轉站的 API Key';
      apiKeyFun.baseUrlLabel = '中轉站 URL';
      apiKeyFun.baseUrlPlaceholder = '例如 https://relay.example.cn 或 https://relay.example.cn/v1';
      apiKeyFun.baseUrlRequired = '請輸入中轉站 URL。';
      apiKeyFun.baseUrlHttpsRequired = '遠端中轉站必須使用 HTTPS；HTTP 僅允許 localhost 或 127.0.0.1。';
      apiKeyFun.baseUrlCredentialsNotAllowed = 'URL 中不能包含使用者名稱或密碼。';
      apiKeyFun.baseUrlInvalid = '請輸入有效的 http/https URL。';
      apiKeyFun.baseUrlResolved = '模型介面：{{url}}';
      delete apiKeyFun.register;
      delete apiKeyFun.docs;
      delete apiKeyFun.viewNow;
    }
    if (apiRelay) {
      apiRelay.pageTitle = 'GMD API';
      apiRelay.pageDesc = '管理用於 Codex API Key 帳號的 GMD API 憑據與連線設定。';
      apiRelay.loading = '正在載入 GMD API...';
      apiRelay.emptyTitle = 'GMD API 暫時無法使用';
      apiRelay.emptyDesc = '本機 GMD API 設定無法使用。';
      apiRelay.defaultDescription = 'GMD API 中轉服務。';
      apiRelay.getApiKey = '開啟 GMD API';
    }
    if (sponsors) {
      sponsors.pageTitle = 'GMD API';
      sponsors.pageDesc = '管理 GMD API 服務連線。';
      sponsors.loading = '正在載入 GMD API...';
      sponsors.emptyTitle = 'GMD API 暫時無法使用';
      sponsors.emptyDesc = '本機 GMD API 設定無法使用。';
      sponsors.defaultDescription = 'GMD API 中轉服務。';
      sponsors.openSponsor = '開啟 GMD API';
    }
    return;
  }
  if (apiKeyFun) {
    apiKeyFun.description =
      'Manage GMD relay addresses and their API keys. Available models and usage follow the selected address and key.';
    apiKeyFun.apiKeyPlaceholder = 'Paste the API key for the current relay';
    apiKeyFun.baseUrlLabel = 'Relay URL';
    apiKeyFun.baseUrlPlaceholder = 'For example, https://relay.example.cn or https://relay.example.cn/v1';
    apiKeyFun.baseUrlRequired = 'Enter a relay URL.';
    apiKeyFun.baseUrlHttpsRequired = 'Remote relays must use HTTPS. HTTP is allowed only for localhost or 127.0.0.1.';
    apiKeyFun.baseUrlCredentialsNotAllowed = 'The URL cannot contain a username or password.';
    apiKeyFun.baseUrlInvalid = 'Enter a valid http/https URL.';
    apiKeyFun.baseUrlResolved = 'Model endpoint: {{url}}';
    delete apiKeyFun.register;
    delete apiKeyFun.docs;
    delete apiKeyFun.viewNow;
  }
  if (apiRelay) {
    apiRelay.pageTitle = 'GMD API';
    apiRelay.pageDesc = 'Manage GMD API credentials and connection settings for Codex API Key accounts.';
    apiRelay.loading = 'Loading GMD API...';
    apiRelay.emptyTitle = 'GMD API unavailable';
    apiRelay.emptyDesc = 'The local GMD API configuration is unavailable.';
    apiRelay.defaultDescription = 'GMD API relay service.';
    apiRelay.getApiKey = 'Open GMD API';
  }
  if (sponsors) {
    sponsors.pageTitle = 'GMD API';
    sponsors.pageDesc = 'Manage GMD API service connections.';
    sponsors.loading = 'Loading GMD API...';
    sponsors.emptyTitle = 'GMD API unavailable';
    sponsors.emptyDesc = 'The local GMD API configuration is unavailable.';
    sponsors.defaultDescription = 'GMD API relay service.';
    sponsors.openSponsor = 'Open GMD API';
  }
}

const localeFiles = (await readdir(localeDir))
  .filter((filename) => filename.endsWith('.json'))
  .sort();

for (const filename of localeFiles) {
  const filePath = path.join(localeDir, filename);
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  const sanitized = replaceLegacyBranding(parsed);
  removePromotionSettings(sanitized);
  sanitizeRelayCopy(sanitized, filename);
  sanitizePromotionCopy(sanitized, filename);
  await writeFile(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
}

console.log(`Sanitized visible branding in ${localeFiles.length} locale files.`);
