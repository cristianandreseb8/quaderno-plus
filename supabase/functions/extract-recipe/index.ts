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

When creating recipes be complete and professional. For multi-dough use ## section headers; an ingredient made earlier in the same recipe (starter, first dough) is written as a reference line starting with "→ ". Never include totals as ingredients.

For batch creation generate complete recipes, not just stubs. Be generous with ingredients and steps.`

// ── Recipe extraction (photos, pasted text, PDF) ─────────────────────────────
// Every extraction path shares one set of rules so the model reads a recipe the way a chef
// would — interpreting tables, totals, sub-preparations and redundancies — instead of
// transcribing lines. Structured outputs guarantee the JSON shape.
const RECIPE_MODEL = "claude-opus-5"

const RECIPE_PROPS = {
  title: { type: "string" },
  category: { type: "string" },
  time: { type: "string" },
  servings: { type: "string" },
  ingredients: { type: "array", items: { type: "string" } },
  steps: { type: "array", items: { type: "string" } },
  notes: { type: "string" },
}
const RECIPE_KEYS = ["title", "category", "time", "servings", "ingredients", "steps", "notes"]
const RECIPE_SCHEMA = { type: "object", additionalProperties: false, required: RECIPE_KEYS, properties: RECIPE_PROPS }
const RECIPE_LIST_SCHEMA = {
  type: "object", additionalProperties: false, required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: [...RECIPE_KEYS, "page", "complete"],
        properties: { ...RECIPE_PROPS, page: { type: "integer" }, complete: { type: "boolean" } },
      },
    },
  },
}
const OUTLINE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "start_page", "end_page", "continues", "continued_from_before"],
        properties: {
          title: { type: "string" },
          start_page: { type: "integer" },
          end_page: { type: "integer" },
          continues: { type: "boolean" },
          continued_from_before: { type: "boolean" },
        },
      },
    },
  },
}

const RECIPE_SYSTEM = `You are an experienced pastry chef and recipe editor preparing recipes for a professional kitchen's recipe database. You understand baking formulas, multi-stage doughs, starters, baker's percentages and production sheets. You read a recipe completely, understand what it means, and write a clean, coherent version that a cook can follow — you never transcribe blindly. Numbers (quantities, units, temperatures, times, pH) are copied exactly as printed, never converted or rounded.`

function recipeRules(mode: string): string {
  const method = mode === "book"
    ? "- Write the steps in your own words, concise and clear, in the language of the document. Keep every quantity, temperature, time, speed, pH and visual cue; leave out anecdotes."
    : "- Keep the author's wording for each step. You may split, order and tidy the steps, but do not rephrase their content."
  return `How to read and write the recipe:

INGREDIENTS
- One line per real ingredient: quantity, unit, two spaces, name — e.g. "500 g  bread flour", "2  eggs", "1 tsp  fine salt". A line without a quantity is just the name ("pearl sugar, to finish").
- Group the parts of the dish with header lines "## Name" in the order they are made (e.g. "## Starter refresh", "## First dough", "## Second dough", "## Glaze").
- Leave out anything that is not an ingredient: totals and subtotals ("Total", "Total dough", "Totale", "Summe", "Gesamt"), column headings, and percentage columns. Baker's percentages are never part of an ingredient line — the app calculates them itself.
- A preparation made earlier in this same recipe and added to a later part (refreshed starter, levain, poolish, the first dough, a cream used for assembly) is not a new ingredient. Write it as a reference line that starts with "→ ", with its quantity if one is given: "→ 117 g  lievito madre (refreshed)", "→ first dough (all of it)". Do not repeat its sub-ingredients and do not add its weight as a purchase.
- When the same ingredient is added at two different moments in one part, keep two lines and make the difference clear ("15 g  acacia honey, mixed with the zest" / "23 g  acacia honey").
- If the document has already applied a substitution, list the ingredients actually used and mention the original in the notes. Genuine alternatives ("or use licoli") go in the notes, not in the ingredient list.
- Keep the document's language and its names for ingredients (brands, flour strength and similar specs belong in the name).

METHOD
- Always include the method, wherever it is printed — often on later pages, in a separate "Method" section, or under numbered lettered parts. One action per step, in order.
${method}
- For recipes in several parts, add header steps "## Name" before each part (e.g. "## Starter", "## First dough", "## Second dough", "## Shaping", "## Glaze", "## Baking").
- Turn tables inside the method (fermentation times by temperature, baking stages) into clear sentences that keep every number.
- Merge duplicated or redundant text, fix obvious typos and broken words, and keep every critical point (target dough temperature, pH, volume increase, core temperature, proof point).

