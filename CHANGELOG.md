# Changelog

All notable changes to AutoThreads are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Session-level notes also live under `_changelog/`.

---

## [0.2.3] — 2026-07-27

### Added

- **Separate reply timer** — replies and @mentions run on their own cadence (`replyIntervalMinutes`, **default 5 minutes**), independent of the post/think interval.
- Auto status panel shows **Next post** and **Next reply check** countdowns with each interval.

### Fixed

- Threads publish/reply **“resource does not exist”**: retry image posts as text-only; treat warm-up `does not exist` on `threads_publish` as transient; verify reply targets still exist before generating/publishing; do not burn the daily reply budget on failed live publishes; skip permanently missing targets.

### Changed

- Default **post/think interval** is **60 minutes**; default **reply check** is **5 minutes**.

---

## [0.2.2] — 2026-07-27

### Added

- **Full-Auto @mention replies** — while launched, the agent also answers public posts that @mention your account (Threads Mentions API), not only replies under your own posts.
- Auto tab toggle **Reply to @mentions of me** (on by default).
- Replies view shows a `mention` badge for inbound mentions.
- Default OAuth/token scopes now include `threads_manage_mentions` (older saved scopes are auto-extended).

### Notes

- Mentions require a Threads access token that includes **`threads_manage_mentions`**. If the permission is missing, mention fetch fails soft and reply-only mode still works — regenerate the token after adding the permission in Meta Developers.
- Same cadence as replies (Full-Auto interval, default 1 minute) and shared daily reply caps.

---

## [0.2.1] — 2026-07-27

### Changed

- Full-Auto default **think interval** is now **1 minute** (was 60), so replies are checked every minute while launched.
- Full-Auto default **max replies per day** is now **100** (was 40).
- Interval validation/UI now allows a minimum of **1** minute (was 5).

> Existing installs keep saved settings. In **Auto**, set interval to `1` and max replies/day to `100` if you already ran an older version, then **Save**.

---

## [0.2.0] — 2026-07-27

### Highlights

- **Full-Auto mode** — an opt-in autonomous agent for hands-off Threads growth.
- **Popular Threads niches (AI-first)** — posts are written in the voice of high-engagement categories like AI, tech, startups, and productivity.
- **Safer by default** — hard daily caps, draft-only mode, and Launch/Stop controls.

### Added

- **Full-Auto engine** — decide → post → reply loop on a configurable interval (`electron/autopilot.ts`).
- **Auto tab** — bilingual EN/한국어 control room for goal, niches, persona, cadence, caps, replies, and live vs draft-only publishing (`src/components/AutopilotView.tsx`).
- **Persona-aware planning & generation** — goal-driven JSON plans, creator recognition (`@handle` + address term), language matching, heuristic fallback for weak local models, and a hard safety block against leaking prompts/keys/tokens (`electron/pipeline.ts`).
- **Popular niche catalog** — AI, tech, dev, startups, productivity, side hustle, creator economy, career, crypto, humor, and more; one-click “popular defaults (AI-first)”.
- **Per-niche voice coaching** — posts match popular Threads niche energy (especially AI Threads: “just tried”, hot takes, builder voice — not press releases).
- **Cadence & safety caps** — think interval, max posts/replies per run and per day, original-vs-news mix, never-repost used headlines, 80-entry activity log.
- **Draft-only safety valve** — agent can plan and write while holding posts for review.
- **Yahoo News** source alongside Google News, Hacker News, Naver News, and custom RSS/Atom.
- **Running indicators** — pulsing live dot on Auto and a Full-Auto status chip in the status bar.

### Changed

- README (EN + KO) documents Full-Auto, popular niches, Yahoo News, and the updated safety model.
- `runGeneration` accepts an optional full system prompt so Full-Auto can inject persona prompts while assisted mode keeps style-only prompts.
- Dev script waits for Vite on `localhost` / IPv6 as well as `127.0.0.1` so `npm run dev` launches Electron reliably on modern macOS.
- Default Full-Auto niches are AI-first popular categories.

### Safety

- Full-Auto is **off by default**; it only runs after **Launch** and stops on **Stop**.
- Hard daily post/reply caps reduce spam risk.
- Prefer **draft-only** for the first smoke test against a real account.

### Packaging

- macOS Apple Silicon + Intel DMG and zip installers.
- Product version **0.2.0**.

---

## [0.1.10] — 2026-07-04

### Added

- Settings toggles for Google News RSS, Hacker News, and Naver News.
- Naver News scraping for Korean media discovery.
- Custom RSS/Atom feeds with optional `{query}` URL replacement.

### Changed

- Manual News browsing and auto-drafting share the same saved source settings.

---

## [0.1.9] — 2026-07-04

### Fixed

- Replies and Queue render as vertical stacked lists.

### Changed

- Packaging emits Mac and Windows zip artifacts in addition to DMG/NSIS installers.

---

## [0.1.8] — 2026-07-04

### Added

- News category presets and News/Blogs mode switch.

### Changed

- Hacker News is queried selectively for tech/startup topics only.

---

## [0.1.0] — 2026-07-04

Initial open-source release: Electron + React desktop app for AI-assisted Threads drafts, local/cloud LLM providers, news scraping, image assist, replies, scheduling, and token-first Threads setup.

[0.2.0]: https://github.com/eisenjimmy/autoTHREADS/releases/tag/v0.2.0
[0.1.10]: https://github.com/eisenjimmy/autoTHREADS/releases/tag/v0.1.10
