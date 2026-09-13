// ---- Life OS Real AI Mentor — Supabase Edge Function (Phase 15) ----
//
// This is the ONLY place any LLM provider secret key is ever read. The browser
// never sees it. Deploy and configure per README.md "Real AI Mentor setup":
//
//   supabase functions deploy mentor
//   supabase secrets set GROQ_API_KEY=YOUR_GROQ_API_KEY   (free provider, default — never commit it)
//   supabase secrets set LLM_API_KEY=YOUR_ANTHROPIC_API_KEY  (only needed if LLM_PROVIDER=anthropic)
//   supabase secrets set LLM_PROVIDER=groq        (optional — "groq" is already the default)
//   supabase secrets set LLM_MODEL=openai/gpt-oss-120b   (optional, has a provider-specific default)
//
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically to every Edge
// Function by the Supabase runtime — you do not need to set those yourself.
//
// This function does NOT read or write any Supabase table. It only verifies the
// caller's identity (via their existing auth session) and relays their message to
// the LLM provider. All Life OS data and all tool EXECUTION happens on the client,
// against the user's own local state — see views/mentor.js. That keeps this
// function stateless, keeps the existing life_os_state/life_os_backups tables
// completely untouched, and means no Supabase schema change was needed for this
// phase.
//
// NOT YET DEPLOYED: writing this file does not deploy it. Until you run the
// commands above against your own Supabase project, calling this endpoint will
// simply fail (which the client handles by falling back to the local Mentor).
//
// ---- Provider architecture ----
// LLM_PROVIDER selects which backend answers the Mentor — "groq" (the free
// default) or "anthropic" (kept fully working as an optional alternative; nothing
// about it was removed). Everything outside this file — the frontend, the tool
// registry/validation/limits in shared.mjs, and the app-level response contract
// ({type:"final",text} / {type:"tool_call",tool,args,callId}) — is identical
// either way. Only two things change per provider: how the outgoing request is
// built (buildAnthropicMessages/toAnthropicTools vs. buildOpenAIMessages/
// toOpenAIToolDefinitions) and how the response is parsed back into that same
// app-level shape (parseAnthropicResponse vs. parseOpenAIResponse).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MENTOR_TOOL_DEFINITIONS,
  validateToolCall,
  checkRequestLimits,
  buildSystemPrompt,
  findToolDefinition,
  normalizeSearchResults,
  wrapUntrustedSearchContent,
  buildRecommendationFromArgs,
  REQUEST_TIMEOUT_MS,
  SEARCH_TIMEOUT_MS,
  DEFAULT_SEARCH_RESULTS,
  MAX_TOOL_CALLS_PER_REQUEST,
  buildGeminiContents,
  toGeminiToolDefinitions,
  parseGeminiResponse,
  buildProviderOrder,
  recordProviderCooldown,
  normalizeSourceTier,
  makeCacheKey,
  getCachedResponse,
  setCachedResponse,
} from './shared.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

// Provider selection — defaults to Groq (free) so the Mentor works with zero
// billing setup out of the box. Set the LLM_PROVIDER secret to "anthropic" to use
// the paid Anthropic path instead; both implementations remain fully in place.
const LLM_PROVIDER = (Deno.env.get('LLM_PROVIDER') || 'groq').toLowerCase();
const LLM_API_KEY = Deno.env.get('LLM_API_KEY'); // Anthropic key — secret, never sent to the client
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY'); // Groq key — secret, never sent to the client
const DEFAULT_MODEL = LLM_PROVIDER === 'anthropic' ? 'claude-sonnet-5' : 'openai/gpt-oss-120b';
const LLM_MODEL = Deno.env.get('LLM_MODEL') || DEFAULT_MODEL;
// Whichever key the active provider actually needs — used only for the "is this
// configured at all" check below, never logged or returned to the client.
const ACTIVE_API_KEY = LLM_PROVIDER === 'anthropic' ? LLM_API_KEY : GROQ_API_KEY;

