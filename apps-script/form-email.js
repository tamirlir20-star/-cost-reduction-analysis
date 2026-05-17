// Google Apps Script — Web Endpoint + Email
//
// Deploy: Extensions → Apps Script → paste → save
//         Deploy → Manage deployments → New version → Deploy
//         Execute as: Me | Who has access: Anyone
//
// Script Properties (Project Settings → Script Properties):
//   SUPABASE_URL = https://jeacujiixlucffbuusme.supabase.co
//   SUPABASE_KEY = <your anon/service-role key>

const CBS_AVERAGES = {
  housing: 4800, groceries: 2700, eatingOut: 650,
  transport: 2100, utilities: 1300, insurance: 800, entertainment: 900,
};

const REGIONAL_FACTORS = {
  'תל אביב':     { housing:1.55, groceries:1.10, eatingOut:1.20, transport:1.05, utilities:1.05, insurance:1.10, entertainment:1.20 },
  'גוש דן':      { housing:1.30, groceries:1.05, eatingOut:1.10, transport:1.05, utilities:1.05, insurance:1.05, entertainment:1.10 },
  'השרון':       { housing:1.20, groceries:1.05, eatingOut:1.08, transport:1.05, utilities:1.00, insurance:1.05, entertainment:1.08 },
  'מרכז':        { housing:1.12, groceries:1.02, eatingOut:1.05, transport:1.00, utilities:1.00, insurance:1.02, entertainment:1.05 },
  'שפלה':        { housing:0.80, groceries:0.95, eatingOut:0.88, transport:0.98, utilities:1.00, insurance:0.92, entertainment:0.82 },
  'ירושלים':     { housing:1.25, groceries:1.00, eatingOut:1.05, transport:0.95, utilities:1.00, insurance:1.00, entertainment:1.00 },
  'חיפה':        { housing:0.85, groceries:0.98, eatingOut:0.95, transport:0.98, utilities:1.00, insurance:0.98, entertainment:0.95 },
  'צפון עירוני': { housing:0.72, groceries:0.96, eatingOut:0.90, transport:1.02, utilities:1.00, insurance:0.95, entertainment:0.87 },
  'צפון כפרי':   { housing:0.58, groceries:0.93, eatingOut:0.82, transport:1.10, utilities:1.00, insurance:0.92, entertainment:0.78 },
  'אשדוד':       { housing:0.80, groceries:0.95, eatingOut:0.90, transport:0.98, utilities:1.00, insurance:0.95, entertainment:0.88 },
  'באר שבע':     { housing:0.65, groceries:0.93, eatingOut:0.85, transport:1.05, utilities:1.00, insurance:0.92, entertainment:0.80 },
};

const HH_FACTOR = { 1:0.55, 2:0.80, 3:1.00, 4:1.20, 5:1.38, 6:1.55 };

const CAT_LABELS = {
  housing: 'דיור', groceries: 'סופר ומזון', eatingOut: 'אוכל בחוץ ומשלוחים',
  transport: 'תחבורה', insurance: 'ביטוחים', utilities: 'חשבונות', entertainment: 'בילויים ומנויים',
};

/* ── Helpers ── */

function getRegionalFactor(city, key) {
  const rf = REGIONAL_FACTORS[city];
  return rf ? (rf[key] || 1.0) : 1.0;
}

function householdFactor(n) {
  return HH_FACTOR[Math.min(n, 6)] || 1.0;
}

function compareToAverage(value, avg) {
  const diff = ((value - avg) / avg) * 100;
  if (diff > 20)  return { label: 'גבוה מהממוצע', icon: '⬆️', pct: Math.round(diff),            color: '#c0392b' };
  if (diff < -20) return { label: 'נמוך מהממוצע', icon: '⬇️', pct: Math.round(Math.abs(diff)),  color: '#27ae60' };
  return           { label: 'בטווח הממוצע',  icon: '✅', pct: Math.round(Math.abs(diff)),       color: '#2980b9' };
}

function fmt(n) {
  return '₪' + Math.round(n).toLocaleString('he-IL');
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── Supabase ── */

function sbUrl() {
  return PropertiesService.getScriptProperties().getProperty('SUPABASE_URL')
    || 'https://jeacujiixlucffbuusme.supabase.co';
}

function sbKey() {
  return PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
}

function getCount() {
  const key = sbKey();
  if (!key) return 0;
  try {
    const res = UrlFetchApp.fetch(sbUrl() + '/rest/v1/submissions?select=id', {
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'count=exact',
        'Range': '0-0',
      },
      muteHttpExceptions: true,
    });
    const range = res.getHeaders()['content-range'] || '';
    const m = range.match(/\/(\d+)/);
    return m ? parseInt(m[1]) : 0;
  } catch (err) {
    Logger.log('getCount error: ' + err);
    return 0;
  }
}

