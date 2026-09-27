/**
 * Powerless Utility — Google Sheets backend for the landing-page funnel.
 *
 * Every form submission lands here and is written into this spreadsheet:
 *
 *   Summary      the numbers at a glance — all formulas, always current
 *   Leads        people who finished the form, newest at the top. Work them
 *                from here: set Follow-up and add Notes as you call.
 *   Unqualified  people the form turned away, and why. Not contacts — they
 *                never gave a phone number or consent. Do not call them.
 *   Consent log  the consent evidence for each lead, kept for your records.
 *                Matches a Leads row by the Received time and name.
 *   Errors       only appears if a submission ever fails to save; the raw
 *                data is kept here so no lead is lost.
 *
 * SETUP (once, about two minutes)
 *  1. In this spreadsheet: Extensions → Apps Script.
 *  2. Delete whatever is in the editor and paste this whole file in. Save.
 *  3. Pick "setup" in the function dropdown at the top, press Run, and allow
 *     access when Google asks. It warns the app is unverified — that is normal
 *     for your own script: Advanced → Go to (project) → Allow.
 *     The tabs appear in the spreadsheet, ready to use.
 *  4. Deploy → New deployment → gear icon → Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     Deploy, then copy the Web app URL (it ends in /exec).
 *     "Anyone" is needed because visitors' browsers send the form without
 *     signing in to Google. SHARED_TOKEN below is what stops strangers.
 *
 * AFTER EDITING THIS FILE: Deploy → Manage deployments → pencil icon →
 * Version: New version → Deploy. Otherwise the website keeps using the old copy.
 */

// Must match CONFIG.leadToken in app.js. Change both together or neither.
var SHARED_TOKEN = '0ab4012780309936280410d292c8b210';

var TABS = {
  summary: 'Summary',
  leads: 'Leads',
  unqualified: 'Unqualified',
  consent: 'Consent log',
  errors: 'Errors'
};

var FOLLOW_UP_STAGES = ['New', 'Called', 'Booked', 'Not interested', 'Won'];

/* [header, field, width]. Fields come from flatten_(). Add new columns at the
   END of a list so existing rows keep lining up with their headers. */
var LEAD_COLUMNS = [
  ['Received', 'receivedAt', 140],
  ['Status', 'status', 110],
  ['Follow-up', 'followUp', 120],
  ['Notes', 'notes', 220],
  ['Name', 'name', 160],
  ['Phone', 'phone', 130],
  ['Email', 'email', 210],
  ['Address', 'address', 280],
  ['ZIP', 'zip', 70],
  ['Monthly bill', 'bill', 105],
  ['Shade', 'shade', 110],
  ['Roof age', 'roofAge', 90],
  ['Timeline', 'timeline', 125],
  ['Source', 'source', 130]
];

var UNQUALIFIED_COLUMNS = [
  ['Received', 'receivedAt', 140],
  ['Reason', 'reason', 230],
  ['Address', 'address', 280],
  ['ZIP', 'zip', 70],
  ['Monthly bill', 'bill', 105],
  ['Owns home', 'homeowner', 95],
  ['Source', 'source', 130]
];

var CONSENT_COLUMNS = [
  ['Received', 'receivedAt', 140],
  ['Event ID', 'eventId', 150],
  ['Name', 'name', 160],
  ['Phone', 'phone', 130],
  ['Email', 'email', 210],
  ['Consent', 'consentGiven', 80],
  ['Version', 'consentVersion', 110],
  ['Wording shown', 'consentDisclosure', 320],
  ['Visitor time', 'visitorTime', 190],
  ['Timezone', 'timeZone', 130],
  ['Page', 'pageUrl', 240],
  ['Campaign', 'utmCampaign', 130],
  ['Referrer', 'referrer', 200]
];

var INK = '#111417';
var BRAND = '#0077A8';
var DATE_FORMAT = 'd mmm yyyy, h:mm am/pm';

