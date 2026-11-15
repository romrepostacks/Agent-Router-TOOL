# Recon: Claude and ChatGPT iOS apps (2026-11-14)

Scope: iOS chat apps, the core loop only (open, ask, read answer, follow up, start new chat). Goal: theme
candidates for the Agent Router phone app (`mobile/`), not a clone. We take layout patterns and roles, never
logos, brand colours, fonts or copy. Screenshots in `replica/screens/` are reference only and are gitignored.

## Sources

| source | url | used for |
| --- | --- | --- |
| ChatGPT App Store listing | https://apps.apple.com/us/app/chatgpt/id6448311069 | 6 screenshots, feature list, 4.8 / 12M ratings |
| Claude App Store listing | https://apps.apple.com/us/app/claude-by-anthropic/id6473753684 | 5 screenshots, feature list, 4.7 / 305K ratings |

Read in a browser at human speed (browser-use, temp profile, no login). The Claude desktop built-in browser
was not available in this session; WebFetch was blocked by a local hook.

## Screen inventory

| ID | screen | how you get there | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Chat | app launch | ask and read | floating top bar (menu, new chat, more), plain-text answers, right-aligned user bubbles, floating composer | filled, with images, with attachments |
| S02 | Chat drawer | menu button top-left | history, projects | list, search | not in screenshots (known from use) |
| S03 | Voice | soundwave / mic button | spoken conversation | full-screen orb, mute, end | Claude: shown |
| S04 | Tools / connectors | + in composer | attach, connect apps | sheet with rows | Claude: shown |
| S05 | File / artifact card | inline in S01 | open a generated file | card with type label | Claude: shown |

## Flows

```
F01 Ask a question       S01 type -> send -> answer streams      happy path: 2 taps
F02 Follow up            S01 type under answer -> send           2 taps
F03 New chat             S01 new-chat button                     1 tap
F04 Find an old chat     S01 menu -> S02 -> row                  2 taps
F05 Attach a photo/file  S01 + -> S04 -> pick -> send            4 taps
```

## Shared patterns (what our themes keep)

- **Chrome floats.** No full-width nav bar. Top-left menu and top-right action group sit in pill or circle
  buttons over the content. The composer is a floating rounded capsule above the home indicator.
- **Answers are plain text**, full width, no bubble, no avatar. **User messages** are soft, low-contrast
  bubbles on the right (ChatGPT tints them with the accent; Claude uses a neutral warm grey).
- **Answer actions** (copy, read aloud, rate, retry, share) are a row of small outline icons under the answer.
- **Composer**: + on the left, placeholder, mic, then one strong circular primary button (voice when empty,
  send when filled). Claude adds a model pill next to +.
- One accent colour, used almost only on the send button. Everything else is greys.
- Large radii: composer and cards ~24–28pt, bubbles ~18–20pt.

## Differences

| | ChatGPT | Claude |
| --- | --- | --- |
| base | pure white, black text | warm off-white |
| body type | sans | serif for answers |
| user bubble | accent-tinted | neutral grey |
| accent | blue (send / voice) | orange (send) |

Both signature combinations (warm cream + serif + orange; white + blue bubble) are trade dress. Our themes
avoid them.

## Mapped to our app

Our phone app (`mobile/www`) already has one view at a time: connect, projects, sessions, chat, running,
inbox, settings, plus a tab bar and bottom sheets. The chat view gets the patterns above. Agent-specific
parts the originals do not have: route chip, provider label, approval cards, Queue / Steer / Stop.

## Out of scope

Voice mode, image generation, connectors marketplace: provider features, not ours to clone.

## Size

Theme swap only: S. Restyle of chat view to the floating pattern: S–M.
