// Google Apps Script — Web Backend
// Credentials: set via Apps Script → Project Settings → Script Properties:
//   SUPABASE_URL  = https://jeacujiixlucffbuusme.supabase.co
//   SUPABASE_KEY  = (anon key — set manually, never committed to git)

const SHEET_NAME = 'Submissions';

const CBS = {
  housing:4800, groceries:2700, eatingOut:650,
  transport:2100, utilities:1300, insurance:800, entertainment:600,
};

const REGIONAL = {
  'תל אביב':     {housing:1.55,groceries:1.10,eatingOut:1.20,transport:1.05,utilities:1.05,insurance:1.10,entertainment:1.20},
  'גוש דן':      {housing:1.30,groceries:1.05,eatingOut:1.10,transport:1.05,utilities:1.05,insurance:1.05,entertainment:1.10},
  'השרון':       {housing:1.20,groceries:1.05,eatingOut:1.08,transport:1.05,utilities:1.00,insurance:1.05,entertainment:1.08},
  'מרכז':        {housing:1.12,groceries:1.02,eatingOut:1.05,transport:1.00,utilities:1.00,insurance:1.02,entertainment:1.05},
  'שפלה':        {housing:0.80,groceries:0.95,eatingOut:0.88,transport:0.98,utilities:1.00,insurance:0.92,entertainment:0.82},
  'ירושלים':     {housing:1.25,groceries:1.00,eatingOut:1.05,transport:0.95,utilities:1.00,insurance:1.00,entertainment:1.00},
  'חיפה':        {housing:0.85,groceries:0.98,eatingOut:0.95,transport:0.98,utilities:1.00,insurance:0.98,entertainment:0.95},
  'צפון עירוני': {housing:0.72,groceries:0.96,eatingOut:0.90,transport:1.02,utilities:1.00,insurance:0.95,entertainment:0.87},
  'צפון כפרי':   {housing:0.58,groceries:0.93,eatingOut:0.82,transport:1.10,utilities:1.00,insurance:0.92,entertainment:0.78},
  'אשדוד':       {housing:0.80,groceries:0.95,eatingOut:0.90,transport:0.98,utilities:1.00,insurance:0.95,entertainment:0.88},
  'באר שבע':     {housing:0.65,groceries:0.93,eatingOut:0.85,transport:1.05,utilities:1.00,insurance:0.92,entertainment:0.80},
};

const HH   = {1:.55, 2:.80, 3:1.00, 4:1.20, 5:1.38, 6:1.55};
const CATS = ['housing','groceries','eatingOut','transport','insurance','utilities','entertainment'];

// ── GET: return live crowd count ──
function doGet(e) {
  const count = getSheet().getLastRow() - 1;
  return json({ count: Math.max(count, 0) });
}

// ── POST: save submission + send email ──
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const email = (data.email || '').trim();
    if (!email.includes('@')) return json({ ok: false, error: 'invalid email' });

    saveToSheet(data);
    saveToSupabase(data, 'web');
    sendReport(data);

    const count = getSheet().getLastRow() - 1;
    return json({ ok: true, count: Math.max(count, 0) });
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

// ── Save to Google Sheet ──
function saveToSheet(d) {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp','source','email','city','hhSize',...CATS]);
  }
  sheet.appendRow([
    new Date(), d.source || 'web', d.email || '', d.city || '', d.hhSize || '',
    ...CATS.map(k => d[k] || 0),
  ]);
}

