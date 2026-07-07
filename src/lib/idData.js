export function parseIdData(raw) {
  if (!raw) return { sensory: {}, versions: [], goal: '', nutritionOverride: null }
  try {
    return JSON.parse(raw)
  } catch {
    return { sensory: {}, versions: [], goal: '', nutritionOverride: null }
  }
}

export const serializeIdData = (d) => JSON.stringify(d)
