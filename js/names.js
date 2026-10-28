// The DM's Perspective — Shops: shopkeepers and shop names, rolled from original word lists (nothing from any book).
import { d, between } from './rules.js';
const pick = list => list[d(list.length) - 1];

// Name parts by people (all invented for this app). Each name is a start and an end, so the same people sound alike.
const PARTS = {
  human: { a: ['Al', 'Bran', 'Cor', 'Dar', 'Ed', 'Fen', 'Gar', 'Hal', 'Jor', 'Kel', 'Lor', 'Mar', 'Ned', 'Os', 'Per', 'Ros', 'Sel', 'Tam', 'Ul', 'Wil', 'Ad', 'Bel', 'Cal', 'Em', 'Har', 'Isa', 'Lin', 'Mer', 'Nor', 'Ver'],
    b: ['ric', 'den', 'win', 'mund', 'wyn', 'ton', 'ard', 'bert', 'el', 'ra', 'na', 'ly', 'beth', 'ford', 'ias', 'is', 'ion', 'ette', 'ina', 'rick'],
    sur: ['Ashford', 'Brightwater', 'Coldbrook', 'Dunmore', 'Fairweather', 'Greaves', 'Hallowell', 'Ironside', 'Marsh', 'Oakhart', 'Pell', 'Redmane', 'Stonebridge', 'Thatcher', 'Underwood', 'Vance', 'Whitlock', 'Yarrow'] },
  dwarf: { a: ['Bram', 'Dorn', 'Grav', 'Hruk', 'Kaz', 'Mord', 'Ost', 'Rag', 'Skar', 'Thrum', 'Vog', 'Brek', 'Durga', 'Helga', 'Ketta', 'Runa', 'Sigra', 'Tova'],
    b: ['ok', 'dal', 'rim', 'gat', 'mek', 'vor', 'nda', 'hild', 'ka', 'run', 'stad', 'bek'],
    sur: ['Anvilsong', 'Coalbrow', 'Deepkettle', 'Flintgrip', 'Granitehold', 'Ironbellow', 'Orefinder', 'Slatebeard', 'Stoutmantle', 'Copperseam', 'Rivetjaw', 'Tunnelwise'] },
  elf: { a: ['Ae', 'Ar', 'Cael', 'El', 'Fae', 'Ith', 'Lae', 'Mir', 'Nai', 'Syl', 'Tha', 'Va', 'Ys', 'Ili', 'Lu', 'Sae', 'Ely', 'Ri', 'Orae', 'Thie'],
    b: ['thir', 'riel', 'lion', 'wen', 'dris', 'nael', 'ndra', 'vyr', 'lis', 'sara', 'thas', 'rion', 'neth', 'liel', 'vain', 'esse'],
    sur: ['Brightleaf', 'Duskwhisper', 'Evenfall', 'Moonbrook', 'Silverfrond', 'Starglade', 'Thornsong', 'Dewmantle', 'Leafsilver', 'Mistwillow'] },
  halfling: { a: ['Bil', 'Bun', 'Cor', 'Dil', 'Fin', 'Lav', 'Mer', 'Pip', 'Ros', 'Tob', 'Wil', 'Cam', 'Ned', 'Pol', 'Lil', 'Mae', 'Hob', 'Tansy'],
    b: ['bo', 'do', 'ly', 'rin', 'kin', 'pie', 'ry', 'ta', 'ella', 'mer', 'nie', 'wick'],
    sur: ['Applewick', 'Barleyfoot', 'Bramblecup', 'Hearthbuckle', 'Kettlesworth', 'Mossbottom', 'Puddlefoot', 'Quickbread', 'Sweetbriar', 'Thistledown'] },
  gnome: { a: ['Bim', 'Bod', 'Fon', 'Glim', 'Orr', 'Zook', 'Bree', 'Cara', 'Nis', 'Tana', 'Wyn', 'Zan', 'Pell', 'Quib', 'Tink', 'Dabb'],
    b: ['ston', 'ble', 'kin', 'dle', 'fiz', 'wick', 'nock', 'bry', 'yx', 'nella', 'zee', 'pip'],
    sur: ['Cogsworth', 'Fizzlebang', 'Gearwhistle', 'Lampwick', 'Puzzlebrook', 'Sprocketeer', 'Tinkerspan', 'Wobblecap', 'Glimmerdell', 'Spindlenose'] },
  orc: { a: ['Grak', 'Dur', 'Mog', 'Ruk', 'Thrag', 'Vor', 'Zug', 'Bash', 'Agra', 'Gorza', 'Mazh', 'Shura', 'Ulga', 'Yazra', 'Krel', 'Ozk'],
    b: ['', 'a', 'ar', 'ug', 'osh', 'ka', 'nar', 'gul', 'esh', 'ra'],
    sur: ['Bonebreaker', 'Grimtusk', 'Ironjaw', 'Redfang', 'Stormhide', 'Ashfist', 'Hardscar', 'Wolfsong'] },
  dragonborn: { a: ['Ark', 'Bhal', 'Drav', 'Ghes', 'Ixa', 'Kor', 'Myrr', 'Qor', 'Rhyx', 'Sar', 'Thrae', 'Vax', 'Zhan', 'Arra', 'Kesh', 'Sorra', 'Tyrra', 'Vexa'],
    b: ['ghar', 'esh', 'rath', 'zarr', 'ixa', 'aan', 'ok', 'ira', 'unth', 'essa', 'oth', 'yrr'],
    sur: ['Ashenscale', 'Brightclaw', 'Cinderwing', 'Dawnhorn', 'Emberjaw', 'Frostcrest', 'Stormtalon', 'Thunderbreath'] },
  tiefling: { a: ['Az', 'Bel', 'Cal', 'Dra', 'Er', 'Ka', 'Mal', 'Nyx', 'Or', 'Ras', 'Sev', 'Vel', 'Xan', 'Zar', 'Lili', 'Mor'],
    b: ['eth', 'ira', 'oth', 'ael', 'ix', 'una', 'ius', 'enna', 'ox', 'ara', 'ys', 'el'],
    sur: ['Ashveil', 'Cinder', 'Dusk', 'Ember', 'Hollow', 'Mourn', 'Sorrow', 'Torment', 'Vesper', 'Whisper'] },
  goliath: { a: ['Ak', 'Bru', 'Ganu', 'Hak', 'Kau', 'Lo', 'Mahu', 'Nok', 'Pau', 'Rau', 'Tahu', 'Vau', 'Ula', 'Ika', 'Sefa', 'Tolu'],
    b: ['ra', 'ki', 'lo', 'nu', 'tha', 'ka', 'mi', 'ro'],
    sur: ['Cliffwalker', 'Peakseeker', 'Stonehewn', 'Skyreach', 'Snowstrider', 'Boulderback', 'Thundercall', 'Longstride'] },
};
// People in each edition (2014 races / 2024 species), with typical adult ages from the SRD's descriptions
export const PEOPLES = {
  2014: ['Human', 'Dwarf', 'Elf', 'Halfling', 'Gnome', 'Half-Elf', 'Half-Orc', 'Dragonborn', 'Tiefling'],
  2024: ['Human', 'Dwarf', 'Elf', 'Halfling', 'Gnome', 'Orc', 'Dragonborn', 'Tiefling', 'Goliath'],
};
const AGES = { Human: [18, 75], Dwarf: [50, 300], Elf: [100, 650], Halfling: [20, 140], Gnome: [40, 400], 'Half-Elf': [20, 170], 'Half-Orc': [14, 70], Orc: [14, 70], Dragonborn: [15, 75], Tiefling: [18, 90], Goliath: [18, 85] };
const FAMILY = { Human: 'human', Dwarf: 'dwarf', Elf: 'elf', Halfling: 'halfling', Gnome: 'gnome', 'Half-Elf': ['human', 'elf'], 'Half-Orc': ['orc', 'human'], Orc: 'orc', Dragonborn: 'dragonborn', Tiefling: 'tiefling', Goliath: 'goliath' };
export const GENDERS = ['Male', 'Female', 'Nonbinary'];

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export function nameFor(race) {
  let fam = FAMILY[race] || 'human';
  if (Array.isArray(fam)) fam = pick(fam);
  const p = PARTS[fam];
  const first = cap(pick(p.a) + pick(p.b));
  const sur = p.sur.length && d(4) > 1 ? ` ${pick(p.sur)}` : '';
  return first + sur;
}
export const ageFor = race => { const [lo, hi] = AGES[race] || AGES.Human; return between(lo, hi); };

