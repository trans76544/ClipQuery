# Agent Memory

## Project Overview

- Project path: `G:\JSProject\Audition_Plugin`
- Project type: Chromium browser extension based on Manifest V3
- Primary goal: let users select text on a webpage, ask LLM-powered questions about that text, and read answers in a lightweight UI
- Current extension name: `Selection QA Helper`

## Core User Experience

- When the user selects text on a webpage, an in-page quick action toolbar appears.
- Quick actions currently include:
  - explain
  - translate
  - summarize
  - ask custom question
  - toggle in-page floating/sidebar mode
  - open browser native side panel
  - pin current page
- The main in-page UI supports:
  - floating panel mode
  - in-page right sidebar mode
  - pinned mode for the current page
  - multi-turn conversation
  - Markdown-rendered assistant output
  - streaming answer display
  - saving a Q&A pair to a Markdown file

## Browser Native Side Panel

- Native `sidePanel` support has been added in parallel with the in-page UI.
- The extension now supports three display styles:
  - floating panel
  - in-page sidebar
  - browser native side panel
- Native side panel files:
  - `sidepanel.html`
  - `sidepanel.css`
  - `sidepanel.js`
- `manifest.json` includes:
  - `sidePanel`
  - `tabs`
  - `downloads`
  - side panel default path

## LLM Request Architecture

- LLM requests are handled in `background.js`.
- Streaming communication between UI and background is implemented with `chrome.runtime.connect`.
- A reconnectable streaming port pattern was added because disconnected ports caused runtime errors such as:
  - `Attempting to use a disconnected port object`
- Both `content.js` and `sidepanel.js` now:
  - reconnect the stream port if needed
  - handle disconnect gracefully
  - show a retry-style status if the port dies mid-request

## API Compatibility Notes

- The extension currently targets an OpenAI-compatible `chat/completions` API shape.
- Background logic supports:
  - SSE streaming responses
  - plain JSON fallback responses
- The extension now also has an experimental `Codex OAuth` mode:
  - authorize endpoint: `https://auth.openai.com/oauth/authorize`
  - token endpoint: `https://auth.openai.com/oauth/token`
  - default Codex endpoint: `https://chatgpt.com/backend-api/codex/responses`
  - default Codex model: `gpt-5.2`
- Current defaults in `background.js` were updated from generic OpenAI defaults to a DashScope-compatible setup:
  - `apiUrl`: `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  - `model`: `qwen-plus`
  - `temperature`: `0.4`
- The system prompt treats the selected webpage text as stable context for the conversation.
- A later settings refactor introduced:
  - `providerProfiles`: multiple saved provider/model configurations
  - `actionProviderMap`: default provider routing for `ask`, `explain`, `summarize`, and `translate`
  - `answerMode`: `strict`, `balanced`, or `general`

## Multi-provider Routing

- The extension no longer relies only on one global provider.
- Each provider profile stores:
  - id
  - name
  - type: `openaiCompatible` or `codexOAuth`
  - apiUrl
  - model
  - temperature
  - systemPrompt
  - optional apiKey for openai-compatible providers
- Quick actions in `content.js` now set an `actionType`.
- The active `actionType` is persisted with native side panel sessions as well.
- Background request routing resolves a provider by:
  - explicit provider id if present
  - otherwise the mapped provider for the current action
  - otherwise the first enabled provider
- This means:
  - `解释` can use one model
  - `总结` can use another
  - `提问` can use another
  - `翻译` can use another

## Answer Modes

- `strict`:
  - stay close to the selected page text
  - do not fill missing facts from general knowledge unless clearly supported
- `balanced`:
  - prefer page context
  - allow limited supplementation from general knowledge
- `general`:
  - behave more like a general assistant
  - selected page text is context, not a hard constraint
- This policy is injected in `background.js` through `buildContextAwarePrompt()`.

## Codex OAuth Notes

- Codex OAuth was requested with reference to:
  - `https://github.com/AnthonyTlei/langchain-codex-oauth/tree/main`
- Official OpenAI public docs do not currently provide a browser-extension-specific Codex OAuth integration guide.
- Current implementation should be treated as experimental.
- The extension does not use `chrome.identity`; instead it:
  - opens the OAuth authorize URL in a normal tab
  - uses the known localhost callback URI: `http://localhost:1455/auth/callback`
  - watches `chrome.tabs.onUpdated` for that redirect URL
  - exchanges the authorization code in `background.js`
- Pending OAuth state is stored in extension storage under:
  - `__codexOAuthPending`
- Token profile display is derived from the returned `id_token` when available.
- OAuth request execution path:
  - settings page starts login via `START_CODEX_OAUTH`
  - background saves pending PKCE state
  - callback is intercepted via tab URL
  - access and refresh tokens are stored in extension local storage
  - request-time refresh is attempted automatically when the token is near expiry
- OAuth mode still reuses the extension's existing conversation, streaming, and favorites flow.
- A later HTTP 400 issue appeared after successful login. The most likely causes were:
  - custom `instructions` being rejected by the Codex consumer backend
  - missing `chatgpt-account-id` header
  - model alias mismatch on the backend
