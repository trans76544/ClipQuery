const DEFAULT_SETTINGS = {
  answerMode: "balanced",
  authMode: "apiKey",
  apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  apiKey: "",
  model: "qwen-plus",
  codexApiUrl: "https://chatgpt.com/backend-api/codex/responses",
  codexModel: "gpt-5.2",
  systemPrompt:
    "You are a helpful reading assistant. Answer the user's question based on the selected webpage text. If the selection is insufficient, say what is missing.",
  temperature: 0.4,
  codexAccessToken: "",
  codexRefreshToken: "",
  codexApiKey: "",
  codexAccountId: "",
  codexExpiresAt: 0,
  codexAccountEmail: "",
  codexAccountName: "",
  codexLoginAt: "",
  codexAuthError: "",
  providerProfiles: [],
  actionProviderMap: {
    ask: "",
    explain: "",
    summarize: "",
    translate: ""
  }
};

const form = document.getElementById("settings-form");
const statusNode = document.getElementById("status");
const addProviderButton = document.getElementById("addProviderButton");
const providerListNode = document.getElementById("providerList");
const codexLoginButton = document.getElementById("codexLoginButton");
const codexLogoutButton = document.getElementById("codexLogoutButton");
const codexAuthBadge = document.getElementById("codexAuthBadge");
const codexAuthDetails = document.getElementById("codexAuthDetails");

const fields = {
  answerMode: document.getElementById("answerMode"),
  routeAsk: document.getElementById("routeAsk"),
  routeExplain: document.getElementById("routeExplain"),
  routeSummarize: document.getElementById("routeSummarize"),
  routeTranslate: document.getElementById("routeTranslate")
};

const state = {
  settings: normalizeStoredSettings(DEFAULT_SETTINGS)
};

document.addEventListener("DOMContentLoaded", init);
form.addEventListener("submit", save);
addProviderButton.addEventListener("click", addProviderProfile);
codexLoginButton.addEventListener("click", startCodexOAuthLogin);
codexLogoutButton.addEventListener("click", logoutCodexOAuth);
providerListNode.addEventListener("click", handleProviderListClick);
providerListNode.addEventListener("change", handleProviderListChange);
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function init() {
  state.settings = await getSettings();
  renderAll();
  const authStatus = await getCodexAuthStatus();
  renderCodexAuthStatus(authStatus, state.settings);
}

function renderAll() {
  fields.answerMode.value = state.settings.answerMode;
  renderProviderList();
  renderActionRouteOptions();
}

function renderProviderList() {
  providerListNode.innerHTML = state.settings.providerProfiles
    .map((profile, index) => renderProviderCard(profile, index))
    .join("");
}

function renderProviderCard(profile, index) {
  const isCodex = profile.type === "codexOAuth";
  return `
    <article class="provider-card" data-provider-id="${escapeHtml(profile.id)}">
      <div class="provider-card-header">
        <h3>Provider ${index + 1}</h3>
        <button type="button" class="danger" data-remove-provider="${escapeHtml(profile.id)}">删除</button>
      </div>

      <label class="field">
        <span>名称</span>
        <input data-field="name" value="${escapeHtml(profile.name)}" />
      </label>

      <div class="field-grid">
        <label class="field">
          <span>类型</span>
          <select data-field="type">
            <option value="openaiCompatible"${profile.type === "openaiCompatible" ? " selected" : ""}>OpenAI 兼容接口</option>
            <option value="codexOAuth"${isCodex ? " selected" : ""}>Codex OAuth</option>
          </select>
        </label>

        <label class="field checkbox-field">
          <span>启用</span>
          <input data-field="enabled" type="checkbox"${profile.enabled ? " checked" : ""} />
        </label>
      </div>

      <label class="field">
        <span>API 地址</span>
        <input data-field="apiUrl" type="url" value="${escapeHtml(profile.apiUrl)}" />
      </label>

      <div class="field-grid">
        <label class="field">
          <span>模型</span>
          <input data-field="model" value="${escapeHtml(profile.model)}" />
        </label>

        <label class="field">
          <span>温度</span>
          <input data-field="temperature" type="number" min="0" max="2" step="0.1" value="${escapeHtml(String(profile.temperature))}" />
        </label>
      </div>

      ${isCodex ? `
        <p class="hint">
          这个 Provider 会复用上面的 Codex OAuth 登录状态，不需要单独填写 API Key。
        </p>
      ` : `
        <label class="field">
          <span>API Key</span>
          <input data-field="apiKey" type="password" value="${escapeHtml(profile.apiKey)}" />
        </label>
      `}

      <label class="field">
        <span>系统提示词</span>
        <textarea data-field="systemPrompt" rows="4">${escapeHtml(profile.systemPrompt)}</textarea>
      </label>
    </article>
  `;
}