function saveToSupabase(row) {
  const key = sbKey();
  if (!key) { Logger.log('No SUPABASE_KEY in Script Properties'); return null; }
  const res = UrlFetchApp.fetch(sbUrl() + '/rest/v1/submissions', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'return=representation',
    },
    payload: JSON.stringify(row),
    muteHttpExceptions: true,
  });
  Logger.log('Supabase INSERT ' + res.getResponseCode() + ': ' + res.getContentText());
  try {
    const rows = JSON.parse(res.getContentText());
    return rows[0] ? rows[0].id : null;
  } catch (e) { return null; }
}

function updateSupabaseEmail(id, email) {
  const key = sbKey();
  if (!key || !id) return;
  const res = UrlFetchApp.fetch(sbUrl() + '/rest/v1/submissions?id=eq.' + id, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify({ email }),
    muteHttpExceptions: true,
  });
  Logger.log('Supabase UPDATE email ' + res.getResponseCode());
}

/* ── Web endpoints ── */

function doGet(e) {
  return jsonOut({ count: getCount() });
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ ok: false, error: 'invalid JSON' }); }

  const email       = (data.email       || '').trim();
  const city        = (data.city        || '').trim();
  const hhSize      = parseInt(data.hhSize) || 3;
  const neighborhood = data.neighborhood || '';
  const ageRange    = data.ageRange     || '';
  const housingType = data.housingType  || '';

  Logger.log('doPost: email=' + email + ' city=' + city + ' hhSize=' + hhSize);

  const hFactor = householdFactor(hhSize);
  let totalUser = 0, totalAvg = 0, rows = '';

  Object.keys(CAT_LABELS).forEach(key => {
    const userVal = parseInt(data[key]) || 0;
    const rFactor = getRegionalFactor(city, key);
    const avgVal  = Math.round(CBS_AVERAGES[key] * hFactor * rFactor);
    const cmp     = compareToAverage(userVal, avgVal);
    totalUser    += userVal;
    totalAvg     += avgVal;

    rows += `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:11px 10px;font-size:14px;text-align:right;">${CAT_LABELS[key]}</td>
        <td style="padding:11px 10px;text-align:center;font-size:14px;font-weight:600;">${fmt(userVal)}</td>
        <td style="padding:11px 10px;text-align:center;font-size:14px;color:#888;">${fmt(avgVal)}</td>
        <td style="padding:11px 10px;text-align:center;font-size:13px;color:${cmp.color};font-weight:600;">${cmp.icon} ${cmp.label}</td>
      </tr>`;
  });

  const totalCmp = compareToAverage(totalUser, totalAvg);

  const submissionId = data.submissionId || null;
  const sbRow = {
    source:        'website',
    city,
    neighborhood,
    age_range:     ageRange,
    housing_type:  housingType,
    hh_size:       hhSize,
    housing:       parseInt(data.housing)       || 0,
    groceries:     parseInt(data.groceries)     || 0,
    eating_out:    parseInt(data.eatingOut)     || 0,
    transport:     parseInt(data.transport)     || 0,
    insurance:     parseInt(data.insurance)     || 0,
    utilities:     parseInt(data.utilities)     || 0,
    entertainment: parseInt(data.entertainment) || 0,
  };

  if (!email) {
    // Anonymous reveal — save without email, return ID
    const id = saveToSupabase(sbRow);
    return jsonOut({ ok: true, count: getCount(), id });
  }

  // Email provided — send email
  GmailApp.sendEmail(email, 'הדוח האישי שלכם — ניתוח הוצאות', '', {
    htmlBody: buildEmailHtml(city, hhSize, rows, totalUser, totalAvg, totalCmp),
    name: 'ניתוח הוצאות',
  });

  if (submissionId) {
    // Update existing row with email
    updateSupabaseEmail(submissionId, email);
  } else {
    // Fallback: save full row with email (anonymous save failed)
    saveToSupabase({ ...sbRow, email });
  }

  return jsonOut({ ok: true, count: getCount() });
}

/* ── Email HTML ── */