// Gemini — the free automatic fallback for Groq, both on their free tiers only
// (this app never adds a paid provider). Uses Google's "AI Studio" Generative
// Language API key, deliberately NOT Vertex AI (which is billed). Entirely
// optional: if GEMINI_API_KEY is unset, the router below simply never includes
// Gemini in the provider order and behavior is byte-for-byte what it was before
// this feature — Groq only, single attempt, same fail-fast-on-429 as always.
// Only ever active alongside the default/"groq" LLM_PROVIDER mode — the
// separate, opt-in, paid Anthropic path (LLM_PROVIDER=anthropic) is untouched.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// gemini-2.0-flash (the original default here) was retired by Google on
// 2026-06-01 — confirmed directly against Google's own current model/pricing
// docs (ai.google.dev/gemini-api/docs/models, /docs/pricing), not guessed.
// Every fallback call using that dead model ID has been failing since then,
// which is very likely why the Groq->Gemini fallback appeared completely
// non-functional in production despite the router itself being correct.
// gemini-3.5-flash-lite is confirmed (same docs) to be: GA/stable (not
// preview), free-tier, and function-calling capable — the same three
// properties the original choice was picked for.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';

// ---- Provider cooldowns + response cache/dedup — module-level, in-memory only.
// Supabase Edge Functions may reuse a warm isolate across requests for a while,
// which is what makes this a useful (not just theoretical) optimization, but it
// is explicitly best-effort: it resets on every cold start and is never shared
// across concurrent isolates/regions. Nothing security- or correctness-critical
// ever depends on it — see shared.mjs's own comments on each piece. ----
let providerCooldowns: Record<string, number> = {};
const responseCache = new Map();
const inFlightRequests = new Map();
// Gemini concurrency tracking — how many Gemini requests are ACTUALLY in flight
// right now, broken down by priority tier (mentor / explore / explore-background).
// This is what lets Explore genuinely use the Gemini fallback (not excluded
// entirely, as an earlier version of this router did) while still protecting
// the shared free-tier quota: see canAdmitToGemini/GEMINI_TIER_CONCURRENCY_CAP
// in shared.mjs for the actual admission policy this state feeds into.
let geminiActiveTotal = 0;
const geminiActiveBySource: Record<string, number> = { mentor: 0, explore: 0, 'explore-background': 0 };

// Phase 3 — real-world research. Tavily was chosen specifically for this: a
// single simple REST endpoint, a free tier, and results already shaped for LLM
// consumption (title/url/content) — see the Phase 3 report for the full
// comparison against Brave/Serper. This key is read ONLY here, on the server,
// exactly like GROQ_API_KEY/LLM_API_KEY above — never sent to the client, never
// logged. If it's unset, webSearch simply reports itself unavailable (below)
// rather than failing the whole Mentor turn.
const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY');

// C4 fix: this used to be '*', letting any site read a response obtained using a
// visitor's own browser session token. This is a private, single-user app — CORS
// only needs to cover the origins it's actually ever served from: any localhost/
// 127.0.0.1 dev port (this project's frontend commonly runs via a local static
// server on a changing port) plus, once set, one fixed production origin. Real
// access control is unchanged either way — the JWT check below still runs
// regardless of Origin; this only controls which origins a BROWSER may read the
// response from (a non-browser caller like curl is unaffected by CORS entirely).
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN'); // optional: your deployed frontend's exact origin, once you have one
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) return true;
  return false;
}
function corsHeadersFor(req) {
  const origin = req.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(obj, status = 200, cors = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// ==================================================
// Anthropic (Messages API) — provider implementation
// ==================================================

// Root cause fix: Anthropic's tool-use protocol requires every tool_result block to
// appear in a user message immediately following an assistant message containing the
// matching tool_use block. This used to send only the latest tool_result with no
// preceding tool_use at all, which Anthropic correctly rejected (400
// invalid_request_error: "Each tool_result block must have a corresponding tool_use
// block in the previous message"). body.toolExchanges now carries every {tool, args,
// callId, result} for this turn, in order, so the full assistant/user pair sequence
// can be reconstructed exactly as it happened.
function buildAnthropicMessages(body) {
  const history = (body.history || []).slice(-10).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.text || '').slice(0, 2000),
  }));
  const exchanges = Array.isArray(body.toolExchanges) ? body.toolExchanges : [];
  if (exchanges.length) {
    const exchangeMessages = [];
    for (const ex of exchanges) {
      exchangeMessages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: String(ex.callId || ''), name: String(ex.tool || ''), input: ex.args || {} }],
      });
      exchangeMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: String(ex.callId || ''), content: String(ex.result || '') }],
      });
    }
    return [...history, { role: 'user', content: String(body.message || '') }, ...exchangeMessages];
  }
  return [...history, { role: 'user', content: String(body.message || '') }];
}

