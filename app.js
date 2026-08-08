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
    leadEndpoint: null
  };

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

  var PERSIST_KEYS = ['step', 'dq', 'bill', 'zip', 'homeowner', 'shade', 'roofAge', 'timeline', 'needsReview'];
  var STORAGE_KEY = 'pu_lead_form';
  var MOBILE_MAX = 900;

  /* ------------------------------------------------------------------
     State — tap answers and ZIP persist for the session.
     Name / phone / email / consent are NEVER persisted (fresh consent
     is collected every time).
     ------------------------------------------------------------------ */
  var state = {
    step: 1, dq: null, done: false, needsReview: '',
    bill: null, zip: '', homeowner: null, shade: null, roofAge: null, timeline: null,
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

  var validate = {
    name: function (v) { return v.trim().length >= 2 ? '' : 'Please enter your full name.'; },
    phone: function (v) { return v.replace(/\D/g, '').length === 10 ? '' : 'Enter a valid 10-digit phone number.'; },
    email: function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? '' : 'Enter a valid email address.'; },
    zip: function (v) { return /^\d{5}$/.test(v) ? '' : 'Enter a 5-digit ZIP code.'; }
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
      '<label class="input-label spaced" for="pu-zip">ZIP code</label>' +
      '<input id="pu-zip" class="text-input mono" type="text" inputmode="numeric" autocomplete="postal-code" ' +
        'placeholder="77002" value="' + esc(state.zip) + '" data-field="zip">' +
      errBlock('zip') +
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
      '<label class="consent' + (state.errors.consent ? ' invalid' : '') + '" data-group="consent">' +
        '<input type="checkbox" data-field="consent"' + (state.consent ? ' checked' : '') + '>' +
        '<span>By checking this box, I expressly consent to receive marketing calls, text messages, and emails from ' +
        '<strong>' + esc(CONFIG.companyName) + '</strong> and its partners at the phone number and email I provided — ' +
        'including messages sent using an autodialer or prerecorded voice. I understand consent is not a condition of any ' +
        'purchase, and message &amp; data rates may apply. Reply STOP to opt out at any time.</span>' +
      '</label>' +
      errBlock('consent') +
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
      p: 'Your ZIP code sits in an electric cooperative territory where we cannot currently install. This changes as agreements are signed, so it is worth checking back.'
    },
    out: {
      h: 'Outside our service area',
      p: 'We currently install around Houston, and your ZIP code falls outside that. We are expanding, so this may change.'
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
    var errs = {
      bill: state.bill ? '' : 'Select your average monthly bill.',
      zip: validate.zip(state.zip),
      homeowner: state.homeowner ? '' : 'Please select one.'
    };
    Object.keys(errs).forEach(function (k) { setErr(k, errs[k]); });
    announce(errs.bill || errs.zip || errs.homeowner || '');

    var first = errs.bill ? '[data-group="bill"]' : errs.zip ? '#pu-zip' : errs.homeowner ? '[data-group="homeowner"]' : null;
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

    var eventId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);

    var lead = {
      submittedAt: new Date().toISOString(),
      needsReview: state.needsReview,
      name: state.name,
      email: state.email,
      phone: '+1' + state.phone.replace(/\D/g, ''),
      zip: state.zip,
      homeowner: state.homeowner,
      bill: state.bill,
      shade: state.shade,
      roofAge: state.roofAge,
      timeline: state.timeline,
      consent: state.consent,
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
      bill: null, zip: '', homeowner: null, shade: null, roofAge: null, timeline: null,
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
    if (field === 'zip') {
      firstStart();
      state.zip = e.target.value.replace(/\D/g, '').slice(0, 5);
      if (e.target.value !== state.zip) e.target.value = state.zip;
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
