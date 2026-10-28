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
/** Starting gold (only when the shop first opens): 3–8 × 20 / 50 / 100 / 250 / 500 gp by quality, in copper. */
const GOLD = [20, 50, 100, 250, 500];
export const rollGold = (q, table = GOLD) => between(3, 8) * (table?.[q - 1] ?? GOLD[q - 1]) * 100;

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
    gold: rollGold(quality, goldTable), priceMod: rollPriceMod(), haggle: rollHaggle(quality), haggleWon: false,
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
  next.items = fresh.map(n => {
    const old = shop.items.find(x => x.name === n.name);
    const had = old ? old.qty : 0;
    if (n.qty == null || had == null) return { ...n, qty: n.qty };
    if (n.qty < had) { const k = had - n.qty, cp = k * sellPrice(next, n); sold.push({ name: n.name, n: k, cp }); made += cp; }
    if (n.qty > had) { const k = n.qty - had, cp = k * buyPrice(next, n); bought.push({ name: n.name, n: k, cp }); spent += cp; }
    return { ...n, everSold: old?.everSold };
  });
  next.gold = (shop.gold || 0) + made - spent;
  // three months in a row: a stall closes (low) or becomes a building (high); a building drops to a stall (low)
  const low = q <= 2;
  next.lowRun = low ? (shop.lowRun || 0) + 1 : 0;
  next.highRun = low ? 0 : (shop.highRun || 0) + 1;
  let change = '';
  if (shop.form === 'stall' && next.lowRun >= 3) { next.status = 'closed'; change = 'closed'; }
  else if (shop.form === 'stall' && next.highRun >= 3) { next.form = 'building'; next.highRun = 0; change = 'upgraded'; }
  else if (shop.form === 'building' && next.lowRun >= 3) { next.form = 'stall'; next.lowRun = 0; change = 'downgraded'; }
  return { shop: next, sold, bought, made, spent, quality: q, change };
}

/* ---------- the party at a shop ---------- */
/** A player buys n of an item: the shop's stock goes down and its gold up. Returns { shop, cp } or { error }. */
export function sale(shop, itemId, n = 1) {
  const it = shop.items.find(x => x.id === itemId);
  if (!it) return { error: "That item isn't here any more." };
  if (it.qty != null && it.qty < n) return { error: it.qty ? `They only have ${it.qty}.` : "It's sold out." };
  const cp = n * sellPrice(shop, it, shop.haggleWon);
  const items = shop.items.map(x => (x.id === itemId ? { ...x, qty: x.qty == null ? null : x.qty - n, everSold: x.unique ? true : x.everSold } : x));
  return { shop: { ...shop, items, gold: (shop.gold || 0) + cp }, cp, item: it };
}
/** A player sells n of an item the shop stocks: stock up, gold down (if the shop can pay). */
export function purchase(shop, name, n = 1) {
  const it = shop.items.find(x => x.name.toLowerCase() === String(name).toLowerCase());
  if (!it) return { error: `${shop.name || shop.type} doesn't buy that.` };
  const cp = n * buyPrice(shop, it, shop.haggleWon);
  if (cp > (shop.gold || 0)) return { error: `${shop.name || shop.type} can't afford it right now.` };
  const items = shop.items.map(x => (x.id === it.id ? { ...x, qty: x.qty == null ? null : x.qty + n } : x));
  return { shop: { ...shop, items, gold: shop.gold - cp }, cp, item: it };
}
