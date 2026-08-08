# Implementation notes

Built from the Claude Design handoff in `project/Powerless Utility Landing.dc.html`.

- `index.html` — page markup (static sections; the lead-form card is rendered by JS)
- `styles.css` — all styling, tokens in `:root`
- `app.js` — 3-step wizard, validation, gating, tracking, sticky CTA, exit-intent modal
- `assets/reason-bill.png` — the one real photo that was filled in the prototype

No build step and no dependencies. Open `index.html` over HTTP (fonts and the
form work from `file://` too, but serve it for realistic testing):

```bash
python3 -m http.server 4173
```

## Configuration

All prototype "props" are the `CONFIG` object at the top of `app.js`:

| Key | Default | Effect |
| --- | --- | --- |
| `headlineVariant` | `'A'` | A–D; overridable per visit with `?headline=` / `?h=` |
| `companyName` | `'Powerless Utility'` | Name inside the TCPA consent text |
| `strictZipGating` | `false` | `true` disqualifies out-of-area ZIPs; `false` lets them through flagged `needsReview: 'REVIEW'` |
| `stickyCta` | `true` | Mobile sticky bottom CTA |
| `exitIntent` | `true` | Desktop exit-intent email capture, once per session |
| `excludedZips` / `servicePrefixes` | Houston sample data | **Placeholder** — replace with the real service-area lists |
| `leadEndpoint` | `null` | When set, the lead is POSTed as JSON; when `null` it is logged and the success state is simulated |

## Before launch

1. Set `CONFIG.leadEndpoint` to the CRM endpoint (failures already surface the
   retry error and re-enable the submit button).
2. Replace `excludedZips` / `servicePrefixes` with real service-area data.
3. Fill the remaining image placeholders — every dashed box in the page is an
   `<div class="img-slot" data-placeholder="…">`; swap each for
   `<img class="img-real" …>` as done for `assets/reason-bill.png`.
4. Wire analytics. Events already push to `window.dataLayer`:
   `form_start`, `step_2_reached`, `step_3_reached`, `dq_renter`, `dq_coop`,
   `dq_out_of_area`, `scroll_depth_25/50/75/100`, `lead_submitted` (with
   `eventId` for CAPI dedupe), `exit_email_captured`. Add `gtag` / `fbq` calls
   in `track()` if not going through GTM.
5. Point `/privacy` and `/terms` at the real pages.

## Behavior carried over from the prototype

- Tap answers and ZIP persist in `sessionStorage`; name, phone, email, and
  consent are never persisted, so consent is collected fresh each time.
- Errors are announced through a visually hidden `aria-live` region, and the
  first invalid field is scrolled to and focused.
- Step headings receive focus on advance; the success heading receives focus on
  submit.
- `prefers-reduced-motion` disables the hero drain animation, progress
  transition, and smooth scrolling.