function renderActionRouteOptions() {
  const enabledProfiles = state.settings.providerProfiles.filter((profile) => profile.enabled);
  renderRouteSelect(fields.routeAsk, state.settings.actionProviderMap.ask, enabledProfiles);
  renderRouteSelect(fields.routeExplain, state.settings.actionProviderMap.explain, enabledProfiles);
  renderRouteSelect(fields.routeSummarize, state.settings.actionProviderMap.summarize, enabledProfiles);
  renderRouteSelect(fields.routeTranslate, state.settings.actionProviderMap.translate, enabledProfiles);
}

function renderRouteSelect(selectNode, currentValue, profiles) {
  const options = profiles.length
    ? profiles
        .map((profile) => {
          const selected = profile.id === currentValue ? " selected" : "";
          return `<option value="${escapeHtml(profile.id)}"${selected}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model)}</option>`;
        })
        .join("")
    : '<option value="">请先添加并启用 Provider</option>';

  selectNode.innerHTML = options;
  selectNode.disabled = profiles.length === 0;
}

function addProviderProfile() {
  const nextIndex = state.settings.providerProfiles.length + 1;
  state.settings.providerProfiles.push({
    id: createProviderId(),
    name: `Provider ${nextIndex}`,
    type: "openaiCompatible",
    apiUrl: DEFAULT_SETTINGS.apiUrl,
    apiKey: "",
    model: DEFAULT_SETTINGS.model,
    temperature: DEFAULT_SETTINGS.temperature,
    systemPrompt: DEFAULT_SETTINGS.systemPrompt,
    enabled: true
  });
  renderAll();
}

function handleProviderListClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const providerId = target.dataset.removeProvider;
  if (!providerId) {
    return;
  }

  state.settings.providerProfiles = state.settings.providerProfiles.filter((profile) => profile.id !== providerId);
  state.settings = normalizeStoredSettings(state.settings);
  renderAll();
}

function handleProviderListChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.getAttribute("data-field") !== "type") {
    return;
  }

  collectFormIntoState();
  renderAll();
}

async function save(event) {
  event.preventDefault();
  collectFormIntoState();
  state.settings = normalizeStoredSettings(state.settings);

  await new Promise((resolve) => {
    chrome.storage.local.set(state.settings, resolve);
  });

  renderAll();
  statusNode.textContent = "已保存";
  window.setTimeout(() => {
    statusNode.textContent = "";
  }, 1800);
}

function collectFormIntoState() {
  state.settings.answerMode = fields.answerMode.value;
  state.settings.providerProfiles = Array.from(providerListNode.querySelectorAll(".provider-card"))
    .map((card, index) => {
      const profile = state.settings.providerProfiles[index];
      const type = card.querySelector('[data-field="type"]').value === "codexOAuth"
        ? "codexOAuth"
        : "openaiCompatible";

      return {
        id: profile?.id || createProviderId(),
        name: card.querySelector('[data-field="name"]').value.trim() || `Provider ${index + 1}`,
        type,
        apiUrl: card.querySelector('[data-field="apiUrl"]').value.trim(),
        apiKey: type === "codexOAuth"
          ? ""
          : card.querySelector('[data-field="apiKey"]').value.trim(),
        model: card.querySelector('[data-field="model"]').value.trim(),
        temperature: Number(card.querySelector('[data-field="temperature"]').value || DEFAULT_SETTINGS.temperature),
        systemPrompt: card.querySelector('[data-field="systemPrompt"]').value.trim(),
        enabled: card.querySelector('[data-field="enabled"]').checked
      };
    });

  state.settings.actionProviderMap = {
    ask: fields.routeAsk.value,
    explain: fields.routeExplain.value,
    summarize: fields.routeSummarize.value,
    translate: fields.routeTranslate.value
  };
}

