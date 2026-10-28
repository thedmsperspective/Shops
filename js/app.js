// The DM's Perspective — Shops. The DM's side: towns, their shops, stock and gold, shopkeepers, and each new month.
// Everything is kept on this device and in a private file in the DM's Google Drive (like the other apps).
import * as R from './rules.js';
import * as N from './names.js';
import { SRD_SHOPS } from './srd-shops.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- the suite core (sign-in, table, edition) ---------- */
let core = null;
const coreReady = import('/core/suite.js').then(m => { core = m; }).catch(() => {});
const edition = () => (core?.tableSettings?.().edition === '2024' ? '2024' : '2014');
const isPlayer = () => core?.tableRole?.() === 'player';

/* ---------- storage: this device (IndexedDB) ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('dmp-shops', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = k => idb().then(db => new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); })).catch(() => null);
const idbPut = (k, v) => idb().then(db => new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); })).catch(() => false);

let S = { locations: [], stamp: 0, settings: { races: '', useMine: true } };
let LIB = null; // the DM's own shop lists (private, from their Drive): { shops: { type: { gold, items } } }
const ui = { view: 'home', loc: null, shop: null };

async function save() {
  S.stamp = Date.now();
  await idbPut('state', S);
  syncSoon();
}

/* ---------- item lists: the DM's own, or the SRD's for the table's edition ---------- */
const usingMine = () => !!(LIB && S.settings.useMine !== false);
function listFor(type) {
  if (usingMine() && LIB.shops?.[type]) return LIB.shops[type].items;
  return SRD_SHOPS[edition()]?.[type] || [];
}
const goldTable = type => (usingMine() && LIB.shops?.[type]?.gold) || null;

