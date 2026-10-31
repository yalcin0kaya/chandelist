/* Chandelist US storefront — reads the shared Supabase catalog, shows only products marked us_visible. */
(function () {
'use strict';

// ---------- config ----------
const SB = 'https://sqvwgghdksxmstmucxdm.supabase.co';
const KEY = 'sb_publishable_JNL2rwjFyL4F7C5iK2xmfQ_fIaWla5h';
const FREE_SHIP = 2500;
const TIERS = [ { min: 25000, pct: 30 }, { min: 10000, pct: 25 }, { min: 0, pct: 20 } ]; // trade, by last-12-month spend
const CATS = {
  lighting: { label: 'Lighting', subs: { chandelier: 'Chandeliers', pendant: 'Pendants', sconce: 'Sconces', flush_mount: 'Flush Mounts', lantern: 'Lanterns', table_lamp: 'Table Lamps', floor_lamp: 'Floor Lamps', outdoor: 'Outdoor', custom: 'Bespoke' } },
  homedecor: { label: 'Home', subs: { side_table: 'Side Tables', tray: 'Trays', candleholder: 'Candleholders', planter: 'Planters' } }
};
const LEAD = { chandelier: [6, 8], lantern: [5, 7], custom: [8, 12] }; // weeks; default [4, 6]

// ---------- tiny helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => '$' + Math.round(n).toLocaleString('en-US');
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
const img = (u, w) => (u && u.includes('/upload/')) ? u.replace('/upload/', '/upload/f_auto,q_auto,w_' + w + '/') : u;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 2800); }
function track(ev, data) { try { window.fbq && fbq('track', ev, data || {}); } catch (e) {} try { window.gtag && gtag('event', ev, data || {}); } catch (e) {} }

// ---------- auth (customer) ----------
const SESS = 'ch_customer_session';
function session() { return store.get(SESS, null); }
async function token() {
  const s = session(); if (!s) return null;
  if (s.expires_at * 1000 > Date.now() + 60000) return s.access_token;
  try {
    const r = await fetch(SB + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (r.ok) { const d = await r.json(); d.expires_at = Math.floor(Date.now() / 1000) + (d.expires_in || 3600); store.set(SESS, d); return d.access_token; }
  } catch (e) {}
  localStorage.removeItem(SESS); return null;
}
function adminPreview() { try { const s = JSON.parse(localStorage.getItem('sb_session') || 'null'); return !!(s && s.access_token); } catch (e) { return false; } }
async function api(path, opt = {}, auth = true) {
  const t = auth ? await token() : null;
  const h = Object.assign({ apikey: KEY, Authorization: 'Bearer ' + (t || KEY), 'Content-Type': 'application/json' }, opt.headers || {});
  const r = await fetch(SB + path, Object.assign({}, opt, { headers: h }));
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) throw new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + r.status));
  return data;
}
let ME = null; // customers row
async function loadMe() {
  ME = null; const s = session(); if (!s) return null;
  try { const rows = await api('/rest/v1/customers?select=*&id=eq.' + s.user.id); ME = rows && rows[0] || { id: s.user.id, email: s.user.email, trade_status: 'none' }; } catch (e) { ME = { id: s.user.id, email: s.user.email, trade_status: 'none' }; }
  try { const ords = await api('/rest/v1/orders?select=total,status,created_at&customer_id=eq.' + s.user.id); const yr = Date.now() - 365 * 864e5; ME.spend12 = (ords || []).filter(o => ['paid', 'in_production', 'shipped', 'delivered'].includes(o.status) && new Date(o.created_at) > yr).reduce((a, o) => a + (+o.total || 0), 0); ME.orders = ords || []; } catch (e) { ME.spend12 = 0; ME.orders = []; }
  return ME;
}
function tradePct() { if (!ME || ME.trade_status !== 'approved') return 0; return (TIERS.find(t => (ME.spend12 || 0) >= t.min) || TIERS[TIERS.length - 1]).pct; }

// ---------- catalog ----------
let PRODUCTS = null;
function parseSubs(v) { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : (a ? [a] : []); } catch (e) { return v ? [v] : []; } }
async function catalog() {
  if (PRODUCTS) return PRODUCTS;
  const preview = adminPreview();
  const cols = 'id,name_en,description_en,category,subcategory,materials,dimensions,images,price_usd,us_visible,tech_files,sort_order,meta_title_en,meta_description_en';
  const q = '/rest/v1/products?select=' + cols + (preview ? '' : '&us_visible=eq.true') + '&order=sort_order.asc.nullslast,id.desc';
  let rows = [];
  try { rows = await api(q, {}, false) || []; } catch (e) { console.error(e); }
  PRODUCTS = rows.filter(p => p.category !== 'arsiv').map(p => ({
    id: p.id, name: p.name_en || ('Piece ' + p.id), desc: p.description_en || '', cat: p.category, subs: parseSubs(p.subcategory),
    materials: /[çğışöüÇĞİŞÖÜ]/.test(p.materials || '') ? '' : (p.materials || ''), dims: p.dimensions || '',
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : [], price: p.price_usd != null ? +p.price_usd : null,
    live: p.us_visible === true, files: Array.isArray(p.tech_files) ? p.tech_files : [],
    metaTitle: p.meta_title_en, metaDesc: p.meta_description_en
  }));
  return PRODUCTS;
}
const pUrl = p => '/products/' + p.id + '-' + slug(p.name);
function lead(p) { const k = p.subs.find(s => LEAD[s]); return LEAD[k] || [4, 6]; }
function shipWindow(weeks) { const f = w => { const d = new Date(); d.setDate(d.getDate() + w * 7); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }; return f(weeks[0]) + ' – ' + f(weeks[1]); }
function cmToIn(text) { return String(text || '').replace(/(\d+(?:[.,]\d+)?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:x|×)\s*(\d+(?:[.,]\d+)?))?\s*cm/gi, (m) => { const nums = m.match(/\d+(?:[.,]\d+)?/g).map(n => Math.round(parseFloat(n.replace(',', '.')) / 2.54)); return nums.join('" × ') + '" (' + m + ')'; }).replace(/Ø\s*(\d+(?:[.,]\d+)?)\s*cm/gi, (m, n) => 'Ø ' + Math.round(parseFloat(n.replace(',', '.')) / 2.54) + '" (' + m + ')'); }
function dimsText(d) { if (!d) return ''; if (d.trim().startsWith('{')) { try { const o = JSON.parse(d); const parts = []; const f = (k, v) => v && parts.push(k + ' ' + Math.round(parseFloat(String(v).replace(',', '.')) / 2.54) + '" (' + v + ' cm)'); f('H', o.h); f('Ø', o.dia); f('W', o.w); f('D', o.d); return parts.join(' · '); } catch (e) {} } return cmToIn(d); }
function priceHTML(p, big) {
  if (p.price == null) return '<span>Price on request</span>';
  const pct = tradePct();
  if (pct) { const tp = Math.round(p.price * (1 - pct / 100)); return `<span class="trade-price">${usd(tp)}<small>Trade</small></span><span class="strike">${usd(p.price)}</span>`; }
  return `${usd(p.price)}<small>List</small>`;
}
function unitPrice(p) { const pct = tradePct(); return p.price == null ? null : Math.round(p.price * (1 - pct / 100)); }