OTHER FIELDS
- title: the recipe's own name (without labels such as "production sheet").
- servings: the yield, e.g. "3 × 550 g (1800 g dough)".
- time: total time if stated or clearly derivable from the method, otherwise "".
- category: 1–3 words.
- notes: short, useful technical notes only — substitutions and alternatives, holding and storage, key formula figures if given (hydration, sugars, fat, inclusions). Leave out nutrition tables, marketing text and anything already said in the method.`
}

async function claudeStructured(opts: { content: unknown[]; schema: object; effort?: string; maxTokens?: number; system?: string }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: RECIPE_MODEL,
      max_tokens: opts.maxTokens || 16000,
      fallbacks: "default",
      output_config: { effort: opts.effort || "medium", format: { type: "json_schema", schema: opts.schema } },
      system: opts.system || RECIPE_SYSTEM,
      messages: [{ role: "user", content: opts.content }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `AI request failed (${res.status})`)
  if (data.stop_reason === "refusal") throw new Error("The AI declined to read this content.")
  // A truncated structured response is not valid JSON; the client retries with less content.
  if (data.stop_reason === "max_tokens") throw new Error("TOO_MUCH_CONTENT")
  const text = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("")
  return JSON.parse(text)
}

// ── Spelling and grammar ─────────────────────────────────────────────────────
// The editor sends every text of a recipe with an id; the model returns only the ones it
// corrected, so the client can show each change and apply the ones the cook accepts.
const PROOFREAD_SCHEMA = {
  type: "object",
  properties: {
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes"],
  additionalProperties: false,
}

const PROOFREAD_SYSTEM = `You are a careful copy editor for recipes written by cooks and bakers. You fix spelling, missing or wrong accents, grammar (agreement, verb forms, articles) and clearly wrong punctuation or capitalization. Nothing else.

Rules:
- Keep every text in its own language. Never translate. A recipe may mix languages (Italian terms in a Spanish recipe, English brand names): leave foreign words and phrases as they are unless they are misspelled in their own language.
- Keep every number, quantity, unit, temperature, time, range, percentage and symbol exactly as written ("500 g", "26-28 °C", "4.5-6 h", "1:1", "80%", "½").
- Keep a leading "## " or "→ " marker exactly.
- Keep brand names, product names, proper nouns and technical terms (lievito madre, autolisi, pâte fermentée, Manitoba, Caputo) as written unless clearly misspelled.
- Do not rephrase, shorten, expand, reorder, or change the style, tone or meaning. Kitchen shorthand and a telegraphic style ("Mix 5 min. Rest.") are fine: leave them.
- Do not change a line only to add or remove a final period.
- Return only the items you changed, each with its id and the complete corrected text. If nothing needs fixing, return {"fixes": []}.`

const pdfBlock = (b64: unknown) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } })
const pageLabel = (a: number, b: number) => (a === b ? `page ${a}` : `pages ${a}–${b}`)

// Several recipes from a page range (short documents, or legacy page batches).
function pdfRecipesPrompt(b: Record<string, unknown>): string {
  const first = Number(b.first_page), last = Number(b.last_page)
  const ctx = b.context_page ? Number(b.context_page) : null
  const known = ((b.known_categories as string[]) || []).slice(0, 60).join(", ")
  return `The attached PDF contains ${pageLabel(first, last)} of "${b.source || "a document"}"${ctx ? `, followed by page ${ctx} as look-ahead only` : ""}. Page 1 of the attachment is page ${first} of the original.

Extract every recipe that starts on ${pageLabel(first, last)}. A recipe includes all of its parts even when they are printed on different pages (title and ingredient tables on one page, the method several pages later). ${ctx ? `Finish a recipe from the look-ahead page ${ctx} if it continues there, but skip recipes that start on it.` : ""} Skip text at the top of page ${first} that clearly continues a recipe from an earlier page. Pages with no recipe content (introductions, indexes, nutrition-only or photo pages) produce nothing; return {"recipes": []} if there are none.

page = the original page number where the recipe starts. complete = false only if part of the recipe is clearly missing from these pages.
${known ? `category: reuse one of these when it fits: ${known}.\n` : ""}
${recipeRules(String(b.mode || "book"))}`
}

// Map of where each recipe lives in a batch of pages (long documents, first pass).
function outlinePrompt(b: Record<string, unknown>): string {
  const first = Number(b.first_page), last = Number(b.last_page), total = Number(b.total_pages || last)
  return `The attached PDF contains ${pageLabel(first, last)} (of ${total}) of "${b.source || "a document"}". Page 1 of the attachment is page ${first} of the original.

List every recipe in these pages with the range of pages that holds its content. A recipe's content includes its title, ingredient tables, sub-recipes, method, and notes — even when the method is printed on later pages or in a separate "Method" section. Use original page numbers.
- start_page: first page with this recipe's content. end_page: last page with its content within ${pageLabel(first, last)}.
- continues: true if its content probably goes on after page ${last}.
- continued_from_before: true (with title "") if page ${first} opens in the middle of a recipe that started before this batch; its end_page is where that recipe ends here.
- Ignore tables of contents, indexes and pages that only mention recipes.
Return {"recipes": []} if there are none.`
}

// One recipe, with every page that holds it.
function pdfRecipePrompt(b: Record<string, unknown>): string {
  const first = Number(b.first_page), last = Number(b.last_page)
  const known = ((b.known_categories as string[]) || []).slice(0, 60).join(", ")
  return `The attached PDF contains ${pageLabel(first, last)} of "${b.source || "a document"}" (page 1 of the attachment is page ${first}). They hold the recipe "${b.title || "(untitled)"}" — its ingredients, sub-recipes and method may be spread over all of these pages. Extract that one recipe completely. Ignore other recipes that may share these pages.