function buildEmailHtml(city, hhSize, rows, totalUser, totalAvg, totalCmp) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,sans-serif;direction:rtl;">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.09);">
  <div style="background:#1a1a2e;padding:28px 32px;text-align:right;">
    <h1 style="color:#fff;margin:0;font-size:20px;">הדוח האישי שלכם</h1>
    <p style="color:#9999bb;margin:6px 0 0;font-size:13px;">${city} · ${hhSize} נפשות</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#444;margin:0 0 20px;font-size:14px;line-height:1.6;text-align:right;">
      השוואה מול ממוצעי הלמ"ס, מותאמים לאזורכם ולגודל משק הבית שלכם:
    </p>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8f8f8;border-bottom:2px solid #eee;">
          <th style="padding:10px;text-align:right;color:#666;font-size:12px;font-weight:600;">קטגוריה</th>
          <th style="padding:10px;text-align:center;color:#666;font-size:12px;font-weight:600;">אתם</th>
          <th style="padding:10px;text-align:center;color:#666;font-size:12px;font-weight:600;">ממוצע באזורכם</th>
          <th style="padding:10px;text-align:center;color:#666;font-size:12px;font-weight:600;">מצב</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:20px;padding:16px 20px;background:#f0f4ff;border-radius:8px;border-right:4px solid #1a1a2e;text-align:right;">
      <p style="margin:0;font-size:15px;"><strong>סה"כ חודשי:</strong> ${fmt(totalUser)}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#666;">ממוצע באזורכם למשק בית כמוכם: ${fmt(totalAvg)}</p>
      <p style="margin:8px 0 0;font-size:14px;color:${totalCmp.color};font-weight:700;">${totalCmp.icon} ${totalCmp.label} ב-${totalCmp.pct}%</p>
    </div>
    <p style="margin-top:24px;font-size:11px;color:#bbb;line-height:1.7;text-align:right;">
      הנתונים מבוססים על סקר הוצאות משק בית של הלמ"ס, מותאמים לאזורכם ולגודל משק הבית שלכם.
      ככל שיותר אנשים ימלאו, ההשוואה תהיה מדויקת יותר.
    </p>
  </div>
</div>
</body>
</html>`;
}

/* ── Legacy Google Form trigger ── */

function parseMidpoint(str) {
  if (!str || str === '—') return 0;
  const clean = str.replace(/[₪,\s]/g, '');
  if (clean.endsWith('+')) return Math.round(parseInt(clean) * 1.3);
  if (clean.endsWith('-')) return Math.round(parseInt(clean) * 0.6);
  const parts = clean.split(/[–—-]/);
  if (parts.length === 2) {
    const a = parseInt(parts[0]), b = parseInt(parts[1]);
    if (!isNaN(a) && !isNaN(b)) return Math.round((a + b) / 2);
  }
  const n = parseInt(clean);
  return isNaN(n) ? 0 : n;
}

function nv(namedValues, key) {
  const arr = namedValues[key];
  if (!arr) return '—';
  const val = [...arr].reverse().find(v => v && v.trim());
  return val ? val.trim() : '—';
}

function onFormSubmit(e) {
  const named = {};
  Object.entries(e.namedValues).forEach(([k, v]) => { named[k.trim()] = v; });

  const cityRaw = nv(named, 'באיזו עיר / אזור אתם גרים?');
  const city    = cityRaw.split('(')[0].trim();
  const sizeStr = nv(named, 'כמה אנשים גרים אצלכם בבית? (כולל ילדים)');
  const email   = nv(named, 'השאירו מייל ונשלח לכם את ההשוואה האישית שלכם');
  if (!email || !email.includes('@')) return;

  const hhSize  = parseInt(sizeStr) || 3;
  const hFactor = householdFactor(hhSize);

  const formCats = [
    { key:'housing',       raw: nv(named, 'כמה שילמתם על דיור? (שכירות / משכנתא)') },
    { key:'groceries',     raw: nv(named, 'כמה הוצאתם על סופר ומזון?') },
    { key:'eatingOut',     raw: nv(named, 'כמה הוצאתם על אוכל בחוץ ומשלוחים?') },
    { key:'transport',     raw: nv(named, 'כמה הוצאתם על תחבורה? (דלק  / תחבורה ציבורית / חניה)') },
    { key:'insurance',     raw: nv(named, 'כמה שילמתם על ביטוחים? (בריאות + חיים + רכב + דירה)') },
    { key:'utilities',     raw: nv(named, 'כמה שילמתם על חשבונות? (חשמל + מים + אינטרנט + סלולר)') },
    { key:'entertainment', raw: nv(named, 'כמה הוצאתם על בילויים ומנויים? (נטפליקס / חדר כושר / יציאות / קולנוע)') },
  ];

  let totalUser = 0, totalAvg = 0, rows = '';
  formCats.forEach(({ key, raw }) => {
    const userVal = parseMidpoint(raw);
    const rFactor = getRegionalFactor(city, key);
    const avgVal  = Math.round(CBS_AVERAGES[key] * hFactor * rFactor);
    const cmp     = compareToAverage(userVal, avgVal);
    totalUser += userVal;
    totalAvg  += avgVal;
    rows += `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:11px 10px;font-size:14px;text-align:right;">${CAT_LABELS[key]}</td>
        <td style="padding:11px 10px;text-align:center;font-size:13px;font-weight:600;">${raw}</td>
        <td style="padding:11px 10px;text-align:center;font-size:14px;color:#888;">${fmt(avgVal)}</td>
        <td style="padding:11px 10px;text-align:center;font-size:13px;color:${cmp.color};font-weight:600;">${cmp.icon} ${cmp.label}</td>
      </tr>`;
  });

  const totalCmp = compareToAverage(totalUser, totalAvg);
  GmailApp.sendEmail(email, 'הדוח האישי שלכם', '', {
    htmlBody: buildEmailHtml(city, sizeStr, rows, totalUser, totalAvg, totalCmp),
    name: 'ניתוח הוצאות',
  });
}