function parseAnthropicResponse(llmResponse) {
  const content = (llmResponse && llmResponse.content) || [];
  const toolUse = content.find((b) => b.type === 'tool_use');
  if (toolUse) {
    const validation = validateToolCall(toolUse.name, toolUse.input);
    if (!validation.ok) {
      return { type: 'final', text: `I tried to use a tool incorrectly (${validation.error}). Let's try that a different way.` };
    }
    return { type: 'tool_call', tool: toolUse.name, args: toolUse.input, callId: toolUse.id };
  }
  const textBlock = content.find((b) => b.type === 'text');
  return { type: 'final', text: (textBlock && textBlock.text) || "I don't have a response for that." };
}

// ==================================================
// Groq / OpenAI-compatible (Chat Completions API) — provider implementation
// ==================================================

// Same {message, history, context, toolExchanges} input as buildAnthropicMessages,
// converted to OpenAI/Groq's Chat Completions shape instead: the system prompt is
// its own message (not a separate top-level field), and each tool round is an
// assistant message carrying a `tool_calls` array followed by a `role:"tool"`
// message — the OpenAI-compatible equivalent of Anthropic's tool_use/tool_result
// pairing, built from the exact same toolExchanges data.
function buildOpenAIMessages(body, systemPrompt) {
  const history = (body.history || []).slice(-10).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.text || '').slice(0, 2000),
  }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: String(body.message || '') },
  ];
  const exchanges = Array.isArray(body.toolExchanges) ? body.toolExchanges : [];
  for (const ex of exchanges) {
    const callId = String(ex.callId || '');
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: callId,
        type: 'function',
        function: { name: String(ex.tool || ''), arguments: JSON.stringify(ex.args || {}) },
      }],
    });
    messages.push({
      role: 'tool',
      tool_call_id: callId,
      content: String(ex.result || ''),
    });
  }
  return messages;
}

// MENTOR_TOOL_DEFINITIONS' `schema` is already plain JSON Schema — only the
// wrapping shape differs from Anthropic's `input_schema` convention.
function toOpenAIToolDefinitions(defs) {
  return defs.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));
}

// Reads choices[0].message: a `tool_calls` array (OpenAI-compatible shape) means the
// model wants to call a tool; otherwise falls back to the plain text `content`.
// Only the first tool call is used — this app's client-side loop (sendRealAIMentorMessage
// in views/mentor.js) only ever handles one tool_call per round-trip, matching the
// same single-tool_use assumption the existing Anthropic path already makes.
function parseOpenAIResponse(llmResponse) {
  const message = llmResponse && llmResponse.choices && llmResponse.choices[0] && llmResponse.choices[0].message;
  const toolCalls = (message && message.tool_calls) || [];
  if (toolCalls.length) {
    const call = toolCalls[0];
    const fn = call.function || {};
    let args;
    try {
      args = fn.arguments ? JSON.parse(fn.arguments) : {};
    } catch (e) {
      return { type: 'final', text: "I tried to use a tool incorrectly (malformed tool arguments). Let's try that a different way." };
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { type: 'final', text: "I tried to use a tool incorrectly (malformed tool arguments). Let's try that a different way." };
    }
    const validation = validateToolCall(fn.name, args);
    if (!validation.ok) {
      return { type: 'final', text: `I tried to use a tool incorrectly (${validation.error}). Let's try that a different way.` };
    }
    return { type: 'tool_call', tool: fn.name, args, callId: String(call.id || '') };
  }
  return { type: 'final', text: (message && message.content) || "I don't have a response for that." };
}

