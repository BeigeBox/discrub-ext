# Discrub Extension — Account Flagging Risk Review

## Overview

Discrub is a Chrome extension that acts as a Discord self-moderation tool. It lets users bulk-search, export, edit, delete, and purge their own Discord messages across DMs and servers. It operates by injecting into the Discord web app, extracting the user's auth token from localStorage, and making direct API calls to Discord's REST API (v10).

---

## Table 1: Highest Flagging Risks (Ranked by Severity)

| # | Risk | Severity | Current Code | Why It Triggers Flagging | Remediation |
|---|------|----------|-------------|--------------------------|-------------|
| 1 | **Hardcoded stale User-Agent** | **Critical** | `discord-service.ts:77-78` — static string `Firefox/17.0 Iceweasel/17.0.1` (a browser from 2012) | Discord fingerprints requests. A 2012 browser UA arriving alongside a modern Discord session is a massive anomaly. Automated tooling detection models flag this instantly. No legitimate user sends this UA. | Remove the custom UA entirely. Let `fetch()` use the browser's real User-Agent (the extension runs in Chrome, which already has a valid one). Alternatively, read `navigator.userAgent` at runtime. |
| 2 | **Missing required Discord client headers** | **Critical** | No `X-Super-Properties`, `X-Discord-Locale`, or `X-Discord-Timezone` headers anywhere in the codebase | The official Discord client sends these headers on every request. Their complete absence is a trivial server-side check to identify non-client traffic. Discord has been known to flag or captcha-gate sessions missing these. | Capture `X-Super-Properties` from a live Discord request via `webRequest` API (the extension already has host permissions), or construct it from the browser's real properties. Add `X-Discord-Locale` and `X-Discord-Timezone` from `navigator.language` and `Intl.DateTimeFormat().resolvedOptions().timeZone`. |
| 3 | **Default delete delay is too low (2s)** | **High** | `app-slice.ts:31` — `DELETE_DELAY: Delay.TWO` with modifier `0.5` giving range 1.5–2.5s | Sustained deletion at 1.5–2.5s intervals for hundreds/thousands of messages creates a machine-like pattern. Discord's abuse detection tracks delete velocity over time windows. Even respecting 429s, a steady 2s cadence across thousands of messages is not human behavior. | Increase the default to at least `Delay.FIVE` (5s). Add progressive backoff: after every N deletions (e.g., 50), insert a longer cooldown pause (60–120s). Consider daily caps. |
| 4 | **No session-level operation caps** | **High** | `purge-slice.ts:58-138` and `message-slice.ts:857-969` — loops run until all messages are processed or user cancels | A single purge session can delete tens of thousands of messages in one sitting. Discord tracks anomalous delete-to-send ratios and bulk destructive actions per session. There is no ceiling. | Add configurable per-session caps (e.g., max 200 deletions per session). Force a mandatory cooldown period between sessions. Warn users when approaching high counts. |
| 5 | **Uniform delay distribution (linear random)** | **Medium** | `discord-service.ts:91-92` — `Math.random() * (max - min) + min` produces a flat uniform distribution | Human action timing follows a log-normal or Poisson-like distribution, not uniform. A perfectly uniform random distribution between 1.5–2.5s is still distinguishable from human behavior by statistical analysis of inter-request timing. | Replace with a distribution that mimics human behavior: use a log-normal or Gaussian random with occasional longer pauses. Inject periodic "micro-breaks" (5–15s) and "macro-breaks" (60–300s). |
| 6 | **`deleteFriendRequest` skips `withDeleteDelay`** | **Medium** | `discord-service.ts:525-535` — calls `withRetry` directly, bypassing `withDeleteDelay` | If a user bulk-removes friends, DELETEs fire as fast as rate limits allow with zero artificial delay. Rapid-fire relationship deletions are a strong abuse signal. | Wrap `deleteFriendRequest` in `withDeleteDelay` like `deleteMessage` and `deleteReaction` are. |
| 7 | **Infinite retry loop on 429** | **Medium** | `discord-service.ts:131-156` — `while (!requestComplete)` with no max retry count | If Discord starts returning repeated 429s (which it does when it suspects abuse), the extension will retry forever. Persistent retry-after-429 loops are themselves a signal of automated tooling. | Add a max retry counter (e.g., 5 retries). After exhausting retries, surface an error to the user and stop the operation. Implement exponential backoff on top of `retry_after`. |

---

## Table 2: Additional Improvements to Prevent Flagging from Mass Deletion

| # | Improvement | Description | Implementation Suggestion |
|---|-------------|-------------|---------------------------|
| 1 | **Progressive backoff / cooldown tiers** | After a configurable number of deletions (e.g., every 25–50), pause for a longer period before continuing. | Add a counter in `_purgeMessages` and `deleteMessages` loops. Every N deletions, `await wait(randomBetween(60, 180))`. Make N configurable in settings. |
| 2 | **Daily / hourly deletion quota** | Track how many deletions have occurred in the past 24 hours and enforce a ceiling. | Persist a counter + timestamp to `chrome.storage.local`. Check before each delete. Default to ~500/day. |
| 3 | **Cross-channel spread detection** | Rapidly deleting across many different channels in quick succession is abnormal. | Track unique channel IDs hit in the current session. If more than 3–5 channels are touched within a short window, insert a longer cooldown. |
| 4 | **Human-like timing jitter model** | Replace uniform random delays with a more realistic timing model. | Use `delay = baseDelay + gaussianRandom() * jitter` where the Gaussian occasionally produces longer pauses. Add a 5–10% chance of a "distraction pause" (10–30s). |
| 5 | **Warm-up period** | Start deletion slowly and gradually increase speed rather than jumping straight to the configured delay. | For the first 10 deletions, use `2x` the configured delay. For 10–30, use `1.5x`. Then settle to `1x`. |
| 6 | **Dynamic User-Agent from browser** | Instead of any hardcoded string, inherit the actual browser User-Agent. | Replace `this.userAgent` with `navigator.userAgent` or remove the header entirely (the browser's fetch will include it automatically). |
| 7 | **Session fingerprint consistency** | Ensure all requests in a session share consistent fingerprint data matching the Discord web client. | Mirror the headers that Discord's own JS client sends: `X-Super-Properties` (base64 encoded client info), `X-Discord-Locale`, `X-Discord-Timezone`, `Referer`, `Origin`. |
| 8 | **Operation resume / spread across days** | Allow large purge operations to be saved and resumed across multiple days rather than run in a single sitting. | Serialize purge state (last processed message ID, channel, criteria) to `chrome.storage.local`. Offer a "Resume Purge" button. Default to auto-pausing after N deletions. |
| 9 | **Confirmation gate for large operations** | Warn users before starting operations above a threshold. | If message count > 100, show a dialog: "This will delete X messages. Large bulk deletions increase account risk. Consider spreading this across multiple sessions." |
| 10 | **Respect Discord's undocumented soft limits** | Discord has been observed to scrutinize accounts that delete more than ~150–200 messages in short succession, even if no 429 is triggered. | Default the per-session cap well below the known soft-limit threshold. Document this in the settings UI tooltip. |

---

## Priority Summary

The two **most impactful** immediate changes are:
1. Removing the hardcoded 2012 User-Agent at `discord-service.ts:77-78` and using the browser's native one
2. Adding the missing Discord client headers (`X-Super-Properties`, etc.)

These are passive fingerprint mismatches that flag the traffic as non-standard before any deletion behavior is even analyzed.