async function startCodexOAuthLogin() {
  codexLoginButton.disabled = true;
  statusNode.textContent = "正在打开 Codex OAuth 登录页...";

  try {
    const result = await sendMessage({
      type: "START_CODEX_OAUTH"
    });
    renderCodexAuthStatus(result.status, await getSettings());
    statusNode.textContent = "请在新标签页完成 Codex 登录";
  } catch (error) {
    statusNode.textContent = toErrorMessage(error);
  } finally {
    window.setTimeout(() => {
      statusNode.textContent = "";
    }, 2400);
    codexLoginButton.disabled = false;
  }
}

async function logoutCodexOAuth() {
  codexLogoutButton.disabled = true;

  try {
    const result = await sendMessage({
      type: "LOGOUT_CODEX_OAUTH"
    });
    renderCodexAuthStatus(result.status, await getSettings());
    statusNode.textContent = "Codex OAuth 已退出";
  } catch (error) {
    statusNode.textContent = toErrorMessage(error);
  } finally {
    window.setTimeout(() => {
      statusNode.textContent = "";
    }, 2000);
    codexLogoutButton.disabled = false;
  }
}

function handleRuntimeMessage(message) {
  if (message?.type !== "CODEX_AUTH_UPDATED") {
    return;
  }

  void getSettings().then((settings) => {
    renderCodexAuthStatus(message.status, settings);
  });
}

function renderCodexAuthStatus(status, settings) {
  const phase = status?.phase || "signed_out";
  const error = status?.error || settings.codexAuthError || "";

  codexAuthBadge.dataset.phase = phase;

  if (phase === "pending") {
    codexAuthBadge.textContent = "登录中";
    codexAuthDetails.textContent = "已打开授权页，请完成登录并等待扩展自动接管回调。";
    codexLogoutButton.disabled = true;
    return;
  }

  if (phase === "authenticated") {
    codexAuthBadge.textContent = "已登录";
    const identity = settings.codexAccountName || settings.codexAccountEmail || "当前账号";
    const expiresText = formatExpiresAt(settings.codexExpiresAt);
    codexAuthDetails.textContent = expiresText
      ? `${identity}，令牌有效期至 ${expiresText}`
      : `${identity}，登录状态可用`;
    codexLogoutButton.disabled = false;
    return;
  }

  if (phase === "cancelled") {
    codexAuthBadge.textContent = "已取消";
    codexAuthDetails.textContent = "你关闭了登录标签页，本次 Codex OAuth 没有完成。";
    codexLogoutButton.disabled = true;
    return;
  }

  codexAuthBadge.textContent = error ? "登录异常" : "未登录";
  codexAuthDetails.textContent = error || "如果某个 provider 类型选的是 Codex OAuth，请先在这里完成登录。";
  codexLogoutButton.disabled = !settings.codexAccessToken && !settings.codexRefreshToken;
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      resolve(normalizeStoredSettings(items));
    });
  });
}

async function getCodexAuthStatus() {
  const result = await sendMessage({
    type: "GET_CODEX_AUTH_STATUS"
  });
  return result.status;
}

