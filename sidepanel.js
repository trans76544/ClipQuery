let port = null;
const state = {
  tabId: null,
  contextText: "",
  pageTitle: "",
  pageUrl: "",
  conversation: [],
  actionType: "ask",
  activeRequestId: null,
  requestCounter: 0,
  pendingAssistantText: ""
};

const chatNode = document.getElementById("sp-chat");
const statusNode = document.getElementById("sp-status");
const inputNode = document.getElementById("sp-input");
const sendButton = document.getElementById("sp-send");
const refreshButton = document.getElementById("sp-refresh");
const clearButton = document.getElementById("sp-clear");

connectStreamPort();
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

document.addEventListener("DOMContentLoaded", () => {
  void loadSession();
});

window.addEventListener("focus", () => {
  void loadSession();
});

sendButton.addEventListener("click", () => {
  submitQuestion();
});
chatNode.addEventListener("click", handleChatClick);

refreshButton.addEventListener("click", () => {
  void loadSession();
});

clearButton.addEventListener("click", () => {
  clearConversation();
});

inputNode.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    submitQuestion();
  }
});

async function loadSession() {
  const response = await chrome.runtime.sendMessage({
    type: "GET_SIDE_PANEL_SESSION"
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Failed to load side panel session."
  }));

  if (!response?.ok) {
    statusNode.textContent = response?.error || "无法加载浏览器侧栏会话";
    return;
  }

  state.tabId = typeof response.tabId === "number" ? response.tabId : null;
  state.contextText = response.session?.contextText || "";
  state.pageTitle = response.session?.pageTitle || "";
  state.pageUrl = response.session?.pageUrl || "";
  state.actionType = normalizeActionType(response.session?.actionType);
  state.conversation = Array.isArray(response.session?.conversation)
    ? response.session.conversation
    : [];
  state.pendingAssistantText = "";
  statusNode.textContent = state.contextText ? "" : "请先在网页中选择文本并打开浏览器侧栏";
  renderConversation();
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  if (message?.type !== "SIDE_PANEL_SESSION_UPDATED") {
    return false;
  }

  if (typeof message.tabId === "number") {
    state.tabId = message.tabId;
  }

  state.contextText = message.session?.contextText || "";
  state.pageTitle = message.session?.pageTitle || "";
  state.pageUrl = message.session?.pageUrl || "";
  state.actionType = normalizeActionType(message.session?.actionType);
  state.conversation = Array.isArray(message.session?.conversation)
    ? message.session.conversation
    : [];
  state.pendingAssistantText = "";
  renderConversation();
  sendResponse?.({ ok: true });
  return true;
}

function connectStreamPort() {
  cleanupStreamPort();

  try {
    port = chrome.runtime.connect({ name: "selection-qa-stream" });
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(handlePortDisconnect);
  } catch (_error) {
    port = null;
  }
}

function cleanupStreamPort() {
  if (!port) {
    return;
  }

  try {
    port.onMessage.removeListener(handlePortMessage);
    port.onDisconnect.removeListener(handlePortDisconnect);
  } catch (_error) {
    // Ignore listener cleanup errors.
  }
}

function handlePortDisconnect() {
  cleanupStreamPort();
  port = null;

  if (state.activeRequestId) {
    state.activeRequestId = null;
    state.pendingAssistantText = "";
    sendButton.disabled = false;
    statusNode.textContent = "连接已断开，请重试";
    renderConversation();
  }
}

function ensureStreamPort() {
  if (!port) {
    connectStreamPort();
  }

  return port;
}

function postToStreamPort(message) {
  let currentPort = ensureStreamPort();
  if (!currentPort) {
    throw new Error("Streaming channel is unavailable.");
  }

  try {
    currentPort.postMessage(message);
    return;
  } catch (_error) {
    connectStreamPort();
    currentPort = ensureStreamPort();
    if (!currentPort) {
      throw new Error("Streaming channel is unavailable.");
    }
    currentPort.postMessage(message);
  }
}

