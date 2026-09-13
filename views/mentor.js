// ---- Life OS Personal Mentor ----
// Two modes, both implemented here:
//
// 1. LOCAL MODE (unchanged from v1.1): a deterministic keyword/pattern matcher.
//    Always available, works fully offline, never calls the network.
// 2. REAL AI MENTOR (Phase 15): calls the Supabase Edge Function at
//    supabase/functions/mentor/index.ts, which holds the actual LLM API key
//    server-side. The browser NEVER receives or stores that key — see
//    realAiAvailable()/AI_CONFIG below, which only ever store a plain endpoint URL
//    (not a secret) in localStorage. Tool EXECUTION always happens here, on the
//    client, against the user's own live local state — the backend only relays
//    messages to the LLM and tells this file which approved tool to run next.
//
// IMPORTANT: writing this file does not, by itself, make Real AI Mentor live. It
// only works once the Edge Function is actually deployed and AI_CONFIG.endpointUrl
// points at it (Settings → Real AI Mentor). Until then, realAiAvailable() is false
// and every message is answered by the local deterministic Mentor below — the app
// never silently pretends to be using a live model when it isn't.

// Phase 2: trimmed to a small, curated set (was 8) — a modern assistant surfaces a
// few useful shortcuts, not a wall of buttons. Existing Local Mode intent-matching
// in mentorParseIntent() is untouched; a couple of these newer phrasings simply
// aren't in its regex set yet (same honest "not sure" fallback as any other
// unmatched phrase in Local Mode — not a regression, just not deepened yet).
const MENTOR_SUGGESTED_PROMPTS=[
  'What should I do tonight?',
  'Help me plan my week',
  'What should I focus on?',
  'Give me something new to try'
];

let mentorPendingAction=null; // ephemeral confirmation state, never persisted
let mentorBusy=false;
// Phase 2: UI-only, never persisted. mentorShowFullConversation reveals the rest of
// the CURRENT conversation past the recent-messages window; mentorHistoryPanelOpen/
// mentorExpandedArchiveId control the separate archived-conversations panel.
const MENTOR_RECENT_MESSAGE_COUNT=8;
let mentorShowFullConversation=false;
let mentorHistoryPanelOpen=false;
let mentorExpandedArchiveId=null;
// D8: bumped by cloudSignOut() (sync.js) so an in-flight Real AI request started
// before sign-out gets its reply silently discarded instead of posting into the
// conversation after the UI has already moved to signed-out — the request itself
// was legitimately authorized when sent, this is only about not showing a stale
// result afterward.
let mentorRequestGeneration=0;

function mentorPushMessage(role,text,opts){
  const msg={role,text,at:new Date().toISOString()};
  if(opts&&opts.isError) msg.isError=true;
  if(opts&&opts.recommendation) msg.recommendation=opts.recommendation;
  S.mentorMessages.push(msg);
  if(S.mentorMessages.length>50) S.mentorMessages=S.mentorMessages.slice(-50);
}
// Phase 2: replaces the old destructive "Clear conversation" (which permanently
// erased history behind a confirm() dialog). New Chat is non-destructive — the
// current conversation is archived, never deleted, so no confirmation is needed.
function mentorStartNewChat(){
  mentorClearRetryCountdown();
  if(!(S.mentorMessages||[]).length)return; // already a fresh chat — nothing to archive
  S.mentorArchivedConversations=S.mentorArchivedConversations||[];
  S.mentorArchivedConversations.unshift({id:uid('conv'),endedAt:new Date().toISOString(),messages:S.mentorMessages});
  if(S.mentorArchivedConversations.length>20) S.mentorArchivedConversations=S.mentorArchivedConversations.slice(0,20);
  S.mentorMessages=[];
  mentorPendingAction=null;
  realMentorPendingConfirmation=null;
  mentorLastFailedText=null;
  mentorShowFullConversation=false;
  save();render('mentor');
  toast('Started a new chat — your previous conversation is saved in History.');
}
function mentorToggleFullConversation(){ mentorShowFullConversation=!mentorShowFullConversation; render('mentor'); }
function mentorToggleHistoryPanel(){ mentorHistoryPanelOpen=!mentorHistoryPanelOpen; mentorExpandedArchiveId=null; render('mentor'); }
function mentorToggleArchivedConversation(id){ mentorExpandedArchiveId=(mentorExpandedArchiveId===id)?null:id; render('mentor'); }
// Lightweight, dependency-free formatter for the small set of markdown constructs
// real model responses actually use (bold, bullet/numbered lists, paragraph breaks).
// Operates on ALREADY html-escaped text, so it only ever wraps existing safe text in
// additional safe tags — it can never reintroduce unescaped HTML from model or user
// content, regardless of what the model outputs.
function mentorFormatMessageHtml(rawText){
  const escaped=esc(rawText||'');
  const lines=escaped.split('\n');
  const blocks=[]; let listItems=null, listType=null;
  const flushList=()=>{ if(listItems){ blocks.push(`<${listType}>${listItems.join('')}</${listType}>`); listItems=null; listType=null; } };
  for(const line of lines){
    const bullet=line.match(/^\s*[-*]\s+(.*)$/);
    const numbered=line.match(/^\s*\d+[.)]\s+(.*)$/);
    if(bullet){
      if(listType!=='ul'){ flushList(); listType='ul'; listItems=[]; }
      listItems.push(`<li>${bullet[1]}</li>`);
    }else if(numbered){
      if(listType!=='ol'){ flushList(); listType='ol'; listItems=[]; }
      listItems.push(`<li>${numbered[1]}</li>`);
    }else{
      flushList();
      if(line.trim()!=='') blocks.push(`<p>${line}</p>`);
    }
  }
  flushList();
  return blocks.join('').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
}
function mentorRenderMessageRow(m){
  const isUser=m.role==='user';
  const roleClass=isUser?'mentor-msg-user':(m.isError?'mentor-msg-mentor mentor-msg-error':'mentor-msg-mentor');
  const body=isUser?`<p>${esc(m.text)}</p>`:mentorFormatMessageHtml(m.text);
  const recCard=(!isUser&&m.recommendation)?mentorRenderRecommendationCard(m.recommendation):'';
  return `<div class="mentor-msg ${roleClass}"><div class="mentor-msg-role">${isUser?'You':'Mentor'}</div><div class="mentor-msg-body">${body}</div>${recCard}</div>`;
}
function mentorArchiveSummary(conv){
  const first=(conv.messages||[]).find(m=>m.role==='user');
  const label=first?first.text:'(empty conversation)';
  const isOpen=mentorExpandedArchiveId===conv.id;
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:center;cursor:pointer" onclick="mentorToggleArchivedConversation('${conv.id}')"><div class="small">${esc(label.length>60?label.slice(0,60)+'…':label)}</div><span class="small muted">${esc(relativeTimeLabel(conv.endedAt))}</span></div>${isOpen?`<div style="margin-top:8px">${(conv.messages||[]).map(mentorRenderMessageRow).join('')}</div>`:''}</div>`;
}
function mentorSuggestPrompt(text){
  const input=$('mentor_input');
  if(!input)return;
  input.value=text;
  input.focus();
}
// Phase 0: robust event binding for the suggestion buttons — a delegated listener
// attached ONCE, at script load, to `document` (which always exists and is never
// replaced) rather than a fragile inline onclick="..." attribute baked into HTML
// that render() regenerates from scratch on every navigation. Delegation means this
// keeps working no matter how many times the Mentor view's markup is rebuilt, with
// no re-binding step needed and no risk of stacking duplicate listeners (this code
// runs exactly once, since it's top-level script execution, not inside a function
// that could be called more than once). Reads the exact suggestion text back from
// the button's data-suggestion attribute — never auto-sends, only fills the input.
document.addEventListener('click',(e)=>{
  const btn=e.target.closest('.mentor-suggestion-btn');
  if(!btn)return;
  mentorSuggestPrompt(btn.dataset.suggestion||'');
});
// Phase 2: composer is now a <textarea> (supports longer/multiline messages) instead
// of a single-line <input>. Same robust delegated-listener pattern as the suggestion
// buttons above — registered once, keeps working across every re-render. Enter sends
// (matching the old input's behavior so nothing feels different for a short message);
// Shift+Enter inserts a real newline, the standard multiline-chat convention.
document.addEventListener('keydown',(e)=>{
  if(e.target&&e.target.id==='mentor_input'&&e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    sendMentorMessage();
  }
});
// Auto-grows the textarea as the user types, capped (via the .mentor-input CSS
// max-height + overflow-y:auto) so it never grows unboundedly tall.
document.addEventListener('input',(e)=>{
  if(!(e.target&&e.target.id==='mentor_input'))return;
  e.target.style.height='auto';
  e.target.style.height=Math.min(e.target.scrollHeight,150)+'px';
});
function mentorIsAffirmative(text){ return /^(yes|y|confirm|do it|go ahead|please do|sure|ok|okay)\b/i.test(text.trim()); }
function mentorRequestConfirmation(type,args,description){
  mentorPendingAction={type,args};
  return `${description} Reply "yes" to confirm, or anything else to cancel.`;
}
// A food's meal type is guessed from the current time only when the user doesn't
// specify one — a transparent UI default, not a claim about what the user actually ate.
function guessMealTypeFromTime(){
  const h=new Date().getHours();
  if(h<11) return 'Breakfast';
  if(h<15) return 'Lunch';
  if(h<21) return 'Dinner';
  return 'Snack';
}