${known ? `category: reuse one of these when it fits: ${known}.\n` : ""}
${recipeRules(String(b.mode || "book"))}`
}

// The gateway has already verified the JWT's signature (verify_jwt); here we only require
// that it belongs to a signed-in account, so the public anon key cannot spend AI credit.
function jwtRole(req: Request): string {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
  const part = token.split(".")[1]
  if (!part) return ""
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")
    return JSON.parse(atob(b64)).role || ""
  } catch (_) {
    return ""
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (jwtRole(req) !== "authenticated") {
    return new Response(JSON.stringify({ error: "Sign in to use the AI features." }), { status: 401, headers: { "Content-Type": "application/json", ...CORS } })
  }

  const body = await req.json()

  try {
    let result: unknown

    if (body.type === "translate") {
      result = await claudeJson([{ role: "user", content: `Translate this recipe JSON to ${body.targetLang}. Keep quantities, units, technical baking terms, "## " section headers and "→ " reference markers at the start of lines. Keep links to other recipes, written [[Name|id]], exactly as they are. Return ONLY valid JSON, same structure:\n\n${JSON.stringify(body.recipe)}` }])
    } else if (body.type === "structure") {
      result = await claudeStructured({
        schema: RECIPE_SCHEMA,
        content: [{ type: "text", text: `Here is a recipe as text:\n\n<recipe>\n${body.text}\n</recipe>\n\n${recipeRules("own")}` }],
      })
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
    } else if (body.type === "proofread") {
      const items = ((body.items || []) as { id: string; text: string }[])
        .filter((it) => it && typeof it.id === "string" && typeof it.text === "string" && it.text.trim())
        .slice(0, 400)
      if (!items.length) {
        result = { fixes: [] }
      } else {
        const out = await claudeStructured({
          system: PROOFREAD_SYSTEM, schema: PROOFREAD_SCHEMA, effort: "low", maxTokens: 12000,
          content: [{ type: "text", text: `Check these texts from one recipe:\n\n${JSON.stringify(items)}` }],
        })
        const byId = new Map(items.map((it) => [it.id, it.text]))
        result = { fixes: (out.fixes || []).filter((f: { id: string; text: string }) => byId.has(f.id) && f.text && f.text !== byId.get(f.id)) }
      }
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
      const out = await claudeStructured({ schema: RECIPE_LIST_SCHEMA, content: [pdfBlock(body.pdf), { type: "text", text: pdfRecipesPrompt(body) }] })
      result = { recipes: out.recipes || [] }
    } else if (body.type === "pdf_outline") {
      if (!body.pdf) throw new Error("No PDF data received")
      const out = await claudeStructured({ schema: OUTLINE_SCHEMA, effort: "low", maxTokens: 8000, content: [pdfBlock(body.pdf), { type: "text", text: outlinePrompt(body) }] })
      result = { recipes: out.recipes || [] }
    } else if (body.type === "pdf_recipe") {
      if (!body.pdf) throw new Error("No PDF data received")
      result = { recipe: await claudeStructured({ schema: RECIPE_SCHEMA, content: [pdfBlock(body.pdf), { type: "text", text: pdfRecipePrompt(body) }] }) }
    } else if (body.type === "auto_categorize") {
      const list = (body.recipes || []).map((r: { id: string; title: string; ingredients: string[] }) => `id:${r.id} title:"${r.title}" ingredients:${(r.ingredients || []).slice(0, 8).join(', ')}`).join('\n')
      const systemPrompt3 = `You are a professional baker. Assign a short, consistent category (2-4 words, e.g. "Grandi Lievitati", "Pan Bread", "Pastry", "Viennoiserie") to each recipe based on its title and ingredients.
Return ONLY valid JSON: {"updates": [{"id": "...", "category": "..."}, ...]}`
      result = await claudeJson([{ role: "user", content: `Recipes:\n${list}` }], systemPrompt3, 2000)
    } else {
      const content: unknown[] = (body.images || []).map((im: { media_type: string; data: string }) => ({
        type: "image", source: { type: "base64", media_type: im.media_type, data: im.data },
      }))
      content.push({ type: "text", text: `These photos show one recipe (possibly over several pages). Extract it completely.\n\n${recipeRules("own")}` })
      result = await claudeStructured({ schema: RECIPE_SCHEMA, content })
    }

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", ...CORS } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return new Response(JSON.stringify({ error: msg }), { status: 422, headers: { "Content-Type": "application/json", ...CORS } })
  }
})
