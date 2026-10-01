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
export const pdfOutline = (params) => invoke({ type: 'pdf_outline', ...params })
export const pdfRecipe = (params) => invoke({ type: 'pdf_recipe', ...params })
// Short texts into another language ("Papel de horno" → "baking paper"); unchanged when they
// already are in it, or are a brand or a proper name.
export const translateStrings = (items, targetLang) => invoke({ type: 'translate_strings', items, target_lang: targetLang })
// Spelling and grammar: items [{ id, text }] in, only the corrected ones [{ id, text }] back.
export const proofreadTexts = (items) => invoke({ type: 'proofread', items })
// Chef mode's reading of a method: per step, which ingredient lines go in and how much, and which
// earlier preparations it uses (see lib/cookPlan.js).
export const cookPlan = (payload) => invoke({ type: 'cook_plan', ...payload })
// When a recipe's fresh ingredients are in season in a region ("Jan" template): per ingredient
// { name, fresh, months[1–12] } and a note.
export const seasonality = (ingredients, region) => invoke({ type: 'seasonality', ingredients, region })
// A short spoken answer for "Hey chef" (with the recipe on screen, if any).
export const voiceAnswer = (question, recipe, language) => invoke({ type: 'voice_answer', question, recipe: stripForApi(recipe), language })
// A new recipe from a request ("a baguette"), in the shape of an imported one.
export const createRecipeAI = (request, language) => invoke({ type: 'create_recipe', request, language })
