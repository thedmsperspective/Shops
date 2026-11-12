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
// Has this character earned the shop's haggle discount? (the DM ticks them off, one by one)
const wonBy = (shop, c) => shop.haggle?.kind !== 'none' && (shop.won || []).some(w => w === '*' || w === (c?.name || ''));
const priceOf = (x, shop, c) => (wonBy(shop, c) && x.hp != null ? x.hp : x.p);
function haggleLine(shop, c) {
  const h = shop.haggle || {};
  if (!h.kind || h.kind === 'none') return '<p class="mu small">This shopkeeper won\'t haggle.</p>';
  if (wonBy(shop, c)) return `<p class="small"><span class="tag ok">✓ ${h.off}% off for you this month</span></p>`;
  return h.kind === 'roll'
    ? `<p class="small">🎲 <b>Haggle:</b> ${esc(h.skill || 'Persuasion')} DC ${h.dc} for ${h.off}% off, just for you, this month. Tell your DM if you want to try.</p>`
    : `<p class="small">🤝 <b>The shopkeeper asks a favor:</b> ${esc(h.favor)} <b>Do it, and you get ${h.off}% off</b> this month. Talk to your DM.</p>`;
}
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
        <span class="small">${esc(s.keeper?.name || '')}${s.keeper?.race ? `, ${esc([s.keeper.gender, s.keeper.race].filter(Boolean).join(' '))}` : ''}</span>${s.status === 'closed' ? '<br><span class="tag bad">Closed</span>' : ''}${wonBy(s, c) ? '<br><span class="tag ok">Your haggled prices</span>' : ''}</button>`).join('')}</div>`;
    app.querySelectorAll('[data-shop]').forEach(b => { b.onclick = () => { open = b.dataset.shop; tab = 'buy'; draw(); window.scrollTo(0, 0); }; });
  } else {
    const bands = R.BANDS.map((b, i) => ({ b, items: shop.items.filter(x => x.band === i) })).filter(g => g.items.length);
    const mine = sellable(shop, c);
    app.innerHTML = `<div class="card"><div class="row"><button class="sm" id="out">← ${esc(view.town)}</button></div>
      <h2>${esc(shop.name)}</h2><p class="mu">${esc(shop.type)} · ${esc(shop.keeper?.name || '')}${shop.keeper?.race ? `, ${esc([shop.keeper.gender, shop.keeper.race].filter(Boolean).join(' '))}` : ''}</p>${haggleLine(shop, c)}${who}
      <div class="row"><button id="tbuy" aria-pressed="${tab === 'buy'}">Buy</button><button id="tsell" aria-pressed="${tab === 'sell'}">Sell</button></div></div>
      ${shop.status === 'closed' ? '<div class="warn">This shop is closed.</div>' : tab === 'buy' ? `<div class="card"><table class="stock"><thead><tr><th>Item</th><th class="num">In stock</th><th class="num">Price</th><th></th></tr></thead><tbody>
        ${bands.map(g => `<tr class="band"><td colspan="4">${g.b} Quality</td></tr>${g.items.map(it => `<tr><td>${esc(it.n)}${it.magic ? ' <span class="tag ac">magic</span>' : ''}${it.base ? `<br><label class="small mu">Made from <select class="sm" data-base="${it.id}">${it.base.map((b, k) => `<option value="${k}">${esc(b.n)}: ${R.money(priceOf(b, shop, c))}</option>`).join('')}</select></label>` : ''}${it.d ? `<br><small class="mu">${esc(it.d)}</small>` : ''}</td><td class="num">${it.q == null ? '∞' : it.q}</td><td class="num">${it.don ? '<span class="mu">By donation</span>' : `${it.base ? 'from ' : ''}${R.money(priceOf(it, shop, c))}`}</td><td>${it.don ? `<button class="sm pri" data-don="${it.id}" ${busy || !c ? 'disabled' : ''}>Donate</button>` : `<button class="sm pri" data-buy="${it.id}" ${busy || !c ? 'disabled' : ''}>Buy</button>`}</td></tr>`).join('')}`).join('') || '<tr><td class="mu">Nothing on the shelf right now.</td></tr>'}
      </tbody></table></div>` : `<div class="card"><p class="mu small">${shop.buysAll ? `${esc(shop.name)} buys almost anything. For things it doesn't stock, ask for an offer.` : `${esc(shop.name)} only buys the kinds of things it sells.`}</p>
        ${mine.length ? `<table class="stock"><thead><tr><th>Your item</th><th class="num">You have</th><th class="num">They pay</th><th></th></tr></thead><tbody>${mine.map(x => `<tr><td>${esc(x.row.name)}</td><td class="num">${n(x.row.qty) || 1}</td>
          <td class="num">${x.p != null ? R.money(x.p) : x.offer?.no ? '<span class="tag bad">Won\'t buy</span>' : x.waiting ? '<span class="tag">Waiting for an offer</span>' : '<span class="mu">—</span>'}</td>
          <td>${x.p != null ? `<button class="sm pri" data-sell="${esc(x.key)}" ${busy ? 'disabled' : ''}>Sell one</button>${x.offer ? ` <button class="sm" data-no="${esc(x.key)}" ${busy ? 'disabled' : ''}>No thanks</button>` : ''}` : x.offer?.no || x.waiting ? '' : `<button class="sm" data-ask="${esc(x.key)}" ${busy ? 'disabled' : ''}>Ask for an offer</button>`}</td></tr>`).join('')}</tbody></table>` : `<p>${shop.buysAll ? 'Your inventory is empty.' : 'Nothing in your inventory that this shop buys.'}</p>`}</div>`}`;
    $('#out').onclick = () => { open = null; draw(); };
    $('#tbuy').onclick = () => { tab = 'buy'; draw(); };
    $('#tsell').onclick = () => { tab = 'sell'; draw(); };
    app.querySelectorAll('[data-buy]').forEach(b => { b.onclick = () => buy(shop, shop.items.find(x => x.id === b.dataset.buy)); });
    app.querySelectorAll('[data-sell]').forEach(b => { b.onclick = () => sell(shop, mine.find(x => x.key === b.dataset.sell)); });
    app.querySelectorAll('[data-don]').forEach(b => { b.onclick = () => donate(shop, shop.items.find(x => x.id === b.dataset.don)); });
    app.querySelectorAll('[data-ask]').forEach(b => { b.onclick = () => askOffer(shop, mine.find(x => x.key === b.dataset.ask)); });
    app.querySelectorAll('[data-no]').forEach(b => { b.onclick = async () => { const x = mine.find(y => y.key === b.dataset.no); const r = await ask({ kind: 'decline', shopId: shop.id, offerId: x.offer.id, name: x.name }); if (r.error) toast(r.error); draw(); }; });
  }
  const w = $('#who'); if (w) w.onchange = () => { charId = w.value; try { localStorage.setItem('dmp-shops-char', charId); } catch { /* */ } draw(); };
}

