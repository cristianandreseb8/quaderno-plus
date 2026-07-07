import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const MODEL = "claude-sonnet-4-6"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 3 }

async function claudeText(messages: object[], system?: string, maxTokens = 1500, webSearch = false): Promise<string> {
  const body: Record<string, unknown> = { model: MODEL, max_tokens: maxTokens, messages }
  if (system) body.system = system
  if (webSearch) body.tools = [WEB_SEARCH_TOOL]
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01",
      ...(webSearch ? { "anthropic-beta": "web-search-2025-03-05" } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return (data.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n")
}

async function claudeJson(messages: object[], system?: string, maxTokens = 2000, webSearch = false) {
  const text = await claudeText(messages, system, maxTokens, webSearch)
  let t = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim()
  const a = t.indexOf("{"), b = t.lastIndexOf("}")
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  return JSON.parse(t)
}

const EXTRACT_PROMPT = `You are an assistant to a professional baker. Extract ALL recipe content from ALL images.

Return ONLY valid JSON, no markdown:

{"title":"","category":"","time":"","servings":"","ingredients":["..."],"steps":["..."],"notes":""}

RULES: Keep original language. For multi-dough recipes prefix each section with "## Section Name". Ingredient format: "500 g bread flour" (quantity, unit, 2 spaces, name). One complete step per element.`

const RECIPE_ASSISTANT_SYSTEM = (recipe: unknown, language: string) =>
`You are an AI assistant for Quaderno+, a professional recipe management app for bakers.

CURRENT RECIPE: ${JSON.stringify(recipe)}

Modify the recipe by including action tags in your response:

<ACTION>{"type":"scale","factor":2.5}</ACTION>
<ACTION>{"type":"translate","language":"Spanish"}</ACTION>
<ACTION>{"type":"update_field","field":"title","value":"New Title"}</ACTION>
<ACTION>{"type":"update_ingredients","ingredients":["500 g flour","300 g water"]}</ACTION>
<ACTION>{"type":"update_steps","steps":["Step 1...","Step 2..."]}</ACTION>
<ACTION>{"type":"add_note","content":"Important tip..."}</ACTION>

Be concise. Language: ${language || "English"}.`

const APP_ASSISTANT_SYSTEM = (recipes: object[]) =>
`You are the global AI assistant for Quaderno+, a professional recipe management app.

RECIPES IN DATABASE (${recipes.length} total):

${recipes.map((r: Record<string, unknown>) => `- "${r.title}" [${r.category || 'no category'}] id:${r.id}`).join('\n')}

You can perform actions with these tags:

<APP_ACTION>{"type":"create_recipe","recipe":{"title":"","category":"","time":"","servings":"","ingredients":["## Section (optional)","qty unit name"],"steps":["..."],"notes":"","source":"AI"}}</APP_ACTION>
<APP_ACTION>{"type":"batch_create","recipes":[{"title":"","category":"","time":"","servings":"","ingredients":[],"steps":[],"notes":"","source":"AI"}]}</APP_ACTION>
<APP_ACTION>{"type":"delete_recipe","id":"recipe_id","title":"Recipe name"}</APP_ACTION>
<APP_ACTION>{"type":"select_recipe","id":"recipe_id"}</APP_ACTION>
<APP_ACTION>{"type":"search","query":"search term"}</APP_ACTION>

When creating recipes be complete and professional. For multi-dough use ## section headers.

For batch creation generate complete recipes, not just stubs. Be generous with ingredients and steps.`

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  const body = await req.json()

  try {
    let result: unknown

    if (body.type === "translate") {
      result = await claudeJson([{ role: "user", content: `Translate this recipe JSON to ${body.targetLang}. Keep quantities, units, technical baking terms, and ## section headers. Return ONLY valid JSON, same structure:\n\n${JSON.stringify(body.recipe)}` }])
    } else if (body.type === "structure") {
      result = await claudeJson([{ role: "user", content: `Structure this recipe text as JSON. Return ONLY valid JSON:\n{"title":"","category":"","time":"","servings":"","ingredients":["..."],"steps":["..."],"notes":""}\nFor multi-dough use ## Section Name headers. Two spaces between unit and name.\n\nText:\n${body.text}` }])
    } else if (body.type === "assistant") {
      const sys = RECIPE_ASSISTANT_SYSTEM(body.recipe, body.language || "English")
      const msgs = (body.messages || []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))
      const text = await claudeText(msgs, sys, 1000)
      result = { text }
    } else if (body.type === "app_assistant") {
      const sys = APP_ASSISTANT_SYSTEM(body.recipes || [])
      const msgs = (body.messages || []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))
      const text = await claudeText(msgs, sys, 2000)
      result = { text }
    } else if (body.type === "format_note") {
      const text = await claudeText([{ role: "user", content: `Clean up this voice transcription into readable text. Fix punctuation and capitalization only. Do NOT rephrase, interpret, add information, or change the meaning. Keep it exactly what was said:\n\n"${body.transcript}"` }], undefined, 300)
      result = { text }
    } else if (body.type === "ai_suggest_notes") {
      const text = await claudeText([{ role: "user", content: `Give 3 short, practical baking notes for this recipe. Be technical and specific. Recipe: ${JSON.stringify(body.recipe)}. Existing notes: "${body.currentNotes || ''}"` }], undefined, 500)
      result = { text }
    } else if (body.type === "analyze_macros") {
      const ings = (body.ingredients || []).map((i: { name: string; qty: number; unit: string }) => `${i.qty} ${i.unit} ${i.name}`).join('\n')
      const systemPrompt = `You are a professional baker and food scientist. Analyze each ingredient and return precise nutritional and baking-relevant data.

If an ingredient name refers to a specific commercial/branded product (e.g. "Caputo 00", "Valrhona Guanaja 70%", "King Arthur Bread Flour"), use web search to find its real published technical specifications (protein %, fat %, ash content, etc.) instead of guessing generic category averages. For generic ingredients (e.g. "flour", "butter", "sugar") use standard reference values, no search needed.

For each ingredient return:
- fat_pct: fat content as % of ingredient weight
- water_pct: total water content as % of ingredient weight
- free_water_pct: free (unbound) water available for hydration as % (e.g. milk=88, butter=0, flour=0, sourdough starter=hydration%, yolk=20)
- sugar_pct: sugar content as % of ingredient weight
- protein_pct: protein content as % of ingredient weight
- carbs_pct: total carbohydrates as %
- cal_per100: calories per 100g
- flour_equivalent_pct: equivalent flour content as % (flour=100, sourdough 50/50 starter=50, biga=60, poolish=50, etc, others=0)
- ingredient_type: one of: flour, butter, egg, egg_yolk, sugar, milk, cream, salt, yeast, sourdough, honey, oil, water, chocolate, fruit, nut, spice, other
- notes: brief technical note (max 15 words) — mention the source if a specific product spec was found via search

Return ONLY valid JSON, no markdown, no commentary before or after: {"cache": {"<ingredient_name>": {fat_pct, water_pct, free_water_pct, sugar_pct, protein_pct, carbs_pct, cal_per100, flour_equivalent_pct, ingredient_type, notes}, ...}}`
      result = await claudeJson([{ role: "user", content: `Recipe: ${body.recipe_title || ''}\nIngredients:\n${ings}` }], systemPrompt, 3000, true)
    } else if (body.type === "analyze_custom_param") {
      const ings = (body.ingredients || []).map((i: { name: string; qty: number; unit: string }) => `${i.qty} ${i.unit} ${i.name}`).join('\n')
      const existingM = body.existing_macros || {}
      const systemPrompt2 = `You are a professional baker and food scientist. Calculate the requested parameter for this recipe.
Return ONLY valid JSON: {"value": <number or string>, "unit": "<unit or empty string>", "explanation": "<1 sentence max 20 words explaining what this value means for this recipe>"}`
      const userMsg = `Recipe: ${body.recipe_title || ''}\nIngredients:\n${ings}\n\nExisting macros: total_batch=${existingM.total || 0}g, fat=${existingM.fat || 0}g, water=${existingM.water || 0}g, flour_equiv=${existingM.flourEqG || 0}g, free_water=${existingM.freeWaterG || 0}g\n\nCalculate: ${body.param_label}`
      result = await claudeJson([{ role: "user", content: userMsg }], systemPrompt2, 400)
    } else if (body.type === "auto_categorize") {
      const list = (body.recipes || []).map((r: { id: string; title: string; ingredients: string[] }) => `id:${r.id} title:"${r.title}" ingredients:${(r.ingredients || []).slice(0, 8).join(', ')}`).join('\n')
      const systemPrompt3 = `You are a professional baker. Assign a short, consistent category (2-4 words, e.g. "Grandi Lievitati", "Pan Bread", "Pastry", "Viennoiserie") to each recipe based on its title and ingredients.
Return ONLY valid JSON: {"updates": [{"id": "...", "category": "..."}, ...]}`
      result = await claudeJson([{ role: "user", content: `Recipes:\n${list}` }], systemPrompt3, 2000)
    } else {
      const content = (body.images || []).map((im: { media_type: string; data: string }) => ({
        type: "image", source: { type: "base64", media_type: im.media_type, data: im.data },
      }))
      content.push({ type: "text", text: EXTRACT_PROMPT })
      result = await claudeJson([{ role: "user", content }])
    }

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", ...CORS } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return new Response(JSON.stringify({ error: msg }), { status: 422, headers: { "Content-Type": "application/json", ...CORS } })
  }
})