// ── Save to Supabase ──
function saveToSupabase(d, source) {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_KEY');
  if (!url || !key) return; // skip silently if not configured yet

  const payload = {
    source:        source || 'web',
    email:         d.email    || '',
    city:          d.city     || '',
    hh_size:       parseInt(d.hhSize) || null,
    housing:       parseInt(d.housing)       || 0,
    groceries:     parseInt(d.groceries)     || 0,
    eating_out:    parseInt(d.eatingOut)     || 0,
    transport:     parseInt(d.transport)     || 0,
    insurance:     parseInt(d.insurance)     || 0,
    utilities:     parseInt(d.utilities)     || 0,
    entertainment: parseInt(d.entertainment) || 0,
  };

  UrlFetchApp.fetch(url + '/rest/v1/submissions', {
    method:  'post',
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    payload:          JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

// ── One-time migration: Google Sheet → Supabase ──
// Run this manually once from the Apps Script editor (Run → migrateSheetToSupabase)
function migrateSheetToSupabase() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) { Logger.log('No data to migrate.'); return; }

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const idx = k => headers.indexOf(k);

  let success = 0, failed = 0;

  rows.slice(1).forEach((row, i) => {
    try {
      const d = {
        source:        row[idx('source')] || 'sheet',
        email:         row[idx('email')]  || '',
        city:          row[idx('city')]   || '',
        hhSize:        row[idx('hhsize')] || row[idx('hh_size')] || '',
        housing:       row[idx('housing')]       || 0,
        groceries:     row[idx('groceries')]     || 0,
        eatingOut:     row[idx('eatingout')]     || row[idx('eating_out')] || 0,
        transport:     row[idx('transport')]     || 0,
        insurance:     row[idx('insurance')]     || 0,
        utilities:     row[idx('utilities')]     || 0,
        entertainment: row[idx('entertainment')] || 0,
      };
      saveToSupabase(d, d.source);
      success++;
      Utilities.sleep(100); // avoid rate limiting
    } catch (e) {
      Logger.log('Row ' + (i + 2) + ' failed: ' + e.message);
      failed++;
    }
  });

  Logger.log('Migration complete. Success: ' + success + ', Failed: ' + failed);
}

// ── Send personalized HTML email ──
function sendReport(d) {
  const city    = d.city || '';
  const hhSize  = parseInt(d.hhSize) || 3;
  const hFactor = HH[Math.min(hhSize, 6)] || 1.0;
  const rf      = REGIONAL[city] || {};

  const catLabels = {
    housing:'דיור', groceries:'סופר ומזון', eatingOut:'אוכל בחוץ ומשלוחים',
    transport:'תחבורה', insurance:'ביטוחים', utilities:'חשבונות', entertainment:'בילויים ומנויים',
  };

  let totalUser = 0, totalAvg = 0, rows = '';

  CATS.forEach(key => {
    const userVal = parseInt(d[key]) || 0;
    const avgVal  = Math.round(CBS[key] * hFactor * (rf[key] || 1.0));
    const diff    = ((userVal - avgVal) / avgVal) * 100;
    totalUser += userVal;
    totalAvg  += avgVal;

    let icon, label, color;
    if (diff > 20)       { icon='⬆️'; label='גבוה מהממוצע'; color='#c0392b'; }
    else if (diff < -20) { icon='⬇️'; label='נמוך מהממוצע'; color='#27ae60'; }
    else                 { icon='✅'; label='בטווח הממוצע';  color='#2980b9'; }

    rows += `<tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:11px 10px;font-size:14px;text-align:right;">${catLabels[key]}</td>
      <td style="padding:11px 10px;text-align:center;font-weight:600;">₪${Math.round(userVal).toLocaleString()}</td>
      <td style="padding:11px 10px;text-align:center;color:#888;">₪${Math.round(avgVal).toLocaleString()}</td>
      <td style="padding:11px 10px;text-align:center;color:${color};font-weight:600;">${icon} ${label}</td>
    </tr>`;
  });

  const diff    = totalUser - totalAvg;
  const pct     = Math.round(Math.abs(diff / totalAvg) * 100);
  const verdict = diff > totalAvg * .15
    ? `⬆ מוציאים ${pct}% יותר מהממוצע — פוטנציאל חיסכון: ₪${Math.round(diff).toLocaleString()} בחודש`
    : diff < -totalAvg * .10
    ? `⬇ מוציאים ${pct}% פחות מהממוצע — כל הכבוד!`
    : `✅ אתם בטווח הממוצע`;

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,sans-serif;direction:rtl;">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.09);">
  <div style="background:#1a1a2e;padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:20px;">הדוח האישי שלכם</h1>
    <p style="color:#9999bb;margin:6px 0 0;font-size:13px;">${city} · ${hhSize} נפשות</p>
  </div>
  <div style="padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8f8f8;border-bottom:2px solid #eee;">
        <th style="padding:10px;text-align:right;color:#666;font-size:12px;">קטגוריה</th>
        <th style="padding:10px;text-align:center;color:#666;font-size:12px;">אתם</th>
        <th style="padding:10px;text-align:center;color:#666;font-size:12px;">ממוצע</th>
        <th style="padding:10px;text-align:center;color:#666;font-size:12px;">מצב</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:20px;padding:16px 20px;background:#f0f4ff;border-radius:8px;border-right:4px solid #1a1a2e;">
      <p style="margin:0;font-size:15px;"><strong>סה"כ: ₪${Math.round(totalUser).toLocaleString()}</strong></p>
      <p style="margin:6px 0 0;font-size:13px;color:#666;">ממוצע באזורכם: ₪${Math.round(totalAvg).toLocaleString()}</p>
      <p style="margin:8px 0 0;font-size:14px;font-weight:700;">${verdict}</p>
    </div>
    <p style="margin-top:20px;font-size:11px;color:#bbb;">
      <a href="https://tamirlir20-star.github.io/-cost-reduction-analysis/" style="color:#bbb;">פתחו שוב את הכלי</a>
    </p>
  </div>
</div></body></html>`;

  GmailApp.sendEmail(d.email, 'הדוח האישי שלכם — ניתוח הוצאות', '', {
    htmlBody: html,
    name:     'ניתוח הוצאות',
  });
}

// ── Helpers ──
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