// Inventory rows this shop will buy (by name, the way the shop lists them). The General Store buys anything: rows it
// has no price for get an offer from it (from the DM's lists, or the DM names one).
function sellable(shop, c) {
  if (!c) return [];
  const buys = new Map((shop.buys || []).map(b => [b.n.toLowerCase(), b]));
  const offers = (shop.offers || []).filter(o => !o.who || o.who === (c.name || ''));
  const out = [];
  for (const [cat, rows] of Object.entries(c.inv || {})) (rows || []).forEach((row, i) => {
    const nm = String(row.name || '').trim(); if (!nm) return;
    if (!(row.qty === '' || row.qty == null || n(row.qty) > 0)) return;
    const b = buys.get(nm.toLowerCase());
    if (b) { out.push({ key: `${cat}.${i}`, cat, i, row, p: priceOf(b, shop, c), name: b.n }); return; }
    if (!shop.buysAll) return;
    const o = offers.find(x => x.n.toLowerCase() === nm.toLowerCase());
    out.push({ key: `${cat}.${i}`, cat, i, row, name: nm, p: o && !o.no ? o.p : null, offer: o || null, waiting: !o && asked.has(askKey(c, nm)) });
  });
  return out;
}
// what this device asked the General Store to price (so it shows "waiting" until the DM answers)
const askKey = (c, nm) => `${c?.id}|${nm.toLowerCase()}`;
const asked = new Set((() => { try { return JSON.parse(localStorage.getItem('dmp-shops-asked') || '[]'); } catch { return []; } })());
const keepAsked = () => { try { localStorage.setItem('dmp-shops-asked', JSON.stringify([...asked].slice(-100))); } catch { /* */ } };