// Descriptors: two or three, a mix of manner and look
const MANNER = ['soft-spoken', 'loud and cheerful', 'suspicious of strangers', 'haggles out of habit', 'never stops talking', 'painfully honest', 'quick to flatter',
  'easily flustered', 'dry humor', 'grumbles constantly', 'superstitious', 'proud of every item', 'absent-minded', 'shrewd bargainer', 'nervous laugh', 'warm and motherly',
  'gruff but fair', 'always busy', 'gossips about everyone', 'deeply religious', 'collects odd trinkets', 'quotes old proverbs', 'hums while working', 'distracted by a pet',
  'sizes up every coin purse', 'patient teacher', 'short-tempered', 'loves a good story', 'tired and overworked', 'secretly in debt'];
const LOOK = ['ink-stained fingers', 'burn scars on both hands', 'missing two fingers', 'spectacles on a chain', 'braided beard with beads', 'smells of herbs',
  'apron full of pockets', 'heavy gold earrings', 'limps on the left leg', 'a pipe always lit', 'weathered, sunburnt face', 'immaculately dressed', 'tattooed forearms',
  'a booming laugh', 'chipped front tooth', 'eye patch', 'silver-streaked hair', 'flour on everything', 'calloused hands', 'wears too many rings'];
export function descriptorsFor() {
  const out = new Set([pick(MANNER), pick(LOOK)]);
  if (d(2) === 2) out.add(pick(d(2) === 1 ? MANNER : LOOK));
  return [...out].join(', ');
}