// ---------- SEO ----------
function seo(title, desc, path, extra) {
  document.title = title; const set = (sel, attr, val) => { let el = document.head.querySelector(sel); if (!el) { el = document.createElement(sel.startsWith('link') ? 'link' : 'meta'); const m = sel.match(/\[(\w+(?::\w+)?)="([^"]+)"\]/); el.setAttribute(m[1], m[2]); document.head.appendChild(el); } el.setAttribute(attr, val); };
  set('meta[name="description"]', 'content', desc); set('link[rel="canonical"]', 'href', 'https://chandelist.com' + path);
  set('meta[property="og:title"]', 'content', title); set('meta[property="og:description"]', 'content', desc); set('meta[property="og:url"]', 'content', 'https://chandelist.com' + path);
  document.querySelectorAll('script[data-ld]').forEach(s => s.remove());
  if (extra) { const s = document.createElement('script'); s.type = 'application/ld+json'; s.dataset.ld = '1'; s.textContent = JSON.stringify(extra); document.head.appendChild(s); }
}

// ---------- components ----------
function card(p) {
  const a = p.images[0], b = p.images[1];
  return `<a class="card" href="${pUrl(p)}"><div class="ph">${!p.live ? '<span class="badge prev">Not on US site</span>' : ''}${a ? `<img src="${img(a, 700)}" alt="${esc(p.name)}" loading="lazy">` : ''}${b ? `<img class="alt" src="${img(b, 700)}" alt="" loading="lazy">` : ''}</div>
  <div class="meta"><h3 class="serif">${esc(p.name)}</h3><span class="pr">${p.price == null ? '<small>On request</small>' : priceHTML(p)}</span></div>
  <div class="lt">Made to order · ships in ${lead(p).join('–')} weeks</div></a>`;
}
function grid(list) { return list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty-state"><h3>The collection is being prepared.</h3><p>New pieces are added every week. <a class="link-u" href="/custom">Commission a piece</a></p></div>`; }

// ---------- pages ----------
async function pageHome() {
  const all = await catalog(); const rank = p => { const o = ['chandelier', 'pendant', 'lantern', 'sconce', 'flush_mount']; const i = o.findIndex(s => p.subs.includes(s)); return i < 0 ? 9 : i; };
  const pool = all.filter(p => p.images.length && p.cat === 'lighting'); const priced = pool.filter(p => p.price != null);
  const feat = (priced.length >= 3 ? priced : pool).slice().sort((a, b) => rank(a) - rank(b)).filter((p, i, arr) => arr.findIndex(x => rank(x) === rank(p)) > i - 2).slice(0, 6);
  const heroP = pool.find(p => p.subs.includes('chandelier')) || pool[0] || null;   const catTiles = Object.entries(CATS.lighting.subs).slice(0, 5).map(([k, v]) => { const p = all.find(x => x.subs.includes(k) && x.images.length); return `<a class="cat" href="/lighting/${k}"><div class="ill">${p ? `<img src="${img(p.images[0], 500)}" alt="${esc(v)}" loading="lazy">` : ''}</div><h3>${v}</h3><p>${all.filter(x => x.subs.includes(k)).length} designs</p></a>`; }).join('');
  seo('Chandelist — Handmade Brass Lighting, Made to Order', 'Hand-spun brass and copper chandeliers, pendants, sconces and lanterns, made to order. Duties included, white-glove delivery across the US.', '/');
  return `
  <section class="hero"><div class="hero-l"><div>
    <div class="eyebrow">Hand-spun brass &amp; copper · Est. 1984</div>
    <h1><span>Light,</span><span><em>made for</em></span><span>your room.</span></h1>
    <p class="lead">Chandeliers, pendants, sconces and lanterns — formed, finished and wired by hand, one order at a time. Nothing sits in a warehouse. Everything is made for you.</p>
    <div class="cta"><a href="/lighting" class="btn btn-dark">Shop Lighting →</a><a href="/custom" class="btn btn-line">Commission a Piece</a></div></div>
    <div class="hero-meta"><div><b>40+</b>years at the bench</div><div><b>Duties</b>included in every price</div><div><b>4–8</b>weeks, made to order</div></div></div>
    <div class="hero-r">${heroP ? `<img src="${img(heroP.images[0], 1400)}" alt="${esc(heroP.name)}"><div class="shade"></div><a class="hero-tag" href="${pUrl(heroP)}">Featured<b>${esc(heroP.name)}</b></a>` : ''}</div></section>
  <div class="marq"><div>${Array(2).fill(['Hand-spun brass', 'Made to order', 'Living finishes', 'Wired for 120V', 'Duties included', 'Since 1984', 'Custom sizes', 'Made by hand'].map(t => `<span>${t}</span>`).join('')).join('')}</div></div>
  <section class="blk"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Shop by Form</div><h2>Five forms, <em>endlessly</em> made to measure.</h2></div><a href="/lighting" class="link-u">View all</a></div><div class="cats">${catTiles}</div></div></section>
  <section class="blk" style="padding-top:0"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">The Collection</div><h2>Pieces our clients return to.</h2></div><a href="/lighting" class="link-u">Shop all lighting</a></div>${grid(feat)}</div></section>
  <section class="blk process"><div class="wrap"><div class="sec-head"><div><div class="eyebrow">Made to Order</div><h2>Why your light takes <em>weeks</em>, not days.</h2></div><p style="max-width:380px;color:#b9b2a3;font-weight:300">We don't keep stock. When you order, solid brass is cut, spun and hand-finished in the size and finish you chose.</p></div>
    <div class="steps"><div class="step"><div class="wk">Day 1</div><h3>Your order</h3><p>We confirm finish, size and drop length, and send a written timeline.</p></div><div class="step"><div class="wk">Weeks 1–2</div><h3>Spun &amp; formed</h3><p>Brass is hand-spun on the lathe, cut, soldered and shaped.</p></div><div class="step"><div class="wk">Weeks 2–3</div><h3>Hand finished</h3><p>Each patina is applied and rubbed back by hand.</p></div><div class="step"><div class="wk">Week 4</div><h3>Wired &amp; tested</h3><p>Wired for North American 120V, burned-in and inspected.</p></div><div class="step"><div class="wk">Weeks 4–6</div><h3>Delivered</h3><p>Crated, insured and delivered, duties already paid.</p></div></div></div></section>
  <section class="blk"><div class="wrap trade-band"><div><div class="eyebrow">For Designers &amp; Architects</div><h2 style="margin:18px 0 24px">The Trade Program.</h2><p style="font-size:17px;color:var(--ink2);font-weight:300;max-width:520px;margin-bottom:34px">Trade pricing that grows with your projects, custom sizes and finishes, spec sheets and CAD for every piece.</p><a href="/trade" class="btn btn-dark">Apply for a Trade Account</a></div>
    <ul class="perks"><li>Trade pricing <b>20–30% off</b></li><li>Custom dimensions <b>Any size</b></li><li>Spec sheets &amp; CAD <b>Every piece</b></li><li>Project quotes <b>Within 2 days</b></li></ul></div></section>`;
}

async function pageList(cat, sub) {
  const all = await catalog(); const C = CATS[cat]; if (!C) return page404();
  let list = all.filter(p => p.cat === cat && (!sub || p.subs.includes(sub)));
  const title = sub ? (C.subs[sub] || sub) : C.label;
  seo(title + ' — Handmade Brass ' + (cat === 'lighting' ? 'Lighting' : 'Decor') + ' | Chandelist', 'Handmade ' + title.toLowerCase() + ' in solid brass and copper, made to order. Duties included.', '/' + cat + (sub ? '/' + sub : ''));
  const chips = `<a class="chip ${!sub ? 'on' : ''}" href="/${cat}">All</a>` + Object.entries(C.subs).filter(([k]) => all.some(p => p.cat === cat && p.subs.includes(k))).map(([k, v]) => `<a class="chip ${sub === k ? 'on' : ''}" href="/${cat}/${k}">${v}</a>`).join('');
  const sort = new URLSearchParams(location.search).get('sort');
  if (sort === 'lo') list = list.slice().sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
  if (sort === 'hi') list = list.slice().sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  return `<div class="wrap"><div class="page-hd"><div class="eyebrow">${C.label}</div><h1>${esc(title)}</h1><p>Every piece is made to order in our workshop. Estimated ship dates are shown on each product and confirmed in writing when you order.</p></div>
  <div class="filters"><div class="chips">${chips}</div><select onchange="location.search=this.value?'?sort='+this.value:''"><option value="">Featured</option><option value="lo" ${sort === 'lo' ? 'selected' : ''}>Price: Low to High</option><option value="hi" ${sort === 'hi' ? 'selected' : ''}>Price: High to Low</option></select></div>
  <div style="padding-bottom:120px">${grid(list)}</div></div>`;
}

async function pageProduct(id) {
  const all = await catalog(); const p = all.find(x => String(x.id) === String(id));
  if (!p) return null;
  const w = lead(p); const path = pUrl(p);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: p.images.slice(0, 4), description: (p.desc || '').slice(0, 300), brand: { '@type': 'Brand', name: 'Chandelist' }, sku: 'CH-' + p.id };
  if (p.price != null) ld.offers = { '@type': 'Offer', priceCurrency: 'USD', price: p.price, availability: 'https://schema.org/PreOrder', url: 'https://chandelist.com' + path };
  seo(p.metaTitle ? p.metaTitle.replace(/osmanl[ıi] ayd[ıi]nlatma|chandelist/ig, 'Chandelist') : p.name + ' | Chandelist', (p.metaDesc || p.desc || p.name).slice(0, 158), path, ld);
  if (location.pathname !== path) history.replaceState(null, '', path);
  track('ViewContent', { content_ids: [String(p.id)], content_type: 'product', value: p.price || 0, currency: 'USD' });
  const thumbs = p.images.slice(0, 8).map((u, i) => `<div class="${i ? '' : 'on'}" data-i="${i}"><img src="${img(u, 200)}" alt="" loading="lazy"></div>`).join('');
  const signedIn = !!session();
  const files = p.files.length ? (signedIn ? `<ul class="files">${p.files.map((f, i) => `<li><span>${esc(f.label || 'File')}</span><a href="#" data-file="${i}">Download</a></li>`).join('')}</ul>` : `<div class="lock">Spec sheets and CAD files are available to account holders. <a class="link-u" href="/account?next=${encodeURIComponent(path)}">Sign in or create an account</a></div>`) : `<div class="lock">Spec sheet and CAD available on request — <a class="link-u" href="/custom?ref=${p.id}">ask our studio</a>.</div>`;
  const buy = p.price == null
    ? `<div class="buyrow"><a class="btn btn-dark" href="/custom?ref=${p.id}">Request a Quote</a></div>`
    : `<div class="opt"><label class="t">Quantity</label><div class="qty"><button id="qm">−</button><span id="qv">1</span><button id="qp">+</button></div></div><div class="buyrow"><button class="btn btn-dark" id="addBtn">Add to Bag — <span id="btnPrice">${usd(unitPrice(p))}</span></button></div>`;
  const html = `<div class="wrap"><div class="crumbs"><a href="/${p.cat}">${CATS[p.cat] ? CATS[p.cat].label : 'Shop'}</a>${p.subs[0] && CATS[p.cat] && CATS[p.cat].subs[p.subs[0]] ? ` / <a href="/${p.cat}/${p.subs[0]}">${CATS[p.cat].subs[p.subs[0]]}</a>` : ''} / <span>${esc(p.name)}</span></div>
  <div class="pdp"><div class="gal"><div class="main">${p.images[0] ? `<img id="gmain" src="${img(p.images[0], 1400)}" alt="${esc(p.name)}">` : ''}</div><div class="thumbs">${thumbs}</div></div>
  <div class="info">${!p.live ? '<div class="status-pill" style="background:#a8491c;color:#fff;margin-bottom:12px">Preview — not on US site</div>' : ''}<div class="eyebrow">${esc(p.subs.map(s => CATS[p.cat] && CATS[p.cat].subs[s]).filter(Boolean).join(' · '))}</div>
    <h1>${esc(p.name)}</h1><div class="price">${priceHTML(p, true)}</div>${tradePct() ? `<div class="afford">Your trade tier: ${tradePct()}% off list</div>` : `<div class="afford">Duties &amp; import fees included</div>`}
    <p class="desc">${esc((p.desc || '').split(/\n+/)[0])}</p>
    ${buy}
    <div class="leadbox"><div class="dot"></div><div><p><b>Made to order · Ships in ${w[0]}–${w[1]} weeks</b></p><small>Estimated to ship ${shipWindow(w)}. Your exact date is confirmed in writing within one business day.</small></div></div>
    <div class="acc">
      <details open><summary>Details</summary><div class="body">${esc(p.desc).replace(/\n+/g, '<br><br>')}</div></details>
      <details><summary>Specifications</summary><div class="body"><table>${[['Dimensions', dimsText(p.dims)], ['Materials', p.materials], ['Electrical', 'Wired for 120V North America, UL-recognized components on request'], ['Mounting', 'Hardwired; canopy and hardware included'], ['Made', 'By hand, to order']].filter(r => r[1]).map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('')}</table></div></details>
      <details><summary>Spec Sheets &amp; CAD</summary><div class="body">${files}</div></details>
      <details><summary>Delivery, Duties &amp; Returns</summary><div class="body">Prices include US import duties — nothing to pay on delivery. Orders over $2,500 ship with complimentary white-glove delivery; smaller orders ship fully insured with signature required. Made-to-order pieces are final sale; anything damaged in transit is repaired or remade at no cost.</div></details>
      <details><summary>Custom Size or Finish</summary><div class="body">Need a different size, drop length or finish? <a class="link-u" href="/custom?ref=${p.id}">Request a custom quote</a> — our studio replies within two business days.</div></details>
    </div></div></div>
  <div class="sec-head" style="margin-bottom:40px"><div><div class="eyebrow">Pairs Well With</div><h2 style="font-size:44px">Complete the room.</h2></div></div>
  <div style="padding-bottom:120px">${grid(all.filter(x => x.id !== p.id && x.cat === p.cat && x.subs.some(s => p.subs.includes(s))).slice(0, 3))}</div></div>`;
  setTimeout(() => {
    document.querySelectorAll('.thumbs div').forEach(t => t.onclick = () => { document.querySelectorAll('.thumbs div').forEach(x => x.classList.remove('on')); t.classList.add('on'); $('#gmain').src = img(p.images[+t.dataset.i], 1400); });
    let q = 1; const upd = () => { $('#qv').textContent = q; $('#btnPrice').textContent = usd(unitPrice(p) * q); };
    if ($('#addBtn')) { $('#qm').onclick = () => { if (q > 1) { q--; upd(); } }; $('#qp').onclick = () => { q++; upd(); }; $('#addBtn').onclick = () => { addToCart(p, q); }; }
    document.querySelectorAll('[data-file]').forEach(a => a.onclick = async e => { e.preventDefault(); const f = p.files[+a.dataset.file]; a.textContent = 'Preparing…'; try { const d = await api('/storage/v1/object/sign/tech-files/' + f.path, { method: 'POST', body: JSON.stringify({ expiresIn: 600 }) }); window.open(SB + '/storage/v1' + d.signedURL, '_blank'); track('Lead', { content_name: 'techfile_' + p.id }); } catch (err) { toast('Could not open the file.'); } a.textContent = 'Download'; });
  }, 0);
  return html;
}

function pageCustom() {
  const ref = new URLSearchParams(location.search).get('ref');
  seo('Custom Lighting — Commission a Piece | Chandelist', 'Send us your drawing, photo or idea. Our studio makes custom brass chandeliers, pendants and sconces to your dimensions. Quote within two business days.', '/custom');
  setTimeout(bindQuoteForm, 0);
  return `<div class="wrap formpage"><div><div class="eyebrow">Custom Design</div><h1>If you can sketch it, <em>we can make it.</em></h1>
    <p class="lede">Upload your drawing, a photo or a reference, tell us the size and finish, and our studio returns a scaled drawing and a fixed price within two business days.</p>
    <ol class="numlist"><li><b>Send your design</b><span>Drawings (PDF, DWG), photos or sketches — whatever you have.</span></li><li><b>Proposal &amp; price</b><span>A scaled drawing, finish options and a fixed quote, duties included.</span></li><li><b>Approval</b><span>A 50% deposit starts production. Progress photos throughout.</span></li><li><b>Delivery</b><span>Typically 8–12 weeks from approval, crated and insured.</span></li></ol></div>
  <div><form class="fgrid" id="quoteForm">
    <div class="f"><label>Full name</label><input name="name" required></div>
    <div class="f"><label>Email</label><input name="email" type="email" required></div>
    <div class="f"><label>Phone</label><input name="phone" type="tel"></div>
    <div class="f"><label>State / Country</label><input name="country" value="United States"></div>
    <div class="f"><label>Project type</label><select name="project_type"><option>Residential</option><option>Hospitality</option><option>Restaurant / Retail</option><option>Commercial</option><option>Other</option></select></div>
    <div class="f"><label>Quantity</label><input name="quantity" value="1"></div>
    <div class="f"><label>Approx. dimensions</label><input name="dimensions" placeholder='e.g. 36" W × 30" H'></div>
    <div class="f"><label>Finish</label><select name="finish"><option>Natural Brass</option><option>Aged Brass</option><option>Antique Copper</option><option>Blackened Brass</option><option>Not sure yet</option></select></div>
    <div class="f full"><label>Needed by</label><input name="deadline" placeholder="Month / year"></div>
    <div class="f full"><label>Describe the piece</label><textarea name="message" required>${ref ? 'Reference: product #' + esc(ref) + '\n' : ''}</textarea></div>
    <div class="f full"><label>Your design files</label><div class="drop" id="drop">Drop files here or click to upload — PDF, DWG, JPG, PNG (max 25 MB each)<input type="file" id="qfiles" multiple accept=".pdf,.dwg,.dxf,.skp,.jpg,.jpeg,.png,.heic,.zip" style="display:none"></div><div class="flist" id="flist"></div></div>
    <div class="f full"><button class="btn btn-dark" type="submit" style="justify-content:center">Request a Quote</button><div class="msg" id="qmsg"></div></div>
  </form></div></div>`;
}
function bindQuoteForm() {
  const form = $('#quoteForm'); if (!form) return; let files = [];
  const drop = $('#drop'), inp = $('#qfiles');
  const show = () => $('#flist').innerHTML = files.map(f => esc(f.name) + ' · ' + Math.round(f.size / 1024) + ' KB').join('<br>');
  drop.onclick = () => inp.click(); inp.onchange = () => { files = files.concat([...inp.files]); show(); };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); }; drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); files = files.concat([...e.dataTransfer.files]); show(); };
  form.onsubmit = async e => {
    e.preventDefault(); const msg = $('#qmsg'); const btn = form.querySelector('button'); btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending…';
    try {
      const big = files.find(f => f.size > 25 * 1024 * 1024); if (big) throw new Error(big.name + ' is larger than 25 MB');
      const up = [];
      for (const f of files) {
        const path = new Date().toISOString().slice(0, 10) + '/' + Date.now() + '_' + f.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_');
        const r = await fetch(SB + '/storage/v1/object/quote-files/' + path, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': f.type || 'application/octet-stream' }, body: f });
        if (!r.ok) throw new Error('Upload failed for ' + f.name); up.push({ name: f.name, path, size: f.size });
      }
      const d = Object.fromEntries(new FormData(form).entries()); d.site = 'chandelist'; d.files = up;
      await api('/rest/v1/quote_requests', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(d) }, false);
      track('Lead', { content_name: 'custom_quote' });
      form.innerHTML = '<div class="formok" style="display:block"><h3>Thank you.</h3><p>Your design has reached our studio. Expect a drawing and a fixed quote within two business days.</p></div>';
    } catch (err) { msg.className = 'msg err'; msg.textContent = 'Something went wrong: ' + err.message; btn.disabled = false; }
  };
}

