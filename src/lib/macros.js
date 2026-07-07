import { FLOUR_WORDS } from './constants.js'

// Approximate nutritional factors per 100g of ingredient type
export const NUTRIENT_DB = {
  flour: { fat: 1.2, water: 14, sugar: 1.5, protein: 12, carbs: 72, cal: 340, flourEq: 100, freeWater: 14 },
  butter: { fat: 80, water: 16, sugar: 0, protein: 1, carbs: 0, cal: 720, flourEq: 0, freeWater: 0 },
  egg: { fat: 10, water: 74, sugar: 0.4, protein: 13, carbs: 1, cal: 155, flourEq: 0, freeWater: 20 },
  sugar: { fat: 0, water: 0, sugar: 100, protein: 0, carbs: 100, cal: 387, flourEq: 0, freeWater: 0 },
  milk: { fat: 3.5, water: 88, sugar: 5, protein: 3.4, carbs: 5, cal: 61, flourEq: 0, freeWater: 88 },
  cream: { fat: 35, water: 58, sugar: 3, protein: 2.5, carbs: 3, cal: 340, flourEq: 0, freeWater: 30 },
  salt: { fat: 0, water: 0, sugar: 0, protein: 0, carbs: 0, cal: 0, flourEq: 0, freeWater: 0 },
  yeast: { fat: 1.5, water: 70, sugar: 0, protein: 40, carbs: 18, cal: 105, flourEq: 0, freeWater: 70 },
  honey: { fat: 0, water: 17, sugar: 82, protein: 0.3, carbs: 82, cal: 304, flourEq: 0, freeWater: 10 },
  chocolate: { fat: 32, water: 1, sugar: 48, protein: 8, carbs: 55, cal: 546, flourEq: 0, freeWater: 0 },
  oil: { fat: 100, water: 0, sugar: 0, protein: 0, carbs: 0, cal: 884, flourEq: 0, freeWater: 0 },
  water: { fat: 0, water: 100, sugar: 0, protein: 0, carbs: 0, cal: 0, flourEq: 0, freeWater: 100 },
  egg_yolk: { fat: 27, water: 49, sugar: 0.5, protein: 16, carbs: 1, cal: 322, flourEq: 0, freeWater: 20 },
  molasses: { fat: 0, water: 22, sugar: 75, protein: 0, carbs: 75, cal: 290, flourEq: 0, freeWater: 15 },
  sourdough: { fat: 1, water: 44, sugar: 0.5, protein: 7, carbs: 45, cal: 220, flourEq: 50, freeWater: 0 },
  biga: { fat: 1, water: 42, sugar: 0.5, protein: 8, carbs: 46, cal: 225, flourEq: 60, freeWater: 0 },
  poolish: { fat: 1, water: 50, sugar: 0.5, protein: 7, carbs: 44, cal: 215, flourEq: 50, freeWater: 0 },
}

export function detectIngType(name) {
  const s = (name || '').toLowerCase()
  if (FLOUR_WORDS.some((k) => s.includes(k))) return 'flour'
  if (['butter', 'beurre', 'mantequilla', 'burro', 'margarine', 'margarina'].some((k) => s.includes(k))) return 'butter'
  if (['tuorlo', 'yolk', 'jaune', 'yema'].some((k) => s.includes(k))) return 'egg_yolk'
  if (['egg', 'uovo', 'huevo', 'oeuf', 'uova'].some((k) => s.includes(k))) return 'egg'
  if (['sugar', 'sucre', 'azucar', 'zucchero', 'saccharose', 'castor', 'caster'].some((k) => s.includes(k))) return 'sugar'
  if (['milk', 'lait', 'leche', 'latte', 'buttermilk', 'latticello'].some((k) => s.includes(k))) return 'milk'
  if (['cream', 'creme', 'nata', 'panna'].some((k) => s.includes(k))) return 'cream'
  if (['salt', 'sel', 'sal', 'sale'].some((k) => s.includes(k))) return 'salt'
  if (['honey', 'miel', 'miele'].some((k) => s.includes(k))) return 'honey'
  if (['oil', 'olio', 'aceite', 'huile'].some((k) => s.includes(k))) return 'oil'
  if (['water', 'agua', 'eau', 'acqua'].some((k) => s.includes(k))) return 'water'
  if (
    ['yeast', 'levure', 'levadura', 'lievito'].some((k) => s.includes(k)) &&
    !s.includes('sourdough') && !s.includes('madre') && !s.includes('naturale') && !s.includes('levain')
  ) return 'yeast'
  if (['sourdough', 'starter', 'madre', 'naturale', 'levain', 'lievito madre', 'pasta madre', 'pms', 'poolish', 'biga', 'lievitino'].some((k) => s.includes(k))) return 'sourdough'
  if (['chocolate', 'cacao', 'cocoa', 'chocolat'].some((k) => s.includes(k))) return 'chocolate'
  if (['malt', 'malto', 'malz'].some((k) => s.includes(k))) return 'flour'
  return 'other'
}

