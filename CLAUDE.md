# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Node.js script (`send.js`) that runs once a day on GitHub Actions, generates an AI morning-greeting card (image + Traditional-Chinese text composited together), and pushes it to a LINE group. The README is the canonical user-facing doc and is written in Traditional Chinese.

## Commands

```bash
npm install     # install deps (requires Cairo/Pango system libs for `canvas` — see below)
npm run send    # one-shot run (same as `node send.js`); also `npm start`
```

There is **no test suite, no linter, no build step, no package-lock.json** (it's gitignored). The only way to validate a change is to run `node send.js` end-to-end, which requires all 7 secrets in `.env` (copy from `.env.example`) and posts a real message to LINE. There is no dry-run flag — if you need to test without sending, comment out the `sendToLine` call in `main()`.

## Architecture

`send.js` is a linear 6-step pipeline orchestrated by `main()`. Each step is a top-level async function and they run sequentially because each depends on the previous output:

1. **Pick styles** — `pickRandomStyle()` picks one of 3 image styles from `STYLES` (`scenery` / `illustration` / `cute`); `pickRandomTextStyle()` picks one of 5 text styles from `TEXT_STYLES` (`zen` / `worker` / `classical` / `literary` / `warm`). This yields 15 daily combinations.
2. **Claude generates copy** — `generateMorningContent()` calls `claude.messages.create` and asks for a strict JSON object with `greeting` / `line1` / `line2` / `line3`. The response is stripped of ` ```json ` fences before `JSON.parse`. The text-style `prompt` field is injected into the user message, and every prompt ends with `請務必全部用繁體中文,不要混入英文單字` to keep the model from inserting English.
3. **Fetch background** — `getUnsplashImage()` hits `/photos/random` with `query = keyword + style.enhance`, landscape orientation, `content_filter=high`.
4. **Composite** — `compositeImage()` draws the Unsplash JPEG onto a 1200×900 canvas, paints a bottom gradient mask, then writes the 4 lines of text with hardcoded coordinates anchored to the bottom edge. Returns a JPEG buffer at quality 0.92.
5. **Host** — `uploadToCloudinary()` streams the buffer into the `morning-bot` folder and returns the `secure_url`.
6. **Send** — `sendToLine()` posts an `image` message to `/v2/bot/message/push` with `to = MORNING_GROUP_ID`. LINE requires a publicly downloadable URL, which is why Cloudinary exists in the pipeline.

Errors are caught at the top level and printed; `err.response.data` is dumped when present (axios). Any failure aborts the run with `process.exit(1)`.

### Customization surface

Almost all behavior is data, not code. To change what's sent, edit the dictionaries near the top of `send.js`:

- `STYLES[*].keywords` — Unsplash search terms (English only — Unsplash doesn't index Chinese well).
- `STYLES[*].enhance` — suffix appended to every Unsplash query for that style (e.g. `"professional landscape photography golden hour"`).
- `TEXT_STYLES[*].prompt` — the persona description injected into the Claude prompt.
- Canvas layout (font sizes, gradient stops, line positions) is hardcoded inside `compositeImage`. There are no layout constants — change the literals.
- Schedule lives in `.github/workflows/morning.yml` as a `cron` expression in **UTC** (current `53 22 * * *` = 06:53 Taipei).

### Model

`send.js` currently calls `model: 'claude-opus-4-5'`. The README documents `claude-haiku-4-5-20251001` as a cheaper fallback. If you need to swap models, change this single string. Per `claude-api` skill guidance, prefer the latest Claude 4.x models when updating.

## Environment constraints

The `canvas` dependency is a native module that requires Cairo, Pango, libjpeg, libgif, and librsvg headers at install time. The workflow installs these via `apt-get` before `npm install`; on a fresh local machine you must do the same or `npm install` will fail. Windows installs of `canvas` frequently fail — the README explicitly recommends GitHub Actions over local dev for this reason.

Chinese rendering depends on a font that is registered by absolute path:

```js
registerFont('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', { family: 'NotoCJK' });
```

This path only exists after `apt-get install fonts-noto-cjk`. The workflow installs `fonts-noto-cjk`, `fonts-noto-cjk-extra`, and `fonts-noto-color-emoji` and runs `fc-cache -fv`. If the font isn't found, registration fails with a warning and Chinese characters render as hex boxes — **the script still appears to succeed**, so always check the rendered output, not just the exit code. If you change the font path for another OS, register under the same `family: 'NotoCJK'` name (used by every `ctx.font` call in `compositeImage`).

### Required env vars (all 7 are required for a successful run)

`LINE_CHANNEL_ACCESS_TOKEN`, `MORNING_GROUP_ID`, `ANTHROPIC_API_KEY`, `UNSPLASH_ACCESS_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. In production they live in GitHub Actions secrets; locally, in `.env` (loaded by an optional `dotenv` require that swallows the missing-module error so CI doesn't need `dotenv` installed).

## Conventions

- The codebase is intentionally one file. Don't refactor into modules unless the user asks — the README explicitly markets "改一行就生效" (change one line and it works) as a feature, and instructs end users to edit `send.js` directly.
- Comments, console logs, and prompt strings are in Traditional Chinese. Match that when adding new ones.
- The README is the spec. If you change the number of styles, the cost estimate, the model, the schedule, or anything else surfaced in the README, update the README in the same change.