// ---- Read helpers (thin text formatting over existing derived data — no new
// decision logic, no second source of truth) ----
function mentorNutritionToday(){
  const mt=foodTotals(S.meals.filter(x=>x.date===today()));
  const p=S.profile;
  return {mt,calLeft:p.cal-mt.cal,protLeft:p.protein-mt.prot};
}
function mentorNutritionRemaining(nutrient){
  const {calLeft,protLeft}=mentorNutritionToday();
  if(nutrient==='protein') return protLeft>=0?`You have about ${Math.round(protLeft)}g of protein left today (target ${S.profile.protein}g).`:`You're about ${Math.round(-protLeft)}g over your ${S.profile.protein}g protein target today.`;
  return calLeft>=0?`You have about ${Math.round(calLeft)} calories left today (target ${S.profile.cal}).`:`You're about ${Math.round(-calLeft)} calories over your ${S.profile.cal} target today.`;
}
function mentorSuggestMeal(maxCal,minProt){
  const {calLeft,protLeft}=mentorNutritionToday();
  const cap=maxCal!=null?maxCal:Math.max(calLeft,0)+50;
  const floor=minProt!=null?minProt:0;
  const candidates=[...(S.foodFavorites||[]),...(S.foodRecipes||[])].filter(f=>Number.isFinite(ensureNumber(f.cal,NaN)));
  const fits=candidates.filter(f=>ensureNumber(f.cal)<=cap&&ensureNumber(f.prot)>=floor).sort((a,b)=>ensureNumber(b.prot)-ensureNumber(a.prot));
  if(fits.length) return `"${fits[0].name}" fits that: ${Math.round(ensureNumber(fits[0].cal))} cal, ${Math.round(ensureNumber(fits[0].prot))}g protein.`;
  if(maxCal!=null||minProt!=null) return `I don't have a saved favorite or recipe matching that${maxCal!=null?` (under ${maxCal} cal)`:''}${minProt!=null?` (${minProt}g+ protein)`:''}. I can only suggest from what you've actually saved in Nutrition — try search there, or save a few options as favorites.`;
  if(calLeft<=0) return `You're already at or over your calorie target today (${Math.round(-calLeft)} over) — a lighter, higher-protein option would fit best if you still want to eat.`;
  return `You have about ${Math.round(calLeft)} calories and ${Math.round(Math.max(protLeft,0))}g protein left today. I don't have a saved favorite/recipe that fits — try search in Nutrition, or tell me a food and I can log it (e.g. "log 200g chicken breast").`;
}
async function mentorLogFood(quantity,unit,foodName,mealType){
  if(!foodName) return "I couldn't tell what food you meant — try \"log 200g chicken breast\".";
  const targetMeal=mealType||guessMealTypeFromTime();
  let match=null;
  // Promise.allSettled never rejects — a total network outage shows up as both
  // entries settling to 'rejected', not as a thrown exception, so it has to be
  // checked explicitly rather than relying on a wrapping try/catch to see it.
  const [usda,off]=await Promise.allSettled([searchUSDA(foodName),searchOpenFoodFacts(foodName)]);
  if(usda.status==='rejected'&&off.status==='rejected'){
    return "I couldn't reach the food database to look that up right now — your local data is unaffected. Try again, or log it manually in Nutrition.";
  }
  try{
    if(usda.status==='fulfilled'&&usda.value.length){
      const key=S.settings.usdaKey||'DEMO_KEY';
      const detail=await fetchWithTimeout(`https://api.nal.usda.gov/fdc/v1/food/${usda.value[0].fdcId}?api_key=${encodeURIComponent(key)}`);
      if(detail.ok) match=nutrientsFromFdc(await detail.json());
    }
    if(!match&&off.status==='fulfilled'&&off.value.length) match=off.value[0];
  }catch(e){ return "I couldn't reach the food database to look that up right now — your local data is unaffected. Try again, or log it manually in Nutrition."; }
  if(!match) return `I couldn't find "${foodName}" in the food database. Try logging it manually in Nutrition, or add it as a custom food.`;
  const q=quantity!=null?quantity:(match.basis?match.basis.amount:1);
  const u=unit||(match.basis?match.basis.unit:'serving');
  const ok=addMealFood(match,q,u,targetMeal);
  if(!ok) return `Found "${match.name}" but that unit isn't supported for it — try grams or servings instead.`;
  return `Logged ${q} ${NUTRITION_UNIT_LABELS[u]||u} of ${match.name} to ${targetMeal}.`;
}
function mentorBjjFocus(){
  const rec=bjjRecommendedPractice(S.bjjTechniques,S.bjjFocus,today(),3);
  if(!rec.length) return "I don't have enough BJJ curriculum data yet to suggest something specific — check the BJJ tab.";
  return `For BJJ, focus on: ${rec.map(t=>t.name).join(', ')}.`;
}
function mentorCareerSuggestion(){
  const active=(S.career||[]).find(e=>e.status==='Active'&&e.nextStep);
  if(active) return `Your active experiment "${active.name}" has a next step: ${active.nextStep}.`;
  const target=S.careerWeeklyTarget;
  if(target&&target.minutesGoal>0) return `Your career target is "${target.text||'your target'}" (${target.minutesGoal} min/week) — log a session toward it.`;
  return "You don't have an active career experiment with a next step set. Consider starting one, or check the Career tab for neglected skills.";
}
function mentorAdventureSuggestion(){
  const plannedIdea=(S.adventureIdeas||[]).find(i=>i.status==='Planned');
  if(plannedIdea) return `You have a planned idea: "${plannedIdea.title}".`;
  let uncompleted=null;
  mentorAdvSearch: for(const lvl of (S.adventureChallenges||[])){
    for(const item of lvl.items){
      if(!(S.adventureChallengeCompletions||[]).some(c=>c.level===lvl.level&&c.challengeText===item)){uncompleted=item;break mentorAdvSearch;}
    }
  }
  if(uncompleted) return `Try this from your adventure ladder: "${uncompleted}".`;
  const activeGoal=(S.adventureGoals||[]).find(g=>g.active);
  if(activeGoal) return `Your active adventure goal is "${activeGoal.name}" — do something small toward it.`;
  return fallbackAdventureIdea(today());
}
function mentorSocialSuggestion(){
  const activeGoal=(S.socialGoals||[]).find(g=>g.active);
  if(activeGoal) return `Your active social goal is "${activeGoal.name}" — one small rep toward it counts.`;
  return "Try one small social rep today — starting a short conversation is enough to count as evidence.";
}
function mentorProgressSummary(){
  const signals=collectCoachSignals(S,today());
  const reinforcement=signals.filter(s=>s.type==='reinforcement');
  if(!reinforcement.length) return "Nothing stands out as improving yet from your recent logs — that's not necessarily bad, just no strong signal either way.";
  return 'Progress: '+reinforcement.slice(0,3).map(s=>s.evidence).join(' ');
}
function mentorNeglectSummary(){
  const signals=collectCoachSignals(S,today());
  const concerns=signals.filter(s=>s.type==='bottleneck'||s.type==='consistency').sort((a,b)=>a.tier-b.tier);
  if(!concerns.length) return "Nothing looks neglected from your logged data right now.";
  return concerns.slice(0,3).map(s=>s.title+' — '+s.evidence+'.').join(' ');
}
function mentorGoalStatus(){
  const signals=collectCoachSignals(S,today());
  const blockers=signals.filter(s=>s.type==='bottleneck'&&s.tier<=2);
  if(blockers.length) return `Not quite — ${blockers[0].title.toLowerCase()}: ${blockers[0].evidence}.`;
  return "Based on your logged data, nothing is flagged as off-track right now.";
}
function mentorTodayPlan(){
  const items=mentorDailyPlan(S,today());
  if(!items.length) return "I don't have enough recent data to build a specific plan yet — log a few things across any area and ask again.";
  return "Here's what I'd prioritize today:\n"+items.map((it,i)=>`${i+1}. ${it}`).join('\n');
}
// Honest stop on live location research — see the file-header note. Never invents a
// business/event name; falls back to the user's own local Adventure data instead.
function mentorLocationPlan(location){
  const base=location
    ? `I don't have live internet/location search yet, so I can't look up real businesses, events, or hours near ${location} — I don't want to invent ones that don't exist.`
    : "I don't have live internet/location search yet, so I can't look up real local businesses or events.";
  return `${base} From your own Adventure list, though: ${mentorAdventureSuggestion()} (Real local search would need a secure server-side search API, which this app doesn't have yet.)`;
}
function mentorHandleDeleteLastFood(){
  const todays=S.meals.filter(x=>x.date===today());
  if(!todays.length) return "You haven't logged any food today, so there's nothing to delete.";
  const last=todays[todays.length-1];
  return mentorRequestConfirmation('delete_food',{id:last.id},`Delete "${last.food}" logged today?`);
}

