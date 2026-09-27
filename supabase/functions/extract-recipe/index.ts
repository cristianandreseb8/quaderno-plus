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

// ── PDF / cookbook import ─────────────────────────────────────────────────────
// The client splits a PDF into small page batches (plus one look-ahead page) and sends
// them one at a time, so each request stays well inside the function's time limit.
const PDF_MODEL = "claude-opus-5"

const RECIPE_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "time", "servings", "ingredients", "steps", "notes", "page", "complete"],
        properties: {
          title: { type: "string" },
          category: { type: "string" },
          time: { type: "string" },
          servings: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          page: { type: "integer" },
          complete: { type: "boolean" },
        },
      },
    },
  },
}

const PDF_SYSTEM = `You extract recipes from document pages for a professional kitchen's recipe database. You are precise with numbers: quantities, units, temperatures and times are copied exactly as printed, never converted or rounded.`

function pdfPrompt(b: Record<string, unknown>): string {
  const first = Number(b.first_page), last = Number(b.last_page)
  const ctx = b.context_page ? Number(b.context_page) : null
  const known = ((b.known_categories as string[]) || []).slice(0, 60).join(", ")
  const pages = first === last ? `page ${first}` : `pages ${first}–${last}`
  const method = b.mode === "own"
    ? `- steps: copy each method step as written. notes: tips printed with the recipe, as written, or "".`
    : `- steps: clear, concise method steps written in your own words, in the language of the document. Keep every quantity, temperature, time, speed and visual cue; leave out stories and anecdotes. notes: at most two short technical tips in your own words, or "".`
  return `The attached PDF contains ${pages} of "${b.source || "a document"}"${ctx ? `, followed by page ${ctx} as look-ahead only` : ""}. Page 1 of the attachment is page ${first} of the original.

Extract every recipe that STARTS on ${pages}.
- If such a recipe continues onto ${ctx ? `the look-ahead page ${ctx}` : "a later page"}, ${ctx ? "finish it from that page" : "extract what is shown and set complete to false"}.
- Skip recipes that start on the look-ahead page (they are processed with the next batch) and skip text at the top of page ${first} that continues a recipe from an earlier page.
- A dish built from several components (a dough and its filling, a cake with its glaze) is ONE recipe: put each component's ingredients after a header line "## Component name".
- ingredients: one per line as quantity, unit, two spaces, name — e.g. "500 g  bread flour", "2  eggs", "1 tsp  fine salt". Keep preparation notes after the name ("cold, diced"). Lines with no quantity are just the name.
${method}
- title, time and servings (yield: pieces, weight or portions) as printed; "" when absent. Keep the document's language.
- category: 1–3 words, consistent across the book.${known ? ` Reuse one of these when it fits: ${known}.` : ""}
- page: the original page number where the recipe starts. complete: false when the recipe is cut off within these pages.
- Pages without recipes (introductions, essays, photos, indexes, tables of contents) produce nothing. Return {"recipes": []} if there are none.`
}

