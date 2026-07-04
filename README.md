<div align="center">

# AutoThreads

**A minimalist desktop studio for automating [Threads](https://www.threads.net) — powered by your own LLM.**

Scrape the news, draft posts in your own voice, reply to what people say back, and schedule it all — using Claude, ChatGPT, or a fully local model. Nothing leaves your machine except the API calls you configure.

Electron · React 19 · TypeScript · Windows & macOS

</div>

---

## What it does

AutoThreads turns a stream of news into a review queue of ready-to-post Threads content. You stay in control: every post is a draft you approve, and only the posts you explicitly schedule go out on their own.

- **News-driven drafting.** Pick your topics; AutoThreads pulls fresh headlines from Google News and turns any of them into a post draft with one click.
- **Bring your own model.** Generate with the **Claude API**, the **OpenAI (ChatGPT) API**, or **any local OpenAI-compatible server** — [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), llama.cpp, and friends. Each provider has a built-in connection test.
- **Writes in your voice.** Give it style notes, paste sample posts, or auto-import your recent Threads posts as voice samples. Your voice is fed into every generation prompt.
- **Answers your replies.** It finds replies to your posts that you haven't responded to and drafts an in-voice reply for each.
- **Review, then post or schedule.** Edit any draft in a distraction-free editor with a live 500-character counter. Post immediately, or schedule it — a background scheduler publishes due posts automatically while the app is open.
- **Optional auto-drafting.** Let it periodically pull news for your topics and pre-fill your drafts queue for review. Drafts *never* publish themselves; only scheduled posts do.
- **Private by design.** API keys and your Threads token are encrypted at rest with the OS keychain (DPAPI on Windows, Keychain on macOS). All app data is plain JSON in your user data folder. The UI itself makes no network calls — every request runs in the main process.

## The interface

A calm, text-editor-style UI inspired by minimalist developer tools — monotone throughout, with a **light (white)** and **dark (black)** theme and nothing competing for your attention.

| View | Purpose |
| --- | --- |
| **Drafts** | Master/detail editor. Review, edit, post now, schedule, or delete. Failed posts show why and can be retried. |
| **News** | Browse live headlines per topic and generate a draft from any of them. |
| **Replies** | Unanswered replies to your posts, each with a one-click "Draft reply." |
| **Queue** | Everything scheduled and published. Post early, unschedule, or open a published post on Threads. |
| **Settings** | Everything below — plus a **Setup wizard** you can rerun anytime. |

A first-run **setup wizard** walks you through the whole configuration in a few steps (appearance → AI provider → Threads → topics → writing style → automation), with connection tests along the way, so the app is usable within a couple of minutes of first launch.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- An LLM provider — **one** of:
  - A local server such as [Ollama](https://ollama.com) (`ollama serve`, default `http://localhost:11434/v1`) or [LM Studio](https://lmstudio.ai) — **no API key, fully offline, free**
  - A [Claude API](https://console.anthropic.com) key
  - An [OpenAI API](https://platform.openai.com) key
- *(Optional, for publishing)* A Threads access token — see [Connecting Threads](#connecting-threads)

### Run it

```bash
git clone https://github.com/<your-username>/autothreads.git
cd autothreads
npm install

npm run dev      # launch with hot-reload (Vite dev server + Electron)
```

### Build a production app

```bash
npm run build    # typecheck the whole project and bundle to dist/ + dist-electron/
npm start        # run the built app
```

## Configuration

Open **Settings** (or the first-run wizard) to configure:

### AI provider

Choose Claude, ChatGPT, or Local LLM and hit **Test connection** to confirm it works before you rely on it.

| Provider | You provide | Notes |
| --- | --- | --- |
| **Local LLM** | Base URL + model name | Any OpenAI-compatible `/v1` endpoint. Ollama: `http://localhost:11434/v1`, LM Studio: `http://localhost:1234/v1`. API key optional. |
| **Claude** | API key + model | Defaults to `claude-sonnet-5`. |
| **ChatGPT** | API key + model | Defaults to `gpt-4o-mini`. |

### Connecting Threads

Publishing and reply-scraping use the official [Threads API](https://developers.facebook.com/docs/threads):

1. Create a Meta app and add the **Threads API** use case.
2. Grant the scopes `threads_basic`, `threads_content_publish`, `threads_read_replies`, and `threads_manage_replies`.
3. Generate a **long-lived access token** and paste it into Settings → Threads API. Leave *User ID* blank to use the token's own account.
4. Hit **Test connection** — it confirms the handle it's connected as.

> Drafting works without Threads configured — you only need it to publish and to pull in replies.

### Writing style

- **Style notes** — free text describing tone, voice, and quirks (e.g. *"Short sentences. Dry. No hashtags."*).
- **Samples** — paste posts that sound like you, or click **Import recent posts from Threads** to pull your own recent posts automatically.

Both are included in every generation prompt.

### Automation

Enable **auto-generate drafts** to have AutoThreads pull fresh news for your topics on an interval (default every 2 hours) and create up to *N* drafts per run for you to review. Scheduled posts publish automatically at their time; auto-generated drafts always wait for your approval.

## How it works

```
News (Google News RSS)  ─┐
                         ├─►  LLM provider  ─►  Draft  ─►  Review  ─►  Post now / Schedule  ─►  Threads API
Unanswered replies  ─────┘     (your voice)                                    │
(Threads API)                                                          Scheduler (main process,
                                                                        publishes due posts)
```

- **Main process (Electron/Node)** owns everything with side effects: news fetching, LLM calls, the Threads client, the draft store, and the scheduler. This keeps the renderer sandboxed and CORS-free.
- **Renderer (React)** is a thin, typed UI that talks to the main process over a small `contextBridge` IPC surface — no direct network or filesystem access.
- **Storage** is a dependency-free local JSON store in your OS user-data directory; secrets are encrypted with Electron `safeStorage`.

## Tech stack

| | |
| --- | --- |
| Shell | Electron |
| UI | React 19 + TypeScript, [Zustand](https://github.com/pmndrs/zustand) for state |
| Build | Vite |
| Dependencies | Zero native modules; RSS parsed without a library; IDs via `crypto.randomUUID()` |

## Project layout

```
electron/          Main process
  main.ts            App window, IPC handlers, window/navigation hardening
  preload.ts         The contextBridge API exposed to the renderer
  settings.ts        Settings store + at-rest secret encryption
  drafts.ts          Draft store (main-process-owned, input-sanitized)
  scheduler.ts       Publishes due scheduled posts; runs auto-draft
  pipeline.ts        Prompt building + draft generation
  llm.ts             Claude / OpenAI / local provider adapters
  threadsApi.ts      Threads Graph API client
  news.ts            Google News RSS scraper
src/               Renderer (React)
  components/        Sidebar, StatusBar, the five views, Onboarding wizard, Toasts
  store/appStore.ts  Zustand store
  styles/app.css     Monotone light/dark design system
```

## Privacy & safety

- Your keys and token are stored **encrypted** on your machine and never transmitted anywhere except directly to the provider/Threads endpoints you configure.
- AutoThreads does not post anything without your action — drafts require review, and only posts you schedule publish on their own.
- If the app is closed mid-publish, the affected post is flagged (it may have gone through) and asks you to check before retrying, rather than silently re-posting.

## Contributing

Issues and pull requests are welcome. The codebase is small and typed end-to-end; `npm run typecheck` and `npm run build` are the quality gates. Please keep the monotone, minimalist UI and the main-process/renderer separation intact.

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<div align="center">
<sub>Not affiliated with Meta or Threads. "Threads" is a trademark of Meta Platforms, Inc.</sub>
</div>
