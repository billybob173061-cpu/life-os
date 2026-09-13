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

// One LLM call (either provider) plus response parsing — exactly what the
// handler used to do inline. Pulled out so the tool-loop below can call it
// repeatedly for server-executed tools without duplicating the fetch/error
// handling for each provider.
async function callLlmOnce(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let r;
    if (LLM_PROVIDER === 'anthropic') {
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
    } else {
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
      // No automatic retry here, on purpose — the user explicitly asked not to
      // wait through a blind retry/backoff. This fails fast. Groq sends a
      // `retry-after` header on 429s — passed through as a plain NUMBER
      // (retryAfterSeconds), not baked into the message text, so the client can
      // drive a real live countdown instead of a static guess. Only a genuine
      // whole-number header counts; anything else stays null so the client
      // never fakes a countdown it doesn't actually have.
      const retryAfterRaw = r.headers.get('retry-after');
      const retryAfterSeconds = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? parseInt(retryAfterRaw, 10) : null;
      return { httpError: { error: 'The AI provider is rate-limiting requests right now.', retryAfterSeconds }, status: 429 };
    }
    if (!r.ok) {
      return { httpError: { error: 'The AI provider returned an error. Your Life OS data was not changed.' }, status: 502 };
    }
    const llmResponse = await r.json();
    const parsed = LLM_PROVIDER === 'anthropic' ? parseAnthropicResponse(llmResponse) : parseOpenAIResponse(llmResponse);
    return { parsed };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      return { httpError: { error: 'The AI Mentor took too long to respond. Try again.' }, status: 504 };
    }
    return { httpError: { error: 'Could not reach the AI provider right now. Your local data is unaffected.' }, status: 502 };
  }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors);

  if (!ACTIVE_API_KEY) {
    // A configuration problem on the server, never a client-side secret leak.
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

  // ---- Phase 3: bounded internal loop for server-executed tools ----
  // Most tool calls (getTodayPlan, logFood, etc.) still go straight back to the
  // client exactly as before — this loop only ever intercepts webSearch and
  // presentRecommendation, which must run here because their execution needs a
  // server-only secret (webSearch) or is pure structured output with no client
  // work to do (presentRecommendation). toolCallCount is shared across BOTH
  // server-side loop iterations and client-side round-trips — it's returned to
  // the client on every hand-off so its own recursion keeps counting from the
  // correct number instead of silently under-counting the calls made in here.
  let toolCallCount = typeof body.toolCallCount === 'number' ? body.toolCallCount : 0;
  let toolExchanges = Array.isArray(body.toolExchanges) ? [...body.toolExchanges] : [];

  for (let i = 0; i < MAX_TOOL_CALLS_PER_REQUEST + 1; i++) {
    const { parsed, httpError, status } = await callLlmOnce({ ...body, toolCallCount, toolExchanges });
    if (httpError) return jsonResponse(httpError, status, cors);

    if (parsed.type !== 'tool_call') {
      // Plain final text — nothing server-side to do with it.
      return jsonResponse(parsed, 200, cors);
    }

    const def = findToolDefinition(parsed.tool);
    if (!def || def.runsOn !== 'server') {
      // A normal client-executed tool — unchanged behavior, just now also
      // reporting the authoritative toolCallCount so the client's own
      // recursion (sendRealAIMentorMessage in views/mentor.js) stays in sync
      // with however many server-side steps already happened this turn.
      return jsonResponse({ ...parsed, toolCallCount: toolCallCount + 1 }, 200, cors);
    }

    toolCallCount += 1;
    if (toolCallCount > MAX_TOOL_CALLS_PER_REQUEST) {
      return jsonResponse({ type: 'final', text: "That needs more research steps than I should take at once — here's what I can tell you from what I already checked. Try asking something more specific." }, 200, cors);
    }

    if (parsed.tool === 'presentRecommendation') {
      // Structured final answer — ends the turn immediately, never loops back.
      return jsonResponse({ type: 'final', text: String((parsed.args && parsed.args.message) || ''), recommendation: buildRecommendationFromArgs(parsed.args) }, 200, cors);
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
    // on the next callLlmOnce and decides what to do next (another search,
    // presentRecommendation, or a plain final answer).
  }

  return jsonResponse({ type: 'final', text: "That needs more research steps than I should take at once — here's what I can tell you from what I already checked." }, 200, cors);
});
