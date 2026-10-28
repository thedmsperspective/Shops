// The DM's Perspective — Shops: the player's side. Browse the shops in the town where the party is, buy with the coins
// on your character sheet, and sell what a shop stocks. The DM's Shops app (on their tablet) checks every sale; this
// device then updates the character sheet here and sends the change over the live link, so the DM's copy follows.
import * as R from './rules.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHEET = '/Char-Sheet/js/';
let core, T, view = null, stop = null, chars = [], charId = '', open = null, tab = 'buy', busy = false, toast = () => {};
const P = { db: null, model: null };

// Your characters on this device (the Character Sheet keeps them here)
async function loadChars() {
  try { P.db = P.db || (await import(`${SHEET}db.js`)).db; P.model = P.model || await import(`${SHEET}model.js`); } catch { return []; }
  chars = (await P.db.all()).filter(c => c?.app === 'charsheet').sort((a, b) => (b.liveKey ? 1 : 0) - (a.liveKey ? 1 : 0) || (a.name || '').localeCompare(b.name || ''));
  try { const saved = localStorage.getItem('dmp-shops-char'); if (chars.some(c => c.id === saved)) charId = saved; } catch { /* */ }
  if (!chars.some(c => c.id === charId)) charId = chars[0]?.id || '';
  return chars;
}
const me = () => chars.find(c => c.id === charId);
const n = v => Number(v) || 0;
const purseOfChar = c => ({ pp: n(c?.coins?.pp), gp: n(c?.coins?.gp), sp: n(c?.coins?.sp), cp: n(c?.coins?.cp) });

export async function startPlayer(c, opts) {
  core = c; toast = opts.toast;
  T = await core.tables();
  await loadChars();
  const table = core.currentTable?.();
  if (!table?.id) return say('Join your DM\'s table in the launcher first.');
  if (table.status && table.status !== 'approved') return say('Your DM hasn\'t let you into the table yet.');
  let pass = core.signedIn(''); if (!pass && core.refreshNow) pass = await core.refreshNow();
  stop?.(); stop = T.watchShops(pass?.value || null, table.id, v => { view = v; draw(); });
  draw();
}
function say(html) { $('#app').innerHTML = `<div class="card"><p>${html}</p><p><a href="/" style="color:inherit">Open the launcher</a></p></div>`; }

