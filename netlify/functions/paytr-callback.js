// PayTR "Bildirim URL": verifies the hash and marks the order paid / failed. Must answer plain "OK".
const { sb, hmac } = require('../lib/paytr');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '');
  const p = Object.fromEntries(new URLSearchParams(raw));
  const expected = hmac(p.merchant_oid + process.env.PAYTR_MERCHANT_SALT + p.status + p.total_amount);
  if (!p.hash || expected !== p.hash) return { statusCode: 400, body: 'PAYTR notification failed: bad hash' };
  try {
    const rows = await sb('/rest/v1/orders?select=id,status&payment_ref=eq.' + encodeURIComponent(p.merchant_oid));
    const o = rows[0];
    if (o && o.status === 'pending_payment') {
      const patch = p.status === 'success'
        ? { status: 'paid', paid_at: new Date().toISOString(), paid_amount: Number(p.total_amount) / 100 }
        : { status: 'payment_failed', payment_error: (p.failed_reason_code || '') + ' ' + (p.failed_reason_msg || '') };
      await sb('/rest/v1/orders?id=eq.' + o.id, { method: 'PATCH', body: JSON.stringify(patch) });
    }
  } catch (e) { console.error(e); return { statusCode: 500, body: 'error' }; }
  return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'OK' };
};