function handlePortMessage(message) {
  if (!message?.requestId || message.requestId !== state.activeRequestId) {
    return;
  }

  if (message.type === "ASK_LLM_STARTED") {
    statusNode.textContent = "正在流式生成回答...";
    sendButton.disabled = true;
    return;
  }

  if (message.type === "ASK_LLM_DELTA") {
    state.pendingAssistantText += message.delta || "";
    renderConversation();
    statusNode.textContent = "正在流式生成回答...";
    sendButton.disabled = true;
    chatNode.scrollTop = chatNode.scrollHeight;
    return;
  }

  if (message.type === "ASK_LLM_DONE") {
    finalizePendingAssistantMessage();
    statusNode.textContent = "回答已生成";
    sendButton.disabled = false;
    state.activeRequestId = null;
    renderConversation();
    void persistSession();
    return;
  }

  if (message.type === "ASK_LLM_ERROR") {
    if (state.pendingAssistantText.trim()) {
      finalizePendingAssistantMessage();
      void persistSession();
    }
    statusNode.textContent =
      message.error === "Request cancelled."
        ? "已取消生成"
        : message.error || "Unknown error";
    sendButton.disabled = false;
    state.activeRequestId = null;
    renderConversation();
  }
}

function handleChatClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const favoriteButton = target.closest("[data-favorite-index]");
  if (!favoriteButton) {
    return;
  }

  const messageIndex = Number(favoriteButton.dataset.favoriteIndex);
  if (Number.isNaN(messageIndex)) {
    return;
  }

  void saveFavoriteForMessage(messageIndex);
}

function submitQuestion() {
  if (!state.contextText.trim()) {
    statusNode.textContent = "请先在网页中选择文本并打开浏览器侧栏";
    return;
  }

  const typedQuestion = inputNode.value.trim();
  const effectiveQuestion = buildEffectiveQuestion(typedQuestion);
  const requestId = `sp_req_${Date.now()}_${++state.requestCounter}`;

  cancelActiveRequest();
  state.conversation.push({
    role: "user",
    content: effectiveQuestion
  });
  state.pendingAssistantText = "";
  inputNode.value = "";
  renderConversation();
  void persistSession();

  state.activeRequestId = requestId;
  sendButton.disabled = true;
  statusNode.textContent = "正在连接模型...";

  try {
    postToStreamPort({
      type: "ASK_LLM",
      requestId,
      contextText: state.contextText,
      conversation: state.conversation,
      actionType: state.actionType
    });
  } catch (_error) {
    state.activeRequestId = null;
    sendButton.disabled = false;
    statusNode.textContent = "连接已断开，请重试";
  }
}

function buildEffectiveQuestion(typedQuestion) {
  if (typedQuestion) {
    return typedQuestion;
  }

  if (looksLikeQuestion(state.contextText)) {
    return state.contextText;
  }

  return "请回答上面的问题。";
}

function looksLikeQuestion(text) {
  const normalized = (text || "").trim();
  return /[?？]$/.test(normalized) || /^(what|why|how|when|where|who|which)\b/i.test(normalized);
}

function cancelActiveRequest() {
  if (!state.activeRequestId) {
    return;
  }

  try {
    postToStreamPort({
      type: "CANCEL_LLM",
      requestId: state.activeRequestId
    });
  } catch (_error) {
    // Ignore cancellation failures when the channel is already gone.
  }
  state.activeRequestId = null;
  state.pendingAssistantText = "";
  sendButton.disabled = false;
}

function finalizePendingAssistantMessage() {
  if (!state.pendingAssistantText.trim()) {
    state.pendingAssistantText = "";
    return;
  }

  state.conversation.push({
    role: "assistant",
    content: state.pendingAssistantText
  });
  state.pendingAssistantText = "";
}

function clearConversation() {
  cancelActiveRequest();
  state.conversation = [];
  state.pendingAssistantText = "";
  statusNode.textContent = state.contextText ? "会话已清空" : "";
  renderConversation();
  void persistSession();
}