// ---- Deterministic intent parser — keyword/pattern matching, not a language model.
// Anything unmatched returns {intent:'unknown'} and the reply is an honest "I'm not
// sure" rather than a guess, per the no-fabricated-actions requirement. ----
function mentorParseIntent(raw){
  const t=String(raw||'').toLowerCase().trim();
  if(!t) return {intent:'empty'};
  const logMatch=t.match(/^(?:log|i ate|i had)\s+(?:(\d+(?:\.\d+)?)\s*(kg|g|grams?|lb|pounds?|oz|ounces?|ml|fl ?oz|servings?)\s+(?:of\s+)?)?(.+)$/);
  if(logMatch) return {intent:'log_food',quantity:logMatch[1]?Number(logMatch[1]):null,unit:mentorNormalizeUnit(logMatch[2]),food:logMatch[3].trim()};
  if(/delete (my )?(last|latest) (food|meal)/.test(t)) return {intent:'delete_last_food'};
  if(/how much (protein|calories?)/.test(t)) return {intent:'nutrition_remaining',nutrient:/protein/.test(t)?'protein':'calories'};
  const constrainedMatch=t.match(/under (\d+)\s*cal(?:ories)?/);
  const protMatch=t.match(/(\d+)\s*g\s*(?:of\s*)?protein/);
  if(/what should i eat|give me (a|some)?\s*(dinner|lunch|breakfast|snack|meal)/.test(t)) return {intent:'suggest_meal',maxCal:constrainedMatch?Number(constrainedMatch[1]):null,minProt:protMatch?Number(protMatch[1]):null};
  if(/bjj|jiu.?jitsu/.test(t)) return {intent:'bjj_focus'};
  if(/make more money|earn more|increase (my )?income|career/.test(t)) return {intent:'career_suggestion'};
  if(/meet people|help me socially|social(ize|ly)?/.test(t)) return {intent:'suggest_social'};
  const locationMatch=t.match(/i'?m in ([a-z0-9 ,.'-]+?)[.?]?\s*(?:what should i do|today)?$/);
  if(locationMatch) return {intent:'location_plan',location:raw.slice(raw.toLowerCase().indexOf(locationMatch[1]),raw.toLowerCase().indexOf(locationMatch[1])+locationMatch[1].length).trim()};
  if(/adventurous|something fun|this weekend|weekend plan/.test(t)) return {intent:'suggest_activity'};
  if(/how am i (doing|progressing)/.test(t)) return {intent:'progress_summary'};
  if(/what am i neglecting|neglecting/.test(t)) return {intent:'neglect_summary'};
  if(/on track/.test(t)) return {intent:'goal_status'};
  if(/biggest priority|what should i (do|focus|work on)( today| next|now)?|plan my (day|evening|night)|what should i do (tonight|this evening)/.test(t)) return {intent:'today_plan'};
  return {intent:'unknown'};
}
function mentorNormalizeUnit(u){
  if(!u) return null;
  u=u.replace(/s$/,'').replace(' ','');
  if(u==='gram') return 'g';
  if(u==='pound') return 'lb';
  if(u==='ounce') return 'oz';
  if(u==='floz') return 'floz';
  if(NUTRITION_UNITS.includes(u)) return u;
  return 'serving';
}

