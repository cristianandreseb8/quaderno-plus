import { supabase } from './supabase.js'

function stripForApi(recipe) {
  if (!recipe) return recipe
  const { thumbnail, source_photos, media_library, ...rest } = recipe
  return rest
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('extract-recipe', { body })
  if (error) {
    // The function answers failures with {error: "..."}; surface that instead of the generic
    // "Edge Function returned a non-2xx status code".
    let msg = error.message
    try {
      const j = await error.context?.json?.()
      if (j?.error) msg = j.error
    } catch (_) {
      const status = error.context?.status
      if (status === 504 || status === 546) msg = 'The AI took too long to answer'
    }
    const err = new Error(msg)
    err.status = error.context?.status
    throw err
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const extractWithClaude = (images) => invoke({ images })
export const structureText = (text) => invoke({ type: 'structure', text })
export const translateRecipe = (recipe, targetLang) => invoke({ type: 'translate', recipe: stripForApi(recipe), targetLang })
export const askAssistant = (msgs, recipe, language) =>
  invoke({ type: 'assistant', messages: msgs.map((m) => ({ role: m.role, content: m.content })), recipe: stripForApi(recipe), language })
export const askAppAssistant = (msgs, recipes) =>
  invoke({
    type: 'app_assistant',
    messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    recipes: recipes.map((r) => ({ id: r.id, title: r.title, category: r.category, time: r.time, servings: r.servings })),
  })
export const aiSuggestNotes = (recipe, currentNotes) => invoke({ type: 'ai_suggest_notes', recipe: stripForApi(recipe), currentNotes })
export const analyzeMacros = (recipeTitle, ingredients) => invoke({ type: 'analyze_macros', recipe_title: recipeTitle, ingredients })
export const analyzeCustomParam = (recipeTitle, ingredients, existingMacros, paramLabel) =>
  invoke({ type: 'analyze_custom_param', recipe_title: recipeTitle, ingredients, existing_macros: existingMacros, param_label: paramLabel })
export const autoCategorize = (recipes) => invoke({ type: 'auto_categorize', recipes })
export const categorizeIngredients = (ingredients, knownCategories) =>
  invoke({ type: 'categorize_ingredients', ingredients, known_categories: knownCategories })
export const describeIngredient = (name, ingredientType) =>
  invoke({ type: 'describe_ingredient', name, ingredient_type: ingredientType })
export const extractPdfRecipes = (params) => invoke({ type: 'extract_pdf', ...params })
