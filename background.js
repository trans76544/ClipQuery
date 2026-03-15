const DEFAULT_SETTINGS = {
  authMode: "apiKey",
  answerMode: "balanced",
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
  codexIdToken: "",
  codexApiKey: "",
  codexAccountId: "",
  codexTokenType: "Bearer",
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

const CODEX_OAUTH_CONFIG = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri: "http://localhost:1455/auth/callback",
  scope: "openid profile email offline_access"
};

const PENDING_CODEX_AUTH_KEY = "__codexOAuthPending";
const sidePanelSessions = new Map();
let currentSidePanelTabId = null;
let pendingCodexAuthCache = null;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getSettings();
  await saveSettings(current);
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_NATIVE_SIDEPANEL") {
    handleOpenNativeSidePanel(message, sender, sendResponse);
    return true;
  }

  if (message?.type === "GET_SIDE_PANEL_SESSION") {
    void handleGetSidePanelSession(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "SAVE_SIDE_PANEL_SESSION") {
    void handleSaveSidePanelSession(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "SAVE_FAVORITE_TO_FILE") {
    void handleSaveFavoriteToFile(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "START_CODEX_OAUTH") {
    void startCodexOAuth()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "LOGOUT_CODEX_OAUTH") {
    void logoutCodexOAuth()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "GET_CODEX_AUTH_STATUS") {
    void getCodexAuthStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "selection-qa-stream") {
    return;
  }

  const controllers = new Map();

  port.onMessage.addListener(async (message) => {
    if (message?.type === "ASK_LLM") {
      const controller = new AbortController();
      controllers.set(message.requestId, controller);

      try {
        await askLLMStream(message, port, controller.signal);
      } catch (error) {
        port.postMessage({
          type: "ASK_LLM_ERROR",
          requestId: message.requestId,
          error: toErrorMessage(error)
        });
      } finally {
        controllers.delete(message.requestId);
      }
      return;
    }

    if (message?.type === "CANCEL_LLM" && message.requestId) {
      const controller = controllers.get(message.requestId);
      if (controller) {
        controller.abort();
        controllers.delete(message.requestId);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const possibleUrl = changeInfo.url || tab?.url || "";
  if (!possibleUrl.startsWith(CODEX_OAUTH_CONFIG.redirectUri)) {
    return;
  }

  void handleCodexOAuthRedirect(tabId, possibleUrl);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleCodexAuthTabRemoved(tabId);
});

async function askLLMStream(message, port, signal) {
  let settings = await getSettings();
  const resolution = resolveProviderForMessage(settings, message);
  const provider = resolution.provider;
  validateProviderSettings(provider);

  if (provider.type === "codexOAuth") {
    settings = await ensureCodexAuthReady(settings);
    await askCodexStream(message, provider, settings, port, signal);
    return;
  }

  await askOpenAICompatibleStream(message, provider, settings.answerMode, port, signal);
}

async function askOpenAICompatibleStream(message, provider, answerMode, port, signal) {
  const payload = {
    model: provider.model,
    temperature: Number(provider.temperature ?? DEFAULT_SETTINGS.temperature),
    stream: true,
    messages: buildMessages(provider.systemPrompt, message, answerMode)
  };

  port.postMessage({
    type: "ASK_LLM_STARTED",
    requestId: message.requestId
  });

  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    throw await buildHttpError(response);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    const answer = extractAnswer(data);
    if (!answer) {
      throw new Error("The API returned no answer content.");
    }

    emitAnswer(port, message.requestId, answer);
    return;
  }

  if (!response.body) {
    const data = await response.json().catch(() => ({}));
    const answer = extractAnswer(data);
    if (!answer) {
      throw new Error("The API returned no answer content.");
    }

    emitAnswer(port, message.requestId, answer);
    return;
  }

  let hasContent = false;
  await forEachSseData(response, (dataText) => {
    if (dataText === "[DONE]") {
      return;
    }

    let data;
    try {
      data = JSON.parse(dataText);
    } catch (_error) {
      return;
    }

    const delta = extractChatCompletionDelta(data);
    if (!delta) {
      return;
    }

    hasContent = true;
    port.postMessage({
      type: "ASK_LLM_DELTA",
      requestId: message.requestId,
      delta
    });
  });

  if (!hasContent) {
    throw new Error("The API returned no answer content.");
  }

  port.postMessage({
    type: "ASK_LLM_DONE",
    requestId: message.requestId
  });
}

async function askCodexStream(message, provider, settings, port, signal) {
  const effectiveModel = normalizeCodexModel(provider.model);
  const accessPayload = parseJwtPayload(settings.codexAccessToken);
  const chatgptAccountId =
    settings.codexAccountId ||
    accessPayload?.account_id ||
    accessPayload?.chatgpt_account_id ||
    accessPayload?.["https://api.openai.com/auth"]?.account_id ||
    "";
  const instructions = buildCodexSystemPrompt(
    provider.systemPrompt,
    String(message?.contextText || message?.selectedText || "").trim(),
    settings.answerMode
  );
  const payload = {
    model: effectiveModel,
    stream: true,
    store: false,
    instructions: instructions || DEFAULT_SETTINGS.systemPrompt,
    input: buildCodexResponseInput(provider.systemPrompt, message)
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.codexAccessToken}`
  };

  if (chatgptAccountId) {
    headers["chatgpt-account-id"] = chatgptAccountId;
  }

  port.postMessage({
    type: "ASK_LLM_STARTED",
    requestId: message.requestId
  });

  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    throw await buildHttpError(response);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    const answer = extractAnswer(data);
    if (!answer) {
      throw new Error("The Codex OAuth API returned no answer content.");
    }

    emitAnswer(port, message.requestId, answer);
    return;
  }

  if (!response.body) {
    throw new Error("The Codex OAuth API did not return a readable response body.");
  }

  let hasContent = false;
  await forEachSseData(response, (dataText) => {
    if (dataText === "[DONE]") {
      return;
    }

    let data;
    try {
      data = JSON.parse(dataText);
    } catch (_error) {
      return;
    }

    if (data?.type === "error") {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        "The Codex OAuth API returned an error event.";
      throw new Error(errorMessage);
    }

    const delta = extractCodexDelta(data);
    if (delta) {
      hasContent = true;
      port.postMessage({
        type: "ASK_LLM_DELTA",
        requestId: message.requestId,
        delta
      });
      return;
    }

    if (data?.type === "response.completed") {
      const answer = extractAnswer(data?.response || data);
      if (answer && !hasContent) {
        hasContent = true;
        port.postMessage({
          type: "ASK_LLM_DELTA",
          requestId: message.requestId,
          delta: answer
        });
      }
    }
  });

  if (!hasContent) {
    throw new Error("The Codex OAuth API returned no answer content.");
  }

  port.postMessage({
    type: "ASK_LLM_DONE",
    requestId: message.requestId
  });
}

function buildMessages(systemPrompt, message, answerMode = DEFAULT_SETTINGS.answerMode) {
  const contextText = (message?.contextText || message?.selectedText || "").trim();
  const conversation = normalizeConversation(message?.conversation);
  const combinedSystemPrompt = buildContextAwarePrompt(systemPrompt, contextText, answerMode);

  if (conversation.length > 0) {
    return [
      {
        role: "system",
        content: combinedSystemPrompt
      },
      ...conversation
    ];
  }

  return [
    {
      role: "system",
      content: combinedSystemPrompt
    },
    {
      role: "user",
      content: message?.question || "Please explain this text."
    }
  ];
}

function buildCodexInput(systemPrompt, message) {
  const conversation = normalizeConversation(message?.conversation);
  const contextText = String(message?.contextText || message?.selectedText || "").trim();
  const question = String(message?.question || "").trim() || "Please explain this text.";
  const systemContent = buildCodexSystemPrompt(systemPrompt, contextText);
  const input = [];

  if (systemContent) {
    input.push({
      role: "system",
      content: systemContent
    });
  }

  if (conversation.length > 0) {
    for (const item of conversation) {
      input.push({
        role: item.role,
        content: item.content
      });
    }
    return input;
  }

  input.push({
    role: "user",
    content: question
  });
  return input;
}

function buildCodexResponseInput(systemPrompt, message) {
  const conversation = normalizeConversation(message?.conversation);
  const contextText = String(message?.contextText || message?.selectedText || "").trim();
  const promptPrelude = buildCodexPromptPrelude(systemPrompt, contextText);
  const items = [];

  if (promptPrelude) {
    items.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text: promptPrelude
        }
      ]
    });
  }

  if (conversation.length > 0) {
    return [
      ...items,
      ...conversation.map((item) => ({
        role: item.role,
        content: item.content
      }))
    ];
  }

  const question = String(message?.question || "").trim() || "Please explain this text.";
  items.push({
    role: "user",
    content: question
  });
  return items;
}

function buildCodexSystemPrompt(systemPrompt, contextText, answerMode = DEFAULT_SETTINGS.answerMode) {
  return buildContextAwarePrompt(systemPrompt, contextText, answerMode);
}

function buildCodexPromptPrelude(systemPrompt, contextText) {
  const parts = [];
  if (systemPrompt) {
    parts.push(
      "Behavior guidance for this conversation:",
      systemPrompt.trim()
    );
  }

  if (contextText) {
    parts.push(
      "Selected webpage context:",
      contextText,
      "Treat the selected webpage text as stable context for the whole conversation."
    );
  }

  return parts.join("\n\n").trim();
}

function buildContextAwarePrompt(systemPrompt, contextText, answerMode = DEFAULT_SETTINGS.answerMode) {
  const policy = getAnswerModePolicy(answerMode);

  const promptParts = [String(systemPrompt || "").trim(), "", policy];
  if (contextText) {
    promptParts.push(
      "",
      "Selected webpage context:",
      contextText,
      "",
      "Treat the selected webpage text as stable context for the whole conversation."
    );
  }

  return promptParts.join("\n").trim();
}

function getAnswerModePolicy(answerMode) {
  const mode = String(answerMode || DEFAULT_SETTINGS.answerMode).trim();
  if (mode === "strict") {
    return [
      "Answer in Chinese by default unless the user asks otherwise.",
      "Use the selected webpage text as the primary source of truth.",
      "If the selected webpage text does not contain enough information, clearly say what is missing instead of filling gaps from general knowledge.",
      "When the user explicitly asks about the selected page, stay faithful to the page content."
    ].join("\n");
  }

  if (mode === "general") {
    return [
      "Answer in Chinese by default unless the user asks otherwise.",
      "Use the selected webpage text as helpful context, but you may freely answer from general knowledge when the user asks a standalone question.",
      "When the selected text is brief, do not refuse just because the page content is sparse.",
      "If part of the answer comes from general knowledge rather than the page, mention that briefly."
    ].join("\n");
  }

  return [
    "Answer in Chinese by default unless the user asks otherwise.",
    "Use the selected webpage text as the primary context when it contains enough information.",
    "If the selected text is only a short title, keyword, or standalone question and the user is clearly asking for a general explanation or direct answer, you may answer from your own knowledge instead of refusing.",
    "When you supplement beyond the selected webpage text, say briefly that the answer is based on general knowledge rather than the selected page alone.",
    "Do not refuse just because the selected text is brief if the question itself is answerable.",
    "If the user explicitly asks to summarize or explain the selected page itself, then prioritize the page content and mention what is missing when needed."
  ].join("\n");
}

function normalizeConversation(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => {
          return (
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string" &&
            item.content.trim()
          );
        })
        .map((item) => ({
          role: item.role,
          content: item.content.trim()
        }))
    : [];
}

function extractChatCompletionDelta(data) {
  const content = data?.choices?.[0]?.delta?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text || item?.content || "")
      .join("");
  }

  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  return "";
}

function extractCodexDelta(data) {
  if (data?.type === "response.output_text.delta" && typeof data?.delta === "string") {
    return data.delta;
  }

  if (typeof data?.delta === "string" && typeof data?.type === "string" && data.type.endsWith(".delta")) {
    return data.delta;
  }

  if (typeof data?.item?.delta === "string") {
    return data.item.delta;
  }

  if (typeof data?.choices?.[0]?.delta?.content === "string") {
    return data.choices[0].delta.content;
  }

  return "";
}

function extractAnswer(data) {
  if (typeof data?.choices?.[0]?.message?.content === "string") {
    return data.choices[0].message.content.trim();
  }

  if (Array.isArray(data?.choices?.[0]?.message?.content)) {
    return data.choices[0].message.content
      .map((item) => item?.text || item?.content || "")
      .join("\n")
      .trim();
  }

  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  if (typeof data?.response?.output_text === "string") {
    return data.response.output_text.trim();
  }

  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item) => item?.content || [])
      .map((item) => item?.text || "")
      .join("\n")
      .trim();
  }

  if (Array.isArray(data?.response?.output)) {
    return data.response.output
      .flatMap((item) => item?.content || [])
      .map((item) => item?.text || item?.content || "")
      .join("\n")
      .trim();
  }

  return "";
}

function emitAnswer(port, requestId, answer) {
  port.postMessage({
    type: "ASK_LLM_DELTA",
    requestId,
    delta: answer
  });
  port.postMessage({
    type: "ASK_LLM_DONE",
    requestId
  });
}

async function forEachSseData(response, onData) {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"));

      for (const line of lines) {
        const dataText = line.slice(5).trim();
        if (!dataText) {
          continue;
        }

        onData(dataText);
      }
    }
  }
}

async function buildHttpError(response) {
  const text = await response.text().catch(() => "");
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = {};
    }
  }
  const message =
    data?.error?.message ||
    data?.message ||
    text ||
    `HTTP ${response.status} ${response.statusText}`;
  return new Error(message);
}

function validateProviderSettings(provider) {
  if (!provider) {
    throw new Error("Please configure at least one provider profile in the extension options.");
  }

  if (!provider.apiUrl) {
    throw new Error(`Please configure the API URL for provider "${provider.name}".`);
  }

  if (!provider.model) {
    throw new Error(`Please configure the model name for provider "${provider.name}".`);
  }

  if (provider.type === "codexOAuth") {
    return;
  }

  if (!provider.apiKey) {
    throw new Error(`Please configure the API key for provider "${provider.name}".`);
  }
}

function normalizeCodexModel(modelName) {
  const value = String(modelName || "").trim();
  if (!value) {
    return "gpt-5.2";
  }

  return value;
}

function resolveProviderForMessage(settings, message) {
  const profiles = Array.isArray(settings.providerProfiles) ? settings.providerProfiles : [];
  const enabledProfiles = profiles.filter((profile) => profile?.enabled !== false);
  if (!enabledProfiles.length) {
    throw new Error("Please configure at least one enabled provider profile in the extension options.");
  }

  const actionType = normalizeActionType(message?.actionType);
  const requestedProviderId = String(message?.providerId || "").trim();
  const mappedProviderId = String(settings.actionProviderMap?.[actionType] || "").trim();
  const selectedId = requestedProviderId || mappedProviderId;

  const provider =
    enabledProfiles.find((item) => item.id === selectedId) ||
    enabledProfiles[0];

  return {
    actionType,
    provider
  };
}

function normalizeActionType(actionType) {
  if (actionType === "explain" || actionType === "summarize" || actionType === "translate") {
    return actionType;
  }

  return "ask";
}

async function ensureCodexAuthReady(settings) {
  const expiresAt = Number(settings.codexExpiresAt || 0);
  const refreshBufferMs = 60 * 1000;
  if (settings.codexAccessToken && expiresAt > Date.now() + refreshBufferMs) {
    return settings;
  }

  if (!settings.codexRefreshToken) {
    throw new Error("Codex OAuth has expired. Please sign in again in the extension options.");
  }

  const tokenData = await requestCodexToken({
    grant_type: "refresh_token",
    refresh_token: settings.codexRefreshToken,
    client_id: CODEX_OAUTH_CONFIG.clientId
  });
  const nextSettings = mergeCodexTokenIntoSettings(settings, tokenData);
  await saveSettings(nextSettings);
  await broadcastCodexAuthState();
  return nextSettings;
}

async function startCodexOAuth() {
  const codeVerifier = createRandomString(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const state = createRandomString(48);
  const authorizeUrl = new URL(CODEX_OAUTH_CONFIG.authorizeUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", CODEX_OAUTH_CONFIG.clientId);
  authorizeUrl.searchParams.set("redirect_uri", CODEX_OAUTH_CONFIG.redirectUri);
  authorizeUrl.searchParams.set("scope", CODEX_OAUTH_CONFIG.scope);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("id_token_add_organizations", "true");
  authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authorizeUrl.searchParams.set("originator", "selection_qa_helper");
  authorizeUrl.searchParams.set("state", state);

  const authTab = await createTab({
    url: authorizeUrl.toString(),
    active: true
  });

  const pending = {
    state,
    codeVerifier,
    tabId: authTab.id,
    startedAt: Date.now()
  };

  await clearCodexAuthError();
  await setPendingCodexAuth(pending);
  await broadcastCodexAuthState();
  return getCodexAuthStatus();
}

async function logoutCodexOAuth() {
  const settings = await getSettings();
  const nextSettings = {
    ...settings,
    codexAccessToken: "",
    codexRefreshToken: "",
    codexIdToken: "",
    codexApiKey: "",
    codexAccountId: "",
    codexTokenType: "Bearer",
    codexExpiresAt: 0,
    codexAccountEmail: "",
    codexAccountName: "",
    codexLoginAt: "",
    codexAuthError: ""
  };
  await saveSettings(nextSettings);
  await clearPendingCodexAuth();
  await broadcastCodexAuthState();
  return getCodexAuthStatus(nextSettings);
}

async function handleCodexOAuthRedirect(tabId, redirectUrl) {
  const pending = await getPendingCodexAuth();
  if (!pending || pending.tabId !== tabId) {
    return;
  }

  const url = new URL(redirectUrl);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    await setCodexAuthError(`Codex OAuth login failed: ${error}.`);
    await clearPendingCodexAuth();
    await broadcastCodexAuthState();
    await redirectTabToOptions(tabId, "codex-oauth-error");
    return;
  }

  if (!code || !state) {
    return;
  }

  if (state !== pending.state) {
    await setCodexAuthError("Codex OAuth state mismatch. Please try signing in again.");
    await clearPendingCodexAuth();
    await broadcastCodexAuthState();
    await redirectTabToOptions(tabId, "codex-oauth-error");
    return;
  }

  try {
    const tokenData = await requestCodexToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: CODEX_OAUTH_CONFIG.redirectUri,
      client_id: CODEX_OAUTH_CONFIG.clientId,
      code_verifier: pending.codeVerifier
    });

    const settings = await getSettings();
    const nextSettings = mergeCodexTokenIntoSettings(settings, tokenData);
    nextSettings.authMode = "codexOAuth";
    nextSettings.codexAuthError = "";
    await saveSettings(nextSettings);
    await clearPendingCodexAuth();
    await broadcastCodexAuthState();
    await closeTab(tabId);
  } catch (error) {
    await setCodexAuthError(`Codex OAuth token exchange failed: ${toErrorMessage(error)}`);
    await clearPendingCodexAuth();
    await broadcastCodexAuthState();
    await redirectTabToOptions(tabId, "codex-oauth-error");
  }
}

async function handleCodexAuthTabRemoved(tabId) {
  const pending = await getPendingCodexAuth();
  if (!pending || pending.tabId !== tabId) {
    return;
  }

  await clearPendingCodexAuth();
  await broadcastCodexAuthState({
    phase: "cancelled",
    authenticated: false,
    authMode: "codexOAuth",
    accountName: "",
    accountEmail: "",
    expiresAt: 0,
    loginAt: "",
    error: ""
  });
}

async function requestCodexToken(params) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) {
      body.set(key, value);
    }
  }

  const response = await fetch(CODEX_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw await buildHttpError(response);
  }

  return response.json();
}

function mergeCodexTokenIntoSettings(settings, tokenData) {
  const profile = parseIdTokenProfile(tokenData?.id_token);
  const parsedAccessPayload = parseJwtPayload(tokenData?.access_token);
  const expiresInSeconds = Number(tokenData?.expires_in || 0);
  return {
    ...settings,
    codexAccessToken: String(tokenData?.access_token || settings.codexAccessToken || "").trim(),
    codexRefreshToken: String(tokenData?.refresh_token || settings.codexRefreshToken || "").trim(),
    codexIdToken: String(tokenData?.id_token || settings.codexIdToken || "").trim(),
    codexApiKey: String(tokenData?.api_key || settings.codexApiKey || "").trim(),
    codexAccountId: String(
      tokenData?.account_id ||
      parsedAccessPayload?.account_id ||
      parsedAccessPayload?.chatgpt_account_id ||
      parsedAccessPayload?.["https://api.openai.com/auth"]?.account_id ||
      settings.codexAccountId ||
      ""
    ).trim(),
    codexTokenType: String(tokenData?.token_type || settings.codexTokenType || "Bearer").trim(),
    codexExpiresAt: expiresInSeconds > 0
      ? Date.now() + expiresInSeconds * 1000
      : Number(settings.codexExpiresAt || 0),
    codexAccountEmail: profile.email || settings.codexAccountEmail || "",
    codexAccountName: profile.name || settings.codexAccountName || "",
    codexLoginAt: new Date().toISOString(),
    codexAuthError: ""
  };
}

function parseIdTokenProfile(idToken) {
  if (typeof idToken !== "string" || !idToken.includes(".")) {
    return { email: "", name: "" };
  }

  const parts = idToken.split(".");
  if (parts.length < 2) {
    return { email: "", name: "" };
  }

  try {
    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized));
    return {
      email: typeof payload?.email === "string" ? payload.email : "",
      name: typeof payload?.name === "string" ? payload.name : ""
    };
  } catch (_error) {
    return { email: "", name: "" };
  }
}

function parseJwtPayload(tokenValue) {
  if (typeof tokenValue !== "string" || !tokenValue.includes(".")) {
    return null;
  }

  const parts = tokenValue.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch (_error) {
    return null;
  }
}

function createRandomString(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64UrlEncode(bytes).slice(0, length);
}

async function createCodeChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getCodexAuthStatus(settingsOverride) {
  const settings = settingsOverride || await getSettings();
  const pending = await getPendingCodexAuth();
  const authenticated = Boolean(settings.codexAccessToken || settings.codexRefreshToken);
  const phase = pending
    ? "pending"
    : authenticated
      ? "authenticated"
      : "signed_out";

  return {
    phase,
    authenticated,
    authMode: settings.authMode,
    accountName: settings.codexAccountName || "",
    accountEmail: settings.codexAccountEmail || "",
    expiresAt: Number(settings.codexExpiresAt || 0),
    loginAt: settings.codexLoginAt || "",
    error: settings.codexAuthError || "",
    pendingTabId: pending?.tabId ?? null
  };
}

async function broadcastCodexAuthState(override) {
  const status = override || await getCodexAuthStatus();
  chrome.runtime.sendMessage(
    {
      type: "CODEX_AUTH_UPDATED",
      status
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

async function getPendingCodexAuth() {
  if (pendingCodexAuthCache) {
    return pendingCodexAuthCache;
  }

  const pending = await getStoredPendingCodexAuth();
  pendingCodexAuthCache = pending;
  return pending;
}

async function setPendingCodexAuth(pending) {
  pendingCodexAuthCache = pending;
  await storageSet({
    [PENDING_CODEX_AUTH_KEY]: pending
  });
}

async function clearPendingCodexAuth() {
  pendingCodexAuthCache = null;
  await storageRemove(PENDING_CODEX_AUTH_KEY);
}

async function getStoredPendingCodexAuth() {
  const items = await storageGet({
    [PENDING_CODEX_AUTH_KEY]: null
  });
  return items[PENDING_CODEX_AUTH_KEY] || null;
}

async function clearCodexAuthError() {
  const settings = await getSettings();
  if (!settings.codexAuthError) {
    return;
  }

  await saveSettings({
    ...settings,
    codexAuthError: ""
  });
}

async function setCodexAuthError(message) {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    codexAuthError: message
  });
}

async function redirectTabToOptions(tabId, hash) {
  try {
    await updateTab(tabId, {
      url: `${chrome.runtime.getURL("options.html")}#${hash}`
    });
  } catch (_error) {
    await closeTab(tabId);
  }
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Request cancelled.";
    }

    return error.message;
  }

  return "Request failed.";
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

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, async (items) => {
      const normalized = normalizeStoredSettings(items);
      const changed = JSON.stringify(normalized) !== JSON.stringify(items);
      if (changed) {
        await saveSettings(normalized);
      }
      resolve(normalized);
    });
  });
}