async function mentorRespond(text){
  // A pending confirmation always takes priority over normal intent parsing —
  // otherwise a destructive action could be triggered by an unrelated later message.
  if(mentorPendingAction){
    const action=mentorPendingAction; mentorPendingAction=null;
    if(!mentorIsAffirmative(text)) return 'Okay, cancelled — nothing was changed.';
    if(action.type==='delete_food'){
      const existed=(S.meals||[]).some(x=>x.id===action.args.id);
      S.meals=(S.meals||[]).filter(x=>x.id!==action.args.id);
      return existed?'Deleted.':'That entry was already gone — nothing to do.';
    }
    return "I don't recognize that confirmed action anymore — nothing was changed.";
  }
  const intent=mentorParseIntent(text);
  switch(intent.intent){
    case 'empty': return 'Ask me something like "What should I do today?" or tap a suggestion below.';
    case 'log_food': return await mentorLogFood(intent.quantity,intent.unit,intent.food,null);
    case 'delete_last_food': return mentorHandleDeleteLastFood();
    case 'nutrition_remaining': return mentorNutritionRemaining(intent.nutrient);
    case 'suggest_meal': return mentorSuggestMeal(intent.maxCal,intent.minProt);
    case 'bjj_focus': return mentorBjjFocus();
    case 'career_suggestion': return mentorCareerSuggestion();
    case 'suggest_social': return mentorSocialSuggestion();
    case 'suggest_activity': return mentorAdventureSuggestion();
    case 'location_plan': return mentorLocationPlan(intent.location);
    case 'progress_summary': return mentorProgressSummary();
    case 'neglect_summary': return mentorNeglectSummary();
    case 'goal_status': return mentorGoalStatus();
    case 'today_plan': return mentorTodayPlan();
    default: return "I'm not sure how to help with that yet. I can answer things like: what should I do today, what should I eat, how much protein do I have left, log a food, what should I work on in BJJ, how am I progressing, or what am I neglecting.";
  }
}
// ==================================================
// Real AI Mentor (Phase 15) — client side
// ==================================================
// Endpoint config only — NEVER a secret. The actual LLM API key lives only in the
// Edge Function's environment (Supabase secrets), never here, never in localStorage,
// never in S, never in an export.
const AI_CONFIG_KEY='lifeos-ai-config';
// Preconfigured production Mentor backend for this deployment (Phase 15). Not a
// secret — just this project's own Edge Function address. A saved localStorage
// config (e.g. from Settings, for local dev against a different project) always
// wins over this default, so pointing at a different backend during development
// remains a one-field override, never a rebuild.
const PRODUCTION_MENTOR_ENDPOINT='https://ubmntbusoooucbdkeqzp.supabase.co/functions/v1/mentor';
function loadAiConfig(){
  let raw=null;
  try{ raw=JSON.parse(localStorage.getItem(AI_CONFIG_KEY)||'null'); }catch(e){ raw=null; }
  const saved=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
  // A blank saved endpointUrl is never a deliberate choice (there's nothing to
  // point at) — treat it as "not configured" and fall through to the production
  // default, rather than letting a stale/legacy empty value from before this
  // default existed permanently mask it. A genuinely different saved URL (e.g.
  // local dev against another project) still overrides, same as `enabled`.
  const endpointUrl=(typeof saved.endpointUrl==='string'&&saved.endpointUrl.trim())?saved.endpointUrl:PRODUCTION_MENTOR_ENDPOINT;
  const enabled=('enabled' in saved)?!!saved.enabled:true;
  return {endpointUrl,enabled};
}
let AI_CONFIG=loadAiConfig();
function saveAiConfig(patch){
  AI_CONFIG={...AI_CONFIG,...patch};
  try{ localStorage.setItem(AI_CONFIG_KEY,JSON.stringify(AI_CONFIG)); }catch(e){}
}
function getAiConfig(){ return {...AI_CONFIG}; }
// Rendered from Settings (views/settings.js) — kept here since this file owns
// AI_CONFIG, matching how sync.js owns CLOUD and settings.js just reads it.
function renderRealAiMentorSettingsCard(){
  const cfg=getAiConfig();
  const signedIn=!!(typeof CLOUD!=='undefined'&&CLOUD&&CLOUD.user);
  return `<div class="card" style="margin-top:12px"><h3>Real AI Mentor</h3>
<p class="muted">Optional: connect the Mentor tab to a real AI backend you deploy yourself (a Supabase Edge Function — see README "Real AI Mentor setup"). The URL below is not a secret, just the address of your own deployed function — the actual AI provider API key lives only on that server, never in this app.</p>
<label>Backend endpoint URL<input id="ai_endpoint_url" class="input" placeholder="https://your-project.supabase.co/functions/v1/mentor" value="${esc(cfg.endpointUrl||'')}"></label>
<label class="row" style="margin-top:8px;align-items:center;gap:8px"><input id="ai_enabled_toggle" type="checkbox" ${cfg.enabled?'checked':''}> Enable Real AI Mentor</label>
<button class="btn secondary" style="margin-top:9px" onclick="saveAiConfigFromSettings()">Save</button>
<p class="small muted" style="margin-top:8px">${signedIn?"You're signed in, so the Mentor can authenticate with this backend once configured and deployed.":'Sign in above first — the AI backend verifies your identity from your Life OS account session, not a value the browser can just assert.'}</p>
</div>`;
}
function saveAiConfigFromSettings(){
  saveAiConfig({endpointUrl:($('ai_endpoint_url')?.value||'').trim(),enabled:!!$('ai_enabled_toggle')?.checked});
  render('settings');toast('Real AI Mentor settings saved');
}
// Real AI requires: configured + enabled + online + signed in (identity is verified
// server-side from the Supabase session — there is no other way to authenticate).
function realAiConfigured(){ return !!(AI_CONFIG.endpointUrl&&AI_CONFIG.enabled); }
function realAiAvailable(){
  return realAiConfigured()
    && typeof navigator!=='undefined' && navigator.onLine!==false
    && !!(typeof SB!=='undefined'&&SB) && !!(typeof CLOUD!=='undefined'&&CLOUD&&CLOUD.user);
}

// The old client-side "20 messages/hour" courtesy counter (aiRateLimitAllows(),
// keyed under localStorage 'lifeos-ai-ratelimit') was removed at the user's
// explicit request on this private, single-user app — it was never a real
// security control anyway (a determined caller could bypass it by calling the
// endpoint directly). Actual abuse/runaway-cost protection is unchanged and
// lives entirely server-side: MAX_TOOL_CALLS_PER_REQUEST, per-call timeouts,
// payload/result size limits, the Tavily result cap, and normal provider error
// handling (see shared.mjs / index.ts) — none of that was touched.