function draw() {
  const app = $('#app');
  if (!view) return say('Looking for your DM\'s shops…');
  if (!view.shops || view.closed) return say('No shops are open to you right now. Your DM opens them when the party is in town.');
  const c = me();
  const who = chars.length ? `<div class="row"><span class="mu">Shopping as</span>${chars.length > 1 ? `<select id="who" style="width:auto">${chars.map(x => `<option value="${x.id}" ${x.id === charId ? 'selected' : ''}>${esc(x.name || 'Unnamed')}</option>`).join('')}</select>` : `<b>${esc(c?.name || '')}</b>`}<span class="tag ac">${esc(R.purseText(purseOfChar(c)))}</span></div>`
    : '<p class="warn">Open your character sheet on this device once (in the Character Sheet app), then come back: your coins come from it.</p>';
  const svc = Object.entries(view.services || {}).filter(([, v]) => v).map(([k, v]) => `<span class="tag ${v === 'open' ? 'ok' : ''}">${esc(k)}: ${v === 'open' ? 'open' : 'closed'}</span>`).join('');
  const shop = open && view.shops.find(s => s.id === open);
  if (!shop) {
    app.innerHTML = `<div class="card"><h2>${esc(view.town)}</h2>${who}${svc ? `<p class="small">Also in town (ask your DM): ${svc}</p>` : ''}</div>
      <div class="grid">${view.shops.map(s => `<button class="tile ${s.status === 'closed' ? 'closed' : ''}" data-shop="${s.id}"><b>${esc(s.name)}</b><span class="mu">${esc(s.type)}</span><br>
        <span class="small">${esc(s.keeper?.name || '')}${s.keeper?.race ? `, ${esc([s.keeper.gender, s.keeper.race].filter(Boolean).join(' '))}` : ''}</span>${s.status === 'closed' ? '<br><span class="tag bad">Closed</span>' : ''}${s.haggled ? '<br><span class="tag ok">Haggled prices</span>' : ''}</button>`).join('')}</div>`;
    app.querySelectorAll('[data-shop]').forEach(b => { b.onclick = () => { open = b.dataset.shop; tab = 'buy'; draw(); window.scrollTo(0, 0); }; });
  } else {
    const bands = R.BANDS.map((b, i) => ({ b, items: shop.items.filter(x => x.band === i) })).filter(g => g.items.length);
    const mine = sellable(shop, c);
    app.innerHTML = `<div class="card"><div class="row"><button class="sm" id="out">← ${esc(view.town)}</button></div>
      <h2>${esc(shop.name)}</h2><p class="mu">${esc(shop.type)} · ${esc(shop.keeper?.name || '')}${shop.keeper?.race ? `, ${esc([shop.keeper.gender, shop.keeper.race].filter(Boolean).join(' '))}` : ''}${shop.haggled ? ' · <span class="tag ok">Haggled prices</span>' : ''}</p>${who}
      <div class="row"><button id="tbuy" aria-pressed="${tab === 'buy'}">Buy</button><button id="tsell" aria-pressed="${tab === 'sell'}">Sell</button></div></div>
      ${shop.status === 'closed' ? '<div class="warn">This shop is closed.</div>' : tab === 'buy' ? `<div class="card"><table class="stock"><thead><tr><th>Item</th><th class="num">In stock</th><th class="num">Price</th><th></th></tr></thead><tbody>
        ${bands.map(g => `<tr class="band"><td colspan="4">${g.b} Quality</td></tr>${g.items.map(it => `<tr><td>${esc(it.n)}${it.magic ? ' <span class="tag ac">magic</span>' : ''}${it.d ? `<br><small class="mu">${esc(it.d)}</small>` : ''}</td><td class="num">${it.q == null ? '∞' : it.q}</td><td class="num">${R.money(it.p)}</td><td><button class="sm pri" data-buy="${it.id}" ${busy || !c ? 'disabled' : ''}>Buy</button></td></tr>`).join('')}`).join('') || '<tr><td class="mu">Nothing on the shelf right now.</td></tr>'}
      </tbody></table></div>` : `<div class="card"><p class="mu small">${esc(shop.name)} only buys the kinds of things it sells.</p>
        ${mine.length ? `<table class="stock"><thead><tr><th>Your item</th><th class="num">You have</th><th class="num">They pay</th><th></th></tr></thead><tbody>${mine.map(x => `<tr><td>${esc(x.row.name)}</td><td class="num">${n(x.row.qty) || 1}</td><td class="num">${R.money(x.p)}</td><td><button class="sm pri" data-sell="${esc(x.key)}" ${busy ? 'disabled' : ''}>Sell one</button></td></tr>`).join('')}</tbody></table>` : '<p>Nothing in your inventory that this shop buys.</p>'}</div>`}`;
    $('#out').onclick = () => { open = null; draw(); };
    $('#tbuy').onclick = () => { tab = 'buy'; draw(); };
    $('#tsell').onclick = () => { tab = 'sell'; draw(); };
    app.querySelectorAll('[data-buy]').forEach(b => { b.onclick = () => buy(shop, shop.items.find(x => x.id === b.dataset.buy)); });
    app.querySelectorAll('[data-sell]').forEach(b => { b.onclick = () => sell(shop, mine.find(x => x.key === b.dataset.sell)); });
  }
  const w = $('#who'); if (w) w.onchange = () => { charId = w.value; try { localStorage.setItem('dmp-shops-char', charId); } catch { /* */ } draw(); };
}

