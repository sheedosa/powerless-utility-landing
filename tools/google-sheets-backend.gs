/**
 * Powerless Utility — Google Sheets backend for the landing-page funnel.
 *
 * Receives every submission from the lead form and writes it to one of two
 * tabs, then keeps a Summary tab in step. Creates and formats the tabs itself
 * on first run — there is nothing to set up in the sheet by hand.
 *
 *   Leads        every visitor who completed the form (Qualified / Needs review)
 *   Unqualified  every visitor the funnel turned away, with the reason
 *   Summary      live counts, pulled from the two tabs with formulas
 *
 * SETUP
 *  1. Create a Google Sheet. Name it whatever you like.
 *  2. Extensions → Apps Script. Delete the placeholder, paste this file in.
 *  3. Change SHARED_TOKEN below to a random string of your own.
 *  4. Deploy → New deployment → type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     "Anyone" is required — the visitor's browser posts to it without signing
 *     in. The token is what stops strangers writing rows.
 *  5. Authorise when prompted. Google will warn that the app is unverified;
 *     that is expected for your own script.
 *  6. Copy the /exec URL. It goes in app.js as CONFIG.leadEndpoint, and the
 *     same token goes in CONFIG.leadToken.
 *
 * Re-deploy (Deploy → Manage deployments → edit → Version: New version) after
 * any change to this file, or the live URL keeps running the old code.
 */

// Must match CONFIG.leadToken in app.js.
var SHARED_TOKEN = 'CHANGE_ME_TO_SOMETHING_RANDOM';

var LEADS_TAB = 'Leads';
var UNQUALIFIED_TAB = 'Unqualified';
var SUMMARY_TAB = 'Summary';

/* Column order for each tab. Add a field at the END of a list rather than in
   the middle, so existing rows keep lining up with their headers. */
var LEAD_COLUMNS = [
  ['Received', 'receivedAt'],
  ['Status', 'status'],
  ['Name', 'name'],
  ['Phone', 'phone'],
  ['Email', 'email'],
  ['Address', 'address'],
  ['City', 'city'],
  ['State', 'state'],
  ['ZIP', 'zip'],
  ['Monthly bill', 'bill'],
  ['Owns home', 'homeowner'],
  ['Shade', 'shade'],
  ['Roof age', 'roofAge'],
  ['Timeline', 'timeline'],
  ['Address entry', 'addressSource'],
  ['Consent', 'consentGiven'],
  ['Consent version', 'consentVersion'],
  ['Consent wording', 'consentDisclosure'],
  ['Submitted (visitor time)', 'visitorTime'],
  ['Timezone', 'timeZone'],
  ['Page', 'pageUrl'],
  ['Source', 'utmSource'],
  ['Medium', 'utmMedium'],
  ['Campaign', 'utmCampaign'],
  ['Referrer', 'referrer'],
  ['Event ID', 'eventId']
];

var UNQUALIFIED_COLUMNS = [
  ['Received', 'receivedAt'],
  ['Reason', 'reason'],
  ['Address', 'address'],
  ['City', 'city'],
  ['State', 'state'],
  ['ZIP', 'zip'],
  ['Monthly bill', 'bill'],
  ['Owns home', 'homeowner'],
  ['Address entry', 'addressSource'],
  ['Submitted (visitor time)', 'visitorTime'],
  ['Timezone', 'timeZone'],
  ['Page', 'pageUrl'],
  ['Source', 'utmSource'],
  ['Medium', 'utmMedium'],
  ['Campaign', 'utmCampaign'],
  ['Referrer', 'referrer'],
  ['Event ID', 'eventId']
];

/** Entry point: the form POSTs here. */
function doPost(e) {
  // One writer at a time, so two submissions in the same second cannot land on
  // the same row.
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

    if (payload.type === 'disqualified') {
      appendTo_(UNQUALIFIED_TAB, UNQUALIFIED_COLUMNS, row);
    } else {
      appendTo_(LEADS_TAB, LEAD_COLUMNS, row);
    }
    buildSummary_();
    return reply_(true, 'ok');
  } catch (err) {
    // Never lose a submission to a formatting bug: park it where it can be
    // recovered by hand.
    try { logFailure_(e, err); } catch (ignored) {}
    return reply_(false, String(err));
  } finally {
    lock.releaseLock();
  }
}

/** Visiting the /exec URL in a browser confirms the deployment is alive. */
function doGet() {
  return reply_(true, 'Powerless Utility funnel endpoint is running.');
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
}

/** Nested payload -> the flat field names the column lists refer to. */
function flatten_(p) {
  var consent = p.consentRecord || {};
  return {
    receivedAt: new Date(),
    status: p.status || '',
    reason: p.reason || '',
    name: p.name || '',
    phone: p.phone || '',
    email: p.email || '',
    address: p.address || '',
    city: p.city || '',
    state: p.state || '',
    zip: p.zip || '',
    bill: p.bill || '',
    homeowner: p.homeowner || '',
    shade: p.shade || '',
    roofAge: p.roofAge || '',
    timeline: p.timeline || '',
    addressSource: p.addressSource || '',
    consentGiven: p.consent ? 'Yes' : 'No',
    consentVersion: consent.version || '',
    consentDisclosure: consent.disclosure || '',
    visitorTime: p.submittedAt || '',
    timeZone: p.timeZone || '',
    pageUrl: consent.pageUrl || p.landingPage || '',
    utmSource: p.utmSource || '',
    utmMedium: p.utmMedium || '',
    utmCampaign: p.utmCampaign || '',
    referrer: p.referrer || '',
    eventId: p.eventId || ''
  };
}