// ==================================================
// Phase 3 — server-executed tools (webSearch, presentRecommendation)
// ==================================================
// These two tools are NEVER returned to the client as a pending tool_call — the
// Edge Function runs them itself and loops back into the model in the same
// request (see the loop in Deno.serve below). That is the entire reason they
// exist here rather than in views/mentor.js's REAL_MENTOR_TOOLS: the search
// provider's API key must never reach the browser.

// One search provider call, wrapped in its own short timeout so a slow/unreachable
// provider can't stall the whole Mentor turn past the outer REQUEST_TIMEOUT_MS.
// Never throws — always resolves to either {results:[...]} or {error:'...'} so the
// caller can hand the model an honest "search failed" result instead of crashing
// the turn.
async function performWebSearch(args) {
  if (!TAVILY_API_KEY) {
    return { error: 'Web search is not configured on the server yet.' };
  }
  const query = String((args && args.query) || '').trim();
  const location = String((args && args.location) || '').trim();
  const fullQuery = location ? `${query} ${location}` : query;
  const maxResults = (args && Number(args.maxResults)) || DEFAULT_SEARCH_RESULTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: fullQuery,
        max_results: Math.min(Math.max(maxResults, 1), 10),
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { error: 'The search provider returned an error.' };
    const data = await r.json();
    const results = normalizeSearchResults((data && data.results) || [], maxResults);
    return { results };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') return { error: 'The web search took too long to respond.' };
    return { error: 'Could not reach the web search provider right now.' };
  }
}

// One LLM call to ONE specific provider, plus response parsing. Unlike the
// original single-provider version, `provider` is now an explicit argument
// (not read from the module-level LLM_PROVIDER constant) so callLlmWithFallback
// below can try more than one provider within the same request. Never retries
// internally — a 429/5xx/timeout is reported back as a structured outcome
// (rateLimited / transientError) and it is the CALLER's job to decide whether
// to try the next provider; this function makes exactly one HTTP call, always.
async function callProvider(provider, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let r;
    if (provider === 'anthropic') {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': LLM_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          max_tokens: 800,
          system: buildSystemPrompt(body.context || {}),
          messages: buildAnthropicMessages(body),
          tools: MENTOR_TOOL_DEFINITIONS.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.schema,
          })),
        }),
        signal: controller.signal,
      });
    } else if (provider === 'gemini') {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: buildSystemPrompt(body.context || {}) }] },
            contents: buildGeminiContents(body),
            tools: toGeminiToolDefinitions(MENTOR_TOOL_DEFINITIONS),
            generationConfig: { maxOutputTokens: 800 },
          }),
          signal: controller.signal,
        }
      );
    } else {
      // 'groq' — the free default/primary provider.
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          max_tokens: 800,
          messages: buildOpenAIMessages(body, buildSystemPrompt(body.context || {})),
          tools: toOpenAIToolDefinitions(MENTOR_TOOL_DEFINITIONS),
        }),
        signal: controller.signal,
      });
    }
    clearTimeout(timer);
    if (r.status === 429) {
      // Retry-After passed through as a plain NUMBER (retryAfterSeconds), not
      // baked into message text, same as before — the client uses it to drive a
      // real live countdown. Only a genuine whole-number header counts.
      const retryAfterRaw = r.headers.get('retry-after');
      const retryAfterSeconds = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? parseInt(retryAfterRaw, 10) : null;
      return { rateLimited: true, retryAfterSeconds };
    }
    if (r.status >= 500) {
      // A transient server-side problem at the provider — worth trying the next
      // provider in the router order (if any), unlike a 4xx (see below).
      return { transientError: true };
    }
    if (!r.ok) {
      // A genuine 4xx other than 429 (bad request / bad key / etc.) — almost
      // certainly not something a different provider would handle any better,
      // so this is reported straight to the client rather than retried.
      return { httpError: { error: 'The AI provider returned an error. Your Life OS data was not changed.' }, status: 502 };
    }
    const llmResponse = await r.json();
    const parsed =
      provider === 'anthropic' ? parseAnthropicResponse(llmResponse) :
      provider === 'gemini' ? parseGeminiResponse(llmResponse) :
      parseOpenAIResponse(llmResponse);
    return { parsed };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') return { transientError: true, timeout: true };
    return { transientError: true };
  }
}