async function claudePdfRecipes(b: Record<string, unknown>) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: PDF_MODEL,
      max_tokens: 16000,
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RECIPE_LIST_SCHEMA } },
      system: PDF_SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b.pdf } },
          { type: "text", text: pdfPrompt(b) },
        ],
      }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `AI request failed (${res.status})`)
  if (data.stop_reason === "refusal") throw new Error("The AI declined to read these pages.")
  // A truncated structured response is not valid JSON; the client retries the batch page by page.
  if (data.stop_reason === "max_tokens") throw new Error("TOO_MUCH_CONTENT")
  const text = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("")
  const parsed = JSON.parse(text)
  return { recipes: parsed.recipes || [], usage: data.usage || null }
}

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
      // Generous budget: a complete recipe (or small batch) inside <APP_ACTION> tags can easily
      // exceed 2000 tokens, and a truncated tag means the action silently never runs.
      const text = await claudeText(msgs, sys, 8000)
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
    } else if (body.type === "translate_strings") {
      // Batch string translation for the app-wide language switch. Results are cached
      // client-side in the `translations` table, so each phrase is paid for once.
      const items = (body.items || []).map((t: string) => String(t))
      const sys = `You translate short cooking-app strings into ${body.target_lang}.

Return ONLY a JSON object of the form {"items": ["...", "..."]} whose array has the same length and order as the input array.
Rules:
- Translate naturally, using correct professional kitchen terminology.
- Preserve every number, quantity, unit and symbol exactly as written.
- Preserve markdown-ish markers: leading "## " section headers, [[wikilinks]] (translate the visible label only if it is not a recipe name — otherwise leave the whole link untouched), and #tags.
- If a string is a proper noun, a brand, or already in the target language, return it unchanged.
- Never add commentary, never merge or split entries.`
      const out = await claudeJson(
        [{ role: "user", content: `Translate to ${body.target_lang}:\n${JSON.stringify(items)}` }],
        sys, 8000,
      )
      // Ask for an object rather than a bare array: claudeJson slices between the first "{"
      // and last "}", which would mangle a top-level array if a translation contained a brace.
      result = { items: Array.isArray(out) ? out : (out.items || out.translations || []) }
    } else if (body.type === "categorize_recipe") {
      const sys = `You are a professional chef organising a recipe library.
Given one recipe, return a category and a handful of tags.
Return ONLY valid JSON: {"category": "<2-4 words>", "tags": ["lowercase-tag", ...]}
Tags describe technique, course, cuisine, main ingredient and dietary notes. Prefer reusing the existing tags supplied. 3-7 tags.`
      const known = (body.known_tags || []).join(', ')
      const msg = `Existing tags in this library: ${known || 'none'}\n\nRecipe: ${JSON.stringify({
        title: body.title, category: body.category, ingredients: (body.ingredients || []).slice(0, 30), steps: (body.steps || []).slice(0, 6),
      })}`
      result = await claudeJson([{ role: "user", content: msg }], sys, 700)
    } else if (body.type === "categorize_ingredients") {
      const list = (body.ingredients || []).map((i: { name: string; ingredient_type?: string }) => `${i.name}${i.ingredient_type ? ` (nutrition type: ${i.ingredient_type})` : ''}`).join('\n')
      const known = (body.known_categories || []).join(', ')
      const sys = `You are a culinary taxonomist. For each ingredient, assign 1-4 broad browsing categories describing what it fundamentally is (e.g. dairy, cheese, fermented, grain, sweetener, fat, spice, herb, fruit, vegetable, nut, seed, protein, liquid, chocolate, egg, alcohol, preservative, seasoning, leavening, baking aid).

An ingredient can and often should have MULTIPLE categories — e.g. a fermented cheese like Reblochon → dairy, cheese, fermented. Sourdough starter → grain, leavening, fermented.

Categories already in use in this library (reuse one of these when it fits instead of inventing a near-duplicate): ${known || 'none yet'}. Only invent a new lowercase one-or-two-word category when nothing existing fits.

Return ONLY valid JSON, no markdown: {"categories": {"<ingredient name exactly as given>": ["cat1","cat2"], ...}}`
      result = await claudeJson([{ role: "user", content: `Ingredients:\n${list}` }], sys, 3000)
    } else if (body.type === "describe_ingredient") {
      const sys = `You are a professional baker and food writer. Write one short, precise descriptor (max 25 words, one sentence, no markdown) for the given ingredient: what it is, its character/flavor, and its typical culinary role. No fluff, no marketing language.`
      const text = await claudeText([{ role: "user", content: `Ingredient: ${body.name}${body.ingredient_type ? ` (nutrition type: ${body.ingredient_type})` : ''}` }], sys, 150)
      result = { text: text.trim() }
    } else if (body.type === "extract_pdf") {
      if (!body.pdf) throw new Error("No PDF data received")
      result = await claudePdfRecipes(body)
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
