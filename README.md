# ClipQuery

[中文说明](./README.zh-CN.md)

A Chromium extension for selection-based AI reading assistance. Select any text on a webpage, then explain, translate, summarize, or continue a multi-turn conversation in a floating panel, an in-page sidebar, or the browser native side panel.

## Highlights

- Selection toolbar with `Ask`, `Explain`, `Translate`, and `Summarize`
- Floating panel, in-page sidebar, and native browser `sidePanel`
- Multi-turn conversation with streaming responses
- Markdown rendering with KaTeX math support
- Save answered Q&A pairs as Markdown files
- Multiple provider profiles with per-action model routing
- Configurable answer modes: `Strict`, `Balanced`, `General`
- Experimental Codex OAuth support alongside OpenAI-compatible APIs

## Screens At A Glance

- In-page floating chat for quick follow-up questions
- Browser native side panel for longer reading sessions
- Settings page for provider management, action routing, and answer-mode tuning

## Features

- `Ask`: open a chat panel and continue asking follow-up questions
- `Explain`: explain the selected text with a model mapped for explanation
- `Translate`: translate the selected text with a model mapped for translation
- `Summarize`: summarize the selected text with a model mapped for summarization
- `Pin`: keep the panel and page-level entry point visible on the current page
- `Favorite`: export the matched question and answer to a local Markdown file

## Provider Support

The extension supports multiple provider profiles.

- `OpenAI-compatible`
  Use any API compatible with `chat/completions`, such as OpenAI-compatible gateways or Qwen-compatible endpoints.
- `Codex OAuth (Experimental)`
  Sign in once with Codex OAuth, then route selected actions to a Codex profile.

Each provider profile can define:

- Name
- Type
- API URL
- Model
- Temperature
- System prompt
- API key for OpenAI-compatible profiles

## Answer Modes

- `Strict`
  Stay close to the selected webpage text and avoid filling gaps from general knowledge.
- `Balanced`
  Prefer the selected webpage text, but allow limited general-knowledge supplementation when the user is clearly asking a standalone question.
- `General`
  Treat the selected webpage text as helpful context, not a hard boundary.

## Install

1. Open Chrome or Edge.
2. Go to the extensions page.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select the project folder after cloning or downloading this repository.

## Configure

Open the extension options page and configure:

- One or more provider profiles
- Which provider handles `Ask`, `Explain`, `Translate`, and `Summarize`
- The default answer mode

Recommended setup example:

- `Ask` -> Qwen or your strongest general model
- `Explain` -> Codex or another reasoning-heavy model
- `Summarize` -> a fast low-cost model
- `Translate` -> a model tuned for bilingual output

## Usage

1. Select text on any webpage.
2. Click one of the quick actions from the selection toolbar.
3. Continue the conversation in the floating panel, in-page sidebar, or browser side panel.
4. Use `Ctrl+Enter` to send quickly.
5. Click `Favorite` on an answer to save it as a Markdown file.

If the input box is empty, the extension will try to treat the selected text itself as the question.

## Math Rendering

The extension supports math-style output in assistant answers.

- Block math: `\[ ... \]`, `$$ ... $$`
- Inline math: `\(...\)`, `$...$`

Math rendering is powered by KaTeX inside the extension.

## Project Structure

- `manifest.json`
  Manifest V3 extension configuration
- `background.js`
  LLM routing, provider resolution, streaming, Codex OAuth, favorites export
- `content.js`
  Selection toolbar, floating panel, in-page sidebar, chat rendering
- `content.css`
  In-page UI styles
- `sidepanel.html`, `sidepanel.js`, `sidepanel.css`
  Native browser side panel UI
- `options.html`, `options.js`, `options.css`
  Settings page for providers, answer mode, and action routing

## Notes

- API keys are stored in browser extension local storage.
- Codex OAuth is experimental and based on observable Codex client behavior, not a public official browser-extension integration guide.
- OpenAI-compatible providers use a `chat/completions` request shape.
- Codex OAuth profiles use a Responses-style request shape.
- For production use, a backend proxy is safer than exposing provider credentials directly in the extension.

## Current Status

This project is actively evolving. The core interaction flow is implemented, but real-browser compatibility can still vary by:

- browser version
- provider compatibility
- Codex OAuth backend behavior
- model output format

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