async function pageTrade() {
  seo('Trade Program for Designers & Architects | Chandelist', 'Trade pricing from 20% to 30% off list, custom sizes and finishes, spec sheets and CAD. Apply in minutes; approval within one business day.', '/trade');
  const s = session(); if (s) await loadMe();
  const st = ME && ME.trade_status;
  const tierRows = TIERS.slice().reverse().map((t, i, arr) => `<li>${i === 0 ? 'Up to $10,000 / yr' : i === 1 ? '$10,000 – $25,000 / yr' : 'Over $25,000 / yr'} <b>${t.pct}% off list</b></li>`).join('');
  let right;
  if (!s) right = `<div class="lock" style="padding:30px"><h3 class="serif" style="font-size:30px;margin-bottom:10px">Apply in two steps</h3><p style="margin-bottom:20px">1. Create a free account. 2. Submit your firm details and resale certificate.</p><a class="btn btn-dark" href="/account?next=/trade">Create Account to Apply</a></div>`;
  else if (st === 'approved') right = `<div class="formok" style="display:block"><h3>You're a trade member.</h3><p>Your current tier: <b>${tradePct()}% off list</b>. Trade prices are shown across the site while you're signed in.</p></div>`;
  else if (st === 'pending') right = `<div class="formok" style="display:block"><h3>Application received.</h3><p>Our trade team reviews every application personally — expect an answer within one business day.</p></div>`;
  else {
    right = `<form class="fgrid" id="tradeForm">
      <div class="f"><label>Full name</label><input name="name" required value="${esc(ME && ME.name || '')}"></div>
      <div class="f"><label>Firm name</label><input name="company" required></div>
      <div class="f"><label>Profession</label><select name="profession"><option>Interior Designer</option><option>Architect</option><option>Builder / Contractor</option><option>Hospitality</option><option>Other</option></select></div>
      <div class="f"><label>Phone</label><input name="phone" type="tel" required></div>
      <div class="f"><label>Firm website or portfolio</label><input name="website" required placeholder="https://"></div>
      <div class="f"><label>State</label><input name="state" required></div>
      <div class="f"><label>Resale certificate / sales tax permit no.</label><input name="resale_cert_no"></div>
      <div class="f"><label>License or ASID / IIDA / AIA / NCIDQ no.</label><input name="license_no"></div>
      <div class="f full"><label>Upload resale certificate or license (PDF/JPG)</label><input type="file" id="tdoc" accept=".pdf,.jpg,.jpeg,.png"></div>
      <div class="f full"><label>Current projects (optional)</label><textarea name="notes"></textarea></div>
      <div class="f full"><button class="btn btn-dark" type="submit" style="justify-content:center">Submit Application</button><div class="msg" id="tmsg"></div></div></form>`;
    setTimeout(bindTradeForm, 0);
  }
  return `<div class="wrap formpage"><div><div class="eyebrow">Trade Program</div><h1>Built for the <em>people who build rooms.</em></h1>
    <p class="lede">Interior designers, architects, builders and hospitality groups receive trade pricing that grows with your projects, custom specification and a dedicated contact.</p>
    <ul class="perks" style="max-width:520px">${tierRows}<li>Spec sheets, CAD &amp; 3D <b>Every piece</b></li><li>Custom sizes &amp; finishes <b>Yes</b></li><li>Hospitality &amp; volume <b>By quote</b></li></ul>
    <p style="font-size:13px;color:var(--muted);margin-top:18px">Tiers are based on your trade purchases over the last 12 months and update automatically. To qualify we ask for a resale certificate, a professional license or ASID/IIDA/AIA/NCIDQ membership, and a firm website or portfolio.</p></div><div>${right}</div></div>`;
}
function bindTradeForm() {
  const form = $('#tradeForm'); if (!form) return;
  form.onsubmit = async e => {
    e.preventDefault(); const msg = $('#tmsg'); const btn = form.querySelector('button'); btn.disabled = true; msg.textContent = 'Submitting…'; msg.className = 'msg';
    try {
      const s = session(); const t = await token(); if (!s || !t) throw new Error('Please sign in again');
      const d = Object.fromEntries(new FormData(form).entries()); const docs = [];
      const f = $('#tdoc').files[0];
      if (f) { const path = s.user.id + '/' + Date.now() + '_' + f.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_'); const r = await fetch(SB + '/storage/v1/object/quote-files/trade/' + path, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': f.type || 'application/octet-stream' }, body: f }); if (r.ok) docs.push({ name: f.name, path: 'trade/' + path }); }
      const row = Object.assign(d, { id: s.user.id, email: s.user.email, trade_status: 'pending', docs, applied_at: new Date().toISOString() });
      await api('/rest/v1/customers', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      track('CompleteRegistration', { content_name: 'trade_application' });
      render();
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; btn.disabled = false; }
  };
}