// One Gemini call, wrapped with concurrency-slot bookkeeping. Both the total
// and per-tier counters are incremented right before the actual fetch and
// ALWAYS decremented afterward (success or failure) so a slot is never
// permanently leaked. This is the enforcement side of canAdmitToGemini's
// admission decision in buildProviderOrder — that function only ever READS
// these counts (it's pure/Deno-free), this is the one place they change.
async function callGeminiTracked(body, tier) {
  geminiActiveTotal += 1;
  geminiActiveBySource[tier] = (geminiActiveBySource[tier] || 0) + 1;
  try {
    return await callProvider('gemini', body);
  } finally {
    geminiActiveTotal -= 1;
    geminiActiveBySource[tier] = Math.max(0, (geminiActiveBySource[tier] || 0) - 1);
  }
}

// Router: tries each provider in buildProviderOrder()'s order, in sequence,
// stopping at the first success. Bounded by construction — at most as many
// attempts as there are configured providers (today: at most 2, Groq then
// Gemini) — never a blind retry loop against the SAME provider; that was a
// deliberate earlier design decision (see the retry-after comment above) and
// this preserves it exactly, just extended across providers instead of within
// one. A provider that just 429'd gets a cooldown recorded so the NEXT request
// (not just this one) skips straight past it instead of wasting a call.
//
// Both Mentor AND Explore (both tiers) go through this exact same router —
// see buildProviderOrder/canAdmitToGemini in shared.mjs for how priority is
// actually enforced (a small per-tier concurrency allowance on Gemini, not an
// outright exclusion).
async function callLlmWithFallback(body, source) {
  if (LLM_PROVIDER === 'anthropic') {
    // Unchanged single-provider path — the free-tier Groq/Gemini router below
    // never applies when the (paid, opt-in) Anthropic provider is selected.
    const r = await callProvider('anthropic', body);
    if (r.parsed) return { parsed: r.parsed };
    if (r.rateLimited) return { httpError: { error: 'The AI provider is rate-limiting requests right now.', retryAfterSeconds: r.retryAfterSeconds }, status: 429 };
    if (r.transientError) {
      return r.timeout
        ? { httpError: { error: 'The AI Mentor took too long to respond. Try again.' }, status: 504 }
        : { httpError: { error: 'Could not reach the AI provider right now. Your local data is unaffected.' }, status: 502 };
    }
    return r; // already-shaped httpError/status from a non-ok, non-429, non-5xx response
  }

  const tier = normalizeSourceTier(source);
  const order = buildProviderOrder({
    hasGroq: !!GROQ_API_KEY,
    hasGemini: !!GEMINI_API_KEY,
    source,
    cooldowns: providerCooldowns,
    now: Date.now(),
    geminiConcurrency: { activeTotal: geminiActiveTotal, activeBySource: geminiActiveBySource },
  });
  if (!order.length) {
    // Every configured provider is currently cooling down, or (for Gemini)
    // this tier has no free concurrency slot right now — fail fast with the
    // same rate-limit shape a live 429 would produce, no point spending a call.
    return { httpError: { error: 'The AI provider is rate-limiting requests right now.', retryAfterSeconds: null }, status: 429 };
  }

  let lastFailure;
  for (const provider of order) {
    const r = provider === 'gemini' ? await callGeminiTracked(body, tier) : await callProvider(provider, body);
    if (r.parsed) return { parsed: r.parsed };
    if (r.rateLimited) {
      providerCooldowns = recordProviderCooldown(providerCooldowns, provider, r.retryAfterSeconds, Date.now());
      lastFailure = { httpError: { error: 'The AI provider is rate-limiting requests right now.', retryAfterSeconds: r.retryAfterSeconds }, status: 429 };
      continue;
    }
    if (r.transientError) {
      lastFailure = r.timeout
        ? { httpError: { error: 'The AI Mentor took too long to respond. Try again.' }, status: 504 }
        : { httpError: { error: 'Could not reach the AI provider right now. Your local data is unaffected.' }, status: 502 };
      continue;
    }
    // A genuine non-ok/non-429/non-5xx response — not worth trying the next
    // provider, it would very likely fail identically (bad request shape, etc.).
    return r;
  }
  return lastFailure;
}

