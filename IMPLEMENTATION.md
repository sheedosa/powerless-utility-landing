# Implementation notes

Built from the Claude Design handoff in `project/Powerless Utility Landing.dc.html`.

- `index.html` — page markup (static sections; the lead-form card is rendered by JS)
- `privacy.html` / `terms.html` — the two policy pages, served at `/privacy.html`
  and `/terms.html`; they carry the site header, footer and typography and
  nothing but the approved policy text in between
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
| `consentVersion` | `'2026-09-09.1'` | Stored with every consent record; bump it whenever `CONSENT_DISCLOSURE_HTML` changes |

## Before launch

1. **Confirm the enquiry destination with the owner, then set
   `CONFIG.leadEndpoint`** to it (failures already surface the retry error and
   re-enable the submit button). Keep any integration secret server-side — never
   in this repo — send over HTTPS only, and restrict access to the people
   handling enquiries. The browser cannot see the submitting IP address, so the
   receiving endpoint has to record it alongside `consentRecord`; the published
   privacy notice covers collecting it. Then run a real end-to-end test with
   owner-authorised test details: submission, consent capture, delivery landing
   in the destination, and an opt-out. A success message on the page does not
   prove delivery.
2. Replace `excludedZips` / `servicePrefixes` with real service-area data.
3. **Settle the consent disclosure — see "Consent and enquiry data" below.**
   It is the one open item in the form that a code change alone cannot close.
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
- Regenerate the derivatives from a master with `tools/add-photo.py <slot> <file>`.
- The four largest images ship a second, narrower encode (`*-sm.avif` /
  `*-sm.webp`, 760px) selected by `<source media="(max-width:899px)">`, so a
  phone downloads roughly half the bytes of the desktop file.

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

## Claims and compliance

- **No financing vocabulary.** The words *financed*, *financing*, *loan*, and
  *debt* were removed from all user-visible copy on request — the audience reads
  them as risk. The offer is stated as "$0 down, you only pay for power, without
  the unnecessary fees." Keep new copy to that framing.
- **No federal tax credit claim.** The 30% residential credit terminated for
  expenditures after 12/31/2025, and the reason-card built on it was removed
  rather than reworded. Do not reintroduce it.
- **The outage card must not overstate.** It says to *pair the system with a
  battery*. Grid-tied solar disconnects during an outage for lineworker safety —
  the FAQ says so explicitly, and the card must never imply panels alone keep
  the lights on.
- **The TECL licence number was removed** from the proof strip and the footer at
  the client's direction, replaced with "licensed and warrantied installation."
  Texas rules generally require an electrical contractor's licence number in
  advertising — confirm with whoever handles TDLR compliance whether this page
  is covered before running paid traffic to it.

## Consent and enquiry data

Implements section 4 of the owner handoff (7 September 2026).

- **The checkbox starts unchecked and is never pre-ticked or persisted.** Consent
  is separate from accepting the terms, and the disclosure sits immediately above
  the submit button at every width. `Privacy Policy` and `Terms and Conditions`
  links sit directly under it — outside the `<label>`, so tapping one navigates
  instead of toggling the box. The utility non-affiliation disclaimer stays where
  it was; the checkbox did not replace it.
- **Every enquiry carries a `consentRecord`**: the box state, the exact
  disclosure text the visitor saw, `CONFIG.consentVersion`, the submission time
  in UTC with the visitor's IANA timezone and UTC offset, and the URL the form
  was submitted from. Bump `consentVersion` whenever the wording changes so old
  records still identify what was actually shown. The submitting IP address must
  be added server-side.
- **UNRESOLVED — the disclosure wording needs an owner decision.** It currently
  reads "from **Powerless Utility** and its partners … including messages sent
  using an autodialer or prerecorded voice." The handoff explicitly declines to
  certify that unnamed-"partners" reference as sufficient permission for
  automated contact by another seller, so the wording is left exactly as the
  owner had it rather than rewritten here. Before any paid traffic runs, the
  disclosure has to name the party that will actually call or text and the
  contact technology it will use. Do not widen it, and do not switch on an
  automated call or text sequence on the strength of the checkbox alone — an
  unchecked box is not permission for automated marketing, and a checked one is
  not permission for more contact than the visitor asked for. If the planned CRM
  integration needs different consent, raise that specific point with the owner.
  Edit `CONSENT_DISCLOSURE_HTML` at the top of `app.js` and bump
  `CONFIG.consentVersion` in the same change; both the page and the stored
  record read from it.
- **The one-call promise governs any integration.** "We call once. If it's not
  for you, tell us and we're done." No extra automated call sequence may be
  activated in the CRM or a follow-up service.
- **Opt-outs must be actionable, and that part is not code.** STOP replies and
  emails to `info@powerlessutility.com` have to reach whoever handles follow-up
  and suppress further marketing, with suppression records kept so an opted-out
  person is not re-added later. The mailbox needs to be monitored — the privacy
  policy points every access, correction, deletion and opt-out request at it.
- **Retention.** Use a documented schedule matched to the actual workflow.
  Covered FTC telemarketing records require five years; apply longer
  requirements where they apply.
- **The privacy notice describes what the page does today** — enquiries, consent
  records, administrative service providers, and the solar provider preparing a
  requested proposal. The page still makes zero third-party requests: no Meta
  Pixel, no Google Analytics, no address autocomplete. `track()` only pushes to
  `window.dataLayer`. **If any of those is added, update `privacy.html` to
  describe it accurately before the tool goes live.**

## Removed credential claims

At the owner's direction (handoff section 2), the **BBB A+**, **NABCEP
Certified** and **Tier-1 Panel Partner** badges and their claims were removed
from the proof strip in `index.html` and from the design source in
`project/`. Nothing was invented to replace them — the row now holds the three
remaining badges (battery program, Texas-based, info stays private) and the flex
row closes the gap on its own, so the design is unchanged apart from being
shorter. Do not reintroduce these three, and do not substitute new credentials
or partnerships. The separate licensed-installation and warranty language is
untouched, as instructed.

The review section heading is now "Homeowners we've helped." The review text
itself is unchanged; the owner confirms the reviews are genuine.

## Deliberate deviations from the prototype

- **The hero photo shows on mobile.** The prototype gated it behind
  `isDesktopView` and hid it under 900px. It now renders at every width, using
  its natural 1120:440 ratio on mobile instead of the desktop crop to 220px —
  the full frame in ~132px of height on a 375px screen. That pushes the form
  card's top from roughly 438px to 594px, still inside the first viewport on a
  375x812 phone, with the step header and first question visible. If mobile
  conversion drops, this is the first thing to A/B — restore the old behavior
  by adding `desktop-only` back to the `.hero-photo` div in `index.html`.
