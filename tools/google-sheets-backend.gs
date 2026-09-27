/**
 * Powerless Utility — Google Sheets backend for the landing-page funnel.
 *
 * Every form submission lands here and is written into this spreadsheet.
 * Laid out to work on a phone as well as a desktop: the Leads tab opens on
 * Name | Phone | Follow-up, the Summary fits a phone screen without sideways
 * scrolling, and every colour, dropdown and frozen pane is honoured by the
 * Google Sheets mobile app.
 *
 *   Summary      the numbers at a glance, starting with how many new leads
 *                are waiting for a call. All formulas, always current.
 *   Leads        people who finished the form, newest at the top. Work them
 *                from here: call, set Follow-up, add Notes.
 *   Unqualified  people the form turned away, and why. Not contacts — they
 *                never gave a phone number or consent. Do not call them.
 *   Consent log  the consent evidence for each lead, kept for your records.
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
 * RUNNING setup AGAIN is safe. Empty tabs are rebuilt so the latest layout
 * and styling always apply. A tab that already holds rows is never touched
 * (it keeps working even in an older layout — the script writes each field
 * under its own header) and setup tells you how to migrate it if it is out
 * of date. The Summary is rebuilt every time: it holds nothing but formulas.
 *
 * AFTER EDITING THIS FILE: Deploy → Manage deployments → pencil icon →
 * Version: New version → Deploy. Otherwise the website keeps using the old copy.
 */

// Must match CONFIG.leadToken in app.js. Change both together or neither.
var SHARED_TOKEN = '0ab4012780309936280410d292c8b210';

// Houston. Governs how the Received time is shown and the "last 7 days" maths.
var TIME_ZONE = 'America/Chicago';
var LOCALE = 'en_US';

var TABS = {
  summary: 'Summary',
  leads: 'Leads',
  unqualified: 'Unqualified',
  consent: 'Consent log',
  errors: 'Errors'
};

var INK = '#111417';
var BRAND = '#0077A8';
var TINT = '#E5F5FC';
var MUTED = '#5B6670';
var BAND = '#F5F7F9';
var DATE_FORMAT = 'd mmm yyyy, h:mm am/pm';
/* Rows a data tab starts with. Google's default 1,000 blank rows mean
   screens of empty scrolling on a phone; 100 keeps the tab finite, and each
   new lead inserts its own row so it never runs out. */
var STARTING_ROWS = 100;

// Shown on the phone's tab strip, so the right tab can be found by colour.
var TAB_COLOURS = {};
TAB_COLOURS[TABS.summary] = BRAND;
TAB_COLOURS[TABS.leads] = '#0B6B3A';
TAB_COLOURS[TABS.unqualified] = MUTED;
TAB_COLOURS[TABS.consent] = '#C7CDD2';
TAB_COLOURS[TABS.errors] = '#9B2C20';

var FOLLOW_UP_STAGES = ['New', 'Called', 'Booked', 'Not interested', 'Won'];

/* [header, field, width]. Fields come from flatten_().

   The header row is the contract: rows are written under whichever header
   carries each name, so columns can be reordered here (or dragged around in
   the sheet) without existing rows drifting out of line.

   Leads is ordered for a phone: the first screen is Name | Phone | Follow-up,
   which is everything needed to make the call and log what happened. */
var LEAD_COLUMNS = [
  ['Name', 'name', 130],
  ['Phone', 'phone', 110],
  ['Follow-up', 'followUp', 115],
  ['Notes', 'notes', 240],
  ['Received', 'receivedAt', 140],
  ['Status', 'status', 105],
  ['Email', 'email', 200],
  ['Address', 'address', 260],
  ['ZIP', 'zip', 60],
  ['Monthly bill', 'bill', 100],
  ['Shade', 'shade', 100],
  ['Roof age', 'roofAge', 85],
  ['Timeline', 'timeline', 115],
  ['Source', 'source', 120]
];