function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, () => resolve());
  });
}

function storageGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (items) => resolve(items));
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tab);
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tab);
    });
  });
}

function closeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function handleOpenNativeSidePanel(message, sender, sendResponse) {
  if (!chrome.sidePanel?.open) {
    sendResponse({
      ok: false,
      error: "This browser does not support the Side Panel API."
    });
    return;
  }

  const tabId = sender?.tab?.id ?? message?.tabId;
  if (typeof tabId !== "number") {
    sendResponse({
      ok: false,
      error: "Unable to determine the active tab for the side panel."
    });
    return;
  }

  const session = normalizeSidePanelSession(message);
  sidePanelSessions.set(tabId, session);
  currentSidePanelTabId = tabId;

  chrome.sidePanel
    .open({ tabId })
    .then(() => {
      void ensureSidePanelOptions(tabId);
      broadcastSidePanelSession(tabId, session);
      sendResponse({ ok: true });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: toErrorMessage(error)
      });
    });
}

async function handleGetSidePanelSession(message) {
  const tabId = message?.tabId ?? currentSidePanelTabId ?? await getActiveTabId();
  if (typeof tabId !== "number") {
    return {
      tabId: null,
      session: normalizeSidePanelSession({})
    };
  }

  return {
    tabId,
    session: sidePanelSessions.get(tabId) || normalizeSidePanelSession({})
  };
}