async function pageAccount() {
  const next = new URLSearchParams(location.search).get('next') || '';
  const s = session();
  if (s) {
    await loadMe();
    seo('My Account | Chandelist', 'Your Chandelist account.', '/account');
    const ord = (ME.orders || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return `<div class="wrap acct-page" style="max-width:760px"><div class="eyebrow">My Account</div><h1>Hello${ME.name ? ', ' + esc(ME.name.split(' ')[0]) : ''}.</h1>
      <p style="margin-bottom:20px">${esc(s.user.email)} · Trade status: <span class="status-pill">${{ none: 'Not applied', pending: 'Under review', approved: 'Approved — ' + tradePct() + '% off', rejected: 'Not approved' }[ME.trade_status || 'none']}</span></p>
      ${ME.trade_status !== 'approved' && ME.trade_status !== 'pending' ? '<p style="margin-bottom:30px"><a class="link-u" href="/trade">Apply for trade pricing</a></p>' : ''}
      <h3 class="serif" style="font-size:28px;margin:30px 0 12px">Orders</h3>${ord.length ? `<ul class="files">${ord.map(o => `<li><span>${new Date(o.created_at).toLocaleDateString('en-US')} · ${usd(o.total)}</span><span class="status-pill">${esc(String(o.status).replace(/_/g, ' '))}</span></li>`).join('')}</ul>` : '<p style="color:var(--muted)">No orders yet.</p>'}
      <p style="margin-top:40px"><button class="link-u" id="logout">Sign out</button></p></div>`;
  }
  seo('Sign In or Create Account | Chandelist', 'Sign in to download spec sheets and CAD, track orders and access trade pricing.', '/account');
  setTimeout(() => {
    document.querySelectorAll('.tabs2 button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs2 button').forEach(x => x.classList.toggle('on', x === b)); $('#fLogin').style.display = b.dataset.t === 'in' ? '' : 'none'; $('#fSignup').style.display = b.dataset.t === 'up' ? '' : 'none'; });
    $('#fLogin').onsubmit = async e => { e.preventDefault(); const m = $('#amsg'); m.className = 'msg'; m.textContent = 'Signing in…'; const d = Object.fromEntries(new FormData(e.target).entries());
      try { const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(d) }, false); r.expires_at = Math.floor(Date.now() / 1000) + (r.expires_in || 3600); store.set(SESS, r); PRODUCTS = null; go(next || '/account'); } catch (err) { m.className = 'msg err'; m.textContent = /confirm/i.test(err.message) ? 'Please confirm your email first — check your inbox.' : 'Email or password is incorrect.'; } };
    $('#fSignup').onsubmit = async e => { e.preventDefault(); const m = $('#amsg'); m.className = 'msg'; m.textContent = 'Creating your account…'; const d = Object.fromEntries(new FormData(e.target).entries());
      try { const r = await api('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: d.email, password: d.password, data: { name: d.name } }) }, false);
        track('CompleteRegistration', { content_name: 'account' });
        if (r && r.access_token) { r.expires_at = Math.floor(Date.now() / 1000) + (r.expires_in || 3600); store.set(SESS, r); try { await api('/rest/v1/customers', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: r.user.id, email: d.email, name: d.name, trade_status: 'none' }) }); } catch (x) {} go(next || '/account'); }
        else { m.className = 'msg ok'; m.textContent = 'Almost there — we sent a confirmation link to ' + d.email + '. Click it, then sign in.'; }
      } catch (err) { m.className = 'msg err'; m.textContent = /disabled|not allowed/i.test(err.message) ? 'Account registration opens soon. Meanwhile, email info@chandelist.com.' : err.message; } };
  }, 0);
  return `<div class="wrap acct-page"><div class="eyebrow">Account</div><h1>Welcome.</h1><div class="tabs2"><button class="on" data-t="in">Sign In</button><button data-t="up">Create Account</button></div>
    <form class="fgrid" id="fLogin"><div class="f full"><label>Email</label><input name="email" type="email" required autocomplete="email"></div><div class="f full"><label>Password</label><input name="password" type="password" required autocomplete="current-password"></div><div class="f full"><button class="btn btn-dark" style="justify-content:center">Sign In</button></div></form>
    <form class="fgrid" id="fSignup" style="display:none"><div class="f full"><label>Full name</label><input name="name" required autocomplete="name"></div><div class="f full"><label>Email</label><input name="email" type="email" required autocomplete="email"></div><div class="f full"><label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required autocomplete="new-password"></div><div class="f full"><button class="btn btn-dark" style="justify-content:center">Create Account</button><p style="font-size:13px;color:var(--muted);margin-top:10px">Designers &amp; architects: create an account, then apply for trade pricing.</p></div></form>
    <div class="msg" id="amsg"></div></div>`;
}