function libParamsToDb(params) {
  const p = params
  return {
    fat: p.fat_pct != null ? p.fat_pct : (p.fat || 0),
    water: p.water_pct != null ? p.water_pct : (p.water || 0),
    sugar: p.sugar_pct != null ? p.sugar_pct : (p.sugar || 0),
    protein: p.protein_pct != null ? p.protein_pct : (p.protein || 0),
    carbs: p.carbs_pct != null ? p.carbs_pct : (p.carbs || 0),
    cal: p.cal_per100 != null ? p.cal_per100 : (p.cal || 0),
    flourEq: p.flour_equivalent_pct != null ? p.flour_equivalent_pct : (p.flourEq || 0),
    freeWater: p.free_water_pct != null ? p.free_water_pct : (p.freeWater || 0),
  }
}

export function calcMacros(ingredients, aiCache, libData) {
  if (!ingredients || !ingredients.length) {
    return { fat: 0, water: 0, sugar: 0, protein: 0, carbs: 0, cal: 0, total: 0, hydration: 0, bakersHydration: 0, fatP: 0, sugarP: 0, saltP: 0, saltG: 0, flourEqG: 0, freeWaterG: 0 }
  }
  let fat = 0, water = 0, sugar = 0, protein = 0, carbs = 0, cal = 0, saltG = 0, total = 0, flourEqG = 0, freeWaterG = 0
  for (const ing of ingredients) {
    const grams = parseFloat(ing.qty) || 0
    if (!grams) continue
    total += grams
    const nm = (ing.name || '').toLowerCase().trim()
    let db = null
    if (libData && libData.length) {
      const libMatch = libData.find((lib) => {
        const cn = (lib.canonical_name || '').toLowerCase()
        const nm2 = (lib.name || '').toLowerCase()
        if (nm === cn || nm === nm2) return true
        if (nm.length > 3 && (cn.includes(nm) || nm.includes(cn))) return true
        if (nm.length > 3 && (nm2.includes(nm) || nm.includes(nm2))) return true
        const aliases = lib.aliases || []
        return aliases.some((a) => { const al = a.toLowerCase(); return nm === al || (nm.length > 3 && (al.includes(nm) || nm.includes(al))) })
      })
      if (libMatch && libMatch.params && Object.keys(libMatch.params).length > 0) db = libParamsToDb(libMatch.params)
    }
    if (!db && aiCache) {
      const cacheKey = Object.keys(aiCache).find((k) => nm.includes(k.toLowerCase()) || k.toLowerCase().includes(nm))
      if (cacheKey) db = libParamsToDb(aiCache[cacheKey])
    }
    if (!db) {
      const t = detectIngType(ing.name)
      db = NUTRIENT_DB[t] || NUTRIENT_DB.other
    }
    fat += grams * (db.fat / 100)
    water += grams * (db.water / 100)
    sugar += grams * (db.sugar / 100)
    protein += grams * (db.protein / 100)
    carbs += grams * (db.carbs / 100)
    cal += grams * (db.cal / 100)
    saltG += detectIngType(ing.name) === 'salt' ? grams : 0
    flourEqG += grams * (db.flourEq / 100)
    freeWaterG += grams * (db.freeWater / 100)
  }
  const hydration = total > 0 ? Math.round((water / total) * 1000) / 10 : 0
  const bh = flourEqG > 0 ? Math.round((freeWaterG / flourEqG) * 1000) / 10 : 0
  return {
    fat: Math.round(fat * 10) / 10,
    water: Math.round(water * 10) / 10,
    sugar: Math.round(sugar * 10) / 10,
    protein: Math.round((protein / total) * 1000) / 10,
    carbs: Math.round((carbs / total) * 1000) / 10,
    cal: Math.round(cal),
    total: Math.round(total),
    hydration,
    bakersHydration: bh,
    fatP: Math.round((fat / total) * 1000) / 10,
    sugarP: Math.round((sugar / total) * 1000) / 10,
    saltP: Math.round((saltG / total) * 1000) / 10,
    saltG: Math.round(saltG * 10) / 10,
    flourEqG: Math.round(flourEqG),
    freeWaterG: Math.round(freeWaterG),
  }
}