// Shop names, by kind of shop
const NOUNS = {
  Alchemist: ['Cauldron', 'Retort', 'Phial', 'Mortar', 'Elixir', 'Alembic', 'Tincture'], Artificer: ['Gear', 'Cog', 'Spring', 'Workbench', 'Tinker', 'Lens', 'Clockwork'],
  'Black Market': ['Shadow', 'Back Door', 'Mask', 'Whisper', 'Lantern', 'Cellar', 'Rat'], Blacksmith: ['Anvil', 'Hammer', 'Forge', 'Tongs', 'Bellows', 'Ingot', 'Blade'],
  'Books & Tomes': ['Quill', 'Page', 'Tome', 'Scroll', 'Inkwell', 'Library', 'Bookend'], Fashion: ['Needle', 'Thread', 'Bolt', 'Thimble', 'Button', 'Loom', 'Velvet'],
  Fletcher: ['Arrow', 'Fletching', 'Quiver', 'Bowstring', 'Feather', 'Yew', 'Target'], 'Food & Drink': ['Tankard', 'Kettle', 'Loaf', 'Barrel', 'Hearth', 'Spoon', 'Goose'],
  Furniture: ['Chair', 'Plank', 'Chest', 'Oak', 'Lathe', 'Joint', 'Cabinet'], General: ['Sundries', 'Crate', 'Scale', 'Lantern', 'Wagon', 'Pack', 'Counter'],
  Instruments: ['Lute', 'Drum', 'Fiddle', 'Note', 'Harp', 'Horn', 'Chord'], Jewelry: ['Gem', 'Ring', 'Facet', 'Locket', 'Pearl', 'Setting', 'Gleam'],
  Stables: ['Horseshoe', 'Saddle', 'Bridle', 'Stall', 'Mare', 'Hay', 'Hitching Post'], Tattoo: ['Needle', 'Ink', 'Mark', 'Brand', 'Sigil', 'Rune', 'Canvas'],
  Temple: ['Candle', 'Altar', 'Censer', 'Chalice', 'Bell', 'Halo', 'Vigil'],
};
const ADJ = ['Gilded', 'Rusty', 'Silver', 'Crooked', 'Merry', 'Iron', 'Copper', 'Wandering', 'Quiet', 'Golden', 'Bent', 'Lucky', 'Old', 'Honest', 'Hidden', 'Painted', 'Laughing', 'Weary', 'Bright', 'Frosted'];
const KIND_WORD = { Alchemist: 'Apothecary', Artificer: 'Workshop', 'Black Market': 'Exchange', Blacksmith: 'Smithy', 'Books & Tomes': 'Books', Fashion: 'Tailor', Fletcher: 'Bowyer',
  'Food & Drink': 'Kitchen', Furniture: 'Joinery', General: 'Goods', Instruments: 'Music', Jewelry: 'Jewelers', Stables: 'Stables', Tattoo: 'Parlor', Temple: 'Shrine' };
export function shopNameFor(type, keeperName = '') {
  const n = NOUNS[type] || NOUNS.General, k = KIND_WORD[type] || 'Shop';
  const first = String(keeperName).split(' ')[0];
  switch (d(5)) {
    case 1: return `The ${pick(ADJ)} ${pick(n)}`;
    case 2: return first ? `${first}'s ${k}` : `The ${pick(ADJ)} ${pick(n)}`;
    case 3: { const x = pick(n); return `${x} & ${pick(n.filter(y => y !== x))}`; }
    case 4: { const x = pick(n); return `The ${x} and ${pick(n.filter(y => y !== x))}`; }
    default: return `${pick(ADJ)} ${pick(n)} ${k}`;
  }
}

/** A whole shopkeeper: { name, gender, race, age, desc } (any field can be rolled again on its own) */
export function keeperFor(edition = '2014', extraRaces = []) {
  const races = [...(PEOPLES[edition] || PEOPLES[2014]), ...extraRaces];
  const race = pick(races);
  return { name: nameFor(race), gender: pick(GENDERS), race, age: ageFor(race), desc: descriptorsFor() };
}