var UNQUALIFIED_COLUMNS = [
  ['Reason', 'reason', 170],
  ['Received', 'receivedAt', 140],
  ['ZIP', 'zip', 60],
  ['Address', 'address', 260],
  ['Monthly bill', 'bill', 100],
  ['Owns home', 'homeowner', 90],
  ['Source', 'source', 120]
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

/* ------------------------------------------------------------------ */
/* Run once from the editor (safe to run again)                       */
/* ------------------------------------------------------------------ */

/** Builds every tab so the sheet is ready before the first lead arrives. */
function setup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  book.setSpreadsheetTimeZone(TIME_ZONE);
  book.setSpreadsheetLocale(LOCALE);

  var notes = [];
  ensureTab_(TABS.leads, LEAD_COLUMNS, notes);
  ensureTab_(TABS.unqualified, UNQUALIFIED_COLUMNS, notes);
  ensureTab_(TABS.consent, CONSENT_COLUMNS, notes);
  rebuildSummary_();

  orderTabs_(book);
  var blank = book.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(blank);
  book.setActiveSheet(book.getSheetByName(TABS.summary));

  return notes.length ? 'Setup complete. ' + notes.join(' ') : 'Setup complete';
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
  var layout = layoutOf_(sheet, columns);
  var width = layout.length;
  sheet.insertRowBefore(2);

  var range = sheet.getRange(2, 1, 1, width);
  // The new row inherits the header's styling; reset it to plain body text.
  // Background stays unset so the row banding shows through.
  range.setBackground(null).setFontColor(INK).setFontWeight('normal')
       .setFontSize(11).setVerticalAlignment('middle');
  // Only Notes wraps: a long note grows its row; everything else stays one line.
  range.setWraps([layout.map(function (c) { return c[1] === 'notes'; })]);
  sheet.setRowHeight(2, 28);

  // Plain-text format on everything but the date, so Sheets never turns a ZIP
  // or phone number into a number and drops characters.
  range.setNumberFormats([layout.map(function (c) { return c[1] === 'receivedAt' ? DATE_FORMAT : '@'; })]);
  range.setValues([layout.map(function (c) {
    var v = c[1] ? row[c[1]] : '';
    return v === undefined || v === null ? '' : v;
  })]);

  var followUp = indexOfField_(layout, 'followUp');
  if (followUp !== -1) sheet.getRange(2, followUp + 1).setDataValidation(followUpRule_());

  // Tappable on a phone: opens the mail app.
  var email = indexOfField_(layout, 'email');
  if (email !== -1 && row.email) linkCell_(sheet.getRange(2, email + 1), row.email, 'mailto:' + row.email);
}

/**
 * The tab's columns in the order its header row actually has them, so a row
 * is always written under the right header even if the layout here has
 * changed since the tab was built, or columns were dragged around by hand.
 */
function layoutOf_(sheet, columns) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return columns;
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return header.map(function (h) {
    var label = String(h).trim();
    for (var i = 0; i < columns.length; i++) if (columns[i][0] === label) return columns[i];
    return [label, null, 0];   // a column the script does not know: left blank
  });
}

function headerMatches_(sheet, columns) {
  var layout = layoutOf_(sheet, columns);
  if (layout.length !== columns.length) return false;
  for (var i = 0; i < columns.length; i++) if (layout[i][0] !== columns[i][0]) return false;
  return true;
}

/** Turns a cell into a link. The plain value is already in the cell, so if
    this is refused nothing is lost. */
function linkCell_(cell, text, url) {
  try {
    cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(url).build());
  } catch (err) { /* plain text stays */ }
}

/* ------------------------------------------------------------------ */
/* Building tabs                                                      */
/* ------------------------------------------------------------------ */

/** Called on every submission: builds anything missing, touches nothing else. */
function ensureTabs_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var fresh = false;
  if (!book.getSheetByName(TABS.leads)) { buildTab_(TABS.leads, LEAD_COLUMNS); fresh = true; }
  if (!book.getSheetByName(TABS.unqualified)) buildTab_(TABS.unqualified, UNQUALIFIED_COLUMNS);
  if (!book.getSheetByName(TABS.consent)) buildTab_(TABS.consent, CONSENT_COLUMNS);
  if (!book.getSheetByName(TABS.summary)) buildSummary_();
  if (fresh) {
    // setup() was skipped; give the sheet the right clock anyway.
    book.setSpreadsheetTimeZone(TIME_ZONE);
    book.setSpreadsheetLocale(LOCALE);
  }
}

