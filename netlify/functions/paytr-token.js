// Creates the order server-side (prices re-computed from the database) and returns a PayTR iFrame token.
const { sb, userFromToken, hmac, json, TIERS } = require('../lib/paytr');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const { PAYTR_MERCHANT_ID: MID, PAYTR_MERCHANT_KEY: MKEY, PAYTR_MERCHANT_SALT: MSALT, SUPABASE_SERVICE_KEY } = process.env;
  const missing = ['PAYTR_MERCHANT_ID', 'PAYTR_MERCHANT_KEY', 'PAYTR_MERCHANT_SALT', 'SUPABASE_SERVICE_KEY'].filter(k => !(process.env[k] || '').trim());
  if (missing.length) { console.error('payments_not_configured, missing:', missing.join(',')); return json(503, { error: 'payments_not_configured', missing }); }
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad request' }); }
  const c = body.customer || {}; const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || !c.email || !c.name || !c.phone || !c.line1 || !c.city || !c.state || !c.zip) return json(400, { error: 'Missing details' });

  try {
    // 1) prices from the database, never from the browser
    const ids = [...new Set(items.map(i => parseInt(i.id, 10)).filter(Boolean))];
    const prods = await sb('/rest/v1/products?select=id,name_en,price_usd,us_visible&id=in.(' + ids.join(',') + ')');
    const byId = Object.fromEntries(prods.map(p => [p.id, p]));
    // 2) trade discount for approved members
    const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await userFromToken(token);
    let pct = 0;
    if (user) {
      const cust = await sb('/rest/v1/customers?select=trade_status&id=eq.' + user.id);
      if (cust[0] && cust[0].trade_status === 'approved') {
        const since = new Date(Date.now() - 365 * 864e5).toISOString();
        const ords = await sb('/rest/v1/orders?select=total&customer_id=eq.' + user.id + '&status=in.(paid,in_production,shipped,delivered)&created_at=gte.' + since);
        const spend = ords.reduce((a, o) => a + (+o.total || 0), 0);
        pct = (TIERS.find(t => spend >= t.min) || TIERS[TIERS.length - 1]).pct;
      }
    }
    const lines = [];
    for (const i of items) {
      const p = byId[parseInt(i.id, 10)]; const q = Math.max(1, Math.min(50, parseInt(i.q, 10) || 1));
      if (!p || !p.us_visible || p.price_usd == null) return json(400, { error: 'Item ' + i.id + ' is not available for online purchase' });
      const unit = Math.round(+p.price_usd * (1 - pct / 100));
      lines.push({ id: p.id, name: p.name_en, qty: q, list: +p.price_usd, unit });
    }
    const subtotal = lines.reduce((a, l) => a + l.list * l.qty, 0);
    const total = lines.reduce((a, l) => a + l.unit * l.qty, 0);

    // 3) order row
    const oid = 'CH' + Date.now() + Math.floor(Math.random() * 1e4);
    const [order] = await sb('/rest/v1/orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      site: 'chandelist', customer_id: user ? user.id : null, email: c.email, name: c.name, phone: c.phone,
      address: { line1: c.line1, line2: c.line2 || '', city: c.city, state: c.state, zip: c.zip, country: 'US' },
      items: lines, subtotal, discount_pct: pct, total, notes: body.notes || '', status: 'pending_payment', payment_ref: oid }) });

    // 4) PayTR token
    const userIp = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1';
    // Currency: USD by default; PAYTR_CURRENCY=TL charges the TL equivalent (TCMB USD selling rate) until the USD account is opened
    let currency = (process.env.PAYTR_CURRENCY || 'USD').toUpperCase() === 'TL' ? 'TL' : 'USD';
    let chargeTotal = total, fx = null;
    if (currency === 'TL') {
      const xml = await (await fetch('https://www.tcmb.gov.tr/kurlar/today.xml')).text();
      const m = xml.match(/CurrencyCode="USD"[\s\S]*?<ForexSelling>([\d.]+)<\/ForexSelling>/);
      fx = m ? parseFloat(m[1]) : NaN; if (!fx) throw new Error('FX rate unavailable');
      chargeTotal = Math.ceil(total * fx * 100) / 100;
      await sb('/rest/v1/orders?id=eq.' + order.id, { method: 'PATCH', body: JSON.stringify({ notes: (body.notes || '') + ' [Charged in TL: ' + chargeTotal + ' TL @ ' + fx + ']' }) });
    }
    const amount = String(Math.round(chargeTotal * 100));
    const basket = Buffer.from(JSON.stringify(lines.map(l => [l.name.slice(0, 100), (fx ? l.unit * fx : l.unit).toFixed(2), l.qty]))).toString('base64');
    const noInst = '1', maxInst = '0', testMode = process.env.PAYTR_TEST_MODE === '1' ? '1' : '0';
    const paytrToken = hmac(MID + userIp + oid + c.email + amount + basket + noInst + maxInst + currency + testMode + MSALT);
    const site = 'https://chandelist.com';
    const form = new URLSearchParams({ merchant_id: MID, user_ip: userIp, merchant_oid: oid, email: c.email, payment_amount: amount, paytr_token: paytrToken,
      user_basket: basket, debug_on: '0', no_installment: noInst, max_installment: maxInst, user_name: c.name, user_address: [c.line1, c.line2, c.city, c.state, c.zip, 'USA'].filter(Boolean).join(', '),
      user_phone: c.phone, merchant_ok_url: site + '/checkout/success?o=' + order.id, merchant_fail_url: site + '/checkout/failed?o=' + order.id,
      timeout_limit: '30', currency, test_mode: testMode, lang: 'en', iframe_v2: '1' });
    const r = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const d = await r.json();
    if (d.status !== 'success') { await sb('/rest/v1/orders?id=eq.' + order.id, { method: 'PATCH', body: JSON.stringify({ status: 'payment_failed', notes: (body.notes || '') + ' [PayTR: ' + d.reason + ']' }) }); return json(502, { error: 'Payment service: ' + d.reason }); }
    return json(200, { token: d.token, orderId: order.id, total, currency, charge: chargeTotal });
  } catch (e) {
    console.error(e); return json(500, { error: 'Could not start payment' });
  }
};
