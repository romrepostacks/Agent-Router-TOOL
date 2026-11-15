# Components (phone chat view)

Colours, fonts and radii come from `tokens-<theme>-<mode>.json`. Icons: Lucide (MIT).

```
Top bar
  parts     circle button (menu) left; pill group (new session, more) right; session title centred, 1 line
  tokens    bg surface @ 85% + blur, border, radius pill, shadow soft
  a11y      44pt targets, aria-labels, title is <h1>

User bubble
  tokens    bg bubble, text, radius lg (tail corner sm), max-width 80%
  states    sending (60% opacity), failed (danger outline + Retry)

Answer
  tokens    text on bg, base 17/26, no bubble
  actions   copy, rate up/down, retry, share; text-muted icons, 32pt, shown under the last answer

Route chip
  tokens    surface, border, text-muted, radius pill, font xs/600
  states    auto, picked, running (accent dot pulses; static with reduced motion)

Approval card
  tokens    surface, border, accent left rule, radius md
  actions   Always allow / Allow once / Decline (Decline = danger text)

Composer
  parts     + button, route chip, textarea (grows to 6 lines), mic, send
  send      round 36pt, bg accent, icon on-accent; disabled when empty (bg border, icon text-muted)
  running   send becomes Stop (square icon); Queue / Steer as text buttons above
  tokens    surface, border, radius lg, shadow pop
  a11y      label "Message", Enter does not send on iOS, focus ring 2px accent

Tab bar
  tokens    surface @ 85% + blur, active = accent, others text-muted
```