/** Called from setup(): build, keep, or rebuild a tab depending on its state. */
function ensureTab_(name, columns, notes) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(name);
  if (!sheet) return buildTab_(name, columns);

  var rows = Math.max(0, sheet.getLastRow() - 1);
  if (rows > 0) {
    if (!headerMatches_(sheet, columns)) {
      notes.push(name + ' has ' + rows + ' row' + (rows === 1 ? '' : 's') +
        ' in an older column order. It keeps working. To get the new layout, ' +
        'rename that tab (for example "' + name + ' old") and run setup again.');
    }
    return sheet;
  }

  // Empty: rebuild so the latest layout and styling always apply. Build the
  // new tab before deleting the old so the spreadsheet is never without one.
  sheet.setName(name + ' (old)');
  var built = buildTab_(name, columns);
  book.deleteSheet(sheet);
  return built;
}

function buildTab_(tabName, columns) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(tabName);
  var width = columns.length;
  sheet.setTabColor(TAB_COLOURS[tabName] || null);

  var head = sheet.getRange(1, 1, 1, width);
  head.setValues([columns.map(function (c) { return c[0]; })]);
  head.setFontWeight('bold').setFontColor('#FFFFFF').setBackground(BRAND)
      .setFontSize(10).setVerticalAlignment('middle').setWrap(false);
  sheet.setRowHeight(1, 32);
  sheet.setFrozenRows(1);
  // Only the working tab keeps a frozen column; on a phone it costs a third
  // of the screen, which the logs do not need.
  if (tabName === TABS.leads) sheet.setFrozenColumns(1);
  columns.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c[2]); });

  // Trim the unused columns and the surplus blank rows so the tab reads as
  // one clean, finite table (rows grow again as leads are inserted).
  var extra = sheet.getMaxColumns() - width;
  if (extra > 0) sheet.deleteColumns(width + 1, extra);
  var surplus = sheet.getMaxRows() - STARTING_ROWS;
  if (surplus > 0) sheet.deleteRows(STARTING_ROWS + 1, surplus);

  // Zebra rows keep the eye on one lead while swiping sideways on a phone.
  // The band must start at row 1: a row inserted at 2 then lands inside the
  // banded range and extends it, rather than pushing the range down.
  var band = sheet.getRange(1, 1, sheet.getMaxRows(), width)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  band.setHeaderRowColor(BRAND).setFirstRowColor('#FFFFFF').setSecondRowColor(BAND);

  // Filter over the whole table, so it grows with every inserted row.
  sheet.getRange(1, 1, sheet.getMaxRows(), width).createFilter();

  // The header is what rows are written by; a warning stops a stray tap
  // renaming it, without ever locking the owner out.
  head.protect().setDescription('Header row — the script writes rows by these names').setWarningOnly(true);

  var rules = [];
  if (tabName === TABS.leads) {
    var status = colLetter_(indexOfField_(columns, 'status') + 1);
    var followUp = indexOfField_(columns, 'followUp') + 1;
    var statusRange = sheet.getRange(status + ':' + status);
    rules.push(textRule_('Qualified', '#D9F2E3', '#0B6B3A', statusRange));
    rules.push(textRule_('Needs review', '#FDF0D5', '#8A5A00', statusRange));

    var fuLetter = colLetter_(followUp);
    var fuRange = sheet.getRange(fuLetter + ':' + fuLetter);
    rules.push(textRule_('New', TINT, BRAND, fuRange));
    rules.push(textRule_('Called', '#EFEAFB', '#5B3FA8', fuRange));
    rules.push(textRule_('Booked', '#D9F2E3', '#0B6B3A', fuRange));
    rules.push(textRule_('Won', '#0B6B3A', '#FFFFFF', fuRange));
    rules.push(textRule_('Not interested', '#EEF0F2', MUTED, fuRange));
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

/** The Summary holds nothing but formulas, so it is simply rebuilt. */
function rebuildSummary_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var old = book.getSheetByName(TABS.summary);
  if (old) old.setName(TABS.summary + ' (old)');
  var built = buildSummary_();
  if (old) book.deleteSheet(old);
  return built;
}

/**
 * The Summary tab: two narrow columns that fit a phone without sideways
 * scrolling, the number that matters most at the top, and one chart.
 * Column letters are read from the live tabs, so this stays right even if a
 * tab is in an older layout or its columns have been dragged around.
 */