/* ------------------------------------------------------------------ */
/* Run once from the editor                                           */
/* ------------------------------------------------------------------ */

/** Builds every tab so the sheet is ready before the first lead arrives. */
function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs_();

  // Tidy the tab order and drop the blank sheet Google creates by default.
  [TABS.summary, TABS.leads, TABS.unqualified, TABS.consent].forEach(function (name, i) {
    var sheet = book.getSheetByName(name);
    book.setActiveSheet(sheet);
    book.moveActiveSheet(i + 1);
  });
  var blank = book.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(blank);
  book.setActiveSheet(book.getSheetByName(TABS.summary));

  return 'Setup complete';
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                               */
/* ------------------------------------------------------------------ */

/** The website POSTs each submission here. */
function doPost(e) {
  // One write at a time, so two submissions in the same second cannot collide.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return reply_(false, 'busy');
  }

  try {
    var payload = parseBody_(e);
    if (!payload) return reply_(false, 'bad request');
    if (String(payload.token || '') !== SHARED_TOKEN) return reply_(false, 'unauthorised');

    var row = flatten_(payload);
    if (isDuplicate_(row.eventId)) return reply_(true, 'duplicate ignored');

    ensureTabs_();
    if (payload.type === 'disqualified') {
      insertNewest_(TABS.unqualified, UNQUALIFIED_COLUMNS, row);
    } else {
      insertNewest_(TABS.leads, LEAD_COLUMNS, row);
      insertNewest_(TABS.consent, CONSENT_COLUMNS, row);
    }
    return reply_(true, 'ok');
  } catch (err) {
    // Never lose a submission to a bug: park the raw data where it can be
    // recovered by hand.
    try { logFailure_(e, err); } catch (ignored) {}
    return reply_(false, String(err));
  } finally {
    lock.releaseLock();
  }
}

/** Opening the /exec URL in a browser confirms the deployment is alive. */
function doGet() {
  return reply_(true, 'Powerless Utility lead endpoint is running.');
}

/* ------------------------------------------------------------------ */
/* Payload                                                            */
/* ------------------------------------------------------------------ */

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

/** Browser payload -> the flat fields the column lists refer to. */
function flatten_(p) {
  var consent = p.consentRecord || {};
  return {
    receivedAt: new Date(),
    status: p.status || '',
    followUp: 'New',
    notes: '',
    reason: p.reason || '',
    name: p.name || '',
    phone: formatPhone_(p.phone),
    email: p.email || '',
    address: p.address || '',
    zip: p.zip || '',
    bill: p.bill || '',
    homeowner: p.homeowner || '',
    shade: p.shade || '',
    roofAge: p.roofAge || '',
    timeline: p.timeline || '',
    source: sourceOf_(p),
    consentGiven: p.consent ? 'Yes' : 'No',
    consentVersion: consent.version || '',
    consentDisclosure: consent.disclosure || '',
    visitorTime: p.submittedAt || '',
    timeZone: p.timeZone || '',
    pageUrl: consent.pageUrl || p.landingPage || '',
    utmCampaign: p.utmCampaign || '',
    referrer: p.referrer || '',
    eventId: p.eventId || ''
  };
}

/** +18328847302 -> (832) 884-7302, which is easier to read and to dial. */
function formatPhone_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if (d.length !== 10) return String(raw || '');
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

/** Campaign source if tagged, else the referring site, else Direct. */
function sourceOf_(p) {
  if (p.utmSource) return p.utmSource;
  var host = String(p.referrer || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '');
  if (host && host.indexOf('powerlessutility.com') === -1) return host;
  return 'Direct';
}

/**
 * A retried submission carries the same eventId, so write it once. Retries
 * arrive within seconds; a 6-hour cache covers them and, unlike storing every
 * id forever, can never fill up.
 */
function isDuplicate_(eventId) {
  if (!eventId) return false;
  var cache = CacheService.getScriptCache();
  var key = 'seen_' + eventId;
  if (cache.get(key)) return true;
  cache.put(key, '1', 21600);
  return false;
}

