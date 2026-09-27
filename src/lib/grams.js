// Typical weights, so every ingredient line counts in totals and baker's % — not only the ones
// written in grams. "1 egg" is about 50 g, "1 tsp salt" about 6 g, "1 cup flour" about 127 g.
// The numbers are kitchen approximations; a weight printed on the line itself always wins.

const norm = (s) => String(s || '').toLowerCase()
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`´]/g, "'")

// ── Units ────────────────────────────────────────────────────────────────────
const MASS = {
  g: 1, gr: 1, grs: 1, gram: 1, grams: 1, gramo: 1, gramos: 1, grammo: 1, grammi: 1, gramm: 1, gramme: 1, grammes: 1,
  kg: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000, kilogramo: 1000, kilogramos: 1000,
  mg: 0.001, oz: 28.35, ounce: 28.35, ounces: 28.35, onza: 28.35, onzas: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6, libra: 453.6, libras: 453.6,
}
// Millilitres per unit. Metric volumes are exact; spoons and cups are the usual measures.
const METRIC_VOLUME = {
  ml: 1, cc: 1, cm3: 1, cl: 10, dl: 100, l: 1000, lt: 1000, ltr: 1000,
  liter: 1000, liters: 1000, litre: 1000, litres: 1000, litro: 1000, litros: 1000, litri: 1000,
}
const KITCHEN_VOLUME = {
  tsp: 5, tsps: 5, teaspoon: 5, teaspoons: 5, tl: 5, cdta: 5, cdtas: 5, cucharadita: 5, cucharaditas: 5,
  cucchiaino: 5, cucchiaini: 5, cac: 5,
  tbsp: 15, tbsps: 15, tbs: 15, tbl: 15, tablespoon: 15, tablespoons: 15, el: 15, cda: 15, cdas: 15,
  cucharada: 15, cucharadas: 15, cucchiaio: 15, cucchiai: 15, cs: 15, cas: 15,
  cup: 240, cups: 240, taza: 240, tazas: 240, tz: 240, tasse: 240, tassen: 240,
  dash: 0.6, dashes: 0.6, splash: 5, chorrito: 5, schuss: 5,
}
// Small amounts that are weighed by eye.
const TINY = {
  pinch: 0.4, pinches: 0.4, pizca: 0.4, pizcas: 0.4, pizzico: 0.4, pizzichi: 0.4, pincee: 0.4, pincees: 0.4, prise: 0.4, prisen: 0.4,
  handful: 15, handfuls: 15, handvoll: 15, punado: 15, punados: 15, manciata: 15, poignee: 15,
  bunch: 40, bunches: 40, bund: 40, manojo: 40, manojos: 40, atado: 40, mazzo: 40, mazzetto: 40, botte: 40,
}
const PACKET = new Set(['sobre', 'sobres', 'packet', 'packets', 'package', 'sachet', 'sachets', 'packchen', 'pck', 'pkg', 'bustina', 'bustine', 'bolsita'])
// Words that only say "this many pieces".
const COUNT = new Set(['unidad', 'unidades', 'ud', 'uds', 'u', 'un', 'una', 'pc', 'pcs', 'pz', 'pezzo', 'pezzi', 'piece', 'pieces', 'stk', 'stuck', 'st', 'whole', 'n'])

const unitKind = (u) => {
  const k = norm(u).replace(/\./g, '') // "c.à.s" → "cas", "gr." → "gr"
  if (!k) return null
  if (MASS[k]) return 'mass'
  if (METRIC_VOLUME[k]) return 'metric'
  if (KITCHEN_VOLUME[k]) return 'kitchen'
  if (TINY[k]) return 'tiny'
  if (PACKET.has(k)) return 'packet'
  if (COUNT.has(k)) return 'count'
  return null
}
// True for words the recipe uses as a unit ("g", "TL", "cucharadita", "ud") — false for words that
// are part of the name ("large", "rote", "uova").
export const isUnitWord = (u) => unitKind(u) !== null

// ── Density (g per ml) for spoons and cups, by what the ingredient is ────────
// First match wins, so specific names come before general ones ("unsalted butter" is butter,
// not salt; "brown sugar" before "sugar"; "sesame oil" before "sesame").
const DENSITY = [
  [/chantilly|whipped cream|nata montada|panna montata|creme fouettee/, 0.4],
  [/brown sugar|azucar (rubia|morena|moreno|mascabado)|zucchero (di canna|bruno|integrale)|cassonade|brauner zucker|rohrzucker|muscovado|panela|chancaca/, 0.93],
  [/icing|powdered sugar|confectioner|impalpable|azucar (flor|glas|glass|glace)|zucchero a velo|sucre glace|puderzucker/, 0.5],
  [/vanill\w* ?zucker|vanilla sugar|azucar (de )?vainill|zucchero vanigliato|sucre vanille/, 0.85],
  [/baking powder|polvos? (de )?hornear|backpulver|back ?pulver|levure chimique|lievito (per dolci|chimico|istantaneo)|royal/, 0.8],
  [/baking soda|bicarbonat|natron/, 1.1],
  [/cream of tartar|cremor|weinstein|creme de tartre/, 0.6],
  [/espresso powder|instant coffee|cafe (instantaneo|soluble)|caffe solubile|nescafe|pulverkaffee/, 0.35],
  [/vinegar|vinagre|aceto|vinaigre|essig|\bsauce\b|\bsalsa\b|\bsoy\b|\bsoja\b|tamari|\bwine\b|\bvino\b|\bvin\b|\bwein\b|water|\bagua\b|acqua|\beau\b|\bwasser\b|juice|\bjugo\b|zumo|succo|\bjus\b|saft|stock|broth|caldo|brodo|bouillon|bruhe|coffee|\bcafe\b|caffe|kaffee|\bbeer\b|cerveza|birra|\bbier\b|liqueur|licor|liquore|\brum\b|\bron\b|brandy|cognac|whisk/, 1.0],
  [/sourdough|levain|lievito (madre|naturale)|masa madre|sauerteig|pasta madre|licoli/, 1.0],
  [/yeast|levadura|lievito|levure|hefe/, 0.6],
  [/condensed|condensada|condensato|kondensmilch/, 1.3],
  [/evaporated|evaporada|evaporato/, 1.03],
  [/butter|mantequilla|burro|beurre|manteca|mandelmus|nussmus/, 0.95],
  [/\boils?\b|aceite|\bolio\b|huile|\bol\b|(oliven|sonnenblumen|raps|sesam|kokos|nuss|walnuss)ol/, 0.92],
  [/cream|crema|panna|creme|sahne|\bnata\b/, 1.0],
  [/milk|leche|latte|\blait\b|milch|buttermilk|yogurt|yoghurt|yogur|joghurt/, 1.03],
  [/honey|\bmiel\b|miele|honig|syrup|sirup|jarabe|sciroppo|glucos|molasses|melaza|treacle|agave|maple|dulce de leche|manjar/, 1.4],
  [/cocoa|cacao|kakao/, 0.42],
  [/cornstarch|corn starch|maizena|maicena|maisstarke|fecula|almidon|amido|starch|arrowroot|tapioca/, 0.55],
  [/flour|harina|farina|mehl|farine|semola|semolina/, 0.53],
  [/oats|avena|avoine|haferflocken/, 0.36],
  [/rice|arroz|\briso\b|\briz\b|reis/, 0.8],
  [/chocolate chips|chips de chocolate|gocce di cioccolato|pepites|schokotropfen|schokostuckchen/, 0.7],
  [/walnut|nuez|nueces|\bnoci\b|\bnoix\b|walnuss|pecan|almond|almendra|mandorl|amande|mandel|hazelnut|avellana|nocciol|noisette|haselnuss|pistach|\bnuts\b|frutos secos/, 0.55],
  [/sesame|sesamo|sesam|chia|flax|linaza|\blino\b|leinsamen|seeds|semillas|\bsemi\b|graines|samen|poppy|amapola|papavero|pavot|mohn/, 0.6],
  [/raisin|pasas|uvetta|rosinen|sultan/, 0.65],
  [/coconut|\bcoco\b|cocco|kokos/, 0.35],
  [/cheese|queso|formaggio|parmigiano|parmesan|fromage|\bkase\b|pecorino|grana/, 0.4],
  [/chocolate|cioccolat|chocolat|schokolade/, 0.7],
  [/zest|ralladura|scorza|zeste|abrieb|schale/, 0.4],
  [/parsley|perejil|prezzemolo|persil|petersilie|cilantro|coriand|koriander|basil|albahaca|basilic|mint|menta|menthe|minze|\bdill\b|eneldo|aneto|aneth|chives|ciboulette|cebollino|erba cipollina|schnittlauch/, 0.25],
  [/oregano|thyme|tomillo|\btimo\b|thym|rosemary|romero|rosmarin|romarin|herbes|italian seasoning|provence|kräuter|krauter/, 0.25],
  [/ginger|jengibre|zenzero|gingembre|ingwer|garlic|\bajo\b|aglio|\bail\b|knoblauch/, 0.6],
  [/paprika|pimenton|cinnamon|canela|cannell|zimt|cumin|comino|cumino|kreuzkummel|pepper|pimienta|\bpepe\b|poivre|pfeffer|chili|\baji\b|merken|curry|piment|turmeric|curcuma|kurkuma|nutmeg|moscada|muscade|muskat|cardamom|clove|clavo|chiodi di garofano|spice|especia|spezie|epice|gewurz|masala|ras el|za.atar|sumac|cayenne|allspice/, 0.45],
  [/mustard|mostaza|senape|moutarde|senf|mayo|mayonesa|mayonnaise|maionese|ketchup|pesto|tahin|peanut butter|\bmus\b/, 1.05],
  [/capers|alcaparra|capperi|capres|kapern/, 0.6],
  [/gelatin|gelatina|gelatine|colapez/, 0.6],
  [/kosher/, 0.6],
  [/salt|\bsal\b|\bsale\b|salz|\bsel\b/, 1.2],
  [/sugar|azucar|zucchero|zucker|sucre/, 0.85],
  [/vanilla|vainilla|vaniglia|vanille/, 0.87],
]
// The ingredient itself comes before any note: "1 TL Salz (für das Kochwasser)" is salt.
const densityOf = (text) => {
  const find = (t) => DENSITY.find(([rx]) => rx.test(t))
  return (find(text.split(/[(,;—]/)[0]) || find(text) || [null, 1])[1]
}

// ── Typical weight of one piece ──────────────────────────────────────────────
// `egg: true` marks eggs, whose size words ("large", "L") are ignored: 50 g is the usual
// weight out of the shell that pastry books assume.
const PIECES = [
  [/egg ?yolks?|\byolks?\b|\byemas?\b|tuorl[oi]|jaunes? d'?oeufs?|^jaunes?\b|eigelb|dotter/, 18, true],
  [/egg ?whites?|\bclaras?\b|albumi?e?\b|\balbumi\b|blancs? d'?oeufs?|eiweiss|eiklar/, 32, true],
  [/\beggs?\b|huevos?|\buov[oa]\b|\boeufs?\b|\beier\b|\bei\b/, 50, true],
  [/heads? (of )?garlic|garlic heads?|cabezas? de ajo|test[ae] d'?aglio|tetes? d'?ail|knoblauchknollen?/, 45],
  [/cloves? (of )?garlic|garlic cloves?|dientes? de ajo|spicch(io|i) d'?aglio|gousses? d'?ail|knoblauchzehen?|zehen? knoblauch/, 5],
  [/vanilla (bean|pod)s?|vainas? de vainilla|baccell[oi] di vaniglia|stecch[ae] di vaniglia|gousses? (de )?vanille|vanilleschoten?/, 4],
  [/sticks? (of )?butter|butter sticks?|\bstick\b.*butter/, 113],
  [/\bknobs?\b|pat of butter|nuez de mantequilla|noce di burro|noix de beurre/, 10],
  [/cinnamon sticks?|(ramas?|rajas?) (de )?canela|stecch[ae] di cannella|batons? de cannelle|zimtstangen?/, 3],
  [/bay lea(f|ves)|hojas? de laurel|\blaurel\b|foglie? di alloro|\balloro\b|feuilles? de laurier|\blaurier\b|lorbeer/, 0.2],
  [/gelatin(e)? (sheets?|leaves?)|sheets? of gelatin|hojas? de (gelatina|colapez)|fogli(o)? di gelatina|feuilles? de gelatine|blatt ?gelatine|gelatineblatt/, 2],
  [/\bsprigs?\b|ramitas?|rametti?|\bbrins?\b|\bzweige?\b/, 1],
  [/spring onions?|scallions?|green onions?|cebollin|cebolletas?|cipollott[oi]|fruhlingszwiebeln?|oignons? (verts|nouveaux)/, 15],
  [/shallots?|chalotas?|echalotes?|scalogn[oi]|schalotten?/, 30],
  [/onions?|cebollas?|cipoll[ae]|oignons?|zwiebeln?/, 150],
  [/garlic|\bajos?\b|aglio|\bail\b|knoblauch/, 5],
  [/carrots?|zanahorias?|carot[ae]|carottes?|karotten?|mohren?/, 70],
  [/cherry tomato(es)?|tomates? cherry|pomodorin[oi]|tomates? cerises?|kirschtomaten?|cocktailtomaten?/, 15],
  [/tomato(es)?|tomates?|pomodor[oi]|tomaten?/, 120],
  [/potato(es)?|\bpapas?\b|patatas?|patat[ae]|pommes? de terre|kartoffeln?/, 170],
  [/avocados?|aguacates?|\bpaltas?\b|avocats?/, 150],
  [/spitzpaprika/, 100],
  [/bell peppers?|pimientos?|peperon[ei]|poivrons?|paprikaschoten?|\bpaprika\b/, 150],
  [/(dried|secos?|secchi|getrocknete?) (chil|chile|aji|peperoncin)|chiles? de arbol|guajillo|ancho chil/, 1],
  [/chil(l)?i(es)?|chiles?|\baji(es)?\b|peperoncin[oi]|piments?|jalapen|chilischoten?/, 15],
  [/zucchin[ie]s?|courgettes?|calabacin|zapallitos?/, 200],
  [/eggplants?|aubergines?|berenjenas?|melanzan[ae]/, 300],
  [/cucumbers?|pepinos?|cetriol[oi]|concombres?|gurken?/, 300],
  [/leeks?|puerros?|\bporri?\b|poireaux?|\blauch\b/, 150],
  [/celery|\bapio\b|sedano|celeri|staudensellerie/, 40],
  [/mushrooms?|champinon|funghi|\bfungo\b|champignons?|pilze?/, 20],
  [/apples?|manzanas?|\bmel[ae]\b|pommes?|apfel/, 180],
  [/bananas?|platanos?|bananen?/, 120],
  [/\bpears?\b|\bperas?\b|\bper[ae]\b|poires?|birnen?/, 170],
  [/pineapples?|\bpinas?\b|ananas/, 1200],
  [/sausages?|frankfurters?|hot ?dogs?|salchichas?|wurstchen|\bwurste?\b|saucisses?|salsicc[ea]/, 60],
  [/chicken breasts?|pechugas? de pollo|pett[oi] di pollo|blancs? de poulet|hahnchenbrust/, 200],
  [/baguettes?/, 250],
  [/marraquetas?|hallullas?|bread rolls?|panecillos?|brotchen|petits? pains?|panini\b/, 100],
  [/(slices?|laminas?|lonchas?|fett[ae]|tranches?|scheiben?) (of |de |di )?(cheese|queso|formaggio|fromage|kase)|cheese slices?|kasescheiben?/, 20],
  [/pecans?|pekannusse|walnuts?|\bnueces\b|almonds?|almendras?|hazelnuts?|avellanas?/, 4],
  [/slices? (of )?bread|rebanadas?|fett[ae] di pane|tranches? de pain|brotscheiben?/, 30],
]
// Citrus: the whole fruit, its juice, or its zest weigh very different amounts.
const CITRUS = [
  [/limes?\b|\blimas?\b|limett[ea]n?|citrons? verts?/, 60, 20, 1],
  [/lemons?|limon(es)?\b|limon[ei]\b|citrons?|zitronen?/, 100, 30, 2],
  [/oranges?|naranjas?|arance|arancia|orangen?/, 180, 80, 4],
]
const JUICE = /juice|jugo|zumo|succo|\bjus\b|saft/
const ZEST = /zest|ralladura|scorza|zeste|abrieb|schale/

function pieceGrams(text) {
  const egg = PIECES.slice(0, 3).find(([rx]) => rx.test(text))
  if (egg) return { g: egg[1], egg: true }
  for (const [rx, whole, juice, zest] of CITRUS) {
    if (rx.test(text)) return { g: JUICE.test(text) ? juice : ZEST.test(text) ? zest : whole, egg: false }
  }
  const hit = PIECES.find(([rx]) => rx.test(text))
  return hit ? { g: hit[1], egg: !!hit[2] } : null
}
// Size words count only in the ingredient itself, not in a note ("2 rolls (or large buns)").
function sizeFactor(full) {
  const text = full.split(/[(,;—]/)[0]
  if (/\b(medium|mediano|mediana|medio|media|moyen|moyenne|mittelgross\w*)\b/.test(text)) return 1
  if (/\b(small|pequen[oa]s?|chic[oa]s?|piccol[oi]|petite?s?|klein\w*)\b/.test(text)) return 0.7
  if (/\b(large|big|grandes?|grand|gross\w*)\b/.test(text)) return 1.3
  return 1
}
function packetGrams(text) {
  if (/vanill/.test(text)) return 8
  if (/baking powder|hornear|back ?pulver|levure chimique|lievito/.test(text) && !/birra|seca|dry|instant|trocken/.test(text)) return 15
  if (/yeast|levadura|lievito|levure|hefe/.test(text)) return 7
  if (/gelatin/.test(text)) return 10
  return 10
}

// ── A weight printed on the line: "(150 g)", "~300 g", "about 1.5–2 kg" ─────
const ANY_UNIT = '(kg|kilos?|grams?|gramos?|grammi|gramm|grammes?|grs?|g|mg|ounces?|onzas?|oz|pounds?|lbs?|ml|cl|dl|l|cc)'
const INLINE_RX = new RegExp(`(\\d+(?:[.,]\\d+)?)(?:\\s*[–-]\\s*(\\d+(?:[.,]\\d+)?))?\\s*${ANY_UNIT}(?![a-z])`)
const EACH_RX = /\b(each|cada un[oa]|c\/u|ciascun[oa]|chacun|chacune|\bje\b|pro stuck)\b/
const num = (s) => parseFloat(String(s).replace(',', '.'))

function inlineGrams(text, name, massOnly = false) {
  const m = text.match(INLINE_RX)
  if (!m || (massOnly && !MASS[m[3]])) return null
  const a = num(m[1]), b = m[2] ? num(m[2]) : a
  const amount = (a + b) / 2, u = m[3]
  if (MASS[u]) return { grams: amount * MASS[u], written: true }
  const d = densityOf(name)
  return { grams: amount * METRIC_VOLUME[u] * d, written: Math.abs(d - 1) <= 0.05 }
}

/**
 * Estimated weight of one ingredient, from parseIng's { qty, unit, name }.
 * Returns { grams, approx }: `approx` is true when the weight is an estimate rather than a
 * weight (or a plain metric volume of a water-like liquid) written in the recipe.
 * grams is 0 when the line cannot be weighed ("salt to taste", an unknown item).
 */
export function estimateGrams({ qty, unit, name }) {
  if (!qty || isNaN(qty) || unit === '%') return { grams: 0, approx: false }
  let u = norm(unit).replace(/\./g, '')
  let text = norm(name)

  // "520 à 560 g jaunes d'œufs", "500 to 600 g flour" — a range; take the middle.
  const rest = ['a', 'to', 'bis'].includes(u) ? text : u === '' ? (text.match(/^(?:a|to|bis|-|–)\s*(.*)$/) || [])[1] : null
  const range = rest && rest.match(/^(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/)
  if (range && unitKind(range[2]) === 'mass') {
    return { grams: ((qty + num(range[1])) / 2) * MASS[range[2]], approx: false }
  }

  // A size or manner word parsed as the unit ("2 large eggs", "1 generous pinch"): fold it back
  // into the name, and use the name's first word as the unit if that is one ("pinch").
  if (u && !unitKind(u)) { text = `${u} ${text}`; u = '' }
  if (!u) {
    const words = text.split(/\s+/)
    // Only real measures ("pinch", "tbsp", "sobre") — never one letter like the egg size "L".
    const at = words.findIndex((w, i) => i < 2 && w.length > 2 && ['kitchen', 'tiny', 'packet'].includes(unitKind(w)))
    if (at >= 0) { u = words[at].replace(/\./g, ''); text = words.filter((_, i) => i !== at).join(' ') }
  }
  const kind = unitKind(u)

  if (kind === 'mass') return { grams: qty * MASS[u], approx: false }

  // A pinch "bloomed in 50 ml water" weighs a pinch: for tiny amounts only a weight counts.
  const inline = inlineGrams(text, text, kind === 'tiny')
  if (inline) return { grams: EACH_RX.test(text) ? inline.grams * qty : inline.grams, approx: !inline.written }

  if (kind === 'metric') {
    const d = densityOf(text)
    return { grams: qty * METRIC_VOLUME[u] * d, approx: Math.abs(d - 1) > 0.05 }
  }
  if (kind === 'kitchen') return { grams: qty * KITCHEN_VOLUME[u] * densityOf(text), approx: true }
  if (kind === 'tiny') return { grams: qty * TINY[u], approx: true }
  if (kind === 'packet') return { grams: qty * packetGrams(text), approx: true }

  // A number of things: eggs, cloves, onions…
  const piece = pieceGrams(text)
  // Pastry sheets sometimes leave out the "g": "470 tuorli" is 470 g of yolks, not 470 yolks.
  if (piece && qty < 100) return { grams: qty * piece.g * (piece.egg ? 1 : sizeFactor(text)), approx: true }
  if (qty >= (piece ? 100 : 20) && kind !== 'count') return { grams: qty, approx: false }
  return { grams: 0, approx: false }
}

// Scale the weights written inside an ingredient's name along with its quantity, so
// "3 eggs (150 g)" becomes "6 eggs (300 g)" — unless they are per piece ("50 g each").
export function scaleInlineWeights(name, factor, fmt) {
  if (EACH_RX.test(norm(name))) return name
  return String(name).replace(
    /(\d+(?:[.,]\d+)?)(\s*[–-]\s*(\d+(?:[.,]\d+)?))?(\s*)(kg|g|gr|grs|grams?|ml|cl|dl|l|oz|ounces?|lbs?|pounds?)(?![A-Za-z])/g,
    (m, a, rangePart, b, sp, unit) => {
      const s = (x) => fmt(num(x) * factor)
      return `${s(a)}${rangePart ? rangePart.replace(b, s(b)) : ''}${sp}${unit}`
    },
  )
}