async function handleSaveSidePanelSession(message) {
  const tabId = message?.tabId ?? currentSidePanelTabId ?? await getActiveTabId();
  if (typeof tabId !== "number") {
    throw new Error("Unable to determine which side panel session to save.");
  }

  const session = normalizeSidePanelSession(message);
  sidePanelSessions.set(tabId, session);
  currentSidePanelTabId = tabId;
  broadcastSidePanelSession(tabId, session);
}

function normalizeSidePanelSession(message) {
  const contextText = typeof message?.contextText === "string"
    ? message.contextText.trim()
    : "";
  const pageTitle = typeof message?.pageTitle === "string"
    ? message.pageTitle.trim()
    : "";
  const pageUrl = typeof message?.pageUrl === "string"
    ? message.pageUrl.trim()
    : "";
  const conversation = normalizeConversation(message?.conversation);
  const actionType = normalizeActionType(message?.actionType);

  return {
    contextText,
    pageTitle,
    pageUrl,
    conversation,
    actionType
  };
}

async function ensureSidePanelOptions(tabId) {
  if (!chrome.sidePanel?.setOptions) {
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel.html",
    enabled: true
  });
}

function broadcastSidePanelSession(tabId, session) {
  chrome.runtime.sendMessage(
    {
      type: "SIDE_PANEL_SESSION_UPDATED",
      tabId,
      session
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
}

async function handleSaveFavoriteToFile(message) {
  if (!chrome.downloads?.download) {
    throw new Error("This browser does not support the Downloads API.");
  }

  const question = String(message?.question || "").trim();
  const answer = String(message?.answer || "").trim();

  if (!question) {
    throw new Error("No question found to save.");
  }

  if (!answer) {
    throw new Error("No answer found to save.");
  }

  const markdown = buildFavoriteMarkdown(message);
  const filename = buildFavoriteFilename(message?.question);
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });

  return {
    downloadId,
    filename
  };
}

function buildFavoriteMarkdown(message) {
  const savedAt = formatTimestamp(message?.savedAt);
  const pageTitle = String(message?.pageTitle || "").trim();
  const pageUrl = String(message?.pageUrl || "").trim();
  const contextText = String(message?.contextText || "").trim();
  const question = String(message?.question || "").trim();
  const answer = String(message?.answer || "").trim();

  const sections = [
    "# Selection QA Favorite",
    "",
    `- Saved at: ${savedAt}`
  ];

  if (pageTitle) {
    sections.push(`- Page title: ${pageTitle}`);
  }

  if (pageUrl) {
    sections.push(`- Page URL: ${pageUrl}`);
  }

  if (contextText) {
    sections.push("", "## Context", "", contextText);
  }

  sections.push("", "## Question", "", question, "", "## Answer", "", answer, "");
  return sections.join("\n");
}

function buildFavoriteFilename(questionText) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const slug = String(questionText || "favorite")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "favorite";

  return `Selection-QA-Favorites/${timestamp}_${slug}.md`;
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}