/* ------------------------------------------------------------------ */
/* Writing rows                                                       */
/* ------------------------------------------------------------------ */

/** Inserts the row directly under the header, so the newest is always on top. */
function insertNewest_(tabName, columns, row) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  var width = columns.length;
  sheet.insertRowBefore(2);

  var range = sheet.getRange(2, 1, 1, width);
  // The new row inherits the header's styling; reset it to plain body text.
  range.setBackground(null).setFontColor(INK).setFontWeight('normal')
       .setFontSize(10).setWrap(false).setVerticalAlignment('middle');
  sheet.setRowHeight(2, 24);

  // Plain-text format on everything but the date, so Sheets never turns a ZIP
  // or phone number into a number and drops characters.
  range.setNumberFormats([columns.map(function (c) { return c[1] === 'receivedAt' ? DATE_FORMAT : '@'; })]);
  range.setValues([columns.map(function (c) { return row[c[1]]; })]);

  if (tabName === TABS.leads) {
    var followUp = indexOfField_(columns, 'followUp');
    sheet.getRange(2, followUp + 1).setDataValidation(followUpRule_());
  }
}

/* ------------------------------------------------------------------ */
/* Building tabs                                                      */
/* ------------------------------------------------------------------ */

function ensureTabs_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book.getSheetByName(TABS.leads)) buildTab_(TABS.leads, LEAD_COLUMNS);
  if (!book.getSheetByName(TABS.unqualified)) buildTab_(TABS.unqualified, UNQUALIFIED_COLUMNS);
  if (!book.getSheetByName(TABS.consent)) buildTab_(TABS.consent, CONSENT_COLUMNS);
  if (!book.getSheetByName(TABS.summary)) buildSummary_();
}

function buildTab_(tabName, columns) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(tabName);
  var width = columns.length;

  var head = sheet.getRange(1, 1, 1, width);
  head.setValues([columns.map(function (c) { return c[0]; })]);
  head.setFontWeight('bold').setFontColor('#FFFFFF').setBackground(BRAND)
      .setVerticalAlignment('middle').setWrap(false);
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  columns.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c[2]); });

  // Trim the unused columns to the right so the tab reads as one clean table.
  var extra = sheet.getMaxColumns() - width;
  if (extra > 0) sheet.deleteColumns(width + 1, extra);

  // Filter over the whole table, so it grows with every inserted row.
  sheet.getRange(1, 1, sheet.getMaxRows(), width).createFilter();

  var rules = [];
  if (tabName === TABS.leads) {
    var status = colLetter_(indexOfField_(columns, 'status') + 1);
    var followUp = indexOfField_(columns, 'followUp') + 1;
    var statusRange = sheet.getRange(status + ':' + status);
    rules.push(textRule_('Qualified', '#D9F2E3', '#0B6B3A', statusRange));
    rules.push(textRule_('Needs review', '#FDF0D5', '#8A5A00', statusRange));

    var fuLetter = colLetter_(followUp);
    var fuRange = sheet.getRange(fuLetter + ':' + fuLetter);
    rules.push(textRule_('New', '#E5F5FC', BRAND, fuRange));
    rules.push(textRule_('Called', '#EFEAFB', '#5B3FA8', fuRange));
    rules.push(textRule_('Booked', '#D9F2E3', '#0B6B3A', fuRange));
    rules.push(textRule_('Won', '#0B6B3A', '#FFFFFF', fuRange));
    rules.push(textRule_('Not interested', '#EEF0F2', '#5B6670', fuRange));
    sheet.getRange(2, followUp, sheet.getMaxRows() - 1, 1).setDataValidation(followUpRule_());
  } else if (tabName === TABS.unqualified) {
    var reason = colLetter_(indexOfField_(columns, 'reason') + 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ROW()>1,LEN($' + reason + '1)>0)')
      .setBackground('#FBE3E1').setFontColor('#9B2C20')
      .setRanges([sheet.getRange(reason + ':' + reason)])
      .build());
  }
  if (rules.length) sheet.setConditionalFormatRules(rules);

  return sheet;
}