/** A retried submission carries the same eventId; write it once. */
function isDuplicate_(eventId) {
  if (!eventId) return false;
  var seen = PropertiesService.getScriptProperties();
  var key = 'seen_' + eventId;
  if (seen.getProperty(key)) return true;
  seen.setProperty(key, '1');
  return false;
}

function appendTo_(tabName, columns, row) {
  var sheet = ensureSheet_(tabName, columns);
  var values = columns.map(function (col) { return row[col[1]]; });
  sheet.appendRow(values);
  styleRow_(sheet, sheet.getLastRow(), tabName, row);
}

/** Creates the tab with headers and formatting the first time it is needed. */
function ensureSheet_(tabName, columns) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(tabName);
  if (sheet) return sheet;

  sheet = book.insertSheet(tabName);
  var headers = columns.map(function (col) { return col[0]; });
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var head = sheet.getRange(1, 1, 1, headers.length);
  head.setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#0077A8')
      .setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.getRange(1, 1, 1, headers.length).createFilter();

  // Readable defaults; the long free-text columns stay narrow and wrapped.
  for (var i = 0; i < headers.length; i++) {
    var name = headers[i];
    var width = 150;
    if (name === 'Address') width = 260;
    else if (name === 'Consent wording') width = 240;
    else if (name === 'Received' || name === 'Submitted (visitor time)') width = 165;
    else if (name === 'Email' || name === 'Page' || name === 'Referrer') width = 200;
    else if (name === 'Reason') width = 210;
    else if (name === 'ZIP' || name === 'State' || name === 'Consent') width = 80;
    sheet.setColumnWidth(i + 1, width);
  }
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  var wordy = headers.indexOf('Consent wording');
  if (wordy !== -1) sheet.getRange(2, wordy + 1, sheet.getMaxRows() - 1, 1).setWrap(false);

  return sheet;
}

/** Colour the status/reason cell so the tab scans at a glance. */
function styleRow_(sheet, rowIndex, tabName, row) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var key = tabName === LEADS_TAB ? 'Status' : 'Reason';
  var col = headers.indexOf(key);
  if (col === -1) return;

  var cell = sheet.getRange(rowIndex, col + 1);
  if (tabName === LEADS_TAB) {
    if (row.status === 'Qualified') cell.setBackground('#D9F2E3').setFontColor('#0B6B3A');
    else cell.setBackground('#FDF0D5').setFontColor('#8A5A00');
  } else {
    cell.setBackground('#FBE3E1').setFontColor('#9B2C20');
  }
  cell.setFontWeight('bold');
}

/**
 * Summary tab. Written as formulas rather than pasted numbers, so it stays
 * correct if rows are edited or deleted by hand.
 */
function buildSummary_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SUMMARY_TAB);
  if (!sheet) {
    sheet = book.insertSheet(SUMMARY_TAB, 0);
  } else if (sheet.getRange('A1').getValue() === 'Powerless Utility — funnel') {
    return;  // already built; the formulas keep themselves current
  }

  sheet.clear();
  var L = "'" + LEADS_TAB + "'";
  var U = "'" + UNQUALIFIED_TAB + "'";

  var rows = [
    ['Powerless Utility — funnel', ''],
    ['', ''],
    ['Qualified leads', '=COUNTIF(' + L + '!B:B,"Qualified")'],
    ['Needs review (outside the usual ZIPs)', '=COUNTIF(' + L + '!B:B,"Needs review")'],
    ['Unqualified', '=MAX(0,COUNTA(' + U + '!A:A)-1)'],
    ['', ''],
    ['Total who reached the form', '=B3+B4+B5'],
    ['Completed the form', '=B3+B4'],
    ['Completion rate', '=IF(B7=0,"—",TEXT(B8/B7,"0.0%"))'],
    ['', ''],
    ['Turned away: renters', '=COUNTIF(' + U + '!B:B,"Renter*")'],
    ['Turned away: co-op territory', '=COUNTIF(' + U + '!B:B,"Electric co-op*")'],
    ['Turned away: outside service area', '=COUNTIF(' + U + '!B:B,"Outside service*")'],
    ['', ''],
    ['Leads in the last 7 days', '=COUNTIFS(' + L + '!A:A,">="&TODAY()-7)'],
    ['Last submission', '=IF(COUNTA(' + L + '!A:A)<2,"—",TEXT(MAX(' + L + '!A:A),"d mmm yyyy, hh:mm"))']
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);

  sheet.getRange('A1').setFontSize(15).setFontWeight('bold').setFontColor('#111417');
  sheet.getRange('A3:A5').setFontWeight('bold');
  sheet.getRange('A7:A9').setFontWeight('bold');
  sheet.getRange('B3').setBackground('#D9F2E3').setFontColor('#0B6B3A').setFontWeight('bold');
  sheet.getRange('B4').setBackground('#FDF0D5').setFontColor('#8A5A00').setFontWeight('bold');
  sheet.getRange('B5').setBackground('#FBE3E1').setFontColor('#9B2C20').setFontWeight('bold');
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 170);
  sheet.setFrozenRows(1);
  sheet.getRange('B3:B16').setHorizontalAlignment('left');
}

/** Last resort: keep the raw body so a failed write is never a lost lead. */
function logFailure_(e, err) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName('Errors') || book.insertSheet('Errors');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['When', 'Error', 'Raw body']);
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