// ---- Phase 3: bounded internal loop for server-executed tools ----
// Most tool calls (getTodayPlan, logFood, etc.) still go straight back to the
// client exactly as before — this loop only ever intercepts webSearch and
// presentRecommendation, which must run here because their execution needs a
// server-only secret (webSearch) or is pure structured output with no client
// work to do (presentRecommendation). toolCallCount is shared across BOTH
// server-side loop iterations and client-side round-trips — it's returned to
// the client on every hand-off so its own recursion keeps counting from the
// correct number instead of silently under-counting the calls made in here.
// Pulled out of the request handler (unchanged in every other way) so the
// caching/dedup layer around Deno.serve below can treat "run this turn" as one
// unit of work with a single {responseBody,status} result to cache.
async function runMentorTurn(body, source) {
  let toolCallCount = typeof body.toolCallCount === 'number' ? body.toolCallCount : 0;
  let toolExchanges = Array.isArray(body.toolExchanges) ? [...body.toolExchanges] : [];

  for (let i = 0; i < MAX_TOOL_CALLS_PER_REQUEST + 1; i++) {
    const { parsed, httpError, status } = await callLlmWithFallback({ ...body, toolCallCount, toolExchanges }, source);
    if (httpError) return { responseBody: httpError, status };

    if (parsed.type !== 'tool_call') {
      // Plain final text — nothing server-side to do with it.
      return { responseBody: parsed, status: 200 };
    }

    const def = findToolDefinition(parsed.tool);
    if (!def || def.runsOn !== 'server') {
      // A normal client-executed tool — unchanged behavior, just now also
      // reporting the authoritative toolCallCount so the client's own
      // recursion (sendRealAIMentorMessage in views/mentor.js) stays in sync
      // with however many server-side steps already happened this turn.
      return { responseBody: { ...parsed, toolCallCount: toolCallCount + 1 }, status: 200 };
    }

    toolCallCount += 1;
    if (toolCallCount > MAX_TOOL_CALLS_PER_REQUEST) {
      return { responseBody: { type: 'final', text: "That needs more research steps than I should take at once — here's what I can tell you from what I already checked. Try asking something more specific." }, status: 200 };
    }

    if (parsed.tool === 'presentRecommendation') {
      // Structured final answer — ends the turn immediately, never loops back.
      return { responseBody: { type: 'final', text: String((parsed.args && parsed.args.message) || ''), recommendation: buildRecommendationFromArgs(parsed.args) }, status: 200 };
    }

    // parsed.tool === 'webSearch' (the only other runsOn:'server' tool today).
    const outcome = await performWebSearch(parsed.args);
    // The blunt reinforcement here (not just the system prompt) matters: a
    // smaller/weaker model can otherwise treat "the tool failed" as a minor
    // inconvenience and quietly answer from its own training memory instead —
    // exactly the fabrication this phase exists to prevent.
    const resultStr = outcome.error
      ? `Error: ${outcome.error}. You have NO real-world information for this request. Do not name any business, place, or event from your own memory — tell the user honestly that live search isn't available right now.`
      : wrapUntrustedSearchContent(outcome.results);
    toolExchanges = [...toolExchanges, { tool: parsed.tool, args: parsed.args, callId: parsed.callId, result: resultStr }];
    // loop again with the search result now in toolExchanges — the model sees it
    // on the next round and decides what to do next (another search,
    // presentRecommendation, or a plain final answer).
  }

  return { responseBody: { type: 'final', text: "That needs more research steps than I should take at once — here's what I can tell you from what I already checked." }, status: 200 };
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors);

  if (!ACTIVE_API_KEY) {
    // A configuration problem on the server, never a client-side secret leak.
    // Gemini is an optional ADDITIONAL fallback, not a replacement for Groq —
    // this check is unchanged, so an unset GEMINI_API_KEY is never treated as a
    // configuration error; it just means no automatic fallback is available.
    const missingVar = LLM_PROVIDER === 'anthropic' ? 'LLM_API_KEY' : 'GROQ_API_KEY';
    return jsonResponse(
      { error: `The AI Mentor backend is not configured yet (missing ${missingVar}). This is a server setup issue, not something wrong on your device — the local Mentor still works.` },
      503, cors
    );
  }

  // ---- Authentication: identity is derived ONLY from the verified session JWT.
  // A client-supplied user id is never trusted for anything. ----
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse({ error: 'Sign in required to use the AI Mentor.' }, 401, cors);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData || !userData.user) {
    return jsonResponse({ error: 'Your session has expired. Sign in again to use the AI Mentor.' }, 401, cors);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: 'Malformed request.' }, 400, cors);
  }

  const limitCheck = checkRequestLimits(body);
  if (!limitCheck.ok) return jsonResponse({ error: limitCheck.error }, 400, cors);

  // Recognizes 'mentor' / 'explore' / 'explore-background' (see
  // normalizeSourceTier in shared.mjs) — anything else, including an older
  // deployed frontend that predates this field entirely, defaults to 'mentor',
  // the highest-priority/most-permissive tier. Both Mentor and Explore get the
  // full Groq->Gemini router; only each tier's slice of Gemini's concurrency
  // pool differs — see GEMINI_TIER_CONCURRENCY_CAP in shared.mjs.
  const source = normalizeSourceTier(body.source);

  // ---- Response cache + in-flight dedup ----
  // Keyed by (user, source, exact message, exact toolExchanges-so-far) — see
  // makeCacheKey in shared.mjs. This absorbs the common real case (a
  // double-tap Send, or a client retry firing while the previous identical
  // request is technically still in flight) without adding any user-visible
  // behavior change on a genuine new turn.
  const cacheKey = makeCacheKey(userData.user.id, source, body);
  const now = Date.now();
  const cached = getCachedResponse(responseCache, cacheKey, now);
  if (cached) return jsonResponse(cached.responseBody, cached.status, cors);

  if (inFlightRequests.has(cacheKey)) {
    // An identical request from this same user is already being processed —
    // await and reuse that SAME result instead of starting a second, redundant
    // provider call (and, for a destructive/write tool, a second side effect).
    const result = await inFlightRequests.get(cacheKey);
    return jsonResponse(result.responseBody, result.status, cors);
  }

  const turnPromise = runMentorTurn(body, source);
  inFlightRequests.set(cacheKey, turnPromise);
  let result;
  try {
    result = await turnPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }

  // Only a genuine 200 is ever cached — caching an error (rate-limited, timed
  // out, etc.) would make a legitimate retry (e.g. right after a cooldown ends)
  // come back stale instead of actually retrying. See setCachedResponse's own
  // comment in shared.mjs.
  if (result.status === 200) setCachedResponse(responseCache, cacheKey, result, now);

  return jsonResponse(result.responseBody, result.status, cors);
});
