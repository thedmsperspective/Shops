// The DM's Perspective — Shops: the rules. Pure functions, no screen and no storage.
//
// Everything here follows the DM's own generator: settlement size decides which shops can open and how good they can
// be; a d20 sets a shop's quality; quality sets its stock, its gold, its haggling and its prices. Each new in-game month
// every shop rolls again: what's lower than the shelf was sold, what's higher was bought, and three months in a row of
// low or high quality closes a stall, upgrades it to a building, or drops a building to a stall.

export const SHOPS = ['Alchemist', 'Artificer', 'Black Market', 'Blacksmith', 'Books & Tomes', 'Fashion', 'Fletcher', 'Food & Drink',
  'Furniture', 'General', 'Instruments', 'Jewelry', 'Stables', 'Tattoo', 'Temple'];
// The two services that stay at the table: players only see whether a town has them and whether they're open
export const SERVICES = ['Enchanter', 'Magic Item Dealer'];
export const BANDS = ['Atrocious', 'Poor', 'Medium', 'Good', 'Excellent'];

export const SIZES = [
  { key: 'Hamlet', pop: '< 249', maxQ: 0, maxShops: 0, green: null, red: null },
  { key: 'Village', pop: '250 – 749', maxQ: 2, maxShops: 4, green: 75, red: 90 },
  { key: 'Town', pop: '750 – 2,999', maxQ: 3, maxShops: 8, green: 50, red: 80 },
  { key: 'City', pop: '3,000 – 9,999', maxQ: 4, maxShops: 12, green: 25, red: 70 },
  { key: 'Metropolis', pop: '> 10,000', maxQ: 5, maxShops: 16, green: 0, red: 60 },
];
export const sizeOf = key => SIZES.find(s => s.key === key) || SIZES[2];

/* ---------- dice ---------- */
let rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
export const useRandom = fn => { rand = fn; }; // tests
export const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
export const d = n => between(1, n);
const pick = list => list[Math.floor(rand() * list.length)];

/* ---------- one shop's numbers ---------- */
/** Quality from a d20 (1–2 → 1, 3–6 → 2, 7–12 → 3, 13–17 → 4, 18–20 → 5), never above the settlement's best. */
export function rollQuality(maxQ = 5) {
  const r = d(20), q = r <= 2 ? 1 : r <= 6 ? 2 : r <= 12 ? 3 : r <= 17 ? 4 : 5;
  return Math.max(1, Math.min(q, maxQ || 5));
}
/** Haggling: a roll by quality decides the DC and the discount (or that this merchant won't haggle). */
const HAGGLE = [null, null, { dc: 25, off: 5 }, { dc: 18, off: 10 }, { dc: 15, off: 15 }, { dc: 13, off: 20 }, { dc: 11, off: 25 }, null, null];
export function rollHaggle(q) {
  const r = q <= 2 ? between(2, 6) : q <= 4 ? between(1, 6) : between(1, 8);
  return HAGGLE[r] ? { ...HAGGLE[r] } : { dc: 0, off: 0 };
}
/** The whole shop's prices: 90%, 95%, 100%, 105% or 110%. */
export const rollPriceMod = () => [0.9, 0.95, 1, 1.05, 1.1][d(5) - 1];
/* ---------- coins: a shop keeps platinum, gold, silver and copper apart (a purse) ---------- */
export const COINS = ['pp', 'gp', 'sp', 'cp'];
const CP = { pp: 1000, gp: 100, sp: 10, cp: 1 };
export const purseOf = shop => shop.purse || fromCp(shop.gold || 0); // shops made before coins were kept apart
export const purseCp = p => COINS.reduce((t, c) => t + (Number(p?.[c]) || 0) * CP[c], 0);
export const shopCp = shop => purseCp(purseOf(shop));
const fromCp = cp => { cp = Math.round(cp); return { pp: 0, gp: Math.trunc(cp / 100), sp: Math.trunc((cp % 100) / 10), cp: cp % 10 }; };
export const addCoins = (a, b, sign = 1) => Object.fromEntries(COINS.map(c => [c, (Number(a?.[c]) || 0) + sign * (Number(b?.[c]) || 0)]));
/** "45 pp, 2,796 gp, 6,670 sp, 32,800 cp" */
export const purseText = p => COINS.filter(c => Number(p?.[c])).map(c => `${Number(p[c]).toLocaleString()} ${c}`).join(', ') || 'no coins';
/**
 * Pay an amount (in copper) out of a purse, biggest coins first, never more than it holds of each.
 * Returns the coins paid, or null if it can't be made exactly from what's there.
 */