/* ---------- Google Drive: a private file for the shops, and one for the DM's own lists ---------- */
const FILE = 'dmp-shops.json', LIB_FILE = 'dmp-shops-library.json';
let tok = null, syncT = null, syncing = false, syncMsg = '';
const pill = m => { syncMsg = m; const e = $('#syncpill'); if (e) e.textContent = m; };
async function getToken(interactive) {
  await coreReady; if (!core) throw new Error("Couldn't load the suite's sign-in.");
  const scope = core.SCOPES.appdata;
  let t = core.signedIn(scope, { app: 'shops' });
  if (!t && core.staysSignedIn?.()) t = await core.refreshNow();
  if ((!t || !(t.exp > Date.now() + 60000)) && interactive) t = await core.signInLong(scope, { app: 'shops' });
  if (!t?.value) throw new Error('Sign in with Google (top right) to keep your shops in your Drive.');
  tok = t.value; return tok;
}
function syncSoon() { clearTimeout(syncT); syncT = setTimeout(() => sync(false), 2500); }
async function sync(interactive) {
  if (syncing) return; syncing = true;
  try {
    pill('syncing…');
    const t = await getToken(interactive);
    const [rem, lib] = await Promise.all([core.readAppdata(t, FILE), core.readAppdata(t, LIB_FILE).catch(() => null)]);
    if (lib?.app === 'dmp-shops-library' && lib.shops) { LIB = lib; await idbPut('library', lib); }
    if (rem?.app === 'dmp-shops' && (rem.state?.stamp || 0) > (S.stamp || 0)) { S = normalize(rem.state); await idbPut('state', S); render(); }
    else if (!rem || (S.stamp || 0) > (rem.state?.stamp || 0)) await core.writeAppdata(t, FILE, { app: 'dmp-shops', v: 1, state: S });
    pill(`✓ saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  } catch (e) { pill(interactive ? `⚠ ${e.message}` : '● not synced'); if (interactive) toast(e.message); }
  finally { syncing = false; }
}
const normalize = s => ({ locations: [], settings: { races: '', useMine: true }, ...s, settings: { races: '', useMine: true, ...(s?.settings || {}) } });

/* ---------- little screen helpers ---------- */
function modal(html, mount) { const m = $('#modal'); m.innerHTML = `<div class="box">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; mount?.(m); }
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
let toastT; function toast(t) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#eadfcb;color:#1b1714;padding:10px 16px;border-radius:10px;z-index:30;max-width:90vw'; document.body.append(el); } el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3500); }
const loc = () => S.locations.find(l => l.id === ui.loc);
const shopOf = () => loc()?.shops.find(s => s.id === ui.shop);
const go = (view, a = {}) => { Object.assign(ui, { view }, a); render(); window.scrollTo(0, 0); };
const shopTitle = s => s.name || s.type;
const qLabel = q => `Quality ${q}`;

/* ---------- making towns and shops ---------- */
function makeShop(type, l, q = null) {
  const s = R.newShop(type, listFor(type), { q, maxQ: R.sizeOf(l.size).maxQ || 5, goldTable: goldTable(type) });
  s.keeper = N.keeperFor(edition(), extraRaces());
  s.name = N.shopNameFor(type, s.keeper.name);
  return s;
}
const extraRaces = () => String(S.settings.races || '').split(',').map(x => x.trim()).filter(Boolean);
function rollTown(l) {
  const r = R.rollShops(l.size);
  l.shops = r.shops.map(t => makeShop(t, l));
  l.services = Object.fromEntries(R.SERVICES.map(t => [t, r.services.includes(t) ? 'open' : '']));
}

/* ---------- screens ---------- */
function render() {
  const app = $('#app');
  $('#back').hidden = ui.view === 'home';
  $('#crumb').textContent = ui.view === 'shop' ? `${loc()?.name || ''}` : '';
  if (isPlayer()) { app.innerHTML = '<div class="card"><h2>Shops</h2><p>The player side is coming next: browsing the shops where your party is, and buying and selling.</p></div>'; return; }
  if (ui.view === 'location' && loc()) return locationView(app);
  if (ui.view === 'shop' && shopOf()) return shopView(app);
  if (ui.view === 'settings') return settingsView(app);
  ui.view = 'home'; homeView(app);
}

function homeView(app) {
  const ls = S.locations;
  app.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">Towns</h2><button class="pri" id="newLoc">+ New town</button></div>
    <p class="mu small">Each town keeps its own shops. Lists: ${usingMine() ? 'your own shop lists' : `the SRD's (${edition()} rules)`}.</p>
    <div class="grid">${ls.map(l => `<button class="tile" data-loc="${l.id}"><b>${esc(l.name)}</b><span class="mu">${esc(l.size)} · ${l.shops.filter(s => s.status !== 'closed').length} shops</span><br>${l.open ? '<span class="tag ok">Open to players</span>' : '<span class="tag">Closed to players</span>'}${l.partyHere ? '<span class="tag ac">Party is here</span>' : ''}</button>`).join('') || '<p class="mu">No towns yet.</p>'}</div></div>
  ${ls.length ? `<div class="card"><h3>A new month</h3><p class="mu small">Every shop in every town rolls its month: new quality and stock, what it sold and bought, and its stall or building countdown. You'll see a summary, and you can undo it.</p>
    <div class="row"><button class="pri" id="month">Start a new month</button>${S.undo ? `<button id="undo">Undo the last new month</button>` : ''}</div></div>` : ''}`;
  app.querySelectorAll('[data-loc]').forEach(b => { b.onclick = () => go('location', { loc: b.dataset.loc }); });
  $('#newLoc').onclick = newTownDialog;
  const m = $('#month'); if (m) m.onclick = () => newMonth();
  const u = $('#undo'); if (u) u.onclick = undoMonth;
}

function newTownDialog() {
  modal(`<h2>New town</h2><label>Name</label><input id="ln" placeholder="Bryn Shander">
    <label>Size</label><select id="ls">${R.SIZES.map(s => `<option ${s.key === 'Town' ? 'selected' : ''} value="${s.key}">${s.key} (${s.pop})</option>`).join('')}</select>
    <p class="mu small">Roll the town picks its shops like your generator: a d100 for each by the town's size, up to its limit. Or start empty and add shops yourself.</p>
    <div class="row"><button class="pri" id="lr">Roll the town</button><button id="le">Start empty</button><button id="lx">Cancel</button></div>`, m => {
    const mk = roll => {
      const name = $('#ln', m).value.trim(); if (!name) return toast('Give the town a name.');
      const l = { id: uid(), name, size: $('#ls', m).value, open: false, partyHere: false, shops: [], services: { Enchanter: '', 'Magic Item Dealer': '' } };
      if (roll) rollTown(l);
      S.locations.push(l); save(); closeModal(); go('location', { loc: l.id });
    };
    $('#lr', m).onclick = () => mk(true); $('#le', m).onclick = () => mk(false); $('#lx', m).onclick = closeModal;
  });
}

function locationView(app) {
  const l = loc(), sz = R.sizeOf(l.size);
  const svc = R.SERVICES.map(t => {
    const v = l.services?.[t] || '';
    return `<div class="row"><b class="grow">${t}</b><select data-svc="${t}" style="width:auto"><option value="" ${!v ? 'selected' : ''}>Not in this town</option><option value="open" ${v === 'open' ? 'selected' : ''}>Here, open</option><option value="closed" ${v === 'closed' ? 'selected' : ''}>Here, closed</option></select></div>`;
  }).join('');
  app.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">${esc(l.name)}</h2><button class="sm" id="ren">Rename</button></div>
    <div class="row"><span class="tag">${esc(l.size)}</span><span class="tag">best quality ${sz.maxQ || '—'}</span><span class="tag">up to ${sz.maxShops} shops</span></div>
    <div class="row" style="margin-top:8px"><button id="open" aria-pressed="${!!l.open}">${l.open ? 'Open to players' : 'Closed to players'}</button><button id="here" aria-pressed="${!!l.partyHere}">${l.partyHere ? 'The party is here' : 'The party is elsewhere'}</button></div>
    <p class="mu small">Players see this town's shops while the party is here and it's open to them.</p></div>
  <div class="card"><div class="row"><h3 class="grow" style="margin:0">Shops</h3><button id="addShop">+ Add a shop</button><button id="reroll">Roll the town again</button></div>
    <div class="grid" style="margin-top:8px">${l.shops.map(s => `<button class="tile ${s.status === 'closed' ? 'closed' : ''}" data-shop="${s.id}"><b>${esc(shopTitle(s))}</b><span class="mu">${esc(s.type)} · ${qLabel(s.quality)} · ${s.form === 'building' ? 'Building' : 'Stall'}</span><br>
      ${s.status === 'closed' ? '<span class="tag bad">Closed</span>' : ''}${s.haggleWon ? '<span class="tag ok">Haggled</span>' : ''}${countdown(s)}<span class="tag ${s.gold < 0 ? 'bad' : ''}">${s.gold < 0 ? 'In debt ' : ''}${R.money(s.gold, { short: true })}</span></button>`).join('') || '<p class="mu">No shops yet.</p>'}</div></div>
  <div class="card"><h3>At the table</h3><p class="mu small">Players only see whether these are here and open.</p>${svc}</div>
  <div class="card"><button class="bad" id="delLoc">Delete this town</button></div>`;
  app.querySelectorAll('[data-shop]').forEach(b => { b.onclick = () => go('shop', { shop: b.dataset.shop }); });
  app.querySelectorAll('[data-svc]').forEach(s => { s.onchange = () => { l.services = { ...(l.services || {}), [s.dataset.svc]: s.value }; save(); }; });
  $('#open').onclick = () => { l.open = !l.open; save(); render(); };
  $('#here').onclick = () => { const v = !l.partyHere; S.locations.forEach(x => { x.partyHere = false; }); l.partyHere = v; save(); render(); };
  $('#ren').onclick = () => { const n = prompt('Town name', l.name); if (n?.trim()) { l.name = n.trim(); save(); render(); } };
  $('#reroll').onclick = () => { if (l.shops.length && !confirm(`Roll ${l.name} again? Its shops are replaced with new ones.`)) return; rollTown(l); save(); render(); };
  $('#addShop').onclick = () => addShopDialog(l);
  $('#delLoc').onclick = () => { if (!confirm(`Delete ${l.name} and all its shops?`)) return; S.locations = S.locations.filter(x => x.id !== l.id); save(); go('home'); };
}
const countdown = s => (s.status === 'closed' ? '' : s.form === 'stall' && s.lowRun ? `<span class="tag bad">Closing ${s.lowRun}/3</span>` : s.form === 'stall' && s.highRun ? `<span class="tag ok">Upgrading ${s.highRun}/3</span>` : s.form === 'building' && s.lowRun ? `<span class="tag bad">To a stall ${s.lowRun}/3</span>` : '');

function addShopDialog(l) {
  const have = new Set(l.shops.map(s => s.type));
  modal(`<h2>Add a shop to ${esc(l.name)}</h2><label>Kind of shop</label><select id="st">${R.SHOPS.map(t => `<option ${have.has(t) ? 'disabled' : ''}>${t}</option>`).join('')}</select>
    <label>Quality</label><select id="sq"><option value="">Roll it (d20)</option>${[1, 2, 3, 4, 5].map(q => `<option value="${q}">Quality ${q}</option>`).join('')}</select>
    <div class="row" style="margin-top:12px"><button class="pri" id="sa">Add</button><button id="sx">Cancel</button></div>`, m => {
    $('#sx', m).onclick = closeModal;
    $('#sa', m).onclick = () => { const s = makeShop($('#st', m).value, l, Number($('#sq', m).value) || null); l.shops.push(s); save(); closeModal(); go('shop', { shop: s.id }); };
  });
}

function shopView(app) {
  const l = loc(), s = shopOf(), k = s.keeper || {};
  const bands = R.BANDS.map((b, i) => ({ b, items: s.items.filter(x => x.band === i) })).filter(g => g.items.length);
  const other = s.items.filter(x => !(x.band >= 0 && x.band <= 4));
  if (other.length) bands.push({ b: 'Other', items: other });
  const row = it => {
    const sell = R.sellPrice(s, it), buy = R.buyPrice(s, it), none = it.qty === 0;
    return `<tr class="${none ? 'none' : ''}"><td>${esc(it.name)}${it.magic ? ' <span class="tag ac">magic</span>' : ''}${it.unique ? ' <span class="tag">only one ever</span>' : ''}${!it.value ? ' <span class="tag bad">no price</span>' : ''}</td>
      <td class="num">${it.qty == null ? '∞' : `<input class="n" data-qty="${it.id}" value="${it.qty}" inputmode="numeric" aria-label="How many">`}</td>
      <td class="num">${it.value ? R.money(sell) : `<input class="n" data-val="${it.id}" placeholder="gp" inputmode="decimal" aria-label="Price in gp">`}</td><td class="num hide-s mu">${it.value ? R.money(buy) : ''}</td><td><button class="sm" data-rm="${it.id}" aria-label="Remove">✕</button></td></tr>`;
  };
  app.innerHTML = `
  <div class="card"><div class="row"><h2 class="grow">${esc(shopTitle(s))}</h2><button class="sm" id="rollShopName">🎲 Name</button><button class="sm" id="rename">Edit name</button></div>
    <div class="row"><span class="tag">${esc(s.type)}</span><span class="tag">${qLabel(s.quality)}</span><span class="tag">${s.form === 'building' ? 'Brick and mortar' : 'Stall'}</span>${s.status === 'closed' ? '<span class="tag bad">Closed</span>' : ''}${countdown(s)}</div>
    <h3>Shopkeeper</h3>
    <div class="keeper">${[['name', 'Proprietor'], ['gender', 'Gender'], ['race', 'Race'], ['age', 'Age'], ['desc', 'Descriptors']].map(([f, n]) => `<span>${n}</span><input data-k="${f}" value="${esc(k[f] ?? '')}"><button class="sm" data-roll="${f}" aria-label="Roll ${n}">🎲</button>`).join('')}</div>
    <p class="mu small">Players see the shop's name and the proprietor's name, race and gender. Age and descriptors are yours.</p></div>
  <div class="card"><h3 style="margin-top:0">This month</h3>
    <div class="stats">
      <div class="stat"><small>${s.gold < 0 ? 'In debt' : 'Gold on hand'}</small><b style="${s.gold < 0 ? 'color:#f1b0a5' : ''}">${R.money(s.gold)}</b></div>
      <div class="stat"><small>Prices</small><b>${Math.round((s.priceMod || 1) * 100)}%</b></div>
      <div class="stat"><small>Haggling</small><b>${s.haggle?.dc ? `DC ${s.haggle.dc}, ${s.haggle.off}% off` : "Won't haggle"}</b></div>
      <div class="stat"><small>Started at</small><b>${qLabel(s.startQuality || s.quality)}</b></div></div>
    <div class="row">${s.haggle?.dc ? `<button id="haggle" aria-pressed="${!!s.haggleWon}">${s.haggleWon ? '✓ Haggle succeeded (whole party, this month)' : 'Haggle succeeded'}</button>` : ''}<button id="gold">Change gold</button>
      <button id="status">${s.status === 'closed' ? 'Reopen the shop' : 'Close the shop'}</button></div></div>
  <div class="card"><div class="row"><h3 class="grow" style="margin:0">On the shelf</h3><button id="addItem">+ Add an item</button><button id="restockNow">Roll this shop's stock again</button></div>
    <p class="mu small">Price is what the shop charges (with its ${Math.round((s.priceMod || 1) * 100)}%); it buys at half value. Faded items aren't on the shelf this month.</p>
    <table class="stock"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num hide-s">Buys at</th><th></th></tr></thead>
    <tbody>${bands.map(g => `<tr class="band"><td colspan="5">${g.b === 'Other' ? 'Other' : `${g.b} Quality`}</td></tr>${g.items.map(row).join('')}`).join('')}</tbody></table></div>
  ${(s.log || []).length ? `<div class="card"><h3 style="margin-top:0">Past months</h3><ul class="log">${s.log.slice(-6).reverse().map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><button class="bad" id="delShop">Remove this shop from ${esc(l.name)}</button></div>`;
  const k2 = s.keeper || (s.keeper = {});
  app.querySelectorAll('[data-k]').forEach(i => { i.onchange = () => { k2[i.dataset.k] = i.dataset.k === 'age' ? Number(i.value) || i.value : i.value; save(); }; });
  // each 🎲 rolls just that one thing again
  app.querySelectorAll('.keeper [data-roll]').forEach(b => {
    b.onclick = () => {
      const f = b.dataset.roll;
      if (f === 'name') k2.name = N.nameFor(k2.race);
      else if (f === 'race') k2.race = N.keeperFor(edition(), extraRaces()).race;
      else if (f === 'age') k2.age = N.ageFor(k2.race);
      else if (f === 'gender') k2.gender = N.GENDERS[R.d(N.GENDERS.length) - 1];
      else if (f === 'desc') k2.desc = N.descriptorsFor();
      save(); render();
    };
  });
  $('#rollShopName').onclick = () => { s.name = N.shopNameFor(s.type, k2.name); save(); render(); };
  $('#rename').onclick = () => { const n = prompt('Shop name', s.name || ''); if (n != null) { s.name = n.trim(); save(); render(); } };
  const h = $('#haggle'); if (h) h.onclick = () => { s.haggleWon = !s.haggleWon; save(); render(); };
  $('#gold').onclick = () => { const v = prompt('Gold on hand (gp)', (s.gold / 100).toString()); if (v != null && !Number.isNaN(Number(v))) { s.gold = Math.round(Number(v) * 100); save(); render(); } };
  $('#status').onclick = () => { s.status = s.status === 'closed' ? 'open' : 'closed'; s.lowRun = 0; s.highRun = 0; save(); render(); };
  $('#restockNow').onclick = () => { if (!confirm('Roll this shop\'s stock again at its current quality? (Gold doesn\'t change.)')) return; s.items = R.stockFor(s.items, s.quality, s.items); save(); render(); };
  $('#addItem').onclick = () => addItemDialog(s);
  $('#delShop').onclick = () => { if (!confirm(`Remove ${shopTitle(s)}?`)) return; l.shops = l.shops.filter(x => x.id !== s.id); save(); go('location'); };
  app.querySelectorAll('[data-qty]').forEach(i => { i.onchange = () => { const it = s.items.find(x => x.id === i.dataset.qty); it.qty = Math.max(0, parseInt(i.value, 10) || 0); save(); render(); }; });
  app.querySelectorAll('[data-val]').forEach(i => { i.onchange = () => { const it = s.items.find(x => x.id === i.dataset.val); it.value = Number(i.value) || 0; it.coin = 'gp'; save(); render(); }; });
  app.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => { if (!confirm('Take this item off the shop\'s list for good?')) return; s.items = s.items.filter(x => x.id !== b.dataset.rm); save(); render(); }; });
}

function addItemDialog(s) {
  const pool = listFor(s.type).filter(x => !s.items.some(y => y.name === x.name));
  modal(`<h2>Add an item to ${esc(shopTitle(s))}</h2>
    ${pool.length ? `<label>From the ${esc(s.type)} list</label><select id="ip"><option value="">Choose…</option>${pool.map((x, i) => `<option value="${i}">${esc(x.name)} (${R.BANDS[x.band] || ''})</option>`).join('')}</select>` : ''}
    <h3>Or your own</h3><label>Name</label><input id="in"><div class="row"><div class="grow"><label>Price (gp)</label><input id="iv" inputmode="decimal"></div><div class="grow"><label>Quality band</label><select id="ib">${R.BANDS.map((b, i) => `<option value="${i}">${b}</option>`).join('')}</select></div><div class="grow"><label>How many now</label><input id="iq" inputmode="numeric" value="1"></div></div>
    <label><input type="checkbox" id="im" style="width:auto"> Magic item</label>
    <div class="row" style="margin-top:12px"><button class="pri" id="ia">Add</button><button id="ix">Cancel</button></div>`, m => {
    $('#ix', m).onclick = closeModal;
    $('#ia', m).onclick = () => {
      const p = $('#ip', m)?.value;
      let it;
      if (p) { const x = pool[Number(p)]; it = { ...x, rule: R.ruleOf(x), id: uid(), qty: R.rollQty(x, s.quality) }; }
      else {
        const name = $('#in', m).value.trim(); if (!name) return toast('Pick an item or type a name.');
        const b = Number($('#ib', m).value);
        // the same rule the generator uses for that band, so it restocks like the rest
        const BAND_D = [[[1, 3], [1, 3], [1, 4], [2, 5], [2, 5]], [0, [1, 3], [1, 4], [2, 5], [2, 5]], [0, 0, [1, 4], [2, 5], [2, 5]], [0, 0, 0, [2, 5], [2, 5]], [0, 0, 0, 0, [2, 5]]];
        it = { id: uid(), name, magic: $('#im', m).checked, band: b, qty: Math.max(0, parseInt($('#iq', m).value, 10) || 0), value: Number($('#iv', m).value) || 0, coin: 'gp', unit: 'each', src: '', desc: '',
          rule: { d: BAND_D[b], m: $('#im', m).checked ? [1, 1, 1, 1, 1] : [3, 5, 8, 10, 15] } };
      }
      s.items.push(it); save(); closeModal(); render();
    };
  });
}

/* ---------- a new month for every town ---------- */
function newMonth() {
  if (!confirm('Start a new month in every town? Each shop rolls its quality and stock.')) return;
  S.undo = JSON.parse(JSON.stringify(S.locations));
  const report = [];
  for (const l of S.locations) {
    const sz = R.sizeOf(l.size);
    for (let i = 0; i < l.shops.length; i++) {
      const s = l.shops[i];
      const r = R.monthFor(s, s.items, { maxQ: sz.maxQ || 5 });
      const ns = r.shop;
      const line = `Quality ${r.quality}: sold ${r.sold.reduce((t, x) => t + x.n, 0)} items for ${R.money(r.made)}, bought ${r.bought.reduce((t, x) => t + x.n, 0)} for ${R.money(r.spent)}${r.change ? ` · ${r.change === 'closed' ? 'CLOSED' : r.change === 'upgraded' ? 'became a building' : 'dropped to a stall'}` : ''}`;
      ns.log = [...(s.log || []), line].slice(-24);
      l.shops[i] = ns;
      if (s.status !== 'closed') report.push({ town: l.name, shop: shopTitle(ns), line, change: r.change });
    }
  }
  save();
  modal(`<h2>A new month</h2>${report.length ? `<ul class="log">${report.map(x => `<li><b>${esc(x.town)}, ${esc(x.shop)}</b>: ${esc(x.line)}</li>`).join('')}</ul>` : '<p class="mu">No open shops.</p>'}
    <div class="row" style="margin-top:12px"><button class="pri" id="ok">Done</button><button id="un">Undo it</button></div>`, m => {
    $('#ok', m).onclick = () => { closeModal(); render(); };
    $('#un', m).onclick = () => { undoMonth(); closeModal(); };
  });
}
function undoMonth() {
  if (!S.undo) return;
  S.locations = S.undo; S.undo = null; save(); render(); toast('The new month was undone.');
}

/* ---------- settings ---------- */
function settingsView(app) {
  app.innerHTML = `
  <div class="card"><h2>Settings</h2>
    <h3>Item lists</h3>
    <p class="mu small">${LIB ? `Your own shop lists are here (${Object.values(LIB.shops || {}).reduce((t, x) => t + (x.items?.length || 0), 0)} items), kept privately in your Google Drive.` : `Using the SRD's lists for the ${edition()} rules. Import your own lists to use those instead.`}</p>
    ${LIB ? `<label><input type="checkbox" id="mine" ${S.settings.useMine !== false ? 'checked' : ''} style="width:auto"> Use my own lists for new shops</label>` : ''}
    <div class="row"><label class="sm" style="margin:0">Import a shop list file: <input type="file" id="libFile" accept=".json" style="width:auto"></label></div>
    <h3>Shopkeepers</h3><label>Extra races or peoples (comma between them)</label><input id="races" value="${esc(S.settings.races)}" placeholder="Goliath, Firbolg">
    <h3>Google Drive</h3><div class="row"><button id="syncNow" class="pri">Sync now</button><span class="mu">${esc(syncMsg)}</span></div>
    <h3>Backup</h3><div class="row"><button id="exp">Save a backup file</button><label class="sm" style="margin:0">Load a backup: <input type="file" id="imp" accept=".json" style="width:auto"></label></div></div>`;
  const mine = $('#mine'); if (mine) mine.onchange = () => { S.settings.useMine = mine.checked; save(); };
  $('#races').onchange = e => { S.settings.races = e.target.value; save(); };
  $('#syncNow').onclick = () => sync(true).then(render);
  $('#libFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (o?.app !== 'dmp-shops-library' || !o.shops) throw new Error("That isn't a shop list file.");
      LIB = o; await idbPut('library', o);
      try { const t = await getToken(true); await core.writeAppdata(t, LIB_FILE, o); toast('Your shop lists are saved in your Drive.'); } catch (err) { toast(`Saved on this device. ${err.message}`); }
      render();
    } catch (err) { toast(err.message); }
  };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'dmp-shops', v: 1, state: S }, null, 1)], { type: 'application/json' })); a.download = `shops-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (o?.app !== 'dmp-shops') throw new Error("That isn't a Shops backup."); if (!confirm('Replace everything here with the backup?')) return; S = normalize(o.state); await save(); render(); } catch (err) { toast(err.message); } };
}

/* ---------- start ---------- */
$('#back').onclick = () => go(ui.view === 'shop' ? 'location' : 'home');
$('#settingsBtn').onclick = () => go('settings');
window.addEventListener('dmp-suite', () => render());
(async () => {
  const [st, lib] = await Promise.all([idbGet('state'), idbGet('library')]);
  if (st) S = normalize(st);
  if (lib) LIB = lib;
  await coreReady;
  render();
  if (core?.signedIn?.(core.SCOPES.appdata, { app: 'shops' }) || core?.staysSignedIn?.()) sync(false);
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
