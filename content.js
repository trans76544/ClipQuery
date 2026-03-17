(function initSelectionQaHelper() {
  const PANEL_WIDTH = 380;
  const PANEL_MARGIN = 12;
  const PANEL_POSITION_KEY = "floatingPanelPosition";
  const PINNED_PAGES_KEY = "pinnedSelectionQaPages";
  const DISPLAY_MODE_KEY = "selectionQaDisplayMode";
  const ICONS = {
    explain:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.8 9.2a2.3 2.3 0 1 1 4.3 1.2c-.7 1-1.6 1.4-2 2.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1" fill="currentColor"/></svg>',
    translate:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M8.5 4v2m0 0c0 4-1.8 7.2-4.5 9.5M6.3 12.8c1.2 1.4 2.6 2.5 4.2 3.3M14 18l3.2-8L20.5 18M15.2 15.2h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    summarize:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    ask:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    layout:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 5v14" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    native:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 5v14M17 8.5l-2 2 2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pin:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l-1.5 5 2.5 2.5v1H7v-1L9.5 9 8 4zM12 12.5V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const QUICK_ACTIONS = {
    explain: "请用中文解释这段内容，并指出关键概念。",
    translate: "请将这段内容翻译成中文，保留原意并尽量自然。",
    summarize: "请用中文总结这段内容，提炼 3 个要点。"
  };

  const state = {
    selectedText: "",
    currentContextText: "",
    conversation: [],
    actionBarVisible: false,
    panelVisible: false,
    anchorRect: null,
    panelPosition: null,
    savedPanelPosition: null,
    pinnedPages: {},
    isPinnedForPage: false,
    displayMode: "floating",
    currentActionType: "ask",
    isDragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    requestCounter: 0,
    activeRequestId: null,
    pendingAssistantText: ""
  };

  let port = null;
  const root = document.createElement("div");
  root.id = "selection-qa-helper-root";
  document.documentElement.appendChild(root);

  const actionBar = document.createElement("div");
  actionBar.id = "selection-qa-helper-actions";
  actionBar.hidden = true;
  actionBar.innerHTML = `
    <button type="button" data-action="explain" class="sqh-icon-button" aria-label="解释" title="解释">${ICONS.explain}</button>
    <button type="button" data-action="translate" class="sqh-icon-button" aria-label="翻译" title="翻译">${ICONS.translate}</button>
    <button type="button" data-action="summarize" class="sqh-icon-button" aria-label="总结" title="总结">${ICONS.summarize}</button>
    <button type="button" data-action="ask" class="sqh-icon-button is-primary" aria-label="提问" title="提问">${ICONS.ask}</button>
    <button type="button" data-action="toggle-layout" class="sqh-icon-button sqh-layout-button" aria-label="切换网页内浮窗或侧栏" title="切换网页内浮窗或侧栏">${ICONS.layout}</button>
    <button type="button" data-action="open-native-sidepanel" class="sqh-icon-button sqh-native-button" aria-label="打开浏览器侧栏" title="打开浏览器侧栏">${ICONS.native}</button>
    <button type="button" data-action="toggle-pin" class="sqh-icon-button sqh-pin-button" aria-label="固定当前页面" title="固定当前页面">${ICONS.pin}</button>
  `;

  const panel = document.createElement("section");
  panel.id = "selection-qa-helper-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sqh-header" id="sqh-drag-handle">
      <strong>选中文本问答</strong>
      <div class="sqh-header-actions">
        <button type="button" class="sqh-layout sqh-icon-button" id="sqh-panel-layout" aria-label="切换网页内浮窗或侧栏" title="切换网页内浮窗或侧栏">${ICONS.layout}</button>
        <button type="button" class="sqh-native sqh-icon-button" id="sqh-panel-native" aria-label="打开浏览器侧栏" title="打开浏览器侧栏">${ICONS.native}</button>
        <button type="button" class="sqh-pin sqh-icon-button" id="sqh-panel-pin" aria-label="固定当前页面" title="固定当前页面">${ICONS.pin}</button>
        <button type="button" class="sqh-close" aria-label="关闭">×</button>
      </div>
    </div>
    <div class="sqh-chat" id="sqh-chat"></div>
    <div class="sqh-status" id="sqh-status"></div>
    <div class="sqh-block">
      <label class="sqh-label" for="sqh-question-input">继续对话</label>
      <textarea id="sqh-question-input" rows="3" placeholder="结合当前选中文本继续提问，留空时默认回答上面问题"></textarea>
    </div>
    <div class="sqh-actions">
      <button type="button" class="sqh-submit">发送</button>
      <button type="button" class="sqh-secondary">收起</button>
    </div>
  `;

  root.appendChild(actionBar);
  root.appendChild(panel);

  const dragHandle = panel.querySelector("#sqh-drag-handle");
  const chatNode = panel.querySelector("#sqh-chat");
  const questionInput = panel.querySelector("#sqh-question-input");
  const submitButton = panel.querySelector(".sqh-submit");
  const closeButton = panel.querySelector(".sqh-close");
  const collapseButton = panel.querySelector(".sqh-secondary");
  const statusNode = panel.querySelector("#sqh-status");
  const panelLayoutButton = panel.querySelector("#sqh-panel-layout");
  const panelNativeButton = panel.querySelector("#sqh-panel-native");
  const panelPinButton = panel.querySelector("#sqh-panel-pin");
  const actionBarLayoutButton = actionBar.querySelector('[data-action="toggle-layout"]');
  const actionBarNativeButton = actionBar.querySelector('[data-action="open-native-sidepanel"]');
  const actionBarPinButton = actionBar.querySelector('[data-action="toggle-pin"]');

  connectStreamPort();
  chatNode.addEventListener("click", handleChatClick);

  void loadPreferences();

  document.addEventListener("mouseup", handlePotentialSelectionChange);
  document.addEventListener("keyup", handlePotentialSelectionChange);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("mousemove", handleDragMove, true);
  document.addEventListener("mouseup", handleDragEnd, true);
  document.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);

  actionBar.addEventListener("click", handleActionBarClick);
  submitButton.addEventListener("click", () => {
    submitQuestion();
  });

  closeButton.addEventListener("click", handleCloseClick);
  closeButton.addEventListener("mousedown", stopEvent, true);
  closeButton.addEventListener("mouseup", stopEvent, true);

  panelPinButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void togglePinForPage();
  });

  panelLayoutButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleDisplayMode();
  });

  panelNativeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openNativeSidePanel();
  });

  collapseButton.addEventListener("click", (event) => {
    event.preventDefault();
    cancelActiveRequest();
    hidePanel();
  });

  dragHandle.addEventListener("mousedown", handleDragStart);

  questionInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearBrowserSelection();
      cancelActiveRequest();
      hideAll();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitQuestion();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.panelVisible) {
      clearBrowserSelection();
      cancelActiveRequest();
      hideAll();
    }
  });

  function handleCloseClick(event) {
    event.preventDefault();
    event.stopPropagation();
    clearBrowserSelection();
    cancelActiveRequest();
    hideAll();
  }

  function stopEvent(event) {
    event.stopPropagation();
  }

  function handlePotentialSelectionChange() {
    window.setTimeout(() => {
      if (state.isDragging || panel.contains(document.activeElement)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        refreshActionBarVisibility();
        return;
      }

      const text = selection.toString().trim();
      if (!text || isSelectionInsideHelper(selection)) {
        refreshActionBarVisibility();
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        refreshActionBarVisibility();
        return;
      }

      state.selectedText = text;
      state.anchorRect = cloneRect(rect);
      refreshActionBarButtons();
      refreshActionBarVisibility();
    }, 10);
  }

  function handleActionBarClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    if (!action) {
      return;
    }

    event.preventDefault();

    if (action === "toggle-pin") {
      void togglePinForPage();
      return;
    }

    if (action === "toggle-layout") {
      void toggleDisplayMode();
      return;
    }

    if (action === "open-native-sidepanel") {
      void openNativeSidePanel();
      return;
    }

    if (!hasUsableContext()) {
      return;
    }

    if (action === "ask") {
      openPanel({ question: "", autoSubmit: false, actionType: "ask" });
      return;
    }

    const presetQuestion = QUICK_ACTIONS[action];
    if (!presetQuestion) {
      return;
    }

    openPanel({ question: presetQuestion, autoSubmit: true, actionType: action });
  }

  function handlePortMessage(message) {
    if (!message?.requestId || message.requestId !== state.activeRequestId) {
      return;
    }

    if (message.type === "ASK_LLM_STARTED") {
      statusNode.textContent = "正在流式生成回答...";
      submitButton.disabled = true;
      return;
    }

    if (message.type === "ASK_LLM_DELTA") {
      state.pendingAssistantText += message.delta || "";
      renderConversation();
      statusNode.textContent = "正在流式生成回答...";
      submitButton.disabled = true;
      chatNode.scrollTop = chatNode.scrollHeight;
      return;
    }

    if (message.type === "ASK_LLM_DONE") {
      finalizePendingAssistantMessage();
      statusNode.textContent = "回答已生成";
      submitButton.disabled = false;
      state.activeRequestId = null;
      renderConversation();
      return;
    }

    if (message.type === "ASK_LLM_ERROR") {
      if (state.pendingAssistantText.trim()) {
        finalizePendingAssistantMessage();
      }
      statusNode.textContent =
        message.error === "Request cancelled."
          ? "已取消生成"
          : message.error || "Unknown error";
      submitButton.disabled = false;
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
      submitButton.disabled = false;
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

  function isSelectionInsideHelper(selection) {
    const anchorNode = selection.anchorNode;
    return anchorNode instanceof Node && root.contains(anchorNode);
  }

  function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (root.contains(target)) {
      return;
    }

    if (!state.panelVisible) {
      if (state.isPinnedForPage) {
        clearBrowserSelection();
        return;
      }

      if (state.actionBarVisible) {
        clearTransientSelectionState();
        refreshActionBarVisibility();
      }
      return;
    }

    if (state.isPinnedForPage) {
      clearBrowserSelection();
      return;
    }

    clearBrowserSelection();
    cancelActiveRequest();
    hideAll();
  }

  function clearTransientSelectionState() {
    clearBrowserSelection();
    state.selectedText = "";
    state.anchorRect = null;
  }

  function handleViewportChange() {
    if (state.panelVisible && state.displayMode === "sidebar") {
      applyPanelModeClass();
    } else if (state.panelVisible && state.panelPosition) {
      positionPanelAt(state.panelPosition.left, state.panelPosition.top);
    }

    refreshActionBarVisibility();
  }

  function openPanel({ question = "", autoSubmit = false, actionType = "ask" } = {}) {
    adoptSelectionAsContextIfNeeded();

    if (!hasUsableContext()) {
      statusNode.textContent = "请先选择网页中的文本";
      refreshActionBarButtons();
      refreshActionBarVisibility();
      return;
    }

    panel.hidden = false;
    state.panelVisible = true;
    state.currentActionType = normalizeActionType(actionType);
    questionInput.value = question;
    renderConversation();
    applyPanelModeClass();

    if (state.displayMode === "sidebar") {
      positionPanelForSidebar();
    } else {
      const initialPosition =
        state.panelPosition ||
        state.savedPanelPosition ||
        getInitialPanelPosition(state.anchorRect || actionBar.getBoundingClientRect());
      positionPanelAt(initialPosition.left, initialPosition.top);
    }

    hideActionBar();
    questionInput.focus();

    if (autoSubmit) {
      void submitQuestion();
    }
  }

  function hidePanel() {
    panel.hidden = true;
    state.panelVisible = false;
    state.isDragging = false;
    panel.classList.remove("is-sidebar");
    refreshActionBarButtons();
    refreshActionBarVisibility();
  }

  function hideAll() {
    panel.hidden = true;
    state.panelVisible = false;
    state.isDragging = false;
    state.selectedText = "";
    state.currentContextText = "";
    state.anchorRect = null;
    state.conversation = [];
    state.pendingAssistantText = "";
    state.currentActionType = "ask";
    questionInput.value = "";
    statusNode.textContent = "";
    panel.classList.remove("is-sidebar");
    renderConversation();
    refreshActionBarButtons();
    refreshActionBarVisibility();
  }

  function handleDragStart(event) {
    if (
      !(event.target instanceof Node) ||
      closeButton.contains(event.target) ||
      panelPinButton.contains(event.target) ||
      panelNativeButton.contains(event.target) ||
      panelLayoutButton.contains(event.target) ||
      state.displayMode === "sidebar"
    ) {
      return;
    }

    state.isDragging = true;
    const panelRect = panel.getBoundingClientRect();
    state.dragOffsetX = event.clientX - panelRect.left;
    state.dragOffsetY = event.clientY - panelRect.top;
    panel.classList.add("is-dragging");
    event.preventDefault();
  }

  function handleDragMove(event) {
    if (!state.isDragging || !state.panelVisible) {
      return;
    }

    const left = event.clientX - state.dragOffsetX;
    const top = event.clientY - state.dragOffsetY;
    positionPanelAt(left, top);
  }

  function handleDragEnd() {
    if (!state.isDragging) {
      return;
    }

    state.isDragging = false;
    panel.classList.remove("is-dragging");
    void savePanelPosition();
  }

  function positionActionBar(rect) {
    if (state.isPinnedForPage) {
      positionPinnedActionBar();
      return;
    }

    const actionBarRect = measureActionBar();
    const top = clamp(
      rect.bottom + 10,
      PANEL_MARGIN,
      window.innerHeight - actionBarRect.height - PANEL_MARGIN
    );
    const left = clamp(
      rect.left + rect.width / 2 - actionBarRect.width / 2,
      PANEL_MARGIN,
      window.innerWidth - actionBarRect.width - PANEL_MARGIN
    );

    actionBar.style.top = `${top}px`;
    actionBar.style.left = `${left}px`;
  }

  function positionPinnedActionBar() {
    const actionBarRect = measureActionBar();
    const top = PANEL_MARGIN;
    const left = Math.max(PANEL_MARGIN, window.innerWidth - actionBarRect.width - PANEL_MARGIN);
    actionBar.style.top = `${top}px`;
    actionBar.style.left = `${left}px`;
  }

  function getInitialPanelPosition(rect) {
    const panelHeight = getPanelHeight();
    const preferredBelowTop = rect.bottom + PANEL_MARGIN;
    const fitsBelow = preferredBelowTop + panelHeight <= window.innerHeight - PANEL_MARGIN;
    const preferredTop = fitsBelow
      ? preferredBelowTop
      : rect.top - panelHeight - PANEL_MARGIN;

    return {
      left: rect.left,
      top: preferredTop
    };
  }

  function positionPanelAt(left, top) {
    if (state.displayMode === "sidebar") {
      positionPanelForSidebar();
      return;
    }

    const panelHeight = getPanelHeight();
    const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
    const safeLeft = clamp(
      left,
      PANEL_MARGIN,
      Math.max(PANEL_MARGIN, window.innerWidth - panelWidth - PANEL_MARGIN)
    );
    const safeTop = clamp(
      top,
      PANEL_MARGIN,
      Math.max(PANEL_MARGIN, window.innerHeight - panelHeight - PANEL_MARGIN)
    );

    panel.style.left = `${safeLeft}px`;
    panel.style.top = `${safeTop}px`;
    state.panelPosition = { left: safeLeft, top: safeTop };
  }

  function positionPanelForSidebar() {
    panel.style.left = "";
    panel.style.top = "";
    state.panelPosition = null;
  }

  async function submitQuestion() {
    adoptSelectionAsContextIfNeeded();

    if (!hasUsableContext()) {
      statusNode.textContent = "请先选择网页中的文本";
      return;
    }

    const typedQuestion = questionInput.value.trim();
    const effectiveQuestion = buildEffectiveQuestion(typedQuestion);
    const requestId = `req_${Date.now()}_${++state.requestCounter}`;

    cancelActiveRequest();
    state.conversation.push({
      role: "user",
      content: effectiveQuestion
    });
    state.pendingAssistantText = "";
    questionInput.value = "";
    renderConversation();

    state.activeRequestId = requestId;
    submitButton.disabled = true;
    statusNode.textContent = "正在连接模型...";

    try {
      postToStreamPort({
        type: "ASK_LLM",
        requestId,
        contextText: state.currentContextText,
        conversation: state.conversation,
        actionType: state.currentActionType
      });
    } catch (_error) {
      state.activeRequestId = null;
      submitButton.disabled = false;
      statusNode.textContent = "连接已断开，请重试";
    }
  }

  function buildEffectiveQuestion(typedQuestion) {
    if (typedQuestion) {
      return typedQuestion;
    }

    if (looksLikeQuestion(state.currentContextText)) {
      return state.currentContextText;
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
    submitButton.disabled = false;
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

  function renderConversation() {
    const htmlParts = [];

    if (state.currentContextText) {
      htmlParts.push(`
        <div class="sqh-context-card">
          <div class="sqh-context-label">当前上下文</div>
          <div class="sqh-context-text">${escapeHtml(state.currentContextText)}</div>
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
      htmlParts.push('<div class="sqh-empty">选择文本后开始提问，支持多轮继续追问。</div>');
    }

    chatNode.innerHTML = htmlParts.join("");
    chatNode.scrollTop = chatNode.scrollHeight;
  }

  function renderMessage(role, content, isStreaming = false, messageIndex = -1) {
    if (role === "assistant") {
      return `
        <article class="sqh-message sqh-message-assistant${isStreaming ? " is-streaming" : ""}">
          <div class="sqh-message-meta">
            <div class="sqh-message-role">AI</div>
            ${isStreaming ? "" : `<button type="button" class="sqh-favorite-button" data-favorite-index="${messageIndex}">收藏</button>`}
          </div>
          <div class="sqh-message-body markdown-body">${markdownToHtml(content || "")}</div>
        </article>
      `;
    }

    return `
      <article class="sqh-message sqh-message-user">
        <div class="sqh-message-role">你</div>
        <div class="sqh-message-body">${escapeHtml(content || "")}</div>
      </article>
    `;
  }

  function adoptSelectionAsContextIfNeeded() {
    const latestSelection = (state.selectedText || "").trim();
    if (!latestSelection) {
      return;
    }

    if (latestSelection !== state.currentContextText) {
      state.currentContextText = latestSelection;
      state.conversation = [];
      state.pendingAssistantText = "";
      statusNode.textContent = "";
      state.currentActionType = "ask";
    }
  }

  function hasUsableContext() {
    return Boolean((state.selectedText || "").trim() || (state.currentContextText || "").trim());
  }

  function refreshActionBarVisibility() {
    if (state.panelVisible) {
      hideActionBar();
      return;
    }

    const shouldShowPinned = state.isPinnedForPage;
    const shouldShowSelectionBar = Boolean(state.anchorRect && (state.selectedText || "").trim());

    if (shouldShowPinned) {
      positionPinnedActionBar();
      showActionBar();
      return;
    }

    if (shouldShowSelectionBar) {
      positionActionBar(state.anchorRect);
      showActionBar();
      return;
    }

    hideActionBar();
  }

  function refreshActionBarButtons() {
    const hasContext = hasUsableContext();

    for (const button of actionBar.querySelectorAll("button")) {
      const action = button.dataset.action;
      if (!action || action === "toggle-pin") {
        continue;
      }

      button.disabled = !hasContext;
    }

    const pinLabel = state.isPinnedForPage ? "取消固定当前页面" : "固定当前页面";
    const layoutLabel = state.displayMode === "sidebar" ? "切换到网页内浮窗" : "切换到网页内侧栏";
    actionBarPinButton.innerHTML = ICONS.pin;
    panelPinButton.innerHTML = ICONS.pin;
    actionBarLayoutButton.innerHTML = ICONS.layout;
    panelLayoutButton.innerHTML = ICONS.layout;
    actionBarPinButton.setAttribute("aria-label", pinLabel);
    panelPinButton.setAttribute("aria-label", pinLabel);
    actionBarPinButton.setAttribute("title", pinLabel);
    panelPinButton.setAttribute("title", pinLabel);
    actionBarLayoutButton.setAttribute("aria-label", layoutLabel);
    panelLayoutButton.setAttribute("aria-label", layoutLabel);
    actionBarLayoutButton.setAttribute("title", layoutLabel);
    panelLayoutButton.setAttribute("title", layoutLabel);
    actionBarPinButton.classList.toggle("is-active", state.isPinnedForPage);
    panelPinButton.classList.toggle("is-active", state.isPinnedForPage);
    actionBarLayoutButton.classList.toggle("is-active", state.displayMode === "sidebar");
    panelLayoutButton.classList.toggle("is-active", state.displayMode === "sidebar");
    actionBarNativeButton.innerHTML = ICONS.native;
    panelNativeButton.innerHTML = ICONS.native;
  }

  function showActionBar() {
    actionBar.hidden = false;
    state.actionBarVisible = true;
  }

  function hideActionBar() {
    actionBar.hidden = true;
    state.actionBarVisible = false;
  }

  async function togglePinForPage() {
    const pageKey = getPageKey();
    state.isPinnedForPage = !state.isPinnedForPage;

    if (state.isPinnedForPage) {
      state.pinnedPages[pageKey] = true;
      if (hasUsableContext() && !state.panelVisible) {
        openPanel({ question: "", autoSubmit: false });
      }
    } else {
      delete state.pinnedPages[pageKey];
    }

    refreshActionBarButtons();
    refreshActionBarVisibility();
    await savePinnedPages();
  }

  async function toggleDisplayMode() {
    state.displayMode = state.displayMode === "sidebar" ? "floating" : "sidebar";
    applyPanelModeClass();
    refreshActionBarButtons();

    if (state.panelVisible) {
      if (state.displayMode === "sidebar") {
        positionPanelForSidebar();
      } else {
        const initialPosition =
          state.savedPanelPosition ||
          getInitialPanelPosition(state.anchorRect || actionBar.getBoundingClientRect());
        positionPanelAt(initialPosition.left, initialPosition.top);
      }
    }

    await saveDisplayMode();
  }

  async function openNativeSidePanel() {
    adoptSelectionAsContextIfNeeded();

    if (!hasUsableContext()) {
      statusNode.textContent = "请先选择网页中的文本";
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "OPEN_NATIVE_SIDEPANEL",
      contextText: state.currentContextText,
      conversation: state.conversation,
      actionType: state.currentActionType,
      pageTitle: document.title,
      pageUrl: location.href
    }).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to open side panel."
    }));

    if (!response?.ok) {
      statusNode.textContent = response?.error || "无法打开浏览器侧栏";
      return;
    }

    statusNode.textContent = "已在浏览器侧栏中打开";
    if (state.panelVisible) {
      hidePanel();
    } else {
      hideActionBar();
    }
  }

  function applyPanelModeClass() {
    panel.classList.toggle("is-sidebar", state.displayMode === "sidebar");
  }

  function getPageKey() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  async function loadPreferences() {
    try {
      const result = await storageGet({
        [PANEL_POSITION_KEY]: null,
        [PINNED_PAGES_KEY]: {},
        [DISPLAY_MODE_KEY]: "floating"
      });

      state.savedPanelPosition = result[PANEL_POSITION_KEY];
      state.pinnedPages = result[PINNED_PAGES_KEY] || {};
      state.displayMode = result[DISPLAY_MODE_KEY] === "sidebar" ? "sidebar" : "floating";
      state.isPinnedForPage = Boolean(state.pinnedPages[getPageKey()]);
    } catch (_error) {
      state.savedPanelPosition = null;
      state.pinnedPages = {};
      state.isPinnedForPage = false;
      state.displayMode = "floating";
    }

    applyPanelModeClass();
    refreshActionBarButtons();
    refreshActionBarVisibility();
    renderConversation();
  }

  async function savePanelPosition() {
    if (!state.panelPosition) {
      return;
    }

    state.savedPanelPosition = { ...state.panelPosition };

    try {
      await storageSet({
        [PANEL_POSITION_KEY]: state.savedPanelPosition
      });
    } catch (_error) {
      // Ignore storage errors and keep the in-memory position.
    }
  }

  async function savePinnedPages() {
    try {
      await storageSet({
        [PINNED_PAGES_KEY]: state.pinnedPages
      });
    } catch (_error) {
      // Ignore storage errors and keep the in-memory pin state.
    }
  }

  async function saveDisplayMode() {
    try {
      await storageSet({
        [DISPLAY_MODE_KEY]: state.displayMode
      });
    } catch (_error) {
      // Ignore storage errors and keep the in-memory mode.
    }
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
      contextText: state.currentContextText,
      question,
      answer: assistantMessage.content,
      pageTitle: document.title,
      pageUrl: location.href,
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
      const rawLine = lines[index];
      const trimmedLine = rawLine.trim();

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

      htmlBlocks.push(
        `<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</p>`
      );
      paragraphLines = [];
    }
  }

  function collectList(lines, startIndex, markerPattern, tagName) {
    const items = [];
    let currentItemLines = [];
    let index = startIndex;

    while (index < lines.length) {
      const rawLine = lines[index];
      const trimmedLine = rawLine.trim();

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

    const html = `<${tagName}>${items
      .map((itemLines) => `<li>${itemLines.map((line) => renderInlineMarkdown(line)).join("<br>")}</li>`)
      .join("")}</${tagName}>`;

    return {
      html,
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
    const rendered = renderMath(expression, true);
    return `<div class="sqh-math-block">${rendered}</div>`;
  }

  function renderMathInline(expression) {
    return `<span class="sqh-math-inline">${renderMath(expression, false)}</span>`;
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

  function getPanelHeight() {
    const wasHidden = panel.hidden;
    if (wasHidden) {
      panel.hidden = false;
      panel.style.visibility = "hidden";
    }

    const height = Math.min(
      panel.getBoundingClientRect().height || 480,
      window.innerHeight - PANEL_MARGIN * 2
    );

    if (wasHidden) {
      panel.hidden = true;
      panel.style.visibility = "";
    }

    return height;
  }

  function measureActionBar() {
    const wasHidden = actionBar.hidden;
    if (wasHidden) {
      actionBar.hidden = false;
      actionBar.style.visibility = "hidden";
    }

    const rect = actionBar.getBoundingClientRect();

    if (wasHidden) {
      actionBar.hidden = true;
      actionBar.style.visibility = "";
    }

    return {
      width: rect.width || 320,
      height: rect.height || 44
    };
  }

  function clearBrowserSelection() {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults, (result) => resolve(result));
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }

  function cloneRect(rect) {
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeActionType(actionType) {
    if (actionType === "explain" || actionType === "summarize" || actionType === "translate") {
      return actionType;
    }

    return "ask";
  }
})();