async function pageCheckout() {
  const cart = getCart(); const all = await catalog();
  const lines = cart.map(i => ({ i, p: all.find(p => p.id === i.id) })).filter(x => x.p && x.p.price != null);
  if (!lines.length) return `<div class="wrap empty-state"><h3>Your bag is empty.</h3><a class="btn btn-dark" href="/lighting">Shop Lighting</a></div>`;
  const pct = tradePct(); const list = lines.reduce((a, x) => a + x.p.price * x.i.q, 0); const total = lines.reduce((a, x) => a + unitPrice(x.p) * x.i.q, 0);
  seo('Checkout | Chandelist', 'Secure checkout.', '/checkout');
  track('InitiateCheckout', { value: total, currency: 'USD', num_items: lines.length });
  setTimeout(() => { $('#coForm').onsubmit = async e => {
    e.preventDefault(); const m = $('#comsg'); const btn = e.target.querySelector('button'); btn.disabled = true; m.className = 'msg'; m.textContent = 'Placing your order…';
    const d = Object.fromEntries(new FormData(e.target).entries()); const s = session();
    const order = { customer_id: s ? s.user.id : null, email: d.email, name: d.name, phone: d.phone, address: { line1: d.line1, line2: d.line2, city: d.city, state: d.state, zip: d.zip, country: 'US' }, items: lines.map(x => ({ id: x.p.id, name: x.p.name, qty: x.i.q, list: x.p.price, unit: unitPrice(x.p) })), subtotal: list, discount_pct: pct, total, notes: d.notes, status: 'pending_payment', site: 'chandelist' };
    try {
      // 1) online card payment (PayTR) — prices are re-checked on the server
      const t = await token();
      const r = await fetch('/.netlify/functions/paytr-token', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { Authorization: 'Bearer ' + t } : {}), body: JSON.stringify({ items: lines.map(x => ({ id: x.p.id, q: x.i.q })), customer: d, notes: d.notes }) });
      const res = await r.json().catch(() => ({}));
      if (r.ok && res.token) {
        track('AddPaymentInfo', { value: res.total, currency: 'USD' });
        $('#app').innerHTML = `<div class="wrap" style="max-width:760px;padding:60px 0 120px"><div class="eyebrow">Secure payment</div><h1 class="serif" style="font-size:44px;margin:10px 0 8px">Pay ${usd(res.total)}</h1><p style="color:var(--muted);margin-bottom:24px">Order #${res.orderId} · ${res.currency === 'TL' ? 'Your card is charged the equivalent ₺' + Number(res.charge).toLocaleString('en-US') + ' (Turkish lira) at today\'s rate; your bank converts it to USD.' : 'Card payment in US dollars, processed securely.'} Duties included.</p><iframe src="https://www.paytr.com/odeme/guvenli/${encodeURIComponent(res.token)}" id="paytriframe" frameborder="0" scrolling="no" style="width:100%;min-height:620px;border:0"></iframe></div>`;
        const sc = document.createElement('script'); sc.src = 'https://www.paytr.com/js/iframeResizer.min.js'; sc.onload = () => { try { iFrameResize({}, '#paytriframe'); } catch (x) {} }; document.body.appendChild(sc);
        window.scrollTo(0, 0); return;
      }
      if (res.error !== 'payments_not_configured') throw new Error(res.error || 'Payment could not be started');
      // 2) fallback while card payments are being set up: order now, payment link by email
      await api('/rest/v1/orders', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(order) }, !!s);
      track('Purchase', { value: total, currency: 'USD' }); saveCart([]);
      $('#app').innerHTML = `<div class="wrap acct-page" style="max-width:640px"><div class="eyebrow">Order received</div><h1>Thank you, ${esc(d.name.split(' ')[0])}.</h1><p class="lede">We've received your order for ${usd(total)}. Within one business day you'll receive an email with your confirmed ship date and a secure payment link.</p><a class="btn btn-line" href="/lighting">Continue Shopping</a></div>`; window.scrollTo(0, 0);
    }
    catch (err) { m.className = 'msg err'; m.textContent = err.message; btn.disabled = false; }
  }; }, 0);
  const s = session();
  return `<div class="wrap"><div class="checkout"><div><div class="eyebrow">Checkout</div><h1 class="serif" style="font-size:52px;margin:10px 0 30px">Shipping details</h1>
    <form class="fgrid" id="coForm"><div class="f"><label>Full name</label><input name="name" required value="${esc(ME && ME.name || '')}"></div><div class="f"><label>Email</label><input name="email" type="email" required value="${esc(s ? s.user.email : '')}"></div>
    <div class="f full"><label>Phone</label><input name="phone" type="tel" required></div><div class="f full"><label>Address</label><input name="line1" required></div><div class="f full"><label>Apt, suite (optional)</label><input name="line2"></div>
    <div class="f"><label>City</label><input name="city" required></div><div class="f"><label>State</label><input name="state" required maxlength="2" placeholder="NY"></div><div class="f"><label>ZIP</label><input name="zip" required pattern="[0-9]{5}(-[0-9]{4})?"></div><div class="f"><label>Country</label><input value="United States" disabled></div>
    <div class="f full"><label>Order notes (drop length, delivery window…)</label><textarea name="notes"></textarea></div>
    <div class="f full"><button class="btn btn-dark" style="justify-content:center">Continue to Payment — ${usd(total)}</button><p style="font-size:13px;color:var(--muted);margin-top:10px">Next: secure card payment in US dollars. Your ship date is confirmed in writing within one business day.</p><div class="msg" id="comsg"></div></div></form></div>
    <div class="sumbox"><h3 class="serif" style="font-size:26px;margin-bottom:14px">Order summary</h3>${lines.map(x => `<div class="sumrow"><span>${esc(x.p.name)} × ${x.i.q}</span><span>${usd(unitPrice(x.p) * x.i.q)}</span></div>`).join('')}
    ${pct ? `<div class="sumrow"><span>Trade pricing (${pct}%)</span><span>−${usd(list - total)}</span></div>` : ''}<div class="sumrow"><span>Duties &amp; import fees</span><span>Included</span></div><div class="sumrow"><span>Delivery</span><span>${total >= FREE_SHIP ? 'White-glove, complimentary' : 'Quoted with your ship date'}</span></div><div class="sumrow tot"><span>Total</span><span>${usd(total)}</span></div></div></div></div>`;
}