async function ask(req) {
  busy = true; draw();
  try {
    let pass = core.signedIn(''); if (!pass && core.refreshNow) pass = await core.refreshNow();
    return await T.shopRequest(pass?.value || null, core.currentTable().id, req);
  } finally { busy = false; }
}
async function buy(shop, it0) {
  const c = me(); if (!c || !it0) return;
  // priced on top of a base (Armor of Gleaming): the armor picked in the row, under its full name
  let it = it0, base = '';
  if (it0.base) {
    const b = it0.base[Number(document.querySelector(`[data-base="${it0.id}"]`)?.value) || 0]; if (!b) return;
    base = b.n; it = { ...it0, n: `${it0.n} (${b.n})`, p: b.p, hp: b.hp };
  }
  if (R.purseCp(purseOfChar(c)) < priceOf(it, shop, c)) { toast("You don't have enough coin for that."); return; }
  const r = await ask({ kind: 'buy', shopId: shop.id, itemId: it.id, n: 1, purse: purseOfChar(c), who: c.name || '', charId: c.id, ...(base ? { base } : {}) });
  if (r.error) { toast(r.error); draw(); return; }
  await changeSheet(c.id, x => {
    x.coins = { ...(x.coins || {}), ...R.addCoins(R.addCoins(purseOfChar(x), r.give, -1), r.change) };
    const cat = catFor(shop.type, it);
    const list = (x.inv[cat] = x.inv[cat] || []);
    const row = list.find(y => String(y.name).toLowerCase() === it.n.toLowerCase());
    if (row) row.qty = n(row.qty || 1) + 1;
    // a magic item: a placeholder until the Magic Items app gives the real card (then this row goes away)
    else list.push({ id: P.model.uid(), name: it.n, wt: '', qty: 1, ...(it.magic ? { magic: true, fromShop: true } : {}), desc: it.magic ? 'Bought in a shop. Its card arrives from your DM\'s Magic Items app.' : (it.d || '') });
    return ['coins', `inv.${cat}`];
  });
  toast(`Bought ${it.n} for ${R.money(r.cp)}.${R.purseCp(r.change) ? ` Change: ${R.purseText(r.change)}.` : ''}${it.magic ? ' Its card arrives on your sheet once your DM opens the Magic Items app.' : ''}`);
}
// By donation: the player gives what they choose, from the coins on their sheet
async function donate(shop, it) {
  const c = me(); if (!c || !it) return;
  const v = prompt(`How much will you give for ${it.n}? (in gp; 0.5 is 5 sp)`, '1');
  if (v == null) return;
  const cp = Math.round((Number(String(v).replace(',', '.')) || 0) * 100);
  if (cp < 1) { toast('Give at least 1 cp.'); return; }
  if (R.purseCp(purseOfChar(c)) < cp) { toast("You don't have that much coin."); return; }
  const r = await ask({ kind: 'donate', shopId: shop.id, itemId: it.id, cp, purse: purseOfChar(c), who: c.name || '' });
  if (r.error) { toast(r.error); draw(); return; }
  await changeSheet(c.id, x => { x.coins = { ...(x.coins || {}), ...R.addCoins(R.addCoins(purseOfChar(x), r.give, -1), r.change) }; return ['coins']; });
  toast(`You gave ${R.money(r.cp)} for ${it.n}.${R.purseCp(r.change) ? ` Change: ${R.purseText(r.change)}.` : ''} Your DM sees it.`);
}
// The General Store: what would it pay for this? An offer at once (from the DM's lists), or the DM names one later
async function askOffer(shop, x) {
  const c = me(); if (!c || !x) return;
  const r = await ask({ kind: 'quote', shopId: shop.id, name: x.name, n: 1, who: c.name || '' });
  if (r.error) { toast(r.error); draw(); return; }
  if (r.refused) { toast(`${shop.name} won't buy that.`); draw(); return; }
  if (r.pending) { asked.add(askKey(c, x.name)); keepAsked(); toast(`${shop.name} will think it over. Your DM names a price; check back here.`); draw(); return; }
  if (r.quote && confirm(`${shop.name} offers ${R.money(r.quote)} for one ${x.name}. Sell it?`)) return sell(shop, { ...x, offer: r.offerId ? { id: r.offerId } : null });
  draw();
}
async function sell(shop, x) {
  const c = me(); if (!c || !x) return;
  const r = await ask({ kind: 'sell', shopId: shop.id, name: x.name, n: 1, who: c.name || '', ...(x.offer?.id ? { offerId: x.offer.id } : {}) });
  if (r.error) { toast(r.error); draw(); return; }
  await changeSheet(c.id, ch => {
    ch.coins = { ...(ch.coins || {}), ...R.addCoins(purseOfChar(ch), r.paid) };
    const list = ch.inv[x.cat] || [], row = list.find(y => y.id === x.row.id) || list[x.i];
    if (row) { const left = n(row.qty || 1) - 1; if (left > 0) row.qty = left; else list.splice(list.indexOf(row), 1); }
    return ['coins', `inv.${x.cat}`];
  });
  asked.delete(askKey(c, x.name)); keepAsked();
  toast(`Sold ${x.name} for ${R.purseText(r.paid)}.`);
}
// Which inventory section a bought item goes in: the DM's own choice for the item, else a guess from the shop and the name
const catFor = (type, it) => {
  if (it.inv) return it.inv;
  if (it.magic) return 'general';
  const n = it.n || '';
  if (/component|spellcasting focus|arcane focus|druidic focus|holy symbol|reliquary|emblem|amulet of/i.test(n)) return 'components';
  if (/armor|mail|plate|shield|breastplate|leather|hide|padded|brigandine/i.test(n) && type !== 'Fashion') return 'armor';
  if (type === 'Fashion' || /cloak|robe|boots|gloves|hat|clothes|outfit|gown|vestments|coat|cape/i.test(n)) return 'armor';
  if (type === 'Blacksmith' || type === 'Fletcher' || /sword|axe|bow|dagger|mace|spear|arrow|bolt|crossbow|hammer|club|staff|whip|javelin|trident|lance|pike|halberd|scimitar|rapier|sling/i.test(n)) return 'weapons';
  if (type === 'Jewelry' || /gem|ring|necklace|earring|bracelet|pearl|jewel|figurine|idol|statuette/i.test(n)) return 'treasure';
  if (type === 'Instruments' || /tools|kit|supplies|instrument/i.test(n)) return 'tools';
  return 'general';
};

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