function buildSummary_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.insertSheet(TABS.summary, 0);
  sheet.setTabColor(TAB_COLOURS[TABS.summary]);

  var leadsSheet = book.getSheetByName(TABS.leads);
  var unqSheet = book.getSheetByName(TABS.unqualified);
  var L = leadsSheet ? layoutOf_(leadsSheet, LEAD_COLUMNS) : LEAD_COLUMNS;
  var U = unqSheet ? layoutOf_(unqSheet, UNQUALIFIED_COLUMNS) : UNQUALIFIED_COLUMNS;
  var col = function (tab, layout, field) {
    var letter = colLetter_(indexOfField_(layout, field) + 1);
    return "'" + tab + "'!" + letter + ':' + letter;
  };
  var recv = col(TABS.leads, L, 'receivedAt');
  var status = col(TABS.leads, L, 'status');
  var fu = col(TABS.leads, L, 'followUp');
  var uRecv = col(TABS.unqualified, U, 'receivedAt');
  var uReason = col(TABS.unqualified, U, 'reason');
  var completed = 'MAX(0,COUNTA(' + recv + ')-1)';
  var turnedAway = 'MAX(0,COUNTA(' + uRecv + ')-1)';

  // [label, value, kind, accent]
  var rows = [
    ['Powerless Utility — Leads', '', 'title'],
    ['New leads to call', '=COUNTIF(' + fu + ',"New")', 'hero'],
    ['Leads in the last 7 days', '=COUNTIFS(' + recv + ',">="&(NOW()-7))', 'stat'],
    ['Leads in the last 30 days', '=COUNTIFS(' + recv + ',">="&(NOW()-30))', 'stat'],
    ['Latest lead', '=IF(COUNTA(' + recv + ')<2,"—",TEXT(MAX(' + recv + '),"' + DATE_FORMAT + '"))', 'stat'],
    ['', '', 'blank'],
    ['PIPELINE', '', 'section'],
    ['Called', '=COUNTIF(' + fu + ',"Called")', 'stat'],
    ['Booked', '=COUNTIF(' + fu + ',"Booked")', 'stat'],
    ['Won', '=COUNTIF(' + fu + ',"Won")', 'stat', 'green'],
    ['Not interested', '=COUNTIF(' + fu + ',"Not interested")', 'stat'],
    ['', '', 'blank'],
    ['LEADS', '', 'section'],
    ['Qualified', '=COUNTIF(' + status + ',"Qualified")', 'stat', 'green'],
    ['Needs review', '=COUNTIF(' + status + ',"Needs review")', 'stat', 'amber'],
    ['Unqualified', '=' + turnedAway, 'stat', 'red'],
    ['Completion rate', '=IF(' + completed + '+' + turnedAway + '=0,"—",TEXT(' + completed + '/(' + completed + '+' + turnedAway + '),"0%"))', 'stat'],
    ['', '', 'blank'],
    ['TURNED AWAY — WHY', '', 'section'],
    ['Renters', '=COUNTIF(' + uReason + ',"Renter*")', 'stat'],
    ['Electric co-op area', '=COUNTIF(' + uReason + ',"Electric co-op*")', 'stat'],
    ['Outside service area', '=COUNTIF(' + uReason + ',"Outside service*")', 'stat'],
    ['', '', 'blank'],
    ['LEADS BY WEEK', '', 'section']
  ];

  // Eight weeks, oldest first so the chart reads left to right. Each label is
  // the Monday the week started; each value counts leads received that week.
  var weekStart = rows.length + 1;
  for (var k = 7; k >= 0; k--) {
    var r = rows.length + 1;
    rows.push([
      '=TODAY()-WEEKDAY(TODAY(),2)+1-' + (7 * k),
      '=COUNTIFS(' + recv + ',">="&A' + r + ',' + recv + ',"<"&A' + r + '+7)',
      'week'
    ]);
  }

  sheet.getRange(1, 1, rows.length, 2).setValues(rows.map(function (row) { return [row[0], row[1]]; }));

  // Style by kind rather than by address, so rows can be reordered above.
  var ACCENT = {
    green: ['#D9F2E3', '#0B6B3A'],
    amber: ['#FDF0D5', '#8A5A00'],
    red: ['#FBE3E1', '#9B2C20']
  };
  rows.forEach(function (row, i) {
    var r = i + 1;
    var a = sheet.getRange(r, 1), b = sheet.getRange(r, 2);
    switch (row[2]) {
      case 'title':
        a.setFontSize(16).setFontWeight('bold').setFontColor(INK);
        sheet.setRowHeight(r, 40);
        break;
      case 'hero':
        a.setFontSize(12).setFontWeight('bold').setFontColor(INK);
        b.setFontSize(20).setFontWeight('bold').setFontColor(BRAND).setBackground(TINT);
        sheet.setRowHeight(r, 44);
        break;
      case 'section':
        a.setFontSize(9).setFontWeight('bold').setFontColor(MUTED);
        sheet.setRowHeight(r, 30);
        a.setVerticalAlignment('bottom');
        break;
      case 'week':
        // Dates right-align by default; keep these in line with the labels.
        a.setNumberFormat('d mmm').setFontColor(MUTED).setHorizontalAlignment('left');
        sheet.setRowHeight(r, 22);
        break;
      case 'blank':
        sheet.setRowHeight(r, 10);
        break;
      default:
        a.setFontSize(11).setFontColor(INK);
        b.setFontSize(11);
    }
    if (row[3] && ACCENT[row[3]]) b.setBackground(ACCENT[row[3]][0]).setFontColor(ACCENT[row[3]][1]).setFontWeight('bold');
  });
  sheet.getRange(1, 2, rows.length, 1).setHorizontalAlignment('right').setVerticalAlignment('middle');
  sheet.getRange(1, 1, rows.length, 1).setVerticalAlignment('middle');

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 100);
  // Nothing frozen: on a phone a pinned title row is just lost space.
  sheet.setFrozenRows(0);
  sheet.setHiddenGridlines(true);
  var extra = sheet.getMaxColumns() - 2;
  if (extra > 0) sheet.deleteColumns(3, extra);
  // Just enough rows for the chart below the table, then the sheet ends.
  var chartRow = rows.length + 2;
  var surplus = sheet.getMaxRows() - (chartRow + 12);
  if (surplus > 0) sheet.deleteRows(chartRow + 13, surplus);

  // The table above carries the exact numbers, so the chart is shape only:
  // no value axis (with little data it shows 0.25 / 0.50 ticks), the count
  // sits on each bar instead. Sized to fit inside the two columns on a phone.
  var chart = sheet.newChart()
    .asColumnChart()
    .addRange(sheet.getRange(weekStart, 1, 8, 2))
    .setNumHeaders(0)
    .setOption('title', 'Leads per week')
    .setOption('titleTextStyle', { color: INK, fontSize: 12, bold: true })
    .setOption('legend', { position: 'none' })
    .setOption('colors', [BRAND])
    .setOption('series', { 0: { dataLabel: 'value', color: BRAND } })
    .setOption('annotations', { alwaysOutside: true, textStyle: { color: INK, fontSize: 11, bold: true } })
    .setOption('hAxis', { format: 'd MMM', slantedText: false, textStyle: { color: MUTED, fontSize: 10 }, gridlines: { color: 'transparent' } })
    .setOption('vAxis', { viewWindow: { min: 0 }, textPosition: 'none', gridlines: { color: 'transparent', count: 0 }, minorGridlines: { count: 0 }, baselineColor: '#E3E7EB' })
    .setOption('chartArea', { left: 12, top: 36, width: '92%', height: '68%' })
    .setOption('bar', { groupWidth: '70%' })
    .setOption('width', 320)
    .setOption('height', 200)
    .setPosition(chartRow, 1, 0, 0)
    .build();
  sheet.insertChart(chart);

  return sheet;
}

function orderTabs_(book) {
  [TABS.summary, TABS.leads, TABS.unqualified, TABS.consent].forEach(function (name, i) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return;
    book.setActiveSheet(sheet);
    book.moveActiveSheet(i + 1);
  });
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
  var sheet = book.getSheetByName(TABS.errors);
  if (!sheet) {
    sheet = book.insertSheet(TABS.errors);
    sheet.setTabColor(TAB_COLOURS[TABS.errors]);
  }
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