/** The Summary tab: labels and formulas only, so it never goes stale. */
function buildSummary_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(TABS.summary, 0);
  var L = "'" + TABS.leads + "'";
  var U = "'" + TABS.unqualified + "'";

  var rows = [
    ['Powerless Utility — Leads', ''],
    ['', ''],
    ['Qualified', '=COUNTIF(' + L + '!B:B,"Qualified")'],
    ['Needs review (ZIP outside the usual area)', '=COUNTIF(' + L + '!B:B,"Needs review")'],
    ['Unqualified', '=MAX(0,COUNTA(' + U + '!A:A)-1)'],
    ['Completion rate', '=IF(B3+B4+B5=0,"—",TEXT((B3+B4)/(B3+B4+B5),"0%"))'],
    ['', ''],
    ['FOLLOW-UP', ''],
    ['New — not yet called', '=COUNTIF(' + L + '!C:C,"New")'],
    ['Called', '=COUNTIF(' + L + '!C:C,"Called")'],
    ['Booked', '=COUNTIF(' + L + '!C:C,"Booked")'],
    ['Won', '=COUNTIF(' + L + '!C:C,"Won")'],
    ['Not interested', '=COUNTIF(' + L + '!C:C,"Not interested")'],
    ['', ''],
    ['WHY PEOPLE WERE TURNED AWAY', ''],
    ['Renters', '=COUNTIF(' + U + '!B:B,"Renter*")'],
    ['Electric co-op area', '=COUNTIF(' + U + '!B:B,"Electric co-op*")'],
    ['Outside service area', '=COUNTIF(' + U + '!B:B,"Outside service*")'],
    ['', ''],
    ['Leads in the last 7 days', '=COUNTIFS(' + L + '!A:A,">="&(NOW()-7))'],
    ['Latest lead', '=IF(COUNTA(' + L + '!A:A)<2,"—",TEXT(MAX(' + L + '!A:A),"d mmm yyyy, h:mm am/pm"))']
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);

  sheet.getRange('A1').setFontSize(16).setFontWeight('bold').setFontColor(INK);
  sheet.getRange('A3:A6').setFontWeight('bold');
  ['A8', 'A15'].forEach(function (a) {
    sheet.getRange(a).setFontWeight('bold').setFontColor('#5B6670').setFontSize(9);
  });
  sheet.getRange('B3').setBackground('#D9F2E3').setFontColor('#0B6B3A').setFontWeight('bold');
  sheet.getRange('B4').setBackground('#FDF0D5').setFontColor('#8A5A00').setFontWeight('bold');
  sheet.getRange('B5').setBackground('#FBE3E1').setFontColor('#9B2C20').setFontWeight('bold');
  sheet.getRange('B9').setBackground('#E5F5FC').setFontColor(BRAND).setFontWeight('bold');
  sheet.getRange('B1:B' + rows.length).setHorizontalAlignment('left');
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 200);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);

  var extra = sheet.getMaxColumns() - 2;
  if (extra > 0) sheet.deleteColumns(3, extra);
  return sheet;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function followUpRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(FOLLOW_UP_STAGES, true)
    .setAllowInvalid(false)
    .build();
}

function textRule_(text, bg, fg, range) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setBold(true)
    .setRanges([range])
    .build();
}

function indexOfField_(columns, field) {
  for (var i = 0; i < columns.length; i++) if (columns[i][1] === field) return i;
  return -1;
}

/** 1 -> A, 27 -> AA. */
function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Last resort: keep the raw body so a failed write is never a lost lead. */
function logFailure_(e, err) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(TABS.errors) || book.insertSheet(TABS.errors);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['When', 'Error', 'Raw submission']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#FBE3E1');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    String(err),
    (e && e.postData && e.postData.contents) ? e.postData.contents : '(no body)'
  ]);
}

function reply_(ok, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