function renderConversation() {
  const htmlParts = [];

  if (state.contextText) {
    htmlParts.push(`
      <div class="sp-context-card">
        <div class="sp-context-label">当前上下文</div>
        <div class="sp-context-text">${escapeHtml(state.contextText)}</div>
      </div>
    `);
  }

  for (let index = 0; index < state.conversation.length; index += 1) {
    const message = state.conversation[index];
    htmlParts.push(renderMessage(message.role, message.content, false, index));
  }

  if (state.pendingAssistantText) {
    htmlParts.push(renderMessage("assistant", state.pendingAssistantText, true, -1));
  }

  if (!htmlParts.length) {
    htmlParts.push('<div class="sp-empty">从网页中选择文本后点击“浏览器侧栏”，即可在这里进行多轮问答。</div>');
  }

  chatNode.innerHTML = htmlParts.join("");
  chatNode.scrollTop = chatNode.scrollHeight;
}

function renderMessage(role, content, isStreaming = false, messageIndex = -1) {
  if (role === "assistant") {
    return `
      <article class="sp-message sp-message-assistant${isStreaming ? " is-streaming" : ""}">
        <div class="sp-message-meta">
          <div class="sp-message-role">AI</div>
          ${isStreaming ? "" : `<button type="button" class="sp-favorite-button" data-favorite-index="${messageIndex}">收藏</button>`}
        </div>
        <div class="sp-message-body markdown-body">${markdownToHtml(content || "")}</div>
      </article>
    `;
  }

  return `
    <article class="sp-message sp-message-user">
      <div class="sp-message-role">你</div>
      <div class="sp-message-body">${escapeHtml(content || "")}</div>
    </article>
  `;
}

function persistSession() {
  return chrome.runtime.sendMessage({
    type: "SAVE_SIDE_PANEL_SESSION",
    tabId: state.tabId,
    contextText: state.contextText,
    pageTitle: state.pageTitle,
    pageUrl: state.pageUrl,
    conversation: state.conversation,
    actionType: state.actionType
  }).catch(() => undefined);
}

async function saveFavoriteForMessage(messageIndex) {
  const assistantMessage = state.conversation[messageIndex];
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    statusNode.textContent = "未找到可收藏的回答";
    return;
  }

  const question = findPreviousUserQuestion(messageIndex);
  if (!question) {
    statusNode.textContent = "未找到对应问题，无法收藏";
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_FAVORITE_TO_FILE",
    contextText: state.contextText,
    question,
    answer: assistantMessage.content,
    pageTitle: state.pageTitle,
    pageUrl: state.pageUrl,
    savedAt: new Date().toISOString()
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "Failed to save favorite."
  }));

  statusNode.textContent = response?.ok
    ? `已收藏到文件：${response.filename || "下载目录"}`
    : response?.error || "收藏失败";
}

function findPreviousUserQuestion(messageIndex) {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = state.conversation[index];
    if (message?.role === "user" && message.content) {
      return message.content;
    }
  }

  return "";
}

function markdownToHtml(markdownText) {
  const normalized = (markdownText || "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return "";
  }

  const codeBlocks = [];
  const mathBlocks = [];
  const textWithCode = normalized.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escapedCode = escapeHtml(code.trimEnd());
    const languageClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    const token = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code${languageClass}>${escapedCode}</code></pre>`);
    return token;
  });
  const text = textWithCode
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, expression) => {
      const token = `__MATH_BLOCK_${mathBlocks.length}__`;
      mathBlocks.push(renderMathBlock(expression));
      return token;
    })
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, expression) => {
      const token = `__MATH_BLOCK_${mathBlocks.length}__`;
      mathBlocks.push(renderMathBlock(expression));
      return token;
    });

  const lines = text.split("\n");
  const htmlBlocks = [];
  let paragraphLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmedLine = lines[index].trim();

    if (!trimmedLine) {
      flushParagraph();
      continue;
    }

    if (/^__(CODE|MATH)_BLOCK_\d+__$/.test(trimmedLine)) {
      flushParagraph();
      htmlBlocks.push(trimmedLine);
      continue;
    }

    if (/^(#{1,6})\s+/.test(trimmedLine)) {
      flushParagraph();
      const [, hashes] = trimmedLine.match(/^(#{1,6})\s+/) || [];
      const level = hashes.length;
      const content = trimmedLine.replace(/^#{1,6}\s+/, "");
      htmlBlocks.push(`<h${level}>${renderInlineMarkdown(content)}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(trimmedLine)) {
      flushParagraph();
      const quoteLines = [];

      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      index -= 1;
      htmlBlocks.push(
        `<blockquote>${quoteLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</blockquote>`
      );
      continue;
    }

    if (/^[-*+]\s+/.test(trimmedLine)) {
      flushParagraph();
      const list = collectList(lines, index, /^[-*+]\s+/, "ul");
      htmlBlocks.push(list.html);
      index = list.nextIndex - 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmedLine)) {
      flushParagraph();
      const list = collectList(lines, index, /^\d+\.\s+/, "ol");
      htmlBlocks.push(list.html);
      index = list.nextIndex - 1;
      continue;
    }

    paragraphLines.push(trimmedLine);
  }

  flushParagraph();

  let html = htmlBlocks.join("");
  html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => codeBlocks[Number(index)] || "");
  html = html.replace(/__MATH_BLOCK_(\d+)__/g, (_match, index) => mathBlocks[Number(index)] || "");
  return html;

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    htmlBlocks.push(`<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p>`);
    paragraphLines = [];
  }
}

