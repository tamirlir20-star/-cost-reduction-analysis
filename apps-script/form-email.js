// Google Apps Script — Auto Email Results
// Attach to the Google Sheet linked to the form:
// Extensions → Apps Script → paste → save
// Triggers → Add Trigger → onFormSubmit / From spreadsheet / On form submit

// Uses e.namedValues (question text → value) — immune to column reordering.
// Keys must match the exact question text in the Google Form.

const CBS_AVERAGES = {
  housing:       4800,
  groceries:     2700,
  eatingOut:     650,
  transport:     2100,
  utilities:     1300,
  insurance:     800,
  entertainment: 600,
};

const REGIONAL_FACTORS = {
  'תל אביב':   { housing:1.55, groceries:1.10, eatingOut:1.20, transport:1.05, utilities:1.05, insurance:1.10, entertainment:1.20 },
  'גוש דן':    { housing:1.30, groceries:1.05, eatingOut:1.10, transport:1.05, utilities:1.05, insurance:1.05, entertainment:1.10 },
  'השרון':     { housing:1.20, groceries:1.05, eatingOut:1.08, transport:1.05, utilities:1.00, insurance:1.05, entertainment:1.08 },
  'מרכז-דרום': { housing:1.05, groceries:1.00, eatingOut:1.00, transport:1.00, utilities:1.00, insurance:1.00, entertainment:1.00 },
  'ירושלים':   { housing:1.25, groceries:1.00, eatingOut:1.05, transport:0.95, utilities:1.00, insurance:1.00, entertainment:1.00 },
  'חיפה':      { housing:0.85, groceries:0.98, eatingOut:0.95, transport:0.98, utilities:1.00, insurance:0.98, entertainment:0.95 },
  'צפון':      { housing:0.70, groceries:0.95, eatingOut:0.88, transport:1.05, utilities:1.00, insurance:0.95, entertainment:0.85 },
  'אשדוד':     { housing:0.80, groceries:0.95, eatingOut:0.90, transport:0.98, utilities:1.00, insurance:0.95, entertainment:0.88 },
  'באר שבע':   { housing:0.65, groceries:0.93, eatingOut:0.85, transport:1.05, utilities:1.00, insurance:0.92, entertainment:0.80 },
};

function getRegionalFactor(city, cbsKey) {
  const match = Object.keys(REGIONAL_FACTORS).find(k => city.includes(k));
  return match ? (REGIONAL_FACTORS[match][cbsKey] || 1.0) : 1.0;
}

function householdFactor(sizeStr) {
  const n = parseInt(sizeStr);
  if (isNaN(n)) return 1.0;
  const map = { 1:0.55, 2:0.80, 3:1.00, 4:1.20, 5:1.38, 6:1.55 };
  return map[Math.min(n, 6)] || 1.0;
}

function parseMidpoint(str) {
  if (!str || str === '—') return 0;
  const clean = str.replace(/[₪,\s]/g, '');
  if (clean.endsWith('+')) return Math.round(parseInt(clean) * 1.3);
  if (clean.endsWith('-')) return Math.round(parseInt(clean) * 0.6);
  const parts = clean.split(/[–—-]/);
  if (parts.length === 2) {
    const a = parseInt(parts[0]);
    const b = parseInt(parts[1]);
    if (!isNaN(a) && !isNaN(b)) return Math.round((a + b) / 2);
  }
  const n = parseInt(clean);
  return isNaN(n) ? 0 : n;
}

function compareToAverage(value, avg) {
  const diff = ((value - avg) / avg) * 100;
  if (diff > 20)  return { label: 'גבוה מהממוצע', icon: '⬆️', pct: Math.round(diff),           color: '#c0392b' };
  if (diff < -20) return { label: 'נמוך מהממוצע', icon: '⬇️', pct: Math.round(Math.abs(diff)), color: '#27ae60' };
  return           { label: 'בטווח הממוצע',  icon: '✅', pct: Math.round(Math.abs(diff)),      color: '#2980b9' };
}

function fmt(n) {
  return '₪' + Math.round(n).toLocaleString('he-IL');
}