export function payFrom(p, cp) {
  let left = Math.round(cp); const out = { pp: 0, gp: 0, sp: 0, cp: 0 };
  for (const c of COINS) { const n = Math.min(Math.max(0, Number(p?.[c]) || 0), Math.floor(left / CP[c])); out[c] = n; left -= n * CP[c]; }
  return left === 0 ? out : null;
}
/**
 * A buyer pays a seller: the buyer hands over coins (exact if they can, otherwise the least over), and the seller gives
 * change from their own purse. Returns { give, change } or { error }.
 */
export function settle(buyer, seller, cp) {
  const exact = payFrom(buyer, cp);
  if (exact) return { give: exact, change: { pp: 0, gp: 0, sp: 0, cp: 0 } };
  if (purseCp(buyer) < cp) return { error: "Not enough coin." };
  // overpay with one more of the smallest coin that covers it, and ask for change
  for (const c of [...COINS].reverse()) {
    const partial = payFrom(buyer, Math.floor(cp / CP[c]) * CP[c]) || { pp: 0, gp: 0, sp: 0, cp: 0 };
    const extra = { ...partial }; if ((Number(buyer[c]) || 0) - extra[c] < 1) continue;
    extra[c] += 1;
    const over = purseCp(extra) - cp; if (over < 0) continue;
    const change = payFrom(addCoins(seller, extra), over);
    if (change) return { give: extra, change };
  }
  return { error: "They can't make change for that." };
}
/** Starting gold (only when the shop first opens): 3–8 × 20 / 50 / 100 / 250 / 500 gp by quality, split across the
 *  coins the way the generator does it (some gold, some silver, some copper, the rest in platinum and gold). */
const GOLD = [20, 50, 100, 250, 500];
export function rollPurse(q, table = GOLD) {
  const T = between(3, 8) * (table?.[q - 1] ?? GOLD[q - 1]);
  const g = between(1, Math.max(1, T - 4)), s = between(1, Math.max(1, T - g - 3)), c = between(1, Math.max(1, T - g - s - 2));
  const rest = Math.max(0, T - g - s - c);
  return { pp: Math.floor(rest / 10), gp: g + (rest % 10), sp: s * 10, cp: c * 100 };
}
export const rollGold = (q, table) => purseCp(rollPurse(q, table));

/** An item's restock rule: { d: [5 ranges or numbers], m: [5 multipliers] } (lists keep it in `qty`, shops in `rule`). */
export const ruleOf = it => it.rule || (it.qty && typeof it.qty === 'object' ? it.qty : null);
/** How many of an item a shop of this quality has: a range (or a set number) times a multiplier. */
export function rollQty(item, q) {
  if (item.unlimited) return null; // "Unlimited": a service, always on offer
  const r = ruleOf(item) || { d: [], m: [] };
  const dv = r.d?.[q - 1] ?? 0, mv = r.m?.[q - 1] ?? 0;
  const n = Array.isArray(dv) ? between(dv[0], dv[1]) : Number(dv) || 0;
  return Math.max(0, n * (Number(mv) || 0));
}