// ---- Tool registry: names/types MUST match supabase/functions/mentor/shared.mjs
// exactly (the client has no module loader to import that file directly, since the
// app intentionally stays framework/build-free — see README "Real AI Mentor
// architecture"). Every tool reuses an existing Life OS function; none of this
// duplicates business logic that already exists elsewhere in the app. ----
const REAL_MENTOR_TOOLS={
  getTodayPlan:{type:'read',run:()=>({items:mentorDailyPlan(S,today())})},
  getNutritionProgress:{type:'read',run:()=>{const {mt,calLeft,protLeft}=mentorNutritionToday();return {cal:Math.round(mt.cal),prot:Math.round(mt.prot),carbs:Math.round(mt.carbs),fat:Math.round(mt.fat),calLeft:Math.round(calLeft),protLeft:Math.round(protLeft),calTarget:S.profile.cal,protTarget:S.profile.protein};}},
  getBJJFocus:{type:'read',run:()=>({recommended:bjjRecommendedPractice(S.bjjTechniques,S.bjjFocus,today(),3).map(t=>({name:t.name,level:t.level,status:t.status,confidence:t.confidence}))})},
  getTrainingProgress:{type:'read',run:()=>({recentSessions:S.workouts.slice(-5).map(w=>({date:w.date,template:w.template||'Workout'})),activeWorkout:!!S.activeWorkout})},
  getBodyProgress:{type:'read',run:()=>{const trend=weightRateOfChange(S.weightLog,today());return {weight:S.profile.weight,target:S.profile.targetWeight,ratePerWeek:trend?Math.round(trend.ratePerWeek*100)/100:null};}},
  getMoneySummary:{type:'read',run:()=>{const p=S.profile;const monthTx=moneyTransactionsInMonth(S.money,monthKey(today()));return {savings:p.savings,savingsGoal:p.savingsGoal,monthIncome:Math.round(sumByType(monthTx,'income')),monthExpense:Math.round(sumByType(monthTx,'expense'))};}},
  getCareerNextStep:{type:'read',run:()=>{const active=(S.career||[]).find(e=>e.status==='Active'&&e.nextStep);return {activeExperiment:active?active.name:null,nextStep:active?active.nextStep:null,weeklyTarget:S.careerWeeklyTarget||null};}},
  getSocialProgress:{type:'read',run:()=>({week:socialWeeklyStats(S.social,today()),activeGoal:(S.socialGoals||[]).find(g=>g.active)?.name||null})},
  // Phase 5 (Activity Memory): enriched with a small, BOUNDED slice of real
  // history — the 8 most recent logged adventures (title/category/days-ago/
  // solo-or-group/rating) plus which categories have and haven't been tried —
  // never the full S.adventures array. rating is only ever what the user
  // explicitly entered when logging; a null rating must never be read as
  // enjoyment or dislike, only as "not rated."
  getAdventureProgress:{type:'read',run:()=>{
    const recentActivities=(S.adventures||[]).slice(-8).reverse().map(a=>({
      title:a.title||a.text||null,
      category:a.category||null,
      daysAgo:Math.max(0,Math.round((new Date(today()+'T00:00:00')-new Date((a.date||today())+'T00:00:00'))/86400000)),
      soloOrGroup:a.soloOrWithOthers||null,
      rating:(typeof a.rating==='number')?a.rating:null
    }));
    const categoriesTried=[...new Set((S.adventures||[]).map(a=>a.category).filter(Boolean))];
    const categoriesUntried=(S.adventureCategories||[]).filter(c=>!categoriesTried.includes(c));
    return {week:adventureWeeklyStats(S.adventures,today()),activeGoal:(S.adventureGoals||[]).find(g=>g.active)?.name||null,plannedIdea:(S.adventureIdeas||[]).find(i=>i.status==='Planned')?.title||null,recentActivities,categoriesTried,categoriesUntried};
  }},
  getWeeklyReview:{type:'read',run:()=>{const wk=reviewWeekInfo(today(),0);const snap=findWeeklySnapshot(S.weeklyReviewSnapshots,wk.weekStart);return snap?{priorities:snap.priorities.map(p=>({priority:p.priority,completed:p.completed})),friction:snap.friction.map(f=>f.problem),reflection:snap.reflection}:{message:'No weekly review recorded yet this week.'};}},
  getCoachSignals:{type:'read',run:()=>({signals:prioritizeCoachSignals(dedupeCoachSignals(collectCoachSignals(S,today())),5).map(s=>({domain:s.domain,type:s.type,title:s.title,evidence:s.evidence,action:s.action}))})},
  getGoals:{type:'read',run:()=>({social:(S.socialGoals||[]).filter(g=>g.active).map(g=>g.name),adventure:(S.adventureGoals||[]).filter(g=>g.active).map(g=>g.name),careerTarget:S.careerWeeklyTarget||null,savingsGoal:{current:S.profile.savings,target:S.profile.savingsGoal}})},
  getRecentActivity:{type:'read',run:()=>({workoutsLast7:S.workouts.slice(-7).length,bjjLast7:S.bjj.slice(-7).length,socialLast7:socialRepsInWindow(S.social,7,today()).length,adventureLast7:adventureRepsInWindow(S.adventures,7,today()).length})},
  logFood:{type:'write',run:async(args)=>await mentorLogFood(args.quantity??null,args.unit??null,args.foodName,args.mealType??null)},
  logBJJSession:{type:'write',run:(args)=>{
    const duration=ensureNumber(args.duration,NaN);
    if(!Number.isFinite(duration)||duration<0||duration>600) return 'Invalid session duration.';
    const type=['gi','nogi','openmat','private'].includes(args.sessionType)?args.sessionType:'gi';
    S.bjj.push({id:uid('bjj'),date:today(),type,duration,drilling:0,sparring:0,notes:(args.notes||'').slice(0,500),techniques:[],effort:null});
    save();
    return `Logged a ${type} BJJ session (${duration} min).`;
  }},
  logSocialRep:{type:'write',run:(args)=>{
    const type=SOCIAL_REP_TYPES.includes(args.repType)?args.repType:'Other';
    S.social.push({id:uid('social'),date:today(),text:(args.note||'').slice(0,500),type,duration:null,personId:null,context:'',difficulty:null,outcome:'',lesson:''});
    save();
    return `Logged a social rep: ${type}.`;
  }},
  logAdventure:{type:'write',run:(args)=>{
    const title=(args.title||'').trim().slice(0,200);
    if(!title) return 'An adventure needs a title.';
    S.adventures.push({id:uid('adventure'),date:today(),text:title,title,category:(args.category||'').slice(0,50),location:'',duration:null,cost:null,soloOrWithOthers:'',difficulty:null,novelty:null,completed:true,notes:'',whatIExperienced:'',whatILearned:''});
    save();
    return `Logged adventure: ${title}.`;
  }},
  logWorkout:{type:'write',run:(args)=>{
    const name=(args.exerciseName||'').trim().slice(0,100);
    if(!name) return 'A workout entry needs an exercise name.';
    S.workouts.push({date:today(),template:'Quick workout',exercises:[{name,logs:[{weight:'',reps:'',status:'working',rpe:'',notes:''}]}]});
    save();
    return `Logged a quick workout entry: ${name}.`;
  }},
  deleteRecentFood:{type:'destructive',run:(args)=>{
    if(!args||args.confirmed!==true) return 'Not confirmed — nothing was deleted.';
    const todays=S.meals.filter(x=>x.date===today());
    if(!todays.length) return "There's nothing logged today to delete.";
    const last=todays[todays.length-1];
    S.meals=S.meals.filter(x=>x.id!==last.id);
    save();
    return `Deleted ${last.food}.`;
  }}
};
function describeDestructiveTool(tool,args){
  if(tool==='deleteRecentFood'){
    const todays=S.meals.filter(x=>x.date===today());
    const last=todays[todays.length-1];
    return last?`I can delete your most recently logged food: ${last.food}${last.quantity?`, ${last.quantity} ${NUTRITION_UNIT_LABELS[last.unit]||last.unit}`:''}. Do you want me to delete it?`:"There's nothing recent to delete.";
  }
  return 'This action needs your confirmation before I do it — reply below.';
}
// C5 fix: mirrors MAX_TOOL_RESULT_LENGTH in supabase/functions/mentor/shared.mjs —
// truncated here too so an unexpectedly large tool result degrades to "truncated but
// still useful" instead of the whole mentor turn failing outright against the
// server-side limit. No current tool output is anywhere near this size; this is
// defense-in-depth against a future one that grows unbounded.
const MAX_REAL_MENTOR_TOOL_RESULT_LENGTH=4000;
async function runRealAiTool(toolName,args){
  const tool=REAL_MENTOR_TOOLS[toolName];
  if(!tool) return {error:`"${toolName}" is not an approved tool.`};
  try{
    const result=await tool.run(args||{});
    const raw=typeof result==='string'?result:JSON.stringify(result);
    const truncated=raw.length>MAX_REAL_MENTOR_TOOL_RESULT_LENGTH
      ?raw.slice(0,MAX_REAL_MENTOR_TOOL_RESULT_LENGTH-1)+'…'
      :raw;
    return {result:truncated};
  }catch(e){
    return {error:'That action failed to run — your data was not changed.'};
  }
}
function mentorFriendlyBackendError(e){
  const msg=String((e&&e.message)||e||'');
  if(msg==='not-signed-in') return 'Sign in to use the Real AI Mentor — it needs your account to verify the request.';
  // 'session-expired' only ever means getFreshMentorAccessToken() saw a genuine
  // AuthApiError refreshing (the refresh token itself was rejected) — not a
  // network hiccup, see 'network-error' below. supabase-js also fires a real
  // SIGNED_OUT event for this case, which sync.js's auth listener handles.
  if(msg==='session-expired') return 'Your session expired. Please sign in again.';
  // A network-flavored failure DURING token refresh — the session itself is
  // still perfectly valid, it just couldn't be refreshed this instant. Must
  // never be worded as "sign in again," per the persistent-session requirement.
  if(msg==='network-error') return "Couldn't reach the server to refresh your session. You're still signed in — this will resolve once you're back online.";
  if(typeof navigator!=='undefined'&&navigator.onLine===false) return "You're offline — the Real AI Mentor needs an internet connection.";
  // fetchWithTimeout() aborts via AbortController, which browsers surface as an
  // AbortError whose message text varies by browser (e.g. "The user aborted a
  // request.") — never as the literal word "timed out". Match the error's name,
  // not wording, so a real 20s timeout reliably gets this friendly copy instead
  // of falling through to the raw browser message below.
  if((e&&e.name==='AbortError')||/timed out/i.test(msg)) return 'The AI Mentor took too long to respond.';
  if(msg==='malformed-response') return 'The AI backend sent back something unexpected.';
  // A genuine fetch-level failure (offline mid-request, DNS/CORS/server-down) —
  // browsers report this as a TypeError with wording like "Failed to fetch" or
  // "NetworkError when attempting to fetch resource."
  if(/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the AI Mentor backend. Check your connection and try again.';
  // Every OTHER server-thrown error is tagged isServerMessage by callMentorBackend()
  // because its text is always pre-written, sanitized, user-facing copy from the
  // Edge Function itself (see index.ts/shared.mjs) — safe to show as-is. Anything
  // NOT tagged is an unanticipated raw exception (a browser/network internal, not
  // meant for a user) — never display it verbatim; log it for diagnostics instead
  // and show a generic, honest fallback.
  if(e&&e.isServerMessage&&msg) return msg;
  if(msg) console.warn('Life OS Mentor: unhandled backend error (not shown to user) —',msg);
  return 'AI Mentor is temporarily unavailable. Your Life OS data was not changed.';
}
// Returns a definitely-current access token using Supabase's own normal session
// mechanism — never a custom/permanent token scheme. getSession() alone can return
// an in-memory session whose autoRefreshToken timer simply hasn't fired yet (e.g. a
// backgrounded/throttled tab, or a session just restored on page load) — so this
// proactively calls the standard refreshSession() whenever the current token is
// already expired or within 60s of expiring, and only ever uses the resulting fresh
// token. If Supabase's own refresh genuinely fails (refresh token itself invalid/
// expired), that's a real "you need to sign in again" case — surfaced honestly,
// never papered over.
// Single-flight lock: Supabase rotates refresh tokens on every use, so two
// concurrent refreshSession() calls (e.g. Mentor and Explore both hitting the
// backend near the same moment, right as the token is about to expire) could
// race — the second call might present a refresh token the first call already
// rotated out from under it, turning a normal refresh into a spurious
// "session invalid." Every caller within the same refresh window instead awaits
// the ONE in-flight refreshSession() call already running.
// Single in-flight refresh, shared by every concurrent caller (Mentor, Explore,
// a retry — anything that needs a token near the same moment). Supabase
// rotates refresh tokens on every use, so two independent refreshSession()
// calls racing each other could have the second one present a token the first
// already rotated out from under it, turning a normal refresh into a spurious
// "session invalid." There must be exactly ONE real refreshSession() call per
// refresh window; every other caller just awaits that same promise.
let mentorTokenRefreshPromise=null;
// Returns {token, reason}. `reason` is only ever set when token is null, and
// says WHY — this is what lets callMentorBackend / mentorFriendlyBackendError
// tell a genuine "your session is gone, sign in again" apart from "the network
// hiccuped (or the refresh call itself timed out), your session is still
// fine, try again in a moment." Only a real AuthApiError (the refresh token
// itself rejected — invalid, expired, or revoked) is ever reported as needing
// to sign in again; supabase-js also fires a genuine SIGNED_OUT event for that
// exact case, which sync.js's auth listener already handles on its own.
async function getFreshMentorAccessToken(){
  // 1. Current session.
  const {data}=await SB.auth.getSession();
  let session=data&&data.session;
  // 2. No session at all — nothing to refresh.
  if(!session) return {token:null,reason:'not-signed-in'};
  const nowSec=Math.floor(Date.now()/1000);
  const expiresInSec=Number.isFinite(session.expires_at)?session.expires_at-nowSec:0;
  // 3. Plenty of time left — use the token as-is, no refresh needed.
  if(expiresInSec>=60) return {token:session.access_token,reason:null};
  // 4-6. Under 60s (or already expired): join the one shared refresh in
  // flight, or become the one caller that starts it. Bounded by the same
  // 15s timeout the rest of this file's network calls use, so a hung request
  // can never wedge every concurrent caller forever — a timeout here is
  // reported as 'network-error', never as a reason to sign out.
  if(!mentorTokenRefreshPromise){
    mentorTokenRefreshPromise=withTimeout(SB.auth.refreshSession(),15000,'Session refresh')
      // 7. ALWAYS release the lock, success or failure, so the next request
      // (once this one settles) can try again rather than staying stuck.
      .finally(()=>{ mentorTokenRefreshPromise=null; });
  }
  // 5. Every caller — including the one that just created it above — awaits
  // this exact same promise, so only one refreshSession() ever actually runs.
  let refreshed,error;
  try{
    ({data:refreshed,error}=await mentorTokenRefreshPromise);
  }catch(e){
    // The withTimeout race rejected — either a genuine timeout, or
    // refreshSession() itself threw instead of resolving with {error}.
    // Neither is ever a "sign in again" case on its own.
    return {token:null,reason:'network-error'};
  }
  if(error){
    // 9. A retryable/network-flavored AuthError vs. a genuine rejection of
    // the refresh token itself.
    const retryable=error.name==='AuthRetryableFetchError'||/network|fetch|timeout/i.test(String(error.message||''));
    return {token:null,reason:retryable?'network-error':'session-expired'};
  }
  if(!refreshed||!refreshed.session) return {token:null,reason:'session-expired'};
  // 8. A genuinely fresh access token.
  return {token:refreshed.session.access_token,reason:null};
}
async function callMentorBackend(payload){
  if(!(typeof SB!=='undefined'&&SB)) throw new Error('not-signed-in');
  const {token:accessToken,reason}=await getFreshMentorAccessToken();
  if(!accessToken) throw new Error(reason||'session-expired');
  const res=await fetchWithTimeout(AI_CONFIG.endpointUrl,{
    method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+accessToken},
    body:JSON.stringify(payload)
  },20000);
  let body;
  try{ body=await res.json(); }catch(e){ throw new Error('malformed-response'); }
  if(!res.ok){
    const err=new Error((body&&body.error)||'backend-error');
    // Marks this message as server-authored (every `error:` string the Edge
    // Function sends back is already pre-written, sanitized, user-facing copy —
    // see index.ts/shared.mjs) so mentorFriendlyBackendError() below can safely
    // display it verbatim, while any OTHER exception (a raw fetch/abort/network
    // failure with no such tag) never reaches the user as unhandled raw text.
    err.isServerMessage=true;
    // Carried as a plain number (not parsed out of message text) so the caller
    // can drive a real live countdown — see mentorStartRetryCountdown below.
    if(body&&typeof body.retryAfterSeconds==='number') err.retryAfterSeconds=body.retryAfterSeconds;
    throw err;
  }
  return body;
}
// Recursive tool-call loop, bounded by MAX_REAL_MENTOR_TOOL_CALLS — mirrors the
// server-side limit in shared.mjs so a runaway loop is caught on both sides.
const MAX_REAL_MENTOR_TOOL_CALLS=6;
async function sendRealAIMentorMessage(userText,resumeState){
  // Root cause fix: sendMentorMessage() already pushes the current user message into
  // S.mentorMessages (so it shows in the UI immediately) BEFORE calling this function.
  // Reading history as slice(-10) therefore always captured that same just-pushed
  // message as history's own last entry. The server then appended the identical text
  // again as a fresh `message` turn (buildAnthropicMessages in index.ts), producing
  // two consecutive user-role messages — invalid per Anthropic's strict user/assistant
  // alternation requirement, rejected with a 400 the client only ever saw as a generic
  // "AI provider returned an error." slice(-11,-1) takes the 10 messages BEFORE the
  // current one instead of the 10 most recent INCLUDING it, removing the duplicate.
  // Location is resolved ONCE per user message (not per tool round-trip) — this
  // is the only place a fresh device-location read happens for Mentor, per the
  // user's location mode (utils.js). 'off' mode returns null instantly with no
  // browser prompt at all; 'whileUsing' does one getCurrentPosition() call;
  // 'live' just reads whatever watchPosition() already has in memory.
  const turnState=resumeState||{
    message:userText,
    history:(S.mentorMessages||[]).slice(-11,-1).map(m=>({role:m.role,text:m.text})),
    context:buildMentorContext(S,today(),await resolveCurrentLocationForRequest()),
    toolCallCount:0,
    toolExchanges:[], // accumulates every {tool,args,callId,result} this turn, in order — see index.ts buildAnthropicMessages
    // Lets the backend's provider router give a real Mentor conversation
    // priority over Explore's background research when its free-tier Gemini
    // fallback is scarce — see buildProviderOrder in shared.mjs. Every
    // recursive continuation of this same turn (resumeState above) already
    // carries this through automatically via the spread.
    source:'mentor'
  };
  let backendData;
  try{ backendData=await callMentorBackend(turnState); }
  catch(e){ return {error:mentorFriendlyBackendError(e),retryAfterSeconds:(e&&typeof e.retryAfterSeconds==='number')?e.retryAfterSeconds:null}; }
  if(backendData.type==='tool_call'){
    // Phase 3: the server may have already run one or more of ITS OWN tool calls
    // (webSearch) before handing this one off to us, so it reports the true
    // running count — fall back to our own local increment only against an older
    // deployed backend that doesn't send toolCallCount yet.
    const nextCount=typeof backendData.toolCallCount==='number'?backendData.toolCallCount:(turnState.toolCallCount||0)+1;
    if(nextCount>MAX_REAL_MENTOR_TOOL_CALLS){
      return {text:"That question needs more steps than I should take at once — here's what I can tell you from what I already checked. Try asking something more specific."};
    }
    const def=REAL_MENTOR_TOOLS[backendData.tool];
    // A `confirmed` flag the MODEL set on its own tool call is never trusted as proof
    // a human agreed — that value comes from the LLM, not the user, and could be
    // hallucinated or injected. Every destructive tool call always routes through the
    // pending-confirmation UI first; the only place `confirmed:true` is ever actually
    // honored is resolveRealMentorPendingTool(), triggered by a real button click.
    if(def&&def.type==='destructive'){
      return {pendingTool:{tool:backendData.tool,args:backendData.args||{},callId:backendData.callId,turnState:{...turnState,toolCallCount:nextCount}}};
    }
    const outcome=await runRealAiTool(backendData.tool,backendData.args);
    return await sendRealAIMentorMessage(null,{
      ...turnState,toolCallCount:nextCount,
      toolExchanges:[...(turnState.toolExchanges||[]),{tool:backendData.tool,args:backendData.args,callId:backendData.callId,result:outcome.error?('Error: '+outcome.error):outcome.result}]
    });
  }
  // Phase 3: a server-executed presentRecommendation call surfaces here as a
  // plain final response carrying an extra `recommendation` field alongside the
  // usual text — pass it straight through unmodified into the existing Phase 2
  // recommendation-card scaffold; when absent this is exactly the old behavior.
  return {text:backendData.text||"I don't have a response for that.",recommendation:backendData.recommendation};
}
let realMentorPendingConfirmation=null;
async function resolveRealMentorPendingTool(confirmed){
  const pending=realMentorPendingConfirmation;
  if(!pending) return;
  realMentorPendingConfirmation=null;
  mentorBusy=true; save(); render('mentor');
  let outcome;
  if(!confirmed){
    outcome=await sendRealAIMentorMessage(null,{...pending.turnState,toolExchanges:[...(pending.turnState.toolExchanges||[]),{tool:pending.tool,args:pending.args,callId:pending.callId,result:'The user declined this action. Nothing was changed.'}]});
  }else{
    const toolOutcome=await runRealAiTool(pending.tool,{...pending.args,confirmed:true});
    outcome=await sendRealAIMentorMessage(null,{...pending.turnState,toolExchanges:[...(pending.turnState.toolExchanges||[]),{tool:pending.tool,args:pending.args,callId:pending.callId,result:toolOutcome.error?('Error: '+toolOutcome.error):toolOutcome.result}]});
  }
  mentorBusy=false;
  mentorPushMessage('mentor',outcome.pendingTool?describeDestructiveTool(outcome.pendingTool.tool,outcome.pendingTool.args):(outcome.text||outcome.error||'Done.'),{isError:!outcome.pendingTool&&!!outcome.error,recommendation:outcome.pendingTool?undefined:outcome.recommendation});
  if(outcome.pendingTool) realMentorPendingConfirmation=outcome.pendingTool;
  else if(outcome.error) mentorStartRetryCountdown(outcome.retryAfterSeconds);
  save();render('mentor');
}