// Returns the first (and usually only) answer for a given form question key.
function nv(namedValues, key) {
  const arr = namedValues[key];
  if (!arr) return '—';
  // Take the last non-empty value — handles duplicate columns from re-added questions
  const val = [...arr].reverse().find(v => v && v.trim());
  return val ? val.trim() : '—';
}

function onFormSubmit(e) {
  // Normalize keys — Google sometimes appends \n to question text
  const named = {};
  Object.entries(e.namedValues).forEach(([k, v]) => { named[k.trim()] = v; });
  Logger.log('namedValues keys: ' + JSON.stringify(Object.keys(named)));

  const cityRaw = nv(named, 'באיזו עיר / אזור אתם גרים?');
  const city    = cityRaw.split('(')[0].trim();
  const sizeStr = nv(named, 'כמה אנשים גרים אצלכם בבית? (כולל ילדים)');
  const email   = nv(named, 'השאירו מייל ונשלח לכם את ההשוואה האישית שלכם');
  if (!email || !email.includes('@')) return;

  const hFactor = householdFactor(sizeStr);

  const categories = [
    { label: 'דיור',               cbsKey: 'housing',       raw: nv(named, 'כמה שילמתם על דיור? (שכירות / משכנתא)') },
    { label: 'סופר ומזון',          cbsKey: 'groceries',     raw: nv(named, 'כמה הוצאתם על סופר ומזון?') },
    { label: 'אוכל בחוץ ומשלוחים', cbsKey: 'eatingOut',     raw: nv(named, 'כמה הוצאתם על אוכל בחוץ ומשלוחים?') },
    { label: 'תחבורה',             cbsKey: 'transport',     raw: nv(named, 'כמה הוצאתם על תחבורה? (דלק / ביטוח רכב / תחבורה ציבורית / חניה)') },
    { label: 'ביטוחים',            cbsKey: 'insurance',     raw: nv(named, 'כמה שילמתם על ביטוחים? (בריאות + חיים + רכב + דירה)') },
    { label: 'חשבונות',            cbsKey: 'utilities',     raw: nv(named, 'כמה שילמתם על חשבונות? (חשמל + מים + אינטרנט + סלולר)') },
    { label: 'בילויים ומנויים',     cbsKey: 'entertainment', raw: nv(named, 'כמה הוצאתם על בילויים ומנויים? (נטפליקס / חדר כושר / יציאות / קולנוע)') },
  ];

  let totalUser = 0;
  let totalAvg  = 0;
  let rows = '';

  categories.forEach(({ label, cbsKey, raw }) => {
    const userVal = parseMidpoint(raw);
    const rFactor = getRegionalFactor(city, cbsKey);
    const avgVal  = Math.round(CBS_AVERAGES[cbsKey] * hFactor * rFactor);
    const cmp     = compareToAverage(userVal, avgVal);
    totalUser    += userVal;
    totalAvg     += avgVal;

    rows += `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:11px 10px;font-size:14px;text-align:right;">${label}</td>
        <td style="padding:11px 10px;text-align:center;font-size:13px;font-weight:600;">${raw}</td>
        <td style="padding:11px 10px;text-align:center;font-size:14px;color:#888;">${fmt(avgVal)}</td>
        <td style="padding:11px 10px;text-align:center;font-size:13px;color:${cmp.color};font-weight:600;">${cmp.icon} ${cmp.label}</td>
      </tr>`;
  });

  const totalCmp = compareToAverage(totalUser, totalAvg);

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,sans-serif;direction:rtl;">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.09);">
  <div style="background:#1a1a2e;padding:28px 32px;text-align:right;">
    <h1 style="color:#fff;margin:0;font-size:20px;">הדוח האישי שלכם</h1>
    <p style="color:#9999bb;margin:6px 0 0;font-size:13px;">${city} · ${sizeStr}</p>
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
      ככל שיותר אנשים ימלאו את הטופס, ההשוואה תהיה מדויקת יותר.
    </p>
  </div>
</div>
</body>
</html>`;

  GmailApp.sendEmail(email, 'הדוח האישי שלכם', '', {
    htmlBody: html,
    name: 'ניתוח הוצאות',
  });
}