/* ---------- prices (everything kept in copper) ---------- */
export const COIN_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
export const valueCp = item => Math.round((Number(item.value) || 0) * (COIN_CP[item.coin] || 100));
/** What the shop charges: value × the shop's price modifier, less the party's haggle discount this month. */
export function sellPrice(shop, item, haggled = false) {
  const base = valueCp(item) * (shop.priceMod || 1);
  return Math.max(0, Math.round(haggled ? base * (1 - (shop.haggle?.off || 0) / 100) : base));
}
/** What the shop pays for one (half its value), plus the haggle discount if the party won it. */
export function buyPrice(shop, item, haggled = false) {
  const base = valueCp(item) / 2;
  return Math.max(0, Math.round(haggled ? base * (1 + (shop.haggle?.off || 0) / 100) : base));
}
/** "12 gp 5 sp" from copper */
export function money(cp, { short = false } = {}) {
  cp = Math.round(Number(cp) || 0);
  if (!cp) return '0 gp';
  const neg = cp < 0; cp = Math.abs(cp);
  const parts = [];
  const gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10;
  if (gp) parts.push(`${gp.toLocaleString()} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (c && !(short && gp >= 10)) parts.push(`${c} cp`);
  return (neg ? '−' : '') + parts.join(' ');
}

/* ---------- a whole shop ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
/** Stock a shop at a quality: every item on its list, with how many there are (0 means not on the shelf this month). */
export function stockFor(list, q, prev = []) {
  const gone = new Set(prev.filter(x => x.unique && x.everSold).map(x => x.name));
  return list.map(it => {
    const qty = gone.has(it.name) ? 0 : rollQty(it, q);
    return { ...it, rule: ruleOf(it), id: prev.find(x => x.name === it.name)?.id || uid(), qty, everSold: gone.has(it.name) || undefined };
  });
}
/** A brand-new shop of a type, rolled at a quality (or rolled from the settlement's best). */
export function newShop(type, list, { q = null, maxQ = 5, goldTable = null } = {}) {
  const quality = q || rollQuality(maxQ);
  return {
    id: uid(), type, quality, startQuality: quality,
    form: quality >= 3 ? 'building' : 'stall', // opened at 1–2: a stall; at 3+: a building
    lowRun: 0, highRun: 0, status: 'open',
    purse: rollPurse(quality, goldTable), priceMod: rollPriceMod(), haggle: rollHaggle(quality), haggleWon: false,
    items: stockFor(list, quality), keeper: null, log: [],
  };
}
/** Which shops a settlement has: a d100 each (green shops and the two services by their own odds),
 *  at most one service for every 4 green shops, and no more than the settlement's maximum. */
export function rollShops(sizeKey) {
  const s = sizeOf(sizeKey);
  if (!s.maxShops) return { shops: [], services: [] };
  const rolled = SHOPS.map(t => ({ t, r: d(100) })).filter(x => x.r >= s.green).sort((a, b) => b.r - a.r).slice(0, s.maxShops);
  const room = Math.min(Math.floor(rolled.length / 4), s.maxShops - rolled.length);
  const services = SERVICES.map(t => ({ t, r: d(100) })).filter(x => x.r >= s.red).sort((a, b) => b.r - a.r).slice(0, Math.max(0, room)).map(x => x.t);
  return { shops: rolled.map(x => x.t).sort((a, b) => SHOPS.indexOf(a) - SHOPS.indexOf(b)), services };
}

/* ---------- a new month ---------- */
/**
 * Roll a shop's month. Returns the changed shop and what happened:
 * { sold: [{ name, n, cp }], bought: [{ name, n, cp }], made, spent, quality, change: 'closed'|'upgraded'|'downgraded'|'' }
 * Lower than the shelf: the shop sold the difference (gains its price). Higher: it bought the difference (pays half value).
 */
export function monthFor(shop, list, { maxQ = 5 } = {}) {
  if (shop.status === 'closed') return { shop, sold: [], bought: [], made: 0, spent: 0, quality: shop.quality, change: '' };
  const q = rollQuality(maxQ);
  const next = { ...shop, quality: q, priceMod: rollPriceMod(), haggle: rollHaggle(q), haggleWon: false };
  const fresh = stockFor(list, q, shop.items);
  const sold = [], bought = [];
  let made = 0, spent = 0;
  // like the tracker's restock columns: money in and out in each item's own coin (a coin can go below zero: debt)
  let purse = { ...purseOf(shop) };
  const inCoin = (it, cp, sign) => { const c = COINS.includes(it.coin) ? it.coin : 'gp'; purse[c] = (Number(purse[c]) || 0) + sign * cp / CP[c]; };
  next.items = fresh.map(n => {
    const old = shop.items.find(x => x.name === n.name);
    const had = old ? old.qty : 0;
    if (n.qty == null || had == null) return { ...n, qty: n.qty };
    if (n.qty < had) { const k = had - n.qty, cp = k * sellPrice(next, n); sold.push({ name: n.name, n: k, cp }); made += cp; inCoin(n, cp, 1); }
    if (n.qty > had) { const k = n.qty - had, cp = k * buyPrice(next, n); bought.push({ name: n.name, n: k, cp }); spent += cp; inCoin(n, cp, -1); }
    return { ...n, everSold: old?.everSold };
  });
  purse = Object.fromEntries(COINS.map(c => [c, Math.round(purse[c] * 100) / 100]));
  next.purse = purse; delete next.gold;
  // three months in a row: a stall closes (low) or becomes a building (high); a building drops to a stall (low).
  // Starting the month in debt counts as a bad month too, the same as a Quality 1–2 roll.
  const low = q <= 2 || shopCp(shop) < 0;
  next.lowRun = low ? (shop.lowRun || 0) + 1 : 0;
  next.highRun = low ? 0 : (shop.highRun || 0) + 1;
  let change = '';
  if (shop.form === 'stall' && next.lowRun >= 3) { next.status = 'closed'; change = 'closed'; }
  else if (shop.form === 'stall' && next.highRun >= 3) { next.form = 'building'; next.highRun = 0; change = 'upgraded'; }
  else if (shop.form === 'building' && next.lowRun >= 3) { next.form = 'stall'; next.lowRun = 0; change = 'downgraded'; }
  return { shop: next, sold, bought, made, spent, quality: q, change, debt: shopCp(shop) < 0 };
}

/* ---------- the party at a shop ---------- */
/**
 * A player buys n of an item with the coins in their purse: stock down, the player's coins into the shop's purse and
 * change back out of it. Returns { shop, cp, give, change, item } or { error }.
 */
export function sale(shop, itemId, n, playerPurse) {
  const it = shop.items.find(x => x.id === itemId);
  if (!it) return { error: "That item isn't here any more." };
  if (it.qty != null && it.qty < n) return { error: it.qty ? `They only have ${it.qty}.` : "It's sold out." };
  const cp = n * sellPrice(shop, it, shop.haggleWon);
  const pay = settle(playerPurse, purseOf(shop), cp);
  if (pay.error) return pay;
  const items = shop.items.map(x => (x.id === itemId ? { ...x, qty: x.qty == null ? null : x.qty - n, everSold: x.unique ? true : x.everSold } : x));
  const purse = addCoins(addCoins(purseOf(shop), pay.give), pay.change, -1);
  return { shop: { ...shop, items, purse }, cp, give: pay.give, change: pay.change, item: it };
}
/** A player sells n of an item the shop stocks: stock up, and the shop pays from what it has (biggest coins first). */
export function purchase(shop, name, n = 1) {
  const it = shop.items.find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!it) return { error: `${shop.name || shop.type} doesn't buy that.` };
  const cp = n * buyPrice(shop, it, shop.haggleWon);
  const paid = payFrom(purseOf(shop), cp);
  if (!paid) return { error: shopCp(shop) < cp ? `${shop.name || shop.type} can't afford it right now.` : `${shop.name || shop.type} doesn't have the right coins to pay that exactly.` };
  const items = shop.items.map(x => (x.id === it.id ? { ...x, qty: x.qty == null ? null : x.qty + n } : x));
  return { shop: { ...shop, items, purse: addCoins(purseOf(shop), paid, -1) }, cp, paid, item: it };
}
