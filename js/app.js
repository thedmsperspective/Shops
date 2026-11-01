// The DM's Perspective — Shops. The DM's side: towns, their shops, stock and gold, shopkeepers, and each new month.
// Everything is kept on this device and in a private file in the DM's Google Drive (like the other apps).
import * as R from './rules.js';
import * as N from './names.js';
import { SRD_SHOPS } from './srd-shops.js';
import { startPlayer } from './player.js';
import { favorFor } from './favors.js';

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
  syncSoon(); publishSoon();
}

/* ---------- the table: what players see, and their buying and selling (answered here, on the DM's device) ---------- */
const amDm = () => core?.tableRole?.() === 'dm' && core.currentTable?.()?.id;
let pubT = null, lastPub = '', stopReq = null;
function publishSoon() { clearTimeout(pubT); pubT = setTimeout(publish, 600); }
const tablePass = async () => { let p = core.signedIn(''); if (!p && core.refreshNow) p = await core.refreshNow(); return p?.value || null; };
function playerView() {
  const l = S.locations.find(x => x.partyHere && x.open);
  if (!l) return { closed: true, t: Date.now() };
  return {
    town: l.name, size: l.size, services: l.services || {}, t: Date.now(),
    shops: l.shops.map(s => ({
      id: s.id, name: shopTitle(s), type: s.type, status: s.status,
      haggle: { kind: R.haggleKind(s), skill: s.haggle?.skill || 'Persuasion', dc: s.haggle?.dc || 0, off: s.haggle?.off || 0, favor: s.haggle?.favor || '' },
      won: s.haggleWon === true ? ['*'] : (s.haggleBy || []),
      keeper: { name: s.keeper?.name || '', race: s.keeper?.race || '', gender: s.keeper?.gender || '' },
      // only what's on the shelf, at the price the party pays (haggled only once they've won it)
      items: s.items.filter(i => i.qty == null || i.qty > 0).filter(i => i.value).map(i => ({ id: i.id, n: i.name, q: i.qty ?? null, p: R.sellPrice(s, i), hp: R.sellPrice(s, i, true), band: i.band, magic: !!i.magic, d: String(i.desc || '').slice(0, 240) })),
      buys: s.items.filter(i => i.value).map(i => ({ n: i.name, p: R.buyPrice(s, i), hp: R.buyPrice(s, i, true) })),
      ...(s.type === R.GENERAL ? { buysAll: true, offers: (s.offers || []).map(o => ({ id: o.id, n: o.name, p: o.cp, who: o.who || '', no: !!o.refused })) } : {}),
    })),
  };
}
async function publish() {
  if (!amDm()) return;
  const v = playerView(), k = JSON.stringify({ ...v, t: 0 });
  if (k === lastPub) return;
  try { const T = await core.tables(); await T.publishShops(await tablePass(), core.currentTable().id, v); lastPub = k; } catch (e) { console.warn('publish shops', e); }
}
async function listenToPlayers() {
  if (!amDm() || stopReq) return;
  const T = await core.tables(); const tid = core.currentTable().id;
  stopReq = T.watchShopRequests(await tablePass(), tid, async ({ uid, rid, req }) => {
    const l = S.locations.find(x => x.partyHere && x.open), i = l ? l.shops.findIndex(s => s.id === req.shopId) : -1;
    if (req.who && !(S.knownWho || []).includes(req.who)) S.knownWho = [...(S.knownWho || []), req.who].slice(-30);
    let ans;
    if (!l || i < 0) ans = { error: "That shop isn't open to you right now." };
    else if (l.shops[i].status === 'closed') ans = { error: 'That shop is closed.' };
    else if (req.kind === 'buy') {
      const r = R.sale(l.shops[i], req.itemId, Math.max(1, Number(req.n) || 1), req.purse || {}, req.who || '');
      if (r.error) ans = { error: r.error };
      else {
        l.shops[i] = { ...r.shop, log: [...(r.shop.log || []), `${req.who || 'A player'} bought ${r.item.name} for ${R.money(r.cp)}`].slice(-40) };
        ans = { ok: true, cp: r.cp, give: r.give, change: r.change };
        toast(`${req.who || 'A player'} bought ${r.item.name} at ${shopTitle(l.shops[i])}.`);
      }
    } else if (req.kind === 'quote') {
      // the General Store's offer for something it doesn't stock: from your lists, or you name a price
      const sh = l.shops[i], cp = priceGuess(sh, req.name, req.who);
      const off = (sh.offers || []).find(o => o.name.toLowerCase() === String(req.name).toLowerCase() && (!o.who || o.who === req.who));
      if (off) ans = off.refused ? { ok: true, refused: true } : { ok: true, quote: off.cp, offerId: off.id };
      else if (cp) ans = { ok: true, quote: cp };
      else {
        S.appraisals = (S.appraisals || []).filter(a => !(a.shopId === sh.id && a.name.toLowerCase() === String(req.name).toLowerCase() && a.who === req.who));
        S.appraisals.push({ id: rid, uid, who: req.who || '', loc: l.id, shopId: sh.id, name: String(req.name || '').slice(0, 100), at: Date.now() });
        ans = { ok: true, pending: true };
        toast(`${req.who || 'A player'} wants an offer for ${req.name} at ${shopTitle(sh)}.`);
      }
    } else if (req.kind === 'sell' && l.shops[i].type === R.GENERAL && !l.shops[i].items.some(x => x.value && x.name.toLowerCase() === String(req.name).toLowerCase())) {
      const sh = l.shops[i], n = Math.max(1, Number(req.n) || 1);
      const off = (sh.offers || []).find(o => o.id === req.offerId && !o.refused);
      const each = off ? off.cp : priceGuess(sh, req.name, req.who);
      const r = each ? R.purchaseAny(sh, req.name, n, each) : { error: 'Ask the store for an offer first.' };
      if (r.error) ans = { error: r.error };
      else {
        l.shops[i] = { ...r.shop, offers: (sh.offers || []).filter(o => o !== off), log: [...(r.shop.log || []), `${req.who || 'A player'} sold ${req.name} for ${R.purseText(r.paid)}`].slice(-40) };
        ans = { ok: true, cp: r.cp, paid: r.paid };
        toast(`${req.who || 'A player'} sold ${req.name} to ${shopTitle(l.shops[i])}.`);
      }
    } else if (req.kind === 'decline') {
      l.shops[i] = { ...l.shops[i], offers: (l.shops[i].offers || []).filter(o => o.id !== req.offerId) };
      ans = { ok: true };
    } else if (req.kind === 'sell') {
      const r = R.purchase(l.shops[i], req.name, Math.max(1, Number(req.n) || 1), req.who || '');
      if (r.error) ans = { error: r.error };
      else {
        l.shops[i] = { ...r.shop, log: [...(r.shop.log || []), `${req.who || 'A player'} sold ${r.item.name} for ${R.purseText(r.paid)}`].slice(-40) };
        ans = { ok: true, cp: r.cp, paid: r.paid };
        toast(`${req.who || 'A player'} sold ${r.item.name} to ${shopTitle(l.shops[i])}.`);
      }
    } else ans = { error: 'Unknown request.' };
    try { await T.answerShop(await tablePass(), tid, uid, rid, ans); } catch (e) { console.warn('answer', e); }
    if (ans.ok) { await save(); render(); }
  });
}