function normalizeStoredSettings(rawSettings) {
  const next = { ...DEFAULT_SETTINGS, ...rawSettings };
  const basePrompt = String(next.systemPrompt || DEFAULT_SETTINGS.systemPrompt).trim();
  const baseTemperature = Number(next.temperature ?? DEFAULT_SETTINGS.temperature);
  const legacyQwenId = "profile_legacy_qwen";
  const legacyCodexId = "profile_legacy_codex";

  let profiles = Array.isArray(next.providerProfiles)
    ? next.providerProfiles
        .map((profile, index) => normalizeProviderProfile(profile, index, basePrompt, baseTemperature))
        .filter(Boolean)
    : [];

  if (!profiles.length) {
    profiles = [
      normalizeProviderProfile({
        id: legacyQwenId,
        name: "Qwen Compatible",
        type: "openaiCompatible",
        apiUrl: next.apiUrl,
        apiKey: next.apiKey,
        model: next.model,
        temperature: baseTemperature,
        systemPrompt: basePrompt,
        enabled: true
      }, 0, basePrompt, baseTemperature),
      normalizeProviderProfile({
        id: legacyCodexId,
        name: "Codex OAuth",
        type: "codexOAuth",
        apiUrl: next.codexApiUrl,
        apiKey: "",
        model: next.codexModel,
        temperature: baseTemperature,
        systemPrompt: basePrompt,
        enabled: true
      }, 1, basePrompt, baseTemperature)
    ].filter(Boolean);
  }

  const fallbackProviderId = selectFallbackProviderId(profiles, next.authMode);
  const currentMap = next.actionProviderMap || {};

  return {
    ...next,
    answerMode: normalizeAnswerMode(next.answerMode),
    providerProfiles: profiles,
    actionProviderMap: {
      ask: normalizeActionProviderId(currentMap.ask, profiles, fallbackProviderId),
      explain: normalizeActionProviderId(currentMap.explain, profiles, fallbackProviderId),
      summarize: normalizeActionProviderId(currentMap.summarize, profiles, fallbackProviderId),
      translate: normalizeActionProviderId(currentMap.translate, profiles, fallbackProviderId)
    }
  };
}

function normalizeProviderProfile(profile, index, basePrompt, baseTemperature) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const type = profile.type === "codexOAuth" ? "codexOAuth" : "openaiCompatible";
  return {
    id: String(profile.id || `profile_${index + 1}`).trim(),
    name: String(profile.name || `Provider ${index + 1}`).trim(),
    type,
    apiUrl: String(
      profile.apiUrl ||
      (type === "codexOAuth" ? DEFAULT_SETTINGS.codexApiUrl : DEFAULT_SETTINGS.apiUrl)
    ).trim(),
    apiKey: type === "codexOAuth" ? "" : String(profile.apiKey || "").trim(),
    model: String(
      profile.model ||
      (type === "codexOAuth" ? DEFAULT_SETTINGS.codexModel : DEFAULT_SETTINGS.model)
    ).trim(),
    temperature: Number(profile.temperature ?? baseTemperature),
    systemPrompt: String(profile.systemPrompt || basePrompt).trim(),
    enabled: profile.enabled !== false
  };
}

function normalizeActionProviderId(providerId, profiles, fallbackProviderId) {
  const value = String(providerId || "").trim();
  if (profiles.some((profile) => profile.id === value && profile.enabled !== false)) {
    return value;
  }

  return fallbackProviderId;
}

function selectFallbackProviderId(profiles, authMode) {
  const enabledProfiles = profiles.filter((profile) => profile.enabled !== false);
  if (!enabledProfiles.length) {
    return "";
  }

  if (authMode === "codexOAuth") {
    const codexProfile = enabledProfiles.find((profile) => profile.type === "codexOAuth");
    if (codexProfile) {
      return codexProfile.id;
    }
  }

  const openAiProfile = enabledProfiles.find((profile) => profile.type === "openaiCompatible");
  return (openAiProfile || enabledProfiles[0]).id;
}

function normalizeAnswerMode(answerMode) {
  if (answerMode === "strict" || answerMode === "general") {
    return answerMode;
  }

  return "balanced";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "请求失败"));
        return;
      }

      resolve(response);
    });
  });
}

function createProviderId() {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatExpiresAt(value) {
  const expiresAt = Number(value || 0);
  if (!expiresAt) {
    return "";
  }

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "操作失败";
}