// ---- Live 429 countdown — UI-only, never persisted, never causes a network
// request on its own. Exactly one timer can exist at a time; starting a new
// one always clears any prior one first. Every tick writes directly to the
// existing DOM node (no render() call), so this never triggers a full
// re-render — only the moment the countdown starts or ends goes through the
// normal render() path (once each), same as any other state change.
let mentorRetryCountdown=null; // {secondsLeft, timerId} while active, else null
function mentorClearRetryCountdown(){
  if(mentorRetryCountdown&&mentorRetryCountdown.timerId!=null) clearInterval(mentorRetryCountdown.timerId);
  mentorRetryCountdown=null;
}
function mentorRetryCountdownTick(){
  if(!mentorRetryCountdown) return;
  mentorRetryCountdown.secondsLeft--;
  const el=$('mentor_retry_countdown');
  if(mentorRetryCountdown.secondsLeft>0){
    if(el) el.textContent='Try again in '+mentorRetryCountdown.secondsLeft+'s';
  }else{
    if(el) el.textContent='You can try again now.';
    const btn=$('mentor_retry_btn');
    if(btn) btn.disabled=false;
    clearInterval(mentorRetryCountdown.timerId);
    mentorRetryCountdown=null;
  }
}
// seconds must be a genuine positive whole number from the provider's own
// retry-after header (see callMentorBackend) — never a guess, never started
// for any other kind of error, so there is never a fake countdown on screen.
function mentorStartRetryCountdown(seconds){
  mentorClearRetryCountdown();
  if(!Number.isFinite(seconds)||seconds<=0) return;
  mentorRetryCountdown={secondsLeft:seconds,timerId:setInterval(mentorRetryCountdownTick,1000)};
}