// What the General Store pays for something it doesn't stock: half its price in your lists (or the SRD's), in copper
function priceGuess(shop, name, who = '') {
  const want = String(name || '').trim().toLowerCase(); if (!want) return 0;
  const hag = R.haggledFor(shop, who);
  const own = shop.items.find(x => x.value && x.name.toLowerCase() === want);
  if (own) return R.buyPrice(shop, own, hag);
  const lists = [...(usingMine() ? Object.values(LIB.shops || {}).map(x => x.items || []) : []), ...Object.values(SRD_SHOPS[edition()] || {})];
  for (const list of lists) { const it = list.find(x => Number(x.value) && x.name.toLowerCase() === want); if (it) return R.buyPrice(shop, it, hag); }
  return 0;
}
// Things players brought to a General Store that need your price
function appraisalsCard(only) {
  const list = (S.appraisals || []).filter(a => !only || a.loc === only);
  if (!list.length) return '';
  return `<div class="card" style="border-color:var(--ac)"><h3 style="margin-top:0">Waiting for your offer</h3><p class="mu small">Your players want to sell these to a General Store, and your lists don't have a price for them. Offer what the store pays for one (it buys at half value, so think of half what it's worth).</p>
    ${list.map(a => { const l = S.locations.find(x => x.id === a.loc), sh = l?.shops.find(x => x.id === a.shopId); return `<div class="row" style="margin:6px 0"><span class="grow"><b>${esc(a.name)}</b><br><span class="mu small">${esc(a.who || 'A player')} · ${esc(sh ? shopTitle(sh) : 'General Store')}${l ? `, ${esc(l.name)}` : ''}</span></span>
      <input class="n" data-ap="${a.id}" placeholder="gp" inputmode="decimal" aria-label="Offer in gp"><button class="sm pri" data-apo="${a.id}">Offer</button><button class="sm" data-apn="${a.id}">Won't buy</button></div>`; }).join('')}</div>`;
}
function bindAppraisals(app) {
  const done = (a, offer) => {
    const l = S.locations.find(x => x.id === a.loc), sh = l?.shops.find(x => x.id === a.shopId);
    if (sh) sh.offers = [...(sh.offers || []).filter(o => !(o.name.toLowerCase() === a.name.toLowerCase() && o.who === a.who)), { id: uid(), name: a.name, who: a.who, ...offer }];
    S.appraisals = S.appraisals.filter(x => x !== a); save(); render();
  };
  app.querySelectorAll('[data-apo]').forEach(b => { b.onclick = () => { const a = S.appraisals.find(x => x.id === b.dataset.apo), gp = Number(app.querySelector(`[data-ap="${b.dataset.apo}"]`).value); if (!(gp > 0)) return toast('Type an offer in gp, or tap Won\'t buy.'); done(a, { cp: Math.round(gp * 100) }); toast(`Offer sent: ${a.who || 'the player'} sees it at the store.`); }; });
  app.querySelectorAll('[data-apn]').forEach(b => { b.onclick = () => { const a = S.appraisals.find(x => x.id === b.dataset.apn); done(a, { cp: 0, refused: true }); }; });
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
    // the newer copy of your lists wins (edited here, or on another device)
    if (lib?.app === 'dmp-shops-library' && lib.shops && (!LIB || (lib.stamp || 0) >= (LIB.stamp || 0))) { LIB = lib; await idbPut('library', lib); }
    else if (LIB && (!lib || (LIB.stamp || 0) > (lib.stamp || 0))) await core.writeAppdata(t, LIB_FILE, LIB);
    if (rem?.app === 'dmp-shops' && (rem.state?.stamp || 0) > (S.stamp || 0)) { S = normalize(rem.state); if (S.locations.filter(l => ensureGeneral(l)).length) save(); await idbPut('state', S); render(); }
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
// A shop asking a favor gets one suggested, one not handed out lately
function fillFavor(s) {
  if (s.haggle?.kind !== 'favor' || s.haggle.favor) return;
  s.haggle.favor = favorFor(s.type, S.usedFavors || []);
  S.usedFavors = [...(S.usedFavors || []), s.haggle.favor].slice(-300);
}
function makeShop(type, l, q = null) {
  const s = R.newShop(type, listFor(type), { q, maxQ: R.qualityCap(l.size), goldTable: goldTable(type) });
  fillFavor(s);
  s.keeper = N.keeperFor(edition(), extraRaces());
  s.name = N.shopNameFor(type, s.keeper.name);
  return s;
}
const extraRaces = () => String(S.settings.races || '').split(',').map(x => x.trim()).filter(Boolean);
// Every settlement has a General Store (towns made before this get one the first time they're opened)
function ensureGeneral(l) {
  if (l.shops.some(s => s.type === R.GENERAL)) return false;
  l.shops.unshift(makeShop(R.GENERAL, l)); return true;
}
function rollTown(l) {
  const r = R.rollShops(l.size);
  l.shops = r.shops.map(t => makeShop(t, l));
  l.services = Object.fromEntries(R.SERVICES.map(t => [t, r.services.includes(t) ? 'open' : '']));
}

/* ---------- screens ---------- */
let playerStarted = false;
function render() {
  const app = $('#app');
  $('#back').hidden = ui.view === 'home';
  $('#crumb').textContent = ui.view === 'shop' ? `${loc()?.name || ''}` : ui.view === 'list' ? 'Shop lists' : '';
  if (isPlayer()) { if (!playerStarted) { playerStarted = true; $('#settingsBtn').hidden = true; startPlayer(core, { toast }); } return; }
  if (ui.view === 'location' && loc()) return locationView(app);
  if (ui.view === 'shop' && shopOf()) return shopView(app);
  if (ui.view === 'settings') return settingsView(app);
  if (ui.view === 'lists') return listsView(app);
  if (ui.view === 'list' && ui.type) return listView(app);
  ui.view = 'home'; homeView(app);
}

function homeView(app) {
  const ls = S.locations;
  app.innerHTML = `
  ${appraisalsCard()}
  <div class="card"><div class="row"><h2 class="grow">Towns</h2><button id="lists">📋 Shop lists</button><button class="pri" id="newLoc">+ New town</button></div>
    <p class="mu small">Each town keeps its own shops. Lists: ${usingMine() ? 'your own shop lists' : `the SRD's (${edition()} rules)`}.</p>
    <div class="grid">${ls.map(l => `<button class="tile" data-loc="${l.id}"><b>${esc(l.name)}</b><span class="mu">${esc(l.size)} · ${l.shops.filter(s => s.status !== 'closed').length} shops</span><br>${l.open ? '<span class="tag ok">Open to players</span>' : '<span class="tag">Closed to players</span>'}${l.partyHere ? '<span class="tag ac">Party is here</span>' : ''}</button>`).join('') || '<p class="mu">No towns yet.</p>'}</div></div>
  ${ls.length ? `<div class="card"><h3>A new month</h3><p class="mu small">Every shop in every town rolls its month: new quality and stock, what it sold and bought, and its stall or building countdown. You'll see a summary, and you can undo it.</p>
    <div class="row"><button class="pri" id="month">Start a new month</button>${S.undo ? `<button id="undo">Undo the last new month</button>` : ''}</div></div>` : ''}`;
  app.querySelectorAll('[data-loc]').forEach(b => { b.onclick = () => go('location', { loc: b.dataset.loc }); });
  bindAppraisals(app);
  $('#newLoc').onclick = newTownDialog;
  $('#lists').onclick = () => go('lists');
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
      if (roll) rollTown(l); else ensureGeneral(l);
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
  app.innerHTML = `${appraisalsCard(l.id)}
  <div class="card"><div class="row"><h2 class="grow">${esc(l.name)}</h2><button class="sm" id="ren">Rename</button></div>
    <div class="row"><span class="tag">${esc(l.size)}</span><span class="tag">best quality ${R.qualityCap(l.size)}</span><span class="tag">a General Store${sz.maxShops ? ` + up to ${sz.maxShops} shops` : ''}</span></div>
    <div class="row" style="margin-top:8px"><button id="open" aria-pressed="${!!l.open}">${l.open ? 'Open to players' : 'Closed to players'}</button><button id="here" aria-pressed="${!!l.partyHere}">${l.partyHere ? 'The party is here' : 'The party is elsewhere'}</button></div>
    <p class="mu small">Players see this town's shops while the party is here and it's open to them.</p></div>
  <div class="card"><div class="row"><h3 class="grow" style="margin:0">Shops</h3><button id="addShop">+ Add a shop</button><button id="reroll">Roll the town again</button></div>
    <div class="grid" style="margin-top:8px">${l.shops.map(s => `<button class="tile ${s.status === 'closed' ? 'closed' : ''}" data-shop="${s.id}"><b>${esc(shopTitle(s))}</b><span class="mu">${esc(s.type)} · ${qLabel(s.quality)} · ${s.form === 'building' ? 'Building' : 'Stall'}</span><br>
      ${s.status === 'closed' ? '<span class="tag bad">Closed</span>' : ''}${s.haggleWon || (s.haggleBy || []).length ? '<span class="tag ok">Haggled</span>' : ''}${countdown(s)}<span class="tag ${R.shopCp(s) < 0 ? 'bad' : ''}">${R.shopCp(s) < 0 ? 'In debt ' : ''}${R.money(R.shopCp(s), { short: true })}</span></button>`).join('') || '<p class="mu">No shops yet.</p>'}</div></div>
  <div class="card"><h3>At the table</h3><p class="mu small">Players only see whether these are here and open.</p>${svc}</div>
  <div class="card"><button class="bad" id="delLoc">Delete this town</button></div>`;
  app.querySelectorAll('[data-shop]').forEach(b => { b.onclick = () => go('shop', { shop: b.dataset.shop }); });
  bindAppraisals(app);
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
      <div class="stat" style="grid-column:span 2"><small>${R.shopCp(s) < 0 ? 'In debt' : 'Coins on hand'} · worth ${R.money(R.shopCp(s))}</small><b style="${R.shopCp(s) < 0 ? 'color:#f1b0a5' : ''}">${esc(R.purseText(R.purseOf(s)))}</b></div>
      <div class="stat"><small>Prices</small><b>${Math.round((s.priceMod || 1) * 100)}%</b></div>
      <div class="stat"><small>Haggling</small><b>${R.haggleKind(s) === 'roll' ? `${esc(s.haggle.skill || 'Persuasion')} DC ${s.haggle.dc}, ${s.haggle.off}% off` : R.haggleKind(s) === 'favor' ? `A favor, ${s.haggle.off}% off` : "Won't haggle"}</b></div>
      <div class="stat"><small>Started at</small><b>${qLabel(s.startQuality || s.quality)}</b></div></div>
    <div class="row"><button id="gold">Change coins</button>
      <button id="status">${s.status === 'closed' ? 'Reopen the shop' : 'Close the shop'}</button></div></div>
  ${haggleCard(s)}
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
  bindHaggle(app, s);
  $('#gold').onclick = () => {
    const p = R.purseOf(s);
    modal(`<h2>Coins on hand</h2><div class="row">${R.COINS.map(c => `<div class="grow"><label>${c}</label><input data-coin="${c}" value="${p[c] || 0}" inputmode="numeric"></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="pri" id="cs">Save</button><button id="cx">Cancel</button></div>`, m => {
      $('#cx', m).onclick = closeModal;
      $('#cs', m).onclick = () => { s.purse = Object.fromEntries(R.COINS.map(c => [c, Number($(`[data-coin="${c}"]`, m).value) || 0])); delete s.gold; save(); closeModal(); render(); };
    });
  };
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

/* ---------- haggling: a skill check or a favor, earned character by character ---------- */
// The party's characters, for ticking off who earned a shop's discount: your Character Sheet party, and anyone who's shopped
function partyNames() {
  const names = new Set();
  try { for (const c of core?.party?.() || []) if (c.name) names.add(c.name); } catch { /* */ }
  for (const n of S.knownWho || []) names.add(n);
  return [...names];
}
function haggleCard(s) {
  const k = R.haggleKind(s), h = s.haggle || {};
  if (s.haggleWon === true) { s.haggleBy = partyNames(); delete s.haggleWon; }
  const won = new Set(s.haggleBy || []), names = [...new Set([...partyNames(), ...won])];
  return `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Haggling this month</h3>
      <select id="hk" style="width:auto">${[['roll', '🎲 Skill check'], ['favor', '🤝 A favor'], ['none', "🚫 Won't haggle"]].map(([v, n]) => `<option value="${v}" ${k === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${k === 'roll' ? `<div class="row"><div><label>Skill</label><select id="hs">${R.HAGGLE_SKILLS.map(x => `<option ${(h.skill || 'Persuasion') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div><label>DC</label><input class="n" id="hdc" inputmode="numeric" value="${h.dc || 15}"></div><div><label>% off</label><input class="n" id="hoff" inputmode="numeric" value="${h.off || 10}"></div></div>` : ''}
    ${k === 'favor' ? `<label>What the shopkeeper asks</label><textarea id="hf">${esc(h.favor || '')}</textarea>
      <div class="row"><button class="sm" id="hnew">🎲 Suggest another</button><div><label style="display:inline;margin-right:6px">% off</label><input class="n" id="hoff" inputmode="numeric" value="${h.off || 15}"></div></div>` : ''}
    ${k !== 'none' ? `<label>Who earned it (their prices drop, everyone else pays full price, until the month turns)</label>
      <div class="row">${names.map(n => `<button class="sm" data-won="${esc(n)}" aria-pressed="${won.has(n)}">${won.has(n) ? '✓ ' : ''}${esc(n)}</button>`).join('') || '<span class="mu small">No characters yet.</span>'}
      <input id="hadd" placeholder="Add a character" style="width:160px"></div>` : ''}
    <p class="mu small">Players see what it takes${k === 'roll' ? ' (the skill and DC)' : k === 'favor' ? ' (the favor)' : ''} and the discount, and their own price once you tick them.</p></div>`;
}
function bindHaggle(app, s) {
  const h = () => (s.haggle = s.haggle || { kind: 'none', dc: 0, off: 0 });
  const k = $('#hk', app); if (!k) return;
  k.onchange = () => {
    const x = h(); x.kind = k.value;
    if (x.kind === 'roll') { x.dc = x.dc || 15; x.off = x.off || 10; x.skill = x.skill || 'Persuasion'; }
    if (x.kind === 'favor') { x.off = x.off || 15; x.favor = x.favor || ''; fillFavor(s); }
    if (x.kind === 'none') s.haggleBy = [];
    save(); render();
  };
  const on = (id, f) => { const el = $(id, app); if (el) el.onchange = () => { f(el.value); save(); }; };
  on('#hs', v => { h().skill = v; });
  on('#hdc', v => { h().dc = Math.max(1, parseInt(v, 10) || 0); });
  on('#hoff', v => { h().off = Math.max(0, Math.min(100, parseInt(v, 10) || 0)); render(); });
  on('#hf', v => { h().favor = v.trim(); });
  const nw = $('#hnew', app); if (nw) nw.onclick = () => { h().favor = ''; fillFavor(s); save(); render(); };
  app.querySelectorAll('[data-won]').forEach(b => { b.onclick = () => { const n = b.dataset.won, w = new Set(s.haggleBy || []); if (w.has(n)) w.delete(n); else w.add(n); s.haggleBy = [...w]; save(); render(); }; });
  const add = $('#hadd', app); if (add) add.onchange = () => { const n = add.value.trim(); if (!n) return; S.knownWho = [...new Set([...(S.knownWho || []), n])]; s.haggleBy = [...new Set([...(s.haggleBy || []), n])]; save(); render(); };
}

/* ---------- the master lists: every shop type and every item it can carry ---------- */
// What new shops are stocked from, and what every shop of a type follows: change an item here and it changes in every
// shop of that type in every town (shelf counts stay). Items added here reach shelves at the next new month.
const COIN_LIST = ['cp', 'sp', 'gp', 'pp'];
const BAND_D = [[[1, 3], [1, 3], [1, 4], [2, 5], [2, 5]], [0, [1, 3], [1, 4], [2, 5], [2, 5]], [0, 0, [1, 4], [2, 5], [2, 5]], [0, 0, 0, [2, 5], [2, 5]], [0, 0, 0, 0, [2, 5]]];
const defaultRule = (band, magic) => ({ d: JSON.parse(JSON.stringify(BAND_D[band] || BAND_D[0])), m: magic ? [1, 1, 1, 1, 1] : [3, 5, 8, 10, 15] });
const listTypes = () => { const own = usingMine() ? Object.keys(LIB.shops || {}) : []; return [...R.SHOPS, ...own.filter(t => !R.SHOPS.includes(t))]; };
const masterOf = type => (usingMine() ? (LIB.shops[type]?.items || []) : (SRD_SHOPS[edition()]?.[type] || []));
let libT = null;
function saveLib() {
  LIB.stamp = Date.now();
  idbPut('library', LIB);
  clearTimeout(libT);
  libT = setTimeout(async () => { try { const t = await getToken(false); if (t) await core.writeAppdata(t, LIB_FILE, LIB); } catch { /* saved on this device; it goes up with the next sync */ } }, 1500);
}
// Your own copy to edit: from your lists if you have them, otherwise from the SRD's for this table's edition
function ownLists() {
  if (!LIB) LIB = { app: 'dmp-shops-library', v: 1, shops: Object.fromEntries(Object.entries(SRD_SHOPS[edition()] || {}).map(([t, items]) => [t, { items: JSON.parse(JSON.stringify(items)) }])) };
  S.settings.useMine = true;
  for (const t of Object.keys(LIB.shops)) for (const it of LIB.shops[t].items || []) if (!it.key) it.key = uid();
  saveLib(); save();
}
// Carry a change into every shop of that type (matched by the item's key, or by name for shops made before keys)
function applyToShops(type, change) {
  let n = 0;
  const same = (x, key, name) => (key && x.key === key) || String(x.name).toLowerCase() === String(name).toLowerCase();
  for (const l of S.locations) for (const s of l.shops) {
    if (s.type !== type) continue;
    if (change.kind === 'edit') {
      const x = s.items.find(y => same(y, change.key, change.oldName)); if (!x) continue;
      const it = change.item;
      Object.assign(x, { key: it.key, name: it.name, value: it.value, coin: it.coin, band: it.band, magic: it.magic, unique: it.unique, unlimited: it.unlimited, desc: it.desc, rule: R.ruleOf(it) });
      if (it.unlimited) x.qty = null; else if (x.qty == null) x.qty = 0;
      n++;
    } else if (change.kind === 'add') {
      if (s.items.some(y => same(y, change.item.key, change.item.name))) continue;
      s.items.push({ ...change.item, rule: R.ruleOf(change.item), id: uid(), qty: change.item.unlimited ? null : 0 }); n++;
    } else if (change.kind === 'remove') {
      const before = s.items.length; s.items = s.items.filter(y => !same(y, change.key, change.name)); n += before - s.items.length;
    }
  }
  if (n) save();
  return n;
}
function listsView(app) {
  const mine = usingMine();
  app.innerHTML = `<div class="card"><h2>Shop lists</h2>
    <p class="mu small">Every shop type and every item it can carry. ${mine ? 'These are your own lists, kept privately in your Google Drive. Change an item and it changes in every shop of that type, in every town.' : `These are the SRD's lists for the ${edition()} rules. To change them, make your own copy first.`}</p>
    ${mine ? '' : '<div class="row"><button class="pri" id="mkOwn">Make my own copy to edit</button></div>'}
    <div class="grid" style="margin-top:10px">${listTypes().map(t => { const items = masterOf(t), np = items.filter(x => !Number(x.value) && !x.unlimited).length; return `<button class="tile" data-type="${esc(t)}"><b>${esc(t)}</b><span class="mu">${items.length} item${items.length === 1 ? '' : 's'}</span>${np ? `<br><span class="tag bad">${np} without a price</span>` : ''}</button>`; }).join('')}</div></div>`;
  app.querySelectorAll('[data-type]').forEach(b => { b.onclick = () => go('list', { type: b.dataset.type, q: '' }); });
  const mk = $('#mkOwn'); if (mk) mk.onclick = () => { ownLists(); toast('Your own copy is ready. Edit away.'); render(); };
}
const ruleText = (it, q) => { const r = R.ruleOf(it); if (it.unlimited) return '∞'; const dv = r?.d?.[q - 1], m = r?.m?.[q - 1]; if (!dv || !m) return '—'; return Array.isArray(dv) ? `${dv[0]}–${dv[1]}${m > 1 ? ` ×${m}` : ''}` : `${dv}${m > 1 ? ` ×${m}` : ''}`; };
function listView(app) {
  const type = ui.type, mine = usingMine(), items = masterOf(type);
  if (mine && items.some(x => !x.key)) { items.forEach(x => { if (!x.key) x.key = uid(); }); saveLib(); }
  const q = (ui.q || '').toLowerCase();
  const shown = items.map((it, i) => ({ it, i })).filter(x => !q || x.it.name.toLowerCase().includes(q));
  const groups = [...R.BANDS.map((b, i) => ({ b: `${b} Quality`, list: shown.filter(x => x.it.band === i) })), { b: 'Other', list: shown.filter(x => !(x.it.band >= 0 && x.it.band <= 4)) }].filter(g => g.list.length);
  app.innerHTML = `<div class="card"><div class="row"><h2 class="grow">${esc(type)}</h2>${mine ? '<button class="pri" id="addM">+ Add an item</button>' : '<button class="pri" id="mkOwn">Make my own copy to edit</button>'}</div>
    <p class="mu small">${items.length} items. Restock shows how many come in each month at Quality 1 to 5 (a roll, times the number after ×). ${mine ? 'Tap an item to change it.' : ''}</p>
    <input id="fq" placeholder="Search ${esc(type)}" value="${esc(ui.q || '')}" autocomplete="off"></div>
    <div class="card"><table class="stock"><thead><tr><th>Item</th><th class="num">Price</th>${[1, 2, 3, 4, 5].map(n => `<th class="num hide-s">Q${n}</th>`).join('')}</tr></thead>
    <tbody>${groups.map(g => `<tr class="band"><td colspan="7">${g.b}</td></tr>${g.list.map(({ it, i }) => `<tr data-i="${i}" style="${mine ? 'cursor:pointer' : ''}"><td>${esc(it.name)}${it.magic ? ' <span class="tag ac">magic</span>' : ''}${it.unique ? ' <span class="tag">only one ever</span>' : ''}${it.unlimited ? ' <span class="tag">always</span>' : ''}</td>
      <td class="num">${Number(it.value) ? `${Number(it.value).toLocaleString()} ${esc(it.coin || 'gp')}` : it.unlimited ? '' : '<span class="tag bad">no price</span>'}</td>${[1, 2, 3, 4, 5].map(n => `<td class="num hide-s mu">${ruleText(it, n)}</td>`).join('')}</tr>`).join('')}`).join('') || `<tr><td class="mu">${q ? 'Nothing matches.' : 'No items yet.'}</td></tr>`}</tbody></table></div>`;
  const f = $('#fq'); f.oninput = () => { ui.q = f.value; const pos = f.selectionStart; listView(app); const g = $('#fq'); g.focus(); g.setSelectionRange(pos, pos); };
  const mk = $('#mkOwn'); if (mk) mk.onclick = () => { ownLists(); toast('Your own copy is ready. Edit away.'); render(); };
  if (!mine) return;
  const a = $('#addM'); if (a) a.onclick = () => itemDialog(type, -1);
  app.querySelectorAll('[data-i]').forEach(r => { r.onclick = () => itemDialog(type, Number(r.dataset.i)); });
}
function itemDialog(type, idx) {
  if (!LIB.shops[type]) LIB.shops[type] = { items: [] };
  const list = LIB.shops[type].items, was = idx >= 0 ? list[idx] : null;
  const it = was ? JSON.parse(JSON.stringify(was)) : { key: uid(), name: '', value: 0, coin: 'gp', band: 2, magic: false, unit: 'each', src: 'Homebrew', desc: '' };
  const r0 = R.ruleOf(it) || defaultRule(it.band, it.magic);
  const cell = (n, k) => { const dv = r0.d?.[n]; return k === 'lo' ? (Array.isArray(dv) ? dv[0] : dv || '') : k === 'hi' ? (Array.isArray(dv) ? dv[1] : dv || '') : (r0.m?.[n] || ''); };
  modal(`<h2>${was ? 'Change an item' : `Add an item to ${esc(type)}`}</h2>
    <label>Name</label><input id="mn" value="${esc(it.name)}">
    <div class="row"><div class="grow"><label>Price</label><input id="mv" inputmode="decimal" value="${Number(it.value) || ''}" placeholder="0"></div>
      <div><label>Coin</label><select id="mc">${COIN_LIST.map(c => `<option ${(it.coin || 'gp') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="grow"><label>Quality band</label><select id="mb">${R.BANDS.map((b, i) => `<option value="${i}" ${it.band === i ? 'selected' : ''}>${b}</option>`).join('')}</select></div></div>
    <div class="row"><label style="margin:6px 0"><input type="checkbox" id="mm" style="width:auto" ${it.magic ? 'checked' : ''}> Magic item</label>
      <label style="margin:6px 0"><input type="checkbox" id="mu" style="width:auto" ${it.unique ? 'checked' : ''}> Only one ever (gone once sold)</label>
      <label style="margin:6px 0"><input type="checkbox" id="ml" style="width:auto" ${it.unlimited ? 'checked' : ''}> Always available (a service)</label></div>
    <label>Restock each month, by the shop's quality: roll from–to, times ×. Leave a row empty if it isn't stocked at that quality.</label>
    <table class="stock" id="rt"><thead><tr><th>Quality</th><th>From</th><th>To</th><th>×</th></tr></thead><tbody>${[0, 1, 2, 3, 4].map(n => `<tr><td>Q${n + 1}</td><td><input class="n" data-r="${n}" data-k="lo" inputmode="numeric" value="${cell(n, 'lo')}"></td><td><input class="n" data-r="${n}" data-k="hi" inputmode="numeric" value="${cell(n, 'hi')}"></td><td><input class="n" data-r="${n}" data-k="m" inputmode="numeric" value="${cell(n, 'm')}"></td></tr>`).join('')}</tbody></table>
    <div class="row"><button class="sm" id="mdef">Use the usual amounts for this band</button></div>
    <label>Description (optional)</label><textarea id="md">${esc(it.desc || '')}</textarea>
    <div class="row" style="margin-top:12px"><button class="pri" id="ms">${was ? 'Save' : 'Add'}</button><button id="mx">Cancel</button><span class="grow"></span>${was ? '<button class="bad" id="mdel">Remove from the list</button>' : ''}</div>`, m => {
    $('#mx', m).onclick = closeModal;
    $('#mdef', m).onclick = () => { const r = defaultRule(Number($('#mb', m).value), $('#mm', m).checked); m.querySelectorAll('[data-r]').forEach(i => { const n = Number(i.dataset.r), dv = r.d[n]; i.value = i.dataset.k === 'm' ? (dv ? r.m[n] : '') : (Array.isArray(dv) ? dv[i.dataset.k === 'lo' ? 0 : 1] : ''); }); };
    $('#ms', m).onclick = () => {
      const name = $('#mn', m).value.trim(); if (!name) return toast('Give the item a name.');
      if (list.some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) return toast(`${type} already has an item called ${name}.`);
      const rule = { d: [], m: [] };
      for (let n = 0; n < 5; n++) {
        const v = k => parseInt($(`[data-r="${n}"][data-k="${k}"]`, m).value, 10);
        let lo = v('lo'), hi = v('hi'); const mu = v('m');
        if (!lo && !hi) { rule.d.push(0); rule.m.push(0); continue; }
        lo = lo || hi; hi = hi || lo; if (hi < lo) [lo, hi] = [hi, lo];
        rule.d.push([lo, hi]); rule.m.push(mu || 1);
      }
      const oldName = was?.name || '';
      Object.assign(it, { name, value: Number($('#mv', m).value) || 0, coin: $('#mc', m).value, band: Number($('#mb', m).value), magic: $('#mm', m).checked, unique: $('#mu', m).checked || undefined, unlimited: $('#ml', m).checked || undefined, desc: $('#md', m).value.trim(), rule, qty: rule });
      if (was) list[idx] = it; else list.push(it);
      saveLib();
      const n = applyToShops(type, was ? { kind: 'edit', key: it.key, oldName, item: it } : { kind: 'add', item: it });
      closeModal(); render();
      toast(was ? `Saved.${n ? ` Updated in ${n} shop${n === 1 ? '' : 's'}.` : ''}` : `Added.${n ? ` It reaches ${n} shop${n === 1 ? '' : 's'} with the next new month.` : ''}`);
    };
    const del = $('#mdel', m);
    if (del) del.onclick = () => {
      if (!confirm(`Remove ${was.name} from the ${type} list? It also comes off the shelves of every ${type} in your towns.`)) return;
      list.splice(idx, 1); saveLib();
      const n = applyToShops(type, { kind: 'remove', key: was.key, name: was.name });
      closeModal(); render(); toast(`Removed.${n ? ` Taken off ${n} shop${n === 1 ? '' : 's'}.` : ''}`);
    };
  });
}

/* ---------- a new month for every town ---------- */
function newMonth() {
  if (!confirm('Start a new month in every town? Each shop rolls its quality and stock.')) return;
  S.undo = JSON.parse(JSON.stringify(S.locations));
  S.appraisals = [];
  const report = [];
  for (const l of S.locations) {
    const sz = R.sizeOf(l.size);
    for (let i = 0; i < l.shops.length; i++) {
      const s = l.shops[i];
      const r = R.monthFor(s, s.items, { maxQ: R.qualityCap(l.size) });
      const ns = r.shop; fillFavor(ns);
      const line = `Quality ${r.quality}${r.debt ? ' (started in debt: a bad month)' : ''}: sold ${r.sold.reduce((t, x) => t + x.n, 0)} items for ${R.money(r.made)}, bought ${r.bought.reduce((t, x) => t + x.n, 0)} for ${R.money(r.spent)}${r.change ? ` · ${r.change === 'closed' ? 'CLOSED' : r.change === 'upgraded' ? 'became a building' : 'dropped to a stall'}` : ''}`;
      ns.log = [...(s.log || []), line].slice(-24);
      l.shops[i] = ns;
      if (s.status !== 'closed') report.push({ town: l.name, shop: shopTitle(ns), line, change: r.change });
    }
    // room for more? one new shop may open, as a stall (Quality 1–2)
    const t = R.rollNewShop(l.size, l.shops);
    if (t) {
      const ns = makeShop(t, l, R.rollQuality(Math.min(2, R.qualityCap(l.size))));
      ns.form = 'stall'; ns.log = ['Opened as a stall'];
      l.shops.push(ns);
      report.push({ town: l.name, shop: shopTitle(ns), line: `NEW: a ${t} opened, as a stall at Quality ${ns.quality}`, change: 'opened' });
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
    <h3>Add a town from a file</h3><p class="mu small">A town brought over from a tracker sheet, with its shops, stock and coins.</p>
    <div class="row"><label class="sm" style="margin:0">Town file: <input type="file" id="townFile" accept=".json" style="width:auto"></label></div>
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
  $('#townFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (o?.app !== 'dmp-shops-town' || !o.location) throw new Error("That isn't a town file.");
      const l = o.location;
      if (S.locations.some(x => x.name.toLowerCase() === l.name.toLowerCase()) && !confirm(`You already have a town called ${l.name}. Add this one as well?`)) return;
      l.id = uid(); ensureGeneral(l); S.locations.push(l); await save(); toast(`${l.name} is in, with ${l.shops.length} shops.`); go('location', { loc: l.id });
    } catch (err) { toast(err.message); }
  };
  $('#exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'dmp-shops', v: 1, state: S }, null, 1)], { type: 'application/json' })); a.download = `shops-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $('#imp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (o?.app !== 'dmp-shops') throw new Error("That isn't a Shops backup."); if (!confirm('Replace everything here with the backup?')) return; S = normalize(o.state); await save(); render(); } catch (err) { toast(err.message); } };
}

/* ---------- start ---------- */
$('#back').onclick = () => go(ui.view === 'shop' ? 'location' : ui.view === 'list' ? 'lists' : 'home');
$('#settingsBtn').onclick = () => go('settings');
window.addEventListener('dmp-suite', () => render());
(async () => {
  const [st, lib] = await Promise.all([idbGet('state'), idbGet('library')]);
  if (st) S = normalize(st);
  if (lib) LIB = lib;
  const added = S.locations.filter(l => ensureGeneral(l)).map(l => l.name);
  if (added.length) { save(); setTimeout(() => toast(`Every town has a General Store now: added one to ${added.join(', ')}.`), 800); }
  await coreReady;
  render();
  if (!isPlayer() && (core?.signedIn?.(core.SCOPES.appdata, { app: 'shops' }) || core?.staysSignedIn?.())) sync(false);
  if (amDm()) { publish(); listenToPlayers(); }
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
