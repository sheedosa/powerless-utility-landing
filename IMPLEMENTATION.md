# Implementation notes

Built from the Claude Design handoff in `project/Powerless Utility Landing.dc.html`.

- `index.html` — page markup (static sections; the lead-form card is rendered by JS)
- `styles.css` — `@font-face` rules + all styling, tokens in `:root`
- `app.js` — 3-step wizard, validation, gating, tracking, sticky CTA, exit-intent modal
- `assets/reason-bill.{avif,webp,jpg}` — the one real photo from the prototype, served
  via `<picture>`; `reason-bill.png` is the untouched master, not referenced by the page
- `assets/fonts/*.woff2` — self-hosted latin subsets of Archivo and IBM Plex
  (SIL Open Font License 1.1), so the page makes no third-party requests

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
3. Add `privacy.html` and `terms.html` — the footer links point at them and
   currently 404. The consent checkbox collects TCPA marketing consent, so a
   reachable privacy policy is a launch blocker, not a nicety.
4. **Swap the stock photography for real job-site photos.** All seven images
   are currently Unsplash stock (credited in a comment at the top of
   `index.html`) — they are licensed for commercial use, but they are not
   Powerless Utility's own installs, crews, or system designs. Two spots to
   watch: the hero implies a recent local install, and the design-preview
   caption has been softened to "Illustrative" precisely because the photo is
   a stock rooftop rather than a real step-02 output. Restore a stronger
   caption once a genuine design screenshot replaces it.

   To swap any slot: 

   ```bash
   python3 tools/add-photo.py hero-install ~/Desktop/roof-photo.jpg
   ```

   That writes `assets/<slot>.{avif,webp,jpg}` — centre-cropped to the slot's
   aspect, capped at 2x its display size — and prints the `<picture>` block.
   Replace that slot's existing `<picture>` with it and write truthful alt
   text; it is read aloud and shown if the image fails. Slot ids:
   `hero-install`, `reason-bill`, `reason-payments`, `reason-credit`,
   `design-preview`, `battery-program`, `install-photo`.

   Testimonial avatars are initial monograms (MR / DT / RM), not photos. Swap
   in real customer photos only with their permission.
5. Wire analytics. Events already push to `window.dataLayer`:
   `form_start`, `step_2_reached`, `step_3_reached`, `dq_renter`, `dq_coop`,
   `dq_out_of_area`, `scroll_depth_25/50/75/100`, `lead_submitted` (with
   `eventId` for CAPI dedupe), `exit_email_captured`. Add `gtag` / `fbq` calls
   in `track()` if not going through GTM.

## Performance notes

- Zero third-party requests. Fonts are self-hosted latin subsets; the two used
  above the fold (IBM Plex Sans 400, Archivo 800) are preloaded, and all seven
  carry `font-display:swap`.
- The one real photo ships as AVIF (42 KB) with WebP (44 KB) and JPEG (49 KB)
  fallbacks, pre-cropped to the aspect the slot actually displays. It was a
  646 KB PNG before — a 93% cut, and it was 98% of total page weight.
- Regenerate the derivatives from the master after replacing it:

  ```bash
  python3 -c "from PIL import Image; im=Image.open('assets/reason-bill.png').convert('RGB'); w,h=im.size; t=round(w/2.31); im=im.crop((0,(h-t)//2,w,(h-t)//2+t)); im.save('assets/reason-bill.avif',quality=62); im.save('assets/reason-bill.webp',quality=80,method=6); im.save('assets/reason-bill.jpg',quality=82,optimize=True,progressive=True)"
  ```

- `app.js` is deferred; CSS is a single render-blocking file (~4 KB gzipped).
- Layout is CLS-free: the image carries intrinsic `width`/`height`, and the
  placeholder slots have fixed heights.

## Behavior carried over from the prototype

- Tap answers and ZIP persist in `sessionStorage`; name, phone, email, and
  consent are never persisted, so consent is collected fresh each time.
- Errors are announced through a visually hidden `aria-live` region, and the
  first invalid field is scrolled to and focused.
- Step headings receive focus on advance; the success heading receives focus on
  submit.
- `prefers-reduced-motion` disables the hero drain animation, progress
  transition, and smooth scrolling.
