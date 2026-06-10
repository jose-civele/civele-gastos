import crypto from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ─── JWT con Service Account ────────────────────────────────────────────────
async function getAccessToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY no configurado en Vercel');
  const key = JSON.parse(raw);

  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(key.private_key, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('No se pudo obtener access_token: ' + JSON.stringify(data));
  return data.access_token;
}

// ─── Helpers Sheets ─────────────────────────────────────────────────────────
function sheetsUrl(range, method = '') {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  return method ? `${base}:${method}?valueInputOption=USER_ENTERED` : base;
}

async function sheetsGet(token, range) {
  const r = await fetch(sheetsUrl(range), {
    headers: { Authorization: `Bearer ${token}` }
  });
  return r.json();
}

async function sheetsAppend(token, range, rows) {
  const r = await fetch(sheetsUrl(range, 'append'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows })
  });
  return r.json();
}

async function sheetsPut(token, range, rows) {
  const r = await fetch(sheetsUrl(range, 'update'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows })
  });
  return r.json();
}

// ─── Handler principal ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SHEET_ID) return res.status(500).json({ error: 'GOOGLE_SHEET_ID no configurado en Vercel' });

  const { action, ...data } = req.body || {};

  try {
    const token = await getAccessToken();

    // ── REGISTRAR GASTO INDIVIDUAL ──────────────────────────────────────────
    if (action === 'appendGasto') {
      const g = data.gasto;
      const row = [
        g.viat || '', g.emp, g.proj, g.fecha, g.concepto,
        g.tipoGasto === 'reintegro' ? 'Reintegro Personal' : 'Factura Comercial',
        g.subtotal, g.iva, g.impoconsumo, g.total,
        g.receptor || '', g.nit || '', g.ciudad || '',
        g.tipo || '', g.obs || '', 'Pendiente', g.id
      ];
      await sheetsAppend(token, 'Detalle Gastos!A:Q', [row]);
      return res.status(200).json({ ok: true });
    }

    // ── FINALIZAR SESIÓN (todos los gastos de una vez) ──────────────────────
    if (action === 'finalizarSesion') {
      const gastos = data.gastos || [];
      if (!gastos.length) return res.status(400).json({ error: 'Sin gastos para finalizar' });

      // 1. Append todos los gastos a Detalle Gastos
      const rows = gastos.map(g => [
        g.viat || '', g.emp, g.proj, g.fecha, g.concepto,
        g.tipoGasto === 'reintegro' ? 'Reintegro Personal' : 'Factura Comercial',
        g.subtotal, g.iva, g.impoconsumo, g.total,
        g.receptor || '', g.nit || '', g.ciudad || '',
        g.tipo || '', g.obs || '', 'Pendiente', g.id
      ]);
      await sheetsAppend(token, 'Detalle Gastos!A:Q', rows);

      // 2. Actualizar Control Viáticos (solo para gastos de factura con viat)
      const facturas = gastos.filter(g => g.tipoGasto === 'factura' && g.viat);
      if (facturas.length) {
        const viat = facturas[0].viat;
        const totalFact = facturas.reduce((s, g) => s + g.total, 0);
        const sheet = await sheetsGet(token, 'Control Viaticos!A:V');
        const rows2 = sheet.values || [];
        const idx = rows2.findIndex(r => r[0] === viat);
        if (idx >= 0) {
          await sheetsPut(token, `Control Viaticos!O${idx + 1}:V${idx + 1}`, [[
            new Date().toLocaleDateString('es-CO'), totalFact, '', '', '', '', '', 'Pendiente'
          ]]);
        }
      }

      return res.status(200).json({ ok: true });
    }

    // ── CONSULTAR ESTADO DE APROBACIÓN ──────────────────────────────────────
    if (action === 'consultarEstado') {
      const sheet = await sheetsGet(token, 'Control Viaticos!A:V');
      const rows2 = sheet.values || [];
      const row = rows2.find(r => r[0] === data.viat);
      const estado = row ? (row[22] || row[21] || row[20] || 'Pendiente') : 'No encontrado';
      return res.status(200).json({ estado });
    }

    // ── CONSULTAR PRESUPUESTO ────────────────────────────────────────────────
    if (action === 'consultarPresupuesto') {
      const sheet = await sheetsGet(token, 'Control Viaticos!A:Z');
      const rows2 = sheet.values || [];
      const row = rows2.find(r => r[0] === data.viat);
      if (!row) return res.status(200).json({ autorizado: 0, encontrado: false });
      // Columna D (índice 3) = monto autorizado
      const autorizado = Number(String(row[3] || '0').replace(/[^0-9.]/g, '')) || 0;
      return res.status(200).json({ autorizado, encontrado: true, estado: row[21] || 'Pendiente' });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });

  } catch (err) {
    console.error('Sheets API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