function collectList(lines, startIndex, markerPattern, tagName) {
  const items = [];
  let currentItemLines = [];
  let index = startIndex;

  while (index < lines.length) {
    const trimmedLine = lines[index].trim();

    if (!trimmedLine) {
      break;
    }

    if (markerPattern.test(trimmedLine)) {
      if (currentItemLines.length) {
        items.push(currentItemLines);
      }
      currentItemLines = [trimmedLine.replace(markerPattern, "")];
      index += 1;
      continue;
    }

    if (startsNewBlock(trimmedLine)) {
      break;
    }

    if (currentItemLines.length) {
      currentItemLines.push(trimmedLine);
      index += 1;
      continue;
    }

    break;
  }

  if (currentItemLines.length) {
    items.push(currentItemLines);
  }

  return {
    html: `<${tagName}>${items
      .map((itemLines) => `<li>${itemLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</li>`)
      .join("")}</${tagName}>`,
    nextIndex: index
  };
}

function startsNewBlock(trimmedLine) {
  return (
    /^__(CODE|MATH)_BLOCK_\d+__$/.test(trimmedLine) ||
    /^(#{1,6})\s+/.test(trimmedLine) ||
    /^>\s?/.test(trimmedLine) ||
    /^[-*+]\s+/.test(trimmedLine) ||
    /^\d+\.\s+/.test(trimmedLine)
  );
}

function renderInlineMarkdown(text) {
  const inlineMathTokens = [];
  const textWithMath = (text || "")
    .replace(/\\\((.+?)\\\)/g, (_match, expression) => {
      const token = `__INLINE_MATH_${inlineMathTokens.length}__`;
      inlineMathTokens.push(renderMathInline(expression));
      return token;
    })
    .replace(/\$([^$\n]+?)\$/g, (_match, expression) => {
      const token = `__INLINE_MATH_${inlineMathTokens.length}__`;
      inlineMathTokens.push(renderMathInline(expression));
      return token;
    });

  let html = escapeHtml(textWithMath);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/__INLINE_MATH_(\d+)__/g, (_match, index) => inlineMathTokens[Number(index)] || "");
  return html;
}

function renderMathBlock(expression) {
  return `<div class="sp-math-block">${renderMath(expression, true)}</div>`;
}

function renderMathInline(expression) {
  return `<span class="sp-math-inline">${renderMath(expression, false)}</span>`;
}

function renderMath(expression, displayMode) {
  const source = String(expression || "").trim();
  if (!source) {
    return "";
  }

  if (typeof katex !== "undefined" && typeof katex.renderToString === "function") {
    try {
      return katex.renderToString(source, {
        throwOnError: false,
        displayMode
      });
    } catch (_error) {
      return `<code>${escapeHtml(source)}</code>`;
    }
  }

  return `<code>${escapeHtml(source)}</code>`;
}

function escapeHtml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeActionType(actionType) {
  if (actionType === "explain" || actionType === "summarize" || actionType === "translate") {
    return actionType;
  }

  return "ask";
}
