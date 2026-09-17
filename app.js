/* Powerless Utility — form-first landing page.
   Port of the Claude Design prototype "Powerless Utility Landing.dc.html". */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Configuration — these were the prototype's editable props.
     ------------------------------------------------------------------ */
  var CONFIG = {
    // 'A' | 'B' | 'C' | 'D' — overridable per-visit with ?headline= / ?h=
    headlineVariant: 'A',
    companyName: 'Powerless Utility',
    // true  -> ZIPs outside SERVICE_PREFIXES are disqualified outright
    // false -> they continue, but the lead is flagged needsReview:'REVIEW'
    strictZipGating: false,
    stickyCta: true,
    exitIntent: true,
    // Replace with the real service-area data before launch.
    excludedZips: ['77327', '77328', '77331', '77335', '77350', '77351', '77360', '77364', '77371'],
    servicePrefixes: ['770', '771', '772', '773', '774', '775'],
    // Production: point this at the CRM endpoint. null = log only.
    // Confirm the real destination with the owner before wiring it up, and keep
    // any credentials server-side — never in this file.
    leadEndpoint: null,
    // Bump this whenever CONSENT_DISCLOSURE_HTML changes, so an existing consent
    // record still identifies the exact wording that visitor was shown.
    consentVersion: '2026-09-09.1',
    /* Address autocomplete. Dormant until one of proxyUrl / apiKey is set: with
       neither, the field is a plain address box that makes no outside request
       and the ZIP is read out of what the visitor types, so service-area gating
       still works.

       Turning it on sends every keystroke of the visitor's address to Google.
       The published privacy notice does not describe that yet — update
       privacy.html in the SAME change that sets a key (IMPLEMENTATION.md has the
       wording ready), or the page collects through a provider it never disclosed.

       proxyUrl is the better of the two: point it at an endpoint on your own
       backend that forwards to Places API (New) and returns its JSON unchanged,
       and the key never reaches the browser. A browser apiKey must be
       HTTP-referrer restricted to powerlessutility.com and capped for spend. */
    addressAutocomplete: {
      proxyUrl: '',
      apiKey: '',
      country: 'us'
    }
  };

  /* The consent disclosure, shown immediately above the submit button and stored
     verbatim with every enquiry as consent evidence.

     UNRESOLVED — owner decision required before any automated calling, texting,
     or CRM dialler is switched on (see IMPLEMENTATION.md). "and its partners" is
     a broad permission for contact by an unnamed seller; the disclosure has to
     name the party that will actually call or text and the technology it uses.
     Do not widen it, and do not treat this checkbox as permission to start an
     automated marketing sequence. */
  var CONSENT_DISCLOSURE_HTML =
    'By checking this box, I expressly consent to receive marketing calls, text messages, and emails from ' +
    '<strong>' + esc(CONFIG.companyName) + '</strong> and its partners at the phone number and email I provided — ' +
    'including messages sent using an autodialer or prerecorded voice. I understand consent is not a condition of any ' +
    'purchase, and message &amp; data rates may apply. Reply STOP to opt out at any time.';

  // The same disclosure as plain text, for the stored consent record.
  function consentDisclosureText() {
    return CONSENT_DISCLOSURE_HTML
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var HEADLINES = {
    A: 'Your electric bill is <span class="accent">a subscription you never agreed to.</span>',
    B: "Texas rates went up again. Yours doesn't have to.",
    C: 'Cut your electric bill by up to 60% with $0 down.',
    D: 'Texas homeowners are seeing bills climb'
  };

  var STEP_NAMES = { 1: 'YOUR BILL', 2: 'YOUR ROOF', 3: 'YOUR DETAILS' };
  var PROGRESS = { 1: '33%', 2: '66%', 3: '100%' };

  var BILL_OPTS = ['Under $100', '$100–150', '$150–250', '$250–350', '$350+'];
  var OWN_OPTS = ['Yes', 'No'];
  var SHADE_OPTS = ['No Shade', 'Partial Shade', 'Heavy Shade'];
  var ROOF_OPTS = ['0–10 yrs', '10–20 yrs', '20+ yrs', 'Not sure'];
  var TIME_OPTS = ['ASAP', '1–3 months', '3–6 months', 'Just researching'];

  var PERSIST_KEYS = ['step', 'dq', 'bill', 'address', 'zip', 'city', 'stateCode', 'addressSource',
    'homeowner', 'shade', 'roofAge', 'timeline', 'needsReview'];
  var STORAGE_KEY = 'pu_lead_form';
  var MOBILE_MAX = 900;

  /* ------------------------------------------------------------------
     State — tap answers and the property address persist for the session.
     Name / phone / email / consent are NEVER persisted (fresh consent
     is collected every time).
     ------------------------------------------------------------------ */
  var state = {
    step: 1, dq: null, done: false, needsReview: '',
    bill: null, homeowner: null, shade: null, roofAge: null, timeline: null,
    address: '', zip: '', city: '', stateCode: '', addressSource: '',
    name: '', phone: '', email: '', consent: false,
    errors: {}, submitting: false,
    exitOpen: false, exitEmail: '', exitDone: false, errExit: ''
  };

  var tracking = { utm: {}, referrer: '', landingPage: '', fired: {} };
  var focusAfterRender = null;

  var els = {
    formCard: document.getElementById('form-card'),
    formBody: document.getElementById('form-body'),
    live: document.getElementById('live-region'),
    headline: document.getElementById('hero-headline'),
    sticky: document.getElementById('sticky-cta'),
    exitOverlay: document.getElementById('exit-overlay'),
    exitDialog: document.getElementById('exit-dialog')
  };

  /* ---------------------------- helpers ---------------------------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readSession() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      PERSIST_KEYS.forEach(function (k) { if (k in saved) state[k] = saved[k]; });
    } catch (e) { /* storage unavailable — start fresh */ }
    if ([1, 2, 3].indexOf(state.step) === -1) state.step = 1; // guard stale persists
  }

  function writeSession() {
    var snap = {};
    PERSIST_KEYS.forEach(function (k) { snap[k] = state[k]; });
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  function track(event, extra) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: event }, tracking.utm, extra || {}));
    // Production: also fire gtag('event', ev) / fbq('trackCustom', ev, {eventID}) here.
  }

  function firstStart() {
    if (!tracking.fired.formStart) { tracking.fired.formStart = 1; track('form_start'); }
  }

  function announce(msg) {
    if (msg && els.live) els.live.textContent = msg;
  }

  function isMobile() { return window.innerWidth < MOBILE_MAX; }

  function fmtPhone(v) {
    var d = v.replace(/\D/g, '');
    if (d.length > 10 && d.charAt(0) === '1') d = d.slice(1);
    d = d.slice(0, 10);
    if (d.length > 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length > 3) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return d;
  }

  function uuid() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  // Service-area gating still runs on a 5-digit ZIP, so pull the last one out of
  // whatever the visitor typed when no suggestion supplied it.
  function zipFromText(v) {
    var found = String(v || '').match(/\b\d{5}\b/g);
    return found ? found[found.length - 1] : '';
  }

  var validate = {
    name: function (v) { return v.trim().length >= 2 ? '' : 'Please enter your full name.'; },
    phone: function (v) { return v.replace(/\D/g, '').length === 10 ? '' : 'Enter a valid 10-digit phone number.'; },
    email: function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? '' : 'Enter a valid email address.'; },
    address: function (v) {
      if (String(v || '').trim().length < 6) return 'Enter your property address.';
      if (!zipFromText(v) && !state.zip) return 'Include your ZIP code so we can check your service area.';
      return '';
    }
  };

  // Updates the error message in place so re-rendering never steals focus
  // from the field the user is interacting with.
  function setErr(key, msg) {
    state.errors[key] = msg;
    var node = els.formBody.querySelector('[data-err="' + key + '"]');
    if (node) {
      node.textContent = msg || '';
      node.hidden = !msg;
    }
    if (key === 'consent') {
      var wrap = els.formBody.querySelector('.consent');
      if (wrap) wrap.classList.toggle('invalid', !!msg);
    }
    if (msg) announce(msg);
  }

  function scrollToEl(el, offset) {
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function focusFirstError(selector) {
    var el = els.formBody.querySelector(selector);
    if (!el) return;
    scrollToEl(el, 90);
    var target = el.tagName === 'INPUT' ? el : el.querySelector('button, input');
    if (target) setTimeout(function () { target.focus({ preventScroll: true }); }, 350);
  }

  function scrollToForm() {
    scrollToEl(els.formCard, 12);
    setTimeout(function () {
      var f = els.formBody.querySelector('button, input');
      if (f) f.focus({ preventScroll: true });
    }, 650);
  }

  /* ------------------------------------------------------------------
     Address autocomplete.

     Talks to Places API (New) over plain fetch — no Google script tag, so the
     page still loads zero third-party code. With neither proxyUrl nor apiKey
     set nothing leaves the browser and the field degrades to a plain address
     box. Every request failure degrades the same way: no list, typed address
     still accepted.
     ------------------------------------------------------------------ */

  var AC_MIN_CHARS = 4;
  var AC_DEBOUNCE_MS = 250;
  var AC_MAX_ITEMS = 5;
  var GOOGLE_SUGGEST_URL = 'https://places.googleapis.com/v1/places:autocomplete';
  var GOOGLE_DETAILS_URL = 'https://places.googleapis.com/v1/places/';

  // sessionToken groups keystrokes + the details call into one billable session.
  var ac = { items: [], active: -1, token: uuid(), timer: null, ctrl: null, seq: 0 };

  function acCfg() { return CONFIG.addressAutocomplete || {}; }
  function acEnabled() { var c = acCfg(); return !!(c.proxyUrl || c.apiKey); }

  function acUrl(op, query) {
    var c = acCfg();
    if (c.proxyUrl) return c.proxyUrl + (c.proxyUrl.indexOf('?') === -1 ? '?' : '&') + 'op=' + op + (query || '');
    return op === 'suggest' ? GOOGLE_SUGGEST_URL : GOOGLE_DETAILS_URL;
  }

  function acHeaders(fieldMask) {
    var c = acCfg();
    var h = {};
    if (!c.proxyUrl && c.apiKey) {
      h['X-Goog-Api-Key'] = c.apiKey;
      if (fieldMask) h['X-Goog-FieldMask'] = fieldMask;
    }
    return h;
  }

  function acFetchSuggestions(query) {
    var c = acCfg();
    var headers = acHeaders();
    headers['Content-Type'] = 'application/json';
    if (ac.ctrl) { try { ac.ctrl.abort(); } catch (e) {} }
    ac.ctrl = ('AbortController' in window) ? new AbortController() : null;
    return fetch(acUrl('suggest'), {
      method: 'POST',
      headers: headers,
      signal: ac.ctrl ? ac.ctrl.signal : undefined,
      body: JSON.stringify({
        input: query,
        sessionToken: ac.token,
        includedRegionCodes: [c.country || 'us'],
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise']
      })
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); });
  }

  function acFetchDetails(placeId) {
    var c = acCfg();
    var url = c.proxyUrl
      ? acUrl('details', '&placeId=' + encodeURIComponent(placeId) + '&sessionToken=' + encodeURIComponent(ac.token))
      : GOOGLE_DETAILS_URL + encodeURIComponent(placeId) + '?sessionToken=' + encodeURIComponent(ac.token);
    return fetch(url, { headers: acHeaders('formattedAddress,addressComponents') })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); });
  }

  function acParse(json) {
    var out = [];
    (((json || {}).suggestions) || []).forEach(function (row) {
      var p = row.placePrediction;
      if (!p || !p.placeId) return;
      var sf = p.structuredFormat || {};
      out.push({
        id: p.placeId,
        full: (p.text && p.text.text) || '',
        primary: (sf.mainText && sf.mainText.text) || (p.text && p.text.text) || '',
        secondary: (sf.secondaryText && sf.secondaryText.text) || ''
      });
    });
    return out.slice(0, AC_MAX_ITEMS);
  }

  function acComponents(json) {
    var out = { formatted: (json && json.formattedAddress) || '', zip: '', city: '', state: '' };
    (((json || {}).addressComponents) || []).forEach(function (c) {
      var t = c.types || [];
      if (t.indexOf('postal_code') !== -1) out.zip = String(c.longText || c.shortText || '').slice(0, 5);
      else if (t.indexOf('locality') !== -1) out.city = c.longText || c.shortText || '';
      else if (t.indexOf('administrative_area_level_1') !== -1) out.state = c.shortText || '';
    });
    return out;
  }

  function acInput() { return els.formBody.querySelector('#pu-address'); }

  function acPaint() {
    var list = els.formBody.querySelector('#pu-address-list');
    var input = acInput();
    if (!list || !input) return;
    if (!ac.items.length) {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    list.innerHTML = ac.items.map(function (it, i) {
      return '<li class="ac-opt" id="pu-ac-' + i + '" role="option" data-ac-opt="' + i + '" ' +
        'aria-selected="' + (i === ac.active) + '">' +
        '<span class="ac-primary">' + esc(it.primary) + '</span>' +
        (it.secondary ? '<span class="ac-secondary">' + esc(it.secondary) + '</span>' : '') +
        '</li>';
    }).join('');
    list.hidden = false;
    // On a phone the card can sit low enough that the list opens past the fold.
    // Nudge the page just far enough that the whole list is reachable; once it
    // fits, the overshoot goes non-positive and this stops firing.
    var overshoot = list.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overshoot > 0) window.scrollBy(0, overshoot);
    input.setAttribute('aria-expanded', 'true');
    if (ac.active >= 0) input.setAttribute('aria-activedescendant', 'pu-ac-' + ac.active);
    else input.removeAttribute('aria-activedescendant');
  }

  function acClose() {
    ac.items = [];
    ac.active = -1;
    if (ac.timer) { clearTimeout(ac.timer); ac.timer = null; }
    acPaint();
  }

  function acQuery(text) {
    if (!acEnabled()) return;
    var q = String(text || '').trim();
    if (ac.timer) clearTimeout(ac.timer);
    if (q.length < AC_MIN_CHARS) { acClose(); return; }
    ac.timer = setTimeout(function () {
      var seq = ++ac.seq;
      acFetchSuggestions(q).then(function (json) {
        if (seq !== ac.seq) return;              // a newer keystroke won
        ac.items = acParse(json);
        ac.active = -1;
        acPaint();
      }).catch(function () { /* offline, blocked, over quota — just no list */ });
    }, AC_DEBOUNCE_MS);
  }

  function acSelect(i) {
    var it = ac.items[i];
    if (!it) return;
    var input = acInput();
    state.address = it.full || (it.primary + (it.secondary ? ', ' + it.secondary : ''));
    state.addressSource = 'suggestion';
    state.zip = zipFromText(state.address);
    if (input) input.value = state.address;
    acClose();
    setErr('address', '');
    writeSession();

    acFetchDetails(it.id).then(function (json) {
      var parts = acComponents(json);
      if (parts.formatted) {
        state.address = parts.formatted;
        var live = acInput();
        if (live) live.value = parts.formatted;
      }
      state.zip = parts.zip || zipFromText(state.address);
      state.city = parts.city;
      state.stateCode = parts.state;
      setErr('address', validate.address(state.address));
      writeSession();
    }).catch(function () {
      // Keep the prediction text; the ZIP parsed out of it still gates.
    }).then(function () {
      ac.token = uuid();                          // details call closes the session
    });
  }

  function acKeydown(e) {
    if (!ac.items.length) {
      if (e.key === 'Escape') acClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var step = e.key === 'ArrowDown' ? 1 : -1;
      ac.active = (ac.active + step + ac.items.length + 1) % (ac.items.length + 1);
      if (ac.active === ac.items.length) ac.active = -1;
      acPaint();
    } else if (e.key === 'Enter') {
      if (ac.active >= 0) { e.preventDefault(); acSelect(ac.active); }
      else acClose();
    } else if (e.key === 'Escape') {
      acClose();
    }
  }

  els.formBody.addEventListener('keydown', function (e) {
    if (e.target.id === 'pu-address') acKeydown(e);
  });

  // Keep focus in the input so choosing an option never fires blur-validation
  // against the half-typed value underneath it.
  els.formBody.addEventListener('mousedown', function (e) {
    if (e.target.closest('#pu-address-list')) e.preventDefault();
  });

  els.formBody.addEventListener('click', function (e) {
    var opt = e.target.closest('[data-ac-opt]');
    if (opt) acSelect(parseInt(opt.getAttribute('data-ac-opt'), 10));
  });

  els.formBody.addEventListener('focusout', function (e) {
    if (e.target.id === 'pu-address') setTimeout(acClose, 0);
  });

  /* ---------------------------- rendering ---------------------------- */

  function errBlock(key, extraClass) {
    var msg = state.errors[key] || '';
    return '<p class="err' + (extraClass ? ' ' + extraClass : '') + '" data-err="' + key + '"' +
      (msg ? '' : ' hidden') + '>' + esc(msg) + '</p>';
  }

  function optButtons(list, key, current, modifier) {
    return list.map(function (label) {
      var on = current === label;
      return '<button type="button" class="opt' + (modifier ? ' ' + modifier : '') + (on ? ' selected' : '') +
        '" data-pick="' + key + '" data-value="' + esc(label) + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
    }).join('');
  }

  // Wraps an option group in a labelled group so the question is announced
  // with the choices rather than the buttons standing on their own.
  function optGroup(key, labelId, list, current, cols, modifier) {
    return '<div class="opt-grid cols-' + cols + '" role="group" aria-labelledby="' + labelId + '" data-group="' + key + '">' +
      optButtons(list, key, current, modifier) + '</div>';
  }

  function stepHeader() {
    return '' +
      '<div class="step-row">' +
        '<span class="step-label">STEP ' + state.step + ' OF 3 &middot; <span>' + STEP_NAMES[state.step] + '</span></span>' +
        '<span class="step-progress" aria-hidden="true">' +
          '<span class="dot"></span><span class="track"></span>' +
          '<span class="fill" style="width:' + PROGRESS[state.step] + '"></span>' +
        '</span>' +
      '</div>';
  }

  function step1() {
    return '' +
      '<h2>Your electric bill</h2>' +
      '<p class="card-sub">Start with what you spend — no bills or documents needed.</p>' +
      '<p class="field-label" id="lbl-bill">Average monthly electric bill</p>' +
      optGroup('bill', 'lbl-bill', BILL_OPTS, state.bill, 2) +
      errBlock('bill') +
      '<label class="input-label spaced" for="pu-address">Property address</label>' +
      '<div class="ac">' +
        '<input id="pu-address" class="text-input" type="text" autocomplete="off" autocapitalize="words" ' +
          'spellcheck="false" role="combobox" aria-expanded="false" aria-controls="pu-address-list" ' +
          'aria-autocomplete="list" aria-describedby="pu-address-hint" ' +
          'placeholder="1420 Oak Ridge Dr, Houston, TX 77002" ' +
          'value="' + esc(state.address) + '" data-field="address">' +
        '<ul class="ac-list" id="pu-address-list" role="listbox" aria-label="Address suggestions" hidden></ul>' +
      '</div>' +
      errBlock('address') +
      '<p class="hint" id="pu-address-hint">' + (acEnabled()
        ? 'Start typing and pick your address from the list.'
        : 'Street, city, state and ZIP.') + '</p>' +
      '<p class="field-label spaced" id="lbl-own">Do you own this home?</p>' +
      optGroup('homeowner', 'lbl-own', OWN_OPTS, state.homeowner, 2, 'opt-word opt-own') +
      errBlock('homeowner') +
      '<p class="hint">Homeowners qualify for the $0-upfront program.</p>' +
      '<button type="button" class="btn btn-primary btn-block" data-action="continue1">Continue</button>' +
      '<p class="hint-center">60-second check. No obligation. Your info stays private.</p>';
  }

  function step2() {
    return '' +
      '<h2 tabindex="-1" data-focus="step2">Your roof</h2>' +
      '<p class="card-sub">Three taps and we can size your system.</p>' +
      '<p class="field-label" id="lbl-shade">How shaded is your roof?</p>' +
      optGroup('shade', 'lbl-shade', SHADE_OPTS, state.shade, 3, 'opt-word opt-shade') +
      errBlock('shade') +
      '<p class="field-label spaced" id="lbl-roof">Roof age</p>' +
      optGroup('roofAge', 'lbl-roof', ROOF_OPTS, state.roofAge, 2, 'opt-word') +
      errBlock('roofAge') +
      '<p class="field-label spaced" id="lbl-time">When are you looking to move forward?</p>' +
      optGroup('timeline', 'lbl-time', TIME_OPTS, state.timeline, 2, 'opt-word') +
      errBlock('timeline') +
      '<div class="nav-row">' +
        '<button type="button" class="btn-link" data-action="back1">&#8592; Back</button>' +
        '<button type="button" class="btn btn-primary" data-action="continue2">Continue</button>' +
      '</div>';
  }

  function step3() {
    return '' +
      '<h2 tabindex="-1" data-focus="step3">Where do we send it?</h2>' +
      '<p class="card-sub">Your estimate is free, and there is no obligation.</p>' +
      '<label class="input-label" for="pu-name">Full name</label>' +
      '<input id="pu-name" class="text-input" type="text" autocomplete="name" placeholder="Jane Rodriguez" ' +
        'value="' + esc(state.name) + '" data-field="name">' +
      errBlock('name') +
      '<label class="input-label spaced-sm" for="pu-phone">Mobile phone</label>' +
      '<input id="pu-phone" class="text-input mono" type="tel" inputmode="tel" autocomplete="tel" placeholder="(832) 884-7302" ' +
        'value="' + esc(state.phone) + '" data-field="phone">' +
      errBlock('phone') +
      '<label class="input-label spaced-sm" for="pu-email">Email</label>' +
      '<input id="pu-email" class="text-input" type="email" inputmode="email" autocomplete="email" placeholder="jane@example.com" ' +
        'value="' + esc(state.email) + '" data-field="email">' +
      errBlock('email') +
      // Unchecked on every render — consent is never persisted or pre-ticked,
      // and it is separate from accepting the terms.
      '<label class="consent' + (state.errors.consent ? ' invalid' : '') + '" data-group="consent">' +
        '<input type="checkbox" data-field="consent"' + (state.consent ? ' checked' : '') + '>' +
        '<span>' + CONSENT_DISCLOSURE_HTML + '</span>' +
      '</label>' +
      errBlock('consent') +
      // Policy links sit outside the label so tapping one navigates instead of
      // toggling the checkbox.
      '<p class="consent-links">' +
        '<a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>' +
        '<span aria-hidden="true"> &middot; </span>' +
        '<a href="terms.html" target="_blank" rel="noopener">Terms and Conditions</a>' +
      '</p>' +
      errBlock('submit', 'spaced') +
      '<div class="nav-row">' +
        '<button type="button" class="btn-link" data-action="back2">&#8592; Back</button>' +
        '<button type="button" class="btn btn-primary" data-action="submit">' +
          (state.submitting ? 'Sending…' : 'Get my free estimate') +
        '</button>' +
      '</div>' +
      '<p class="privacy-line"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<rect x="3" y="7" width="10" height="7" rx="1.5" stroke="#5B6670" stroke-width="1.8"></rect>' +
        '<path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="#5B6670" stroke-width="1.8"></path></svg>' +
        'Your info stays private — used only for your solar consult.</p>';
  }

  var DQ_COPY = {
    renter: {
      h: 'We need the property owner',
      p: 'Solar installation has to be approved and signed by whoever owns the home. If you rent, ask your landlord to start a request — or get in touch about community solar, which works without owning the roof.'
    },
    coop: {
      h: 'Not available in your area yet',
      p: 'Your address sits in an electric cooperative territory where we cannot currently install. This changes as agreements are signed, so it is worth checking back.'
    },
    out: {
      h: 'Outside our service area',
      p: 'We currently install around Houston, and your address falls outside that. We are expanding, so this may change.'
    }
  };

  function dqView() {
    var copy = DQ_COPY[state.dq];
    return '<div class="dq"><h2>' + esc(copy.h) + '</h2><p>' + esc(copy.p) + '</p>' +
      '<button type="button" class="btn-link-brand" data-action="startOver">&#8592; Start over</button></div>';
  }

  function successView() {
    var firstName = state.name.trim().split(/\s+/)[0] || 'neighbor';
    return '' +
      '<div class="success">' +
        '<h2 tabindex="-1" data-focus="success">Request received</h2>' +
        '<p class="success-sub">Thanks ' + esc(firstName) + ' — your solar quote request is in.</p>' +
        '<ol>' +
          '<li><span class="num">01</span><span class="txt">We review your roof, shade, and local rates</span></li>' +
          '<li><span class="num">02</span><span class="txt">A local solar advisor calls or texts within 1 business day</span></li>' +
          '<li><span class="num">03</span><span class="txt">You get a custom savings estimate — free, no obligation</span></li>' +
        '</ol>' +
        '<div class="success-footer">' +
          '<p>Want to skip the wait?</p>' +
          '<a class="call-btn" href="tel:+13469168197">Call us now</a>' +
          '<button type="button" class="restart-btn" data-action="startNew">Start a new request</button>' +
        '</div>' +
      '</div>';
  }

  function render() {
    var html;
    if (state.done) html = successView();
    else if (state.dq) html = dqView();
    else html = stepHeader() + (state.step === 1 ? step1() : state.step === 2 ? step2() : step3());

    els.formBody.innerHTML = html;

    if (focusAfterRender) {
      var f = els.formBody.querySelector('[data-focus="' + focusAfterRender + '"]');
      if (f) f.focus();
      focusAfterRender = null;
    }

    writeSession();
    updateSticky();
  }

  function setSubmitLabel() {
    var btn = els.formBody.querySelector('[data-action="submit"]');
    if (!btn) return;
    btn.textContent = state.submitting ? 'Sending…' : 'Get my free estimate';
    btn.disabled = state.submitting;
  }

  /* ---------------------------- transitions ---------------------------- */

  function goToStep(step) {
    if (step > state.step) track('step_' + step + '_reached');
    if (step !== state.step) focusAfterRender = step === 2 ? 'step2' : step === 3 ? 'step3' : null;
    state.step = step;
    render();
  }

  function continue1() {
    if (!state.zip) state.zip = zipFromText(state.address);

    var errs = {
      bill: state.bill ? '' : 'Select your average monthly bill.',
      address: validate.address(state.address),
      homeowner: state.homeowner ? '' : 'Please select one.'
    };
    Object.keys(errs).forEach(function (k) { setErr(k, errs[k]); });
    announce(errs.bill || errs.address || errs.homeowner || '');

    var first = errs.bill ? '[data-group="bill"]' : errs.address ? '#pu-address' : errs.homeowner ? '[data-group="homeowner"]' : null;
    if (first) { focusFirstError(first); return; }

    // Gating — evaluated before step 2 is shown.
    if (state.homeowner === 'No') { state.dq = 'renter'; track('dq_renter'); render(); return; }
    if (CONFIG.excludedZips.indexOf(state.zip) !== -1) { state.dq = 'coop'; track('dq_coop'); render(); return; }

    var inArea = CONFIG.servicePrefixes.indexOf(state.zip.slice(0, 3)) !== -1;
    if (!inArea && CONFIG.strictZipGating) { state.dq = 'out'; track('dq_out_of_area'); render(); return; }

    state.needsReview = inArea ? '' : 'REVIEW';
    goToStep(2);
  }

  function continue2() {
    var errs = {
      shade: state.shade ? '' : 'Select your roof shade.',
      roofAge: state.roofAge ? '' : 'Select your roof age.',
      timeline: state.timeline ? '' : 'Select a timeframe.'
    };
    Object.keys(errs).forEach(function (k) { setErr(k, errs[k]); });
    announce(errs.shade || errs.roofAge || errs.timeline || '');

    var first = errs.shade ? '[data-group="shade"]' : errs.roofAge ? '[data-group="roofAge"]' : errs.timeline ? '[data-group="timeline"]' : null;
    if (first) { focusFirstError(first); return; }

    goToStep(3);
  }

  function submitLead() {
    var errs = {
      name: validate.name(state.name),
      phone: validate.phone(state.phone),
      email: validate.email(state.email),
      consent: state.consent ? '' : 'Please check the box to continue.',
      submit: ''
    };
    Object.keys(errs).forEach(function (k) { setErr(k, errs[k]); });
    announce(errs.name || errs.phone || errs.email || errs.consent || '');

    var first = errs.name ? '#pu-name' : errs.phone ? '#pu-phone' : errs.email ? '#pu-email' : errs.consent ? '[data-group="consent"]' : null;
    if (first) { focusFirstError(first); return; }
    if (state.submitting) return;

    state.submitting = true;
    setSubmitLabel();

    var eventId = uuid();

    var now = new Date();
    var timeZone = '';
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

    var lead = {
      submittedAt: now.toISOString(),
      needsReview: state.needsReview,
      name: state.name,
      email: state.email,
      phone: '+1' + state.phone.replace(/\D/g, ''),
      address: state.address,
      city: state.city,
      state: state.stateCode,
      zip: state.zip,
      // 'suggestion' = picked from the autocomplete list, 'typed' = keyed in by hand.
      addressSource: state.addressSource,
      homeowner: state.homeowner,
      bill: state.bill,
      shade: state.shade,
      roofAge: state.roofAge,
      timeline: state.timeline,
      consent: state.consent,
      /* Consent evidence kept with the enquiry: the box state, the exact wording
         shown, its version, the submission time with timezone, and the page the
         form was submitted from. The submitting IP address has to be recorded
         server-side — it cannot be read from the browser — and the published
         privacy notice covers collecting it. */
      consentRecord: {
        given: state.consent,
        version: CONFIG.consentVersion,
        disclosure: consentDisclosureText(),
        submittedAt: now.toISOString(),
        timeZone: timeZone,
        utcOffsetMinutes: -now.getTimezoneOffset(),
        pageUrl: location.href
      },
      fbclid: tracking.utm.fbclid || '',
      utmSource: tracking.utm.utmSource || '',
      utmMedium: tracking.utm.utmMedium || '',
      utmCampaign: tracking.utm.utmCampaign || '',
      utmContent: tracking.utm.utmContent || '',
      utmTerm: tracking.utm.utmTerm || '',
      referrer: tracking.referrer,
      landingPage: tracking.landingPage,
      eventId: eventId
    };

    function onSuccess() {
      track('lead_submitted', { eventId: eventId });
      state.submitting = false;
      state.done = true;
      focusAfterRender = 'success';
      announce('Request received.');
      render();
    }

    function onFailure() {
      state.submitting = false;
      setSubmitLabel();
      setErr('submit', 'Something went wrong sending your request. Please try again.');
    }

    if (CONFIG.leadEndpoint) {
      fetch(CONFIG.leadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead)
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); onSuccess(); })
        .catch(onFailure);
    } else {
      console.log('lead', lead);
      setTimeout(onSuccess, 700);
    }
  }

  function startOver() {
    state.dq = null; state.homeowner = null; state.step = 1; state.errors = {};
    render();
  }

  function startNew() {
    Object.assign(state, {
      step: 1, done: false, dq: null, needsReview: '',
      bill: null, homeowner: null, shade: null, roofAge: null, timeline: null,
      address: '', zip: '', city: '', stateCode: '', addressSource: '',
      name: '', phone: '', email: '', consent: false, errors: {}
    });
    if (els.live) els.live.textContent = '';
    render();
  }

  /* ---------------------------- events ---------------------------- */

  els.formBody.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]');
    if (pick) {
      firstStart();
      var key = pick.getAttribute('data-pick');
      state[key] = pick.getAttribute('data-value');
      var group = pick.parentElement;
      Array.prototype.forEach.call(group.querySelectorAll('[data-pick]'), function (b) {
        var on = b === pick;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
      });
      setErr(key, '');
      writeSession();
      return;
    }
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    var actions = {
      continue1: continue1, continue2: continue2, submit: submitLead,
      back1: function () { goToStep(1); }, back2: function () { goToStep(2); },
      startOver: startOver, startNew: startNew
    };
    var fn = actions[actionEl.getAttribute('data-action')];
    if (fn) fn();
  });

  els.formBody.addEventListener('input', function (e) {
    var field = e.target.getAttribute('data-field');
    if (!field) return;
    if (field === 'address') {
      firstStart();
      state.address = e.target.value;
      state.addressSource = 'typed';
      // Typed edits re-derive the ZIP; a suggestion overwrites it on selection.
      state.zip = zipFromText(state.address);
      state.city = '';
      state.stateCode = '';
      if (!validate.address(state.address)) setErr('address', '');
      acQuery(state.address);
      writeSession();
    } else if (field === 'phone') {
      var start = e.target.selectionStart;
      var atEnd = start === e.target.value.length;
      state.phone = fmtPhone(e.target.value);
      e.target.value = state.phone;
      if (!atEnd) { try { e.target.setSelectionRange(start, start); } catch (err) {} }
    } else if (field === 'consent') {
      state.consent = e.target.checked;
      if (e.target.checked) setErr('consent', '');
    } else {
      state[field] = e.target.value;
    }
  });

  els.formBody.addEventListener('change', function (e) {
    if (e.target.getAttribute('data-field') === 'consent') {
      state.consent = e.target.checked;
      if (e.target.checked) setErr('consent', '');
    }
  });

  els.formBody.addEventListener('blur', function (e) {
    var field = e.target.getAttribute('data-field');
    if (!field || !validate[field]) return;
    setErr(field, validate[field](state[field]));
  }, true);

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-scroll-to-form]')) scrollToForm();
  });

  /* ---------------------------- sticky CTA ---------------------------- */

  var formCardVisible = true;

  function updateSticky() {
    var show = !formCardVisible && isMobile() && !state.done && !state.dq && CONFIG.stickyCta;
    els.sticky.hidden = !show;
    document.body.classList.toggle('has-sticky', show);
  }

  if ('IntersectionObserver' in window && els.formCard) {
    new IntersectionObserver(function (entries) {
      formCardVisible = entries[0].isIntersecting;
      updateSticky();
    }, { threshold: 0 }).observe(els.formCard);
  }

  window.addEventListener('resize', updateSticky);

  /* ---------------------------- scroll depth ---------------------------- */

  window.addEventListener('scroll', function () {
    var d = document.documentElement;
    var pct = (window.scrollY + window.innerHeight) / Math.max(d.scrollHeight, 1) * 100;
    [25, 50, 75, 100].forEach(function (t) {
      if (pct >= t && !tracking.fired['sd' + t]) { tracking.fired['sd' + t] = 1; track('scroll_depth_' + t); }
    });
  }, { passive: true });

  /* ---------------------------- exit intent ---------------------------- */

  function renderExit() {
    var html;
    if (state.exitDone) {
      html = '<h3>Sent.</h3><p>Check your inbox in the next few minutes.</p>' +
        '<button type="button" class="exit-back" data-exit="close">Back to the page</button>';
    } else {
      html = '<h3>Not ready? Get the 60-second estimate emailed instead.</h3>' +
        '<p>One email. No follow-up sequence.</p>' +
        '<label class="input-label" for="pu-exit-email">Email</label>' +
        '<input id="pu-exit-email" class="text-input" type="email" inputmode="email" autocomplete="email" value="' + esc(state.exitEmail) + '">' +
        (state.errExit ? '<p class="err">' + esc(state.errExit) + '</p>' : '') +
        '<button type="button" class="btn btn-primary exit-submit" data-exit="submit">Email me the estimate</button>' +
        '<button type="button" class="exit-dismiss" data-exit="close">No thanks</button>';
    }
    els.exitDialog.innerHTML = html;
    els.exitOverlay.hidden = !state.exitOpen;
    if (state.exitOpen && !state.exitDone) {
      var input = document.getElementById('pu-exit-email');
      if (input) input.focus();
    }
  }

  var exitReturnFocus = null;

  function openExit() {
    exitReturnFocus = document.activeElement;
    state.exitOpen = true;
    renderExit();
  }

  function closeExit() {
    state.exitOpen = false;
    els.exitOverlay.hidden = true;
    if (exitReturnFocus && document.contains(exitReturnFocus)) exitReturnFocus.focus();
    exitReturnFocus = null;
  }

  // Keep Tab inside the dialog while it is open.
  function trapTab(e) {
    if (e.key !== 'Tab' || !state.exitOpen) return;
    var focusable = els.exitDialog.querySelectorAll('button, input, a[href]');
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  els.exitOverlay.addEventListener('click', function (e) {
    if (e.target === els.exitOverlay) { closeExit(); return; }
    var action = e.target.closest('[data-exit]');
    if (!action) return;
    if (action.getAttribute('data-exit') === 'close') { closeExit(); return; }
    var input = document.getElementById('pu-exit-email');
    state.exitEmail = input ? input.value : '';
    var err = validate.email(state.exitEmail);
    if (err) { state.errExit = err; renderExit(); return; }
    state.errExit = '';
    track('exit_email_captured');
    // Production: POST the email to the estimate-by-email endpoint here.
    state.exitDone = true;
    renderExit();
  });

  els.exitOverlay.addEventListener('input', function (e) {
    if (e.target.id === 'pu-exit-email') { state.exitEmail = e.target.value; state.errExit = ''; }
  });

  document.addEventListener('keydown', function (e) {
    if (!state.exitOpen) return;
    if (e.key === 'Escape') closeExit();
    else trapTab(e);
  });

  document.addEventListener('mouseout', function (e) {
    if (e.relatedTarget || e.clientY >= 8) return;
    if (window.innerWidth < MOBILE_MAX) return;
    if (state.exitOpen || state.done || !CONFIG.exitIntent) return;
    try {
      if (sessionStorage.getItem('pu_exit_shown')) return;
      sessionStorage.setItem('pu_exit_shown', '1');
    } catch (err) {}
    openExit();
  });

  /* ---------------------------- init ---------------------------- */

  function applyHeadline() {
    var q = new URLSearchParams(location.search);
    var override = q.get('headline') || q.get('h');
    if (override) { els.headline.textContent = override; return; }
    var key = String(CONFIG.headlineVariant || 'A').charAt(0).toUpperCase();
    els.headline.innerHTML = HEADLINES[key] || HEADLINES.A;
  }

  function captureAttribution() {
    var q = new URLSearchParams(location.search);
    var map = {
      utm_source: 'utmSource', utm_medium: 'utmMedium', utm_campaign: 'utmCampaign',
      utm_content: 'utmContent', utm_term: 'utmTerm', gclid: 'gclid', fbclid: 'fbclid'
    };
    Object.keys(map).forEach(function (k) {
      var v = q.get(k);
      if (v) tracking.utm[map[k]] = v;
    });
    tracking.referrer = document.referrer || '';
    tracking.landingPage = location.href;
  }

  readSession();
  applyHeadline();
  captureAttribution();
  render();
})();