let mentorLastFailedText=null;
async function sendMentorMessage(){
  if(mentorBusy) return;
  const input=$('mentor_input');
  const text=(input?.value||'').trim();
  if(!text) return;
  mentorClearRetryCountdown(); // a new request always cancels any prior countdown
  mentorLastFailedText=null;
  mentorPushMessage('user',text);
  if(input) input.value='';
  mentorBusy=true;
  const myGeneration=mentorRequestGeneration;
  save();render('mentor');
  let reply, replyIsError=false, recommendation, retryAfterSeconds=null;
  if(realAiAvailable()){
    // Real AI mode never silently substitutes the deterministic local Mentor on
    // failure — that would let the user believe a canned local answer came from the
    // real model. Every failure path here shows an honest AI-unavailable message and
    // sets mentorLastFailedText so the existing Retry button (below) can resend the
    // exact same request once the underlying issue (rate limit, provider outage,
    // expired session) is resolved.
    const outcome=await sendRealAIMentorMessage(text);
    if(outcome.pendingTool){
      realMentorPendingConfirmation=outcome.pendingTool;
      reply=describeDestructiveTool(outcome.pendingTool.tool,outcome.pendingTool.args);
    }else if(outcome.error){
      mentorLastFailedText=text;
      reply=outcome.error;
      replyIsError=true;
      retryAfterSeconds=outcome.retryAfterSeconds;
    }else{
      reply=outcome.text;
      recommendation=outcome.recommendation;
    }
  }else{
    try{ reply=await mentorRespond(text); }
    catch(e){ reply="Something went wrong answering that — your data wasn't changed. Try rephrasing."; replyIsError=true; }
  }
  mentorBusy=false;
  if(myGeneration!==mentorRequestGeneration) return; // signed out mid-flight — discard this reply
  mentorPushMessage('mentor',reply,{isError:replyIsError,recommendation});
  mentorStartRetryCountdown(retryAfterSeconds); // no-op unless this was a genuine rate-limit error with a real header value — set BEFORE render so the very first paint already shows the correct starting number
  save();render('mentor');
}
function retryLastMentorMessage(){
  if(!mentorLastFailedText||mentorBusy) return;
  $('mentor_input').value=mentorLastFailedText;
  sendMentorMessage();
}