- Current mitigation in `background.js`:
  - Codex mode no longer sends arbitrary `instructions`
  - system prompt and selected page context are folded into a prelude user message
  - `chatgpt-account-id` is sent when available
  - HTTP error handling now reads plain-text response bodies so the UI can show the real backend error instead of only `HTTP 400`

## Multi-turn Conversation Model

- The earlier UI had separate “selected text” and “question” boxes.
- It was later redesigned into a chat-style panel:
  - one context card at the top
  - one ongoing conversation area
  - one input for continued follow-up questions
- Current conversation behavior:
  - newly selected text becomes the current context
  - if the selected text changes, the old conversation is reset
  - subsequent questions are sent together with prior conversation turns

## Pin Behavior

- User expectation changed during development:
  - initial pin behavior only pinned the action buttons
  - desired behavior is that the dialog and content stay open as well
- Current pinned behavior:
  - pin is page-scoped
  - when pinned, clicking elsewhere on the page should not dismiss the panel
  - pin can auto-open the panel if there is usable context and the panel is not already visible

## Selection Toolbar Interaction Notes

- A regression occurred after switching a global dismiss handler from `mousedown` to `click` to help native side panel user-gesture behavior.
- That change caused the selection toolbar to appear and immediately disappear.
- Current fix:
  - outside-click dismissal only runs when the panel is already open
  - the selection toolbar itself is no longer immediately dismissed by the same click sequence

## Native Side Panel Opening Notes

- Native `chrome.sidePanel.open()` is sensitive to valid user gesture timing.
- A prior bug came from doing too much async work before calling `sidePanel.open()`.
- Background logic was updated so `sidePanel.open()` is called as directly as possible from the user-triggered message path.
- There was also concern that global page event handling in the content script could interfere with user gesture validity.

## Markdown Rendering

- Assistant output is rendered as Markdown in both in-page UI and native side panel UI.
- The Markdown renderer is custom and lightweight.
- Supported rendering includes:
  - headings
  - paragraphs
  - lists
  - blockquotes
  - code blocks
  - inline code
  - bold
  - italic
  - links
- A bug existed where multi-line list items were broken or truncated.
- That was fixed by moving from a rough block-based parser to a more line-oriented parser with list collection.
- This renderer is still custom and may need future improvement for:
  - nested lists
  - tables
  - task lists
  - more complete Markdown edge cases

## Save / Favorite Feature

- Users requested a way to bookmark useful Q&A for later review.
- Current implementation:
  - every completed assistant answer shows a `收藏` button
  - available in both in-page chat and native side panel
  - clicking it exports a Markdown file via the Downloads API
- Exported file content includes:
  - saved time
  - page title
  - page URL
  - selected context
  - matched user question
  - assistant answer
- Export location:
  - browser default downloads folder
  - under `Selection-QA-Favorites/`

## UI and Visual Notes

- The action toolbar was initially text-based and became too long.
- It was later converted to icon buttons.
- Earlier placeholder character icons were considered ugly.
- Current state:
  - custom inline SVG icons are used in `content.js`
  - ask uses a magnifying-glass style icon
  - pin uses a pin icon
- Tooltips and accessibility labels are preserved via:
  - `title`
  - `aria-label`

## Known Important Files

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `sidepanel.html`
- `sidepanel.css`
- `sidepanel.js`
- `options.html`
- `options.js`
- `options.css`
- `README.md`
- `README.zh-CN.md`

## Documentation State

- The project has bilingual READMEs:
  - `README.md` for English
  - `README.zh-CN.md` for Chinese
- They link to each other at the top.
- README content has been updated to mention:
  - in-page sidebar
  - browser native side panel
  - favorite/save-to-file support
  - experimental Codex OAuth mode

## Important Developer Constraints and Conventions

- Manual file edits in this project should use `apply_patch`.
- Do not assume PowerShell commands work; the environment behaves like `cmd`.
- `rg` exists in the Codex app bundle, but some invocations returned `Access denied`; simple `type`, `dir`, and targeted checks were often more reliable here.
- The project directory started empty and the whole extension was built from scratch in this workspace.

## Current Version Memory

- `manifest.json` version has progressed over time and currently reflects `0.6.0`.
- The extension has undergone several iterative UX changes; if anything breaks, likely risk areas are:
  - native side panel open flow
  - stream port reconnect logic
  - pin behavior
  - interaction between selection toolbar and outside-click dismissal
  - custom Markdown rendering
  - experimental Codex OAuth callback capture and token refresh

## Suggested Next Areas If Work Continues

- Improve native side panel reliability across Chrome/Edge versions.
- Sync conversation state live between in-page UI and native side panel.
- Replace the custom Markdown parser with a more complete safe renderer if richer formatting is needed.
- Add a built-in favorites/history viewer instead of relying only on exported Markdown downloads.
- Add tests or at least a structured manual QA checklist for the main interaction paths.