function pageAbout() {
  seo('Our Craft — Four Decades at the Bench | Chandelist', 'A family of metalsmiths spinning, hammering and finishing brass and copper lighting by hand since 1984.', '/about');
  return `<div class="wrap"><div class="about-hero"><div><div class="eyebrow">Our Craft</div><h1 style="margin-top:16px">Four decades <em>at the bench.</em></h1></div><div>
  <p>Chandelist is the work of a family of metalsmiths who have been spinning, hammering and finishing brass and copper in Istanbul since 1984.</p>
  <p>We still work the old way: sheet metal on the lathe, solder by hand, patina applied with a brush and rubbed back with a cloth. It is slower. It is also the only way we know to make a light that feels like it was always meant to hang in your room.</p>
  <p>Every piece is made to order — you choose the size, the finish and the drop, and we make exactly that, wired for North America and delivered with duties paid.</p></div></div>
  <section class="blk"><p class="bigquote">“A light is the one object in a room you <em>look at</em> and <em>look by.</em> It deserves to be made slowly.”</p></section>
  <div class="stats" style="margin-top:0;margin-bottom:120px"><div><b>1984</b><span>Our workshop opens</span></div><div><b>40+</b><span>Years of hand-spun brass</span></div><div><b>100%</b><span>Made to order</span></div><div><b>1</b><span>Craftsman follows each piece</span></div></div></div>`;
}
function pageFaq() {
  seo('Help — Lead Times, Shipping, Duties & Returns | Chandelist', 'Answers about made-to-order lead times, US delivery, duties, returns and warranty.', '/faq');
  const q = (a, b) => `<details><summary>${a}</summary><div class="body">${b}</div></details>`;
  return `<div class="wrap"><div class="page-hd" style="text-align:center;border:none"><div class="eyebrow">Help</div><h1>Questions, answered.</h1></div><div class="faq acc">
  <h3>Orders &amp; Lead Times</h3>${q('Why is everything made to order?', 'Because we would rather make your light than store someone else\'s. Making to order lets you choose finish, size and drop length.')}${q('How long will my order take?', 'Most pieces ship in 4–6 weeks; chandeliers and large lanterns in 6–8 weeks. Every product page shows an estimated ship window, confirmed in writing within one business day.')}${q('How do I pay?', 'After you place your order we confirm your ship date and email a secure card payment link. Production starts once payment is complete.')}
  <h3>Shipping &amp; Duties</h3>${q('Where do you ship?', 'All 50 states. Orders over $2,500 receive complimentary white-glove delivery; smaller orders ship insured with signature required.')}${q('Will I pay import duties?', 'No. Our prices include US import duties and fees — nothing is collected at your door.')}${q('What if something arrives damaged?', 'Note it on the delivery receipt, send a photo within 48 hours, and we repair or remake it at no cost.')}
  <h3>Returns &amp; Warranty</h3>${q('Can I return a made-to-order piece?', 'Made-to-order pieces are final sale. Orders can be changed or cancelled free of charge within 48 hours of payment.')}${q('Is there a warranty?', 'Five years on workmanship and electrical components. Natural patina development is part of the finish, not a defect.')}
  <h3>Electrical</h3>${q('Are fixtures compatible with US wiring?', 'Yes — wired for North American 120V with standard E26/E12 sockets, dimmable with a compatible LED bulb and dimmer. Installation by a licensed electrician is recommended.')}</div></div>`;
}
function pageLegal(kind) {
  const t = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Sale';
  seo(t + ' | Chandelist', t, '/' + kind);
  const body = kind === 'privacy' ? 'We collect the information you give us (name, email, phone, address, files you upload) to answer quotes and fulfil orders. Card details are handled by our payment provider and never stored by us. We use analytics and advertising cookies to understand site use. Email info@chandelist.com to access or delete your data.'
    : 'All pieces are made to order. Prices are in US dollars and include import duties. Lead times are estimates confirmed in writing after ordering. Made-to-order items are final sale except for damage in transit or manufacturing defects, covered by a five-year warranty on workmanship and electrical components.';
  const seller = kind === 'terms' ? `<h3 class="serif" style="font-size:24px;margin:40px 0 10px">Seller information</h3><p style="font-size:14px;color:var(--ink2)">Chandelist is a brand of Art Bakırcılık San. ve Tic. A.Ş., Çobançeşme Mah. Mithatpaşa Cad. Söğütlü Sok. No:2/1, Bahçelievler, Istanbul, Türkiye. Customer service: info@chandelist.com</p>` : '';
  return `<div class="wrap acct-page" style="max-width:760px"><h1>${t}</h1><p class="lede">${body}</p>${seller}</div>`;
}
function page404() { seo('Not found | Chandelist', 'Page not found', location.pathname); return `<div class="wrap empty-state"><h3>This page has moved.</h3><a class="btn btn-dark" href="/lighting">Shop Lighting</a></div>`; }