views.mentor=()=>{
  const messages=S.mentorMessages||[];
  const archived=S.mentorArchivedConversations||[];
  const hasConversation=messages.length>0;
  const realAvailable=realAiAvailable();
  const modeLabel=realAvailable
    ?'<span class="pill pill-active">REAL AI &middot; Connected</span>'
    :(realAiConfigured()
      ?`<span class="pill pill-warning">REAL AI unavailable ${!(typeof CLOUD!=='undefined'&&CLOUD&&CLOUD.user)?'&middot; sign in required':(typeof navigator!=='undefined'&&navigator.onLine===false?'&middot; offline':'')}</span>`
      :'<span class="pill">LOCAL MODE &middot; deterministic built-in coach</span>');

  const visibleMessages=mentorShowFullConversation?messages:messages.slice(-MENTOR_RECENT_MESSAGE_COUNT);
  // Count of messages hidden when COLLAPSED — used for the toggle's label whether
  // currently expanded or not, so "Show fewer messages" doesn't lose that number.
  const earlierCount=Math.max(messages.length-MENTOR_RECENT_MESSAGE_COUNT,0);

  // Phase 2 landing state: only shown when there's no active conversation, so a
  // fresh Mentor open (or right after New Chat) feels intentional rather than blank.
  const landingBlock=!hasConversation?`<div class="mentor-landing"><h2>Ask me anything.</h2><p class="muted">Decisions, training, money, career, social situations, ideas, plans, or something to actually go do tonight — ask like you would a sharp friend who happens to know your Life OS.</p></div>`:'';

  const conversationBlock=hasConversation?`<div class="mentor-conversation">
${earlierCount>0?`<button type="button" class="btn secondary mentor-show-earlier" onclick="mentorToggleFullConversation()">${mentorShowFullConversation?'Show fewer messages':`Show ${earlierCount} earlier message${earlierCount===1?'':'s'}`}</button>`:''}
${visibleMessages.map(mentorRenderMessageRow).join('')}
${mentorBusy?'<div class="mentor-typing"><span></span><span></span><span></span></div>':''}
${realMentorPendingConfirmation?`<div class="row" style="margin-top:8px"><button class="btn danger" onclick="resolveRealMentorPendingTool(true)">Yes, do it</button><button class="btn secondary" onclick="resolveRealMentorPendingTool(false)">No, cancel</button></div>`:''}
${(!mentorBusy&&mentorLastFailedText)?`${mentorRetryCountdown?`<div id="mentor_retry_countdown" class="small muted" style="margin-top:8px">Try again in ${mentorRetryCountdown.secondsLeft}s</div>`:''}<button id="mentor_retry_btn" type="button" class="btn secondary" style="margin-top:8px" onclick="retryLastMentorMessage()" ${mentorRetryCountdown?'disabled':''}>Retry</button>`:''}
</div>`:'';

  const historyPanel=mentorHistoryPanelOpen?`<div class="card mentor-history-panel"><h3 style="margin:0 0 8px">Past conversations</h3>${archived.length?archived.map(mentorArchiveSummary).join(''):'<div class="empty">No earlier conversations yet.</div>'}</div>`:'';

  return `<div class="mentor-shell">
<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
${modeLabel}
<div class="row" style="gap:6px">${archived.length?`<button type="button" class="btn secondary" onclick="mentorToggleHistoryPanel()">${mentorHistoryPanelOpen?'Hide history':'History'}</button>`:''}${hasConversation?`<button type="button" class="btn secondary" onclick="mentorStartNewChat()">New chat</button>`:''}<button type="button" class="btn secondary" onclick="go('settings')">Configure</button></div>
</div>
${landingBlock}
${conversationBlock}
${historyPanel}
<div class="mentor-composer">
<div class="row" style="align-items:flex-end;flex-wrap:nowrap">
<textarea id="mentor_input" class="input mentor-input" placeholder="Ask me anything…" rows="1"></textarea>
<button type="button" class="btn mentor-send-btn" onclick="sendMentorMessage()" ${mentorBusy?'disabled':''}>${mentorBusy?'Sending…':'Send'}</button>
</div>
<div class="row mentor-suggestions">${MENTOR_SUGGESTED_PROMPTS.map(p=>`<button type="button" class="btn secondary mentor-suggestion-btn" data-suggestion="${esc(p)}">${esc(p)}</button>`).join('')}</div>
</div>
</div>`;
};