// Inventory rows this shop will buy (by name, the way the shop lists them)
function sellable(shop, c) {
  if (!c) return [];
  const buys = new Map((shop.buys || []).map(b => [b.n.toLowerCase(), b]));
  const out = [];
  for (const [cat, rows] of Object.entries(c.inv || {})) (rows || []).forEach((row, i) => {
    const b = buys.get(String(row.name || '').trim().toLowerCase());
    if (b && (row.qty === '' || row.qty == null || n(row.qty) > 0)) out.push({ key: `${cat}.${i}`, cat, i, row, p: b.p, name: b.n });
  });
  return out;
}

async function ask(req) {
  busy = true; draw();
  try {
    let pass = core.signedIn(''); if (!pass && core.refreshNow) pass = await core.refreshNow();
    return await T.shopRequest(pass?.value || null, core.currentTable().id, req);
  } finally { busy = false; }
}
async function buy(shop, it) {
  const c = me(); if (!c || !it) return;
  if (R.purseCp(purseOfChar(c)) < it.p) { toast("You don't have enough coin for that."); return; }
  const r = await ask({ kind: 'buy', shopId: shop.id, itemId: it.id, n: 1, purse: purseOfChar(c), who: c.name || '' });
  if (r.error) { toast(r.error); draw(); return; }
  await changeSheet(c.id, x => {
    x.coins = { ...(x.coins || {}), ...R.addCoins(R.addCoins(purseOfChar(x), r.give, -1), r.change) };
    const cat = catFor(shop.type, it);
    const list = (x.inv[cat] = x.inv[cat] || []);
    const row = list.find(y => String(y.name).toLowerCase() === it.n.toLowerCase());
    if (row) row.qty = n(row.qty || 1) + 1;
    else list.push({ id: P.model.uid(), name: it.n, wt: '', qty: 1, magic: !!it.magic, desc: it.d || '' });
    return ['coins', `inv.${cat}`];
  });
  toast(`Bought ${it.n} for ${R.money(r.cp)}.${R.purseCp(r.change) ? ` Change: ${R.purseText(r.change)}.` : ''}`);
}
async function sell(shop, x) {
  const c = me(); if (!c || !x) return;
  const r = await ask({ kind: 'sell', shopId: shop.id, name: x.name, n: 1, who: c.name || '' });
  if (r.error) { toast(r.error); draw(); return; }
  await changeSheet(c.id, ch => {
    ch.coins = { ...(ch.coins || {}), ...R.addCoins(purseOfChar(ch), r.paid) };
    const list = ch.inv[x.cat] || [], row = list.find(y => y.id === x.row.id) || list[x.i];
    if (row) { const left = n(row.qty || 1) - 1; if (left > 0) row.qty = left; else list.splice(list.indexOf(row), 1); }
    return ['coins', `inv.${x.cat}`];
  });
  toast(`Sold ${x.name} for ${R.purseText(r.paid)}.`);
}
const catFor = (type, it) => (type === 'Blacksmith' && /armor|mail|plate|shield|breastplate|leather|hide/i.test(it.n) ? 'armor'
  : type === 'Blacksmith' || type === 'Fletcher' ? 'weapons' : type === 'Jewelry' ? 'treasure' : /tools|kit|supplies/i.test(it.n) ? 'tools' : 'general');

// Change the character here, stamp what changed, and send it over the live link so the DM's copy follows at once
async function changeSheet(id, fn) {
  const c = await P.db.get(id); if (!c) return;
  const paths = fn(c) || [];
  const t = Date.now();
  for (const p of paths) P.model.stamp(c, p);
  await P.db.put(c);
  chars = chars.map(x => (x.id === id ? c : x));
  try {
    const L = await core.live?.();
    if (L && c.liveKey) for (const p of paths) await L.cput(c.liveKey, `sheet/${L.encPath(p)}`, { v: p.split('.').reduce((o, k) => o?.[k], c), t: c.edits?.[p] || t });
  } catch { /* the Character Sheet syncs it through Drive anyway */ }
  draw();
}