// ---------- cart ----------
function getCart() { return store.get('ch_cart', []); }
function saveCart(c) { store.set('ch_cart', c); renderCart(); }
function addToCart(p, q) { const c = getCart(); const ex = c.find(i => i.id === p.id); if (ex) ex.q += q; else c.push({ id: p.id, q }); saveCart(c); track('AddToCart', { content_ids: [String(p.id)], value: unitPrice(p) * q, currency: 'USD' }); openCart(); }
async function renderCart() {
  const c = getCart(); $('#cc').textContent = c.reduce((a, i) => a + i.q, 0);
  if (!$('#drawer').classList.contains('on')) return;
  const all = await catalog(); const lines = c.map(i => ({ i, p: all.find(p => p.id === i.id) })).filter(x => x.p && x.p.price != null);
  const sub = lines.reduce((a, x) => a + unitPrice(x.p) * x.i.q, 0); const left = Math.max(0, FREE_SHIP - sub);
  $('#meter').innerHTML = (left ? `You're <b>${usd(left)}</b> away from complimentary white-glove delivery.` : '<b>Complimentary white-glove delivery</b> is included.') + `<div class="bar"><i style="width:${Math.min(100, sub / FREE_SHIP * 100)}%"></i></div>`;
  if (!lines.length) { $('#items').innerHTML = '<div class="empty"><div class="serif">Your bag is empty.</div>Every piece is made for you.<br><br><a href="/lighting" class="btn btn-dark">Shop Lighting</a></div>'; $('#df').style.display = 'none'; return; }
  $('#df').style.display = 'block';
  $('#items').innerHTML = lines.map((x, n) => `<div class="it"><div class="th">${x.p.images[0] ? `<img src="${img(x.p.images[0], 200)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</div><div><h4>${esc(x.p.name)}</h4><small style="color:var(--brass2)">Ships in ${lead(x.p).join('–')} weeks</small><div class="q"><button data-n="${n}" data-d="-1">−</button>${x.i.q}<button data-n="${n}" data-d="1">+</button></div><button class="rm" data-rm="${x.p.id}">Remove</button></div><div>${usd(unitPrice(x.p) * x.i.q)}</div></div>`).join('');
  $('#items').querySelectorAll('[data-d]').forEach(b => b.onclick = () => { const x = lines[+b.dataset.n]; const cc = getCart(); const it = cc.find(i => i.id === x.p.id); it.q += +b.dataset.d; saveCart(cc.filter(i => i.q > 0)); });
  $('#items').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => saveCart(getCart().filter(i => i.id !== +b.dataset.rm)));
  $('#df').innerHTML = `<div class="row"><span>Subtotal</span><span>${usd(sub)}</span></div><div class="row"><span>Duties</span><span>Included</span></div><div class="row tot"><span>Total</span><span>${usd(sub)}</span></div><div class="note">Made to order — ships in about ${Math.max(...lines.map(x => lead(x.p)[1]))} weeks. Sales tax, if any, confirmed with your ship date.</div><a class="btn btn-dark" href="/checkout" style="width:100%;justify-content:center">Checkout →</a>`;
}
function openCart() { $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); renderCart(); }
function closeCart() { $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }

// ---------- router ----------
function go(path) { history.pushState(null, '', path); render(); }
async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/'; const seg = path.split('/').filter(Boolean);
  closeCart(); $('#mnav').classList.remove('on');
  if (session()) { if (!ME) await loadMe(); $('#acctLink').textContent = 'My Account'; } else { ME = null; $('#acctLink').textContent = 'Log In | Create Account'; }
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === seg[0]));
  let html;
  try {
    if (!seg.length) html = await pageHome();
    else if (CATS[seg[0]]) html = (seg[1] && !CATS[seg[0]].subs[seg[1]]) ? page404() : await pageList(seg[0], seg[1]);
    else if (seg[0] === 'products' && seg[1]) { html = await pageProduct(parseInt(seg[1], 10)); if (!html) { location.replace('https://osmanliaydinlatma.com/en' + location.pathname); return; } }
    else if (seg[0] === 'custom' || seg[0] === 'contact') html = pageCustom();
    else if (seg[0] === 'trade') html = await pageTrade();
    else if (seg[0] === 'account') html = await pageAccount();
    else if (seg[0] === 'checkout' && seg[1] === 'success') { saveCart([]); track('Purchase', { currency: 'USD' }); seo('Thank you | Chandelist', 'Order confirmed', '/checkout/success'); html = `<div class="wrap acct-page" style="max-width:640px"><div class="eyebrow">Payment received</div><h1>Thank you.</h1><p class="lede">Your order is confirmed and goes into production now. You'll receive your ship date in writing within one business day, and photos of your piece before it leaves the workshop.</p><a class="btn btn-line" href="/lighting">Continue Shopping</a></div>`; }
    else if (seg[0] === 'checkout' && seg[1] === 'failed') { seo('Payment not completed | Chandelist', 'Payment not completed', '/checkout/failed'); html = `<div class="wrap acct-page" style="max-width:640px"><div class="eyebrow">Payment not completed</div><h1>No charge was made.</h1><p class="lede">Your bag is saved. You can try again with another card, or write to info@chandelist.com and we'll send you a payment link.</p><a class="btn btn-dark" href="/checkout">Try Again</a></div>`; }
    else if (seg[0] === 'checkout') html = await pageCheckout();
    else if (seg[0] === 'about' || seg[0] === 'workshop') html = pageAbout();
    else if (seg[0] === 'faq') html = pageFaq();
    else if (seg[0] === 'privacy' || seg[0] === 'terms') html = pageLegal(seg[0]);
    else html = page404();
  } catch (e) { console.error(e); html = page404(); }
  $('#app').innerHTML = html; window.scrollTo(0, 0);
  const lo = $('#logout'); if (lo) lo.onclick = () => { localStorage.removeItem(SESS); ME = null; PRODUCTS = null; go('/'); };
  try { gtag('event', 'page_view', { page_path: location.pathname }); fbq('track', 'PageView'); } catch (e) {}
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]'); if (!a) return; const h = a.getAttribute('href');
  if (!h || !h.startsWith('/') || h.startsWith('//') || a.target || e.metaKey || e.ctrlKey || h.startsWith('/admin')) return;
  e.preventDefault(); go(h);
});
window.addEventListener('popstate', render);
$('#openCart').onclick = openCart; $('#closeCart').onclick = closeCart; $('#scrim').onclick = closeCart;
$('#burger').onclick = () => $('#mnav').classList.toggle('on');
$('#yr').textContent = new Date().getFullYear();
renderCart(); render();
})();
