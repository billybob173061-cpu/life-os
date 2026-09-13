// ---- Explore (Phase 4) ----
// Explore absorbs the old Adventure tab's data and functionality (goals, ideas,
// history, ladder, experiments, categories, weekly target — all untouched below,
// just renamed from render('adventure') to render('explore')) and adds a modern
// discovery layer on top of the EXACT SAME Phase 3 research infrastructure Mentor
// uses (sendRealAIMentorMessage / webSearch / presentRecommendation / Tavily) —
// no second search system, no new Edge Function code, no new server calls.
//
// Explore is a visual discovery surface, not a second chat: a discovery request
// is built as a one-off turnState (no Mentor conversation history attached) and
// sent straight to sendRealAIMentorMessage(null, turnState), reusing 100% of the
// existing tool loop, validation, and security rules server-side.

const ADVENTURE_SOLO_OPTIONS=['Solo','With others'];
const ADVENTURE_IDEA_STATUSES=['Idea','Planned','Done','Dropped'];
// Static, offline, curated fallback list — never pretends to know local events or
// real-time availability. Deterministic per date (stable within a day) so the
// suggestion doesn't change on every re-render.
const ADVENTURE_FALLBACK_IDEAS=['Explore a nearby town you have never walked around','Try a new restaurant alone','Attend a local event','Visit a museum or gallery','Take a scenic drive and photograph something','Try a creative class','Go to a BJJ open mat','Take a different route somewhere familiar','Spend an hour somewhere new nearby'];
function fallbackAdventureIdea(asOf){
  let hash=0; for(let i=0;i<asOf.length;i++) hash=(hash*31+asOf.charCodeAt(i))>>>0;
  return ADVENTURE_FALLBACK_IDEAS[hash%ADVENTURE_FALLBACK_IDEAS.length];
}
// Priority order per spec Section 10: planned idea -> uncompleted challenge -> active
// goal -> simple fallback. (Today's card uses a different, separately-specified order.)
function nextAdventureSuggestion(){
  const plannedIdea=(S.adventureIdeas||[]).find(i=>i.status==='Planned');
  if(plannedIdea) return `Planned: ${esc(plannedIdea.title)}`;
  let uncompleted=null;
  adventureChallengeSearch: for(const lvl of (S.adventureChallenges||[])){
    for(const item of lvl.items){
      if(!(S.adventureChallengeCompletions||[]).some(c=>c.level===lvl.level&&c.challengeText===item)){uncompleted=item;break adventureChallengeSearch;}
    }
  }
  if(uncompleted) return `Try: ${esc(uncompleted)}`;
  const activeGoal=(S.adventureGoals||[]).find(g=>g.active);
  if(activeGoal) return `Goal: ${esc(activeGoal.name)}`;
  return esc(fallbackAdventureIdea(today()));
}

// ---- Adventure record logging: Title -> category -> optional details -> Log ----
// Unchanged from the old Adventure tab, plus an optional 1-5 `rating` (additive,
// backward-compatible — old entries simply have no rating and just don't show stars).
function logAdventure(){
  const title=($('adv_title').value||'').trim();
  if(!title){toast('Give it a short title');return}
  const category=$('adv_category').value||'';
  const location=($('adv_location').value||'').trim();
  const durationRaw=$('adv_duration').value;
  const duration=durationRaw===''?null:ensureNumber(durationRaw,NaN);
  const costRaw=$('adv_cost').value;
  const cost=costRaw===''?null:ensureNumber(costRaw,NaN);
  const soloOrWithOthers=$('adv_solo').value||'';
  const diffRaw=$('adv_difficulty').value;
  const novRaw=$('adv_novelty').value;
  const ratingRaw=$('adv_rating')?$('adv_rating').value:'';
  if(duration!==null&&(!Number.isFinite(duration)||duration<0)){toast('Duration must be zero or more minutes');return}
  if(cost!==null&&(!Number.isFinite(cost)||cost<0)){toast('Cost must be zero or more');return}
  let difficulty=null,novelty=null,rating=null;
  if(diffRaw!==''){difficulty=ensureNumber(diffRaw,NaN); if(!Number.isFinite(difficulty)||difficulty<1||difficulty>5){toast('Difficulty should be between 1 and 5, or left blank');return}}
  if(novRaw!==''){novelty=ensureNumber(novRaw,NaN); if(!Number.isFinite(novelty)||novelty<1||novelty>5){toast('Novelty should be between 1 and 5, or left blank');return}}
  if(ratingRaw){rating=ensureNumber(ratingRaw,NaN); if(!Number.isFinite(rating)||rating<1||rating>5) rating=null;}
  S.adventures.push({id:uid('adventure'),date:today(),text:title,title,category,location,duration,cost,soloOrWithOthers,difficulty,novelty,rating,completed:true,notes:'',whatIExperienced:'',whatILearned:''});
  save();render('explore');toast('Adventure logged — that\'s evidence you got out.');
}
function deleteAdventure(id){
  if(!confirm('Delete this adventure? This cannot be undone.'))return;
  S.adventures=(S.adventures||[]).filter(x=>x.id!==id);
  save();render('explore');toast('Deleted');
}
// C7: practical edit for a mistaken title/duration/notes/rating on an already-logged
// adventure — reuses the app's existing prompt()-based quick-edit pattern rather
// than a new inline form.
function editAdventure(id){
  const a=(S.adventures||[]).find(x=>x.id===id);
  if(!a){toast('That adventure no longer exists');return}
  const titleRaw=prompt('Title:',a.title||a.text||'');
  if(titleRaw===null)return;
  if(!titleRaw.trim()){toast('Give it a short title');return}
  const durationRaw=prompt('Duration in minutes (optional, blank = none):',a.duration!=null?a.duration:'');
  if(durationRaw===null)return;
  let duration=null;
  if(durationRaw.trim()!==''){
    duration=ensureNumber(durationRaw,NaN);
    if(!Number.isFinite(duration)||duration<0){toast('Duration must be zero or more minutes');return}
  }
  const ratingRaw=prompt('Rating 1-5 (optional, blank = none):',a.rating!=null?a.rating:'');
  if(ratingRaw===null)return;
  let rating=null;
  if(ratingRaw.trim()!==''){
    rating=ensureNumber(ratingRaw,NaN);
    if(!Number.isFinite(rating)||rating<1||rating>5){toast('Rating should be between 1 and 5, or left blank');return}
  }
  const notesRaw=prompt('Notes (optional):',a.notes||'');
  if(notesRaw===null)return;
  a.title=titleRaw.trim();
  a.text=a.title;
  a.duration=duration;
  a.rating=rating;
  a.notes=notesRaw.trim();
  save();render('explore');toast('Adventure updated');
}
let adventureHistoryFilter='all';
function setAdventureHistoryFilter(f){adventureHistoryFilter=f;render('explore');}
// Index-based wrapper so a user- or import-controlled category name is never
// interpolated directly into an inline onclick string (esc() protects HTML/attribute
// context, but not a JS-string-inside-an-attribute context, which a crafted category
// name containing a quote could otherwise break out of).
function setAdventureHistoryFilterByIndex(i){
  const c=(S.adventureCategories||[])[i];
  if(c!==undefined) setAdventureHistoryFilter(c);
}

// ---- Categories (editable/extendable) ----
function addAdventureCategory(){
  const name=($('adv_new_category').value||'').trim();
  if(!name){toast('Enter a category name');return}
  if((S.adventureCategories||[]).some(c=>sameExerciseName(c,name))){toast('That category already exists');return}
  S.adventureCategories.push(name);
  save();render('explore');toast('Category added');
}

// ---- Ideas ("Saved Ideas" in the new Explore UI — same underlying data) ----
function createAdventureIdea(){
  const title=($('aidea_title').value||'').trim();
  if(!title){toast('Name the idea');return}
  const category=$('aidea_category').value||'';
  const costRaw=$('aidea_cost').value;
  const estimatedCost=costRaw===''?null:ensureNumber(costRaw,NaN);
  const durRaw=$('aidea_duration').value;
  const estimatedDuration=durRaw===''?null:ensureNumber(durRaw,NaN);
  if(estimatedCost!==null&&(!Number.isFinite(estimatedCost)||estimatedCost<0)){toast('Estimated cost must be zero or more');return}
  if(estimatedDuration!==null&&(!Number.isFinite(estimatedDuration)||estimatedDuration<0)){toast('Estimated duration must be zero or more');return}
  const soloOrGroup=$('aidea_solo').value||'';
  S.adventureIdeas.push({id:uid('aidea'),title,category,estimatedCost,estimatedDuration,difficulty:null,soloOrGroup,notes:'',status:'Idea'});
  save();render('explore');toast('Idea saved');
}
// A fast, single-field "capture it before you forget it" path for the Explore
// quick-add box — still just an ordinary S.adventureIdeas entry underneath, so it
// works everywhere the fuller form's entries do (mark done / convert / delete).
function quickSaveExploreIdea(){
  const input=$('explore_quick_idea');
  const title=(input&&input.value||'').trim();
  if(!title){toast('Type an idea first');return}
  S.adventureIdeas.push({id:uid('aidea'),title,category:'',estimatedCost:null,estimatedDuration:null,difficulty:null,soloOrGroup:'',notes:'',status:'Idea'});
  if(input) input.value='';
  save();render('explore');toast('Saved');
}
function updateIdeaStatus(id,status){
  const i=(S.adventureIdeas||[]).find(x=>x.id===id); if(!i)return;
  i.status=status; save();render('explore');
}
function convertIdeaToAdventure(id){
  const i=(S.adventureIdeas||[]).find(x=>x.id===id); if(!i)return;
  S.adventures.push({id:uid('adventure'),date:today(),text:i.title,title:i.title,category:i.category,location:'',duration:i.estimatedDuration,cost:i.estimatedCost,soloOrWithOthers:i.soloOrGroup,difficulty:i.difficulty,novelty:null,rating:null,completed:true,notes:i.notes||'',whatIExperienced:'',whatILearned:''});
  i.status='Done';
  save();render('explore');toast('Logged as a real adventure');
}
function deleteAdventureIdea(id){
  if(!confirm('Delete this idea? This cannot be undone.'))return;
  S.adventureIdeas=(S.adventureIdeas||[]).filter(x=>x.id!==id);
  save();render('explore');toast('Idea deleted');
}

// ---- Goals ----
function createAdventureGoal(){
  const name=($('agoal_name').value||'').trim();
  if(!name){toast('Name the goal');return}
  const description=($('agoal_desc').value||'').trim();
  const freqRaw=$('agoal_freq').value;
  const targetFrequency=freqRaw===''?null:ensureNumber(freqRaw,NaN);
  if(targetFrequency!==null&&(!Number.isFinite(targetFrequency)||targetFrequency<0)){toast('Target frequency must be zero or more');return}
  S.adventureGoals.push({id:uid('agoal'),name,description,targetFrequency,active:true,createdDate:today()});
  save();render('explore');toast('Goal created');
}
function toggleAdventureGoalActive(id){
  const g=(S.adventureGoals||[]).find(x=>x.id===id); if(!g)return;
  g.active=!g.active; save();render('explore');
}
function deleteAdventureGoal(id){
  if(!confirm('Delete this goal? This cannot be undone.'))return;
  S.adventureGoals=(S.adventureGoals||[]).filter(x=>x.id!==id);
  save();render('explore');toast('Goal deleted');
}

// ---- Weekly target ----
function setAdventureWeeklyTarget(){
  const experiences=Math.max(0,ensureNumber($('atarget_exp').value,0));
  const minutes=Math.max(0,ensureNumber($('atarget_min').value,0));
  S.adventureWeeklyTarget={experiences,minutes};
  save();render('explore');toast('Weekly target saved');
}

// ---- Experiments: a disappointing outcome still counts if you actually did it ----
function createAdventureExperiment(){
  const title=($('aexp_title').value||'').trim();
  if(!title){toast('Name the experiment');return}
  const whatIPlanned=($('aexp_plan').value||'').trim();
  S.adventureExperiments.push({id:uid('aexp'),title,date:today(),whatIPlanned,whatHappened:'',whatILearned:'',difficulty:null,completed:false});
  save();render('explore');toast('Experiment created');
}
function updateAdventureExperimentText(id,field,value){
  const e=(S.adventureExperiments||[]).find(x=>x.id===id); if(!e)return;
  e[field]=value; save();
}
function setAdventureExperimentDifficulty(id,value){
  const e=(S.adventureExperiments||[]).find(x=>x.id===id); if(!e)return;
  e.difficulty=value===''?null:Math.max(1,Math.min(5,ensureNumber(value,NaN)));
  save();render('explore');
}
function completeAdventureExperiment(id){
  const e=(S.adventureExperiments||[]).find(x=>x.id===id); if(!e)return;
  e.completed=true; save();render('explore');toast('Logged as evidence — the outcome doesn\'t matter, doing it does');
}
function deleteAdventureExperiment(id){
  if(!confirm('Delete this experiment? This cannot be undone.'))return;
  S.adventureExperiments=(S.adventureExperiments||[]).filter(x=>x.id!==id);
  save();render('explore');toast('Experiment deleted');
}

// ---- Ladder: repeatable, not one-time checkboxes ----
let adventureChallengeExpandedLevel=0;
function toggleAdventureChallengeLevel(level){adventureChallengeExpandedLevel=(adventureChallengeExpandedLevel===level)?0:level;render('explore');}
function markAdventureChallengeDone(level,itemIndex){
  const lvl=(S.adventureChallenges||[]).find(l=>l.level===level);
  const item=lvl&&lvl.items[itemIndex];
  if(!item)return;
  S.adventureChallengeCompletions.push({id:uid('achal'),challengeText:item,level,date:today()});
  save();render('explore');toast('Logged as a rep');
}

function renderIdeaItem(i){
  return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(i.title)}</b><span class="pill ${i.status==='Done'?'pill-active':''}">${esc(i.status)}</span></div><div class="small muted">${i.category?esc(i.category)+' · ':''}${i.estimatedCost!==null?money(i.estimatedCost)+' · ':''}${i.estimatedDuration!==null?i.estimatedDuration+' min':''}</div><div class="row" style="margin-top:6px">${ADVENTURE_IDEA_STATUSES.map(s=>`<button class="btn ${i.status===s?'':'secondary'}" onclick="updateIdeaStatus('${i.id}','${s}')">${s}</button>`).join('')}</div><div class="row" style="margin-top:6px">${i.status!=='Done'?`<button class="btn secondary" onclick="convertIdeaToAdventure('${i.id}')">Log as done</button>`:''}<button class="btn danger" onclick="deleteAdventureIdea('${i.id}')">Delete</button></div></div>`;
}
function renderAdventureGoalItem(g){
  return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b><span class="pill ${g.active?'pill-active':''}">${g.active?'Active':'Inactive'}</span></div>${g.description?`<div class="small muted">${esc(g.description)}</div>`:''}${g.targetFrequency?`<div class="small muted">Target: ${g.targetFrequency}× per week</div>`:''}<div class="row" style="margin-top:6px"><button class="btn secondary" onclick="toggleAdventureGoalActive('${g.id}')">${g.active?'Deactivate':'Reactivate'}</button><button class="btn danger" onclick="deleteAdventureGoal('${g.id}')">Delete</button></div></div>`;
}
function renderAdventureExperimentCard(e){
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<div><b>${esc(e.title)}</b> <span class="pill ${e.completed?'pill-active':''}">${e.completed?'Completed':'Planned'}</span><div class="small muted">${e.date}</div>${e.whatIPlanned?`<div class="small muted">Plan: ${esc(e.whatIPlanned)}</div>`:''}</div>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteAdventureExperiment('${e.id}')">×</button>
</div>
<label class="small" style="margin-top:8px;display:block">What happened<textarea class="input" rows="2" onchange="updateAdventureExperimentText('${e.id}','whatHappened',this.value)">${esc(e.whatHappened)}</textarea></label>
<label class="small" style="margin-top:8px;display:block">What I learned<textarea class="input" rows="2" onchange="updateAdventureExperimentText('${e.id}','whatILearned',this.value)">${esc(e.whatILearned)}</textarea></label>
<div class="row" style="margin-top:8px;align-items:center"><span class="small">Difficulty</span><select class="input" style="max-width:90px" onchange="setAdventureExperimentDifficulty('${e.id}',this.value)"><option value="">—</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${e.difficulty===n?'selected':''}>${n}</option>`).join('')}</select>${!e.completed?`<button class="btn" onclick="completeAdventureExperiment('${e.id}')">Mark done</button>`:''}</div>
<p class="small muted" style="margin-top:6px">A disappointing outcome still counts — the evidence is that you did it.</p>
</div>`;
}

// ==================================================
// New in Phase 4: live discovery (reuses Mentor's exact backend, no new server code)
// ==================================================

let exploreBusy=false;
let exploreDiscovery=null; // {promptLabel, text, recommendation, error} | null — last "Find something" result
let exploreHappeningSoon=null; // {fetchedAt, tonight:{...}|{error}|null, weekend:{...}|{error}|null} | null
let exploreForYouBusy=false;

const EXPLORE_QUICK_PROMPTS=[
  'Something fun tonight',
  'Cheap date idea',
  'Something I can do alone',
  'Live music this weekend',
  "Something I've never done"
];

// Same location-priority infrastructure Mentor uses (utils.js) — city by default,
// device coordinates only when the user has actually enabled a location mode, and
// even then only as raw numbers passed to the backend, never shown here.
function exploreLocationLabel(){
  const mode=(typeof locationMode==='function')?locationMode():'off';
  if((mode==='whileUsing'||mode==='live')&&typeof LOCATION_RUNTIME!=='undefined'&&LOCATION_RUNTIME.coords) return 'Near you';
  if(S.profile.city) return `Exploring ${S.profile.city}`;
  return 'Add your city in Settings to personalize this';
}

// One turn, no Mentor chat history attached (Explore is a separate surface, not a
// second conversation) — otherwise identical to how Mentor sends a message:
// same context builder, same location resolution, same recursive tool loop,
// same webSearch/presentRecommendation/Tavily path, same generation guard for a
// sign-out mid-request.
async function exploreResearch(promptText){
  const myGeneration=mentorRequestGeneration;
  if(!realAiAvailable()){
    return {error:"Live discovery needs Real AI Mentor signed in — see Settings. Local Mode can't research the live web."};
  }
  const turnState={
    message:promptText,
    history:[],
    context:buildMentorContext(S,today(),await resolveCurrentLocationForRequest()),
    toolCallCount:0,
    toolExchanges:[]
  };
  const outcome=await sendRealAIMentorMessage(null,turnState);
  if(myGeneration!==mentorRequestGeneration) return null; // signed out mid-flight — discard
  if(outcome.pendingTool) return {error:'That needs a confirmation step — try asking Mentor directly instead.'};
  if(outcome.error) return {error:outcome.error};
  return {text:outcome.text,recommendation:outcome.recommendation};
}

async function exploreFindSomething(promptText){
  if(exploreBusy) return;
  const text=(promptText||($('explore_find_input')&&$('explore_find_input').value)||'').trim();
  if(!text){toast('Type what you feel like doing, or tap a suggestion');return}
  exploreBusy=true;
  exploreDiscovery={promptLabel:text,loading:true};
  render('explore');
  const result=await exploreResearch(text);
  exploreBusy=false;
  if(result===null) return; // discarded (signed out mid-flight) — don't paint a stale result
  exploreDiscovery={promptLabel:text,...result};
  save();render('explore');
}
// Suggestion chips run the search immediately — unlike Mentor's fill-then-send
// pattern, these are fixed, pre-approved strings (not risk of an accidental send
// of free text), so one tap giving an immediate result is the more useful,
// modern-consumer-app behavior here.
function exploreRunQuickPrompt(text){ exploreFindSomething(text); }

async function exploreFindHappeningSoon(){
  if(exploreBusy) return;
  exploreBusy=true;
  exploreHappeningSoon={fetchedAt:new Date().toISOString(),tonight:{loading:true},weekend:{loading:true}};
  render('explore');
  const [tonight,weekend]=await Promise.all([
    exploreResearch('Specific events or things happening tonight'),
    exploreResearch('Specific events happening this weekend')
  ]);
  exploreBusy=false;
  if(tonight===null||weekend===null) return; // signed out mid-flight
  exploreHappeningSoon={fetchedAt:new Date().toISOString(),tonight,weekend};
  save();render('explore');
}

// ---- "For You" — simple, honest, entirely LOCAL heuristics (zero web requests).
// Never a psychological read of the user — just small, plainly-derived observations
// from their own logged data, same spirit as the deterministic Coach signals. ----
function exploreForYouNotes(){
  const notes=[];
  // Brand-new user (nothing logged at all yet) gets one honest, welcoming note
  // and nothing else — checked FIRST so it can't be crowded out by the
  // "untried category" rule below, which would otherwise trivially match
  // every category (including one literally named "Explore") on empty data.
  if(!(S.adventures||[]).length) return ["Log your first experience and this section will start noticing patterns."];
  const cutoff=new Date(today()+'T00:00:00'); cutoff.setDate(cutoff.getDate()-14);
  const recent=(S.adventures||[]).filter(a=>{ const d=new Date((a.date||'')+'T00:00:00'); return !isNaN(d)&&d>=cutoff; });
  const soloCount=recent.filter(a=>a.soloOrWithOthers==='Solo').length;
  const groupCount=recent.filter(a=>a.soloOrWithOthers==='With others').length;
  if(soloCount>=3&&groupCount===0) notes.push("You've done a few solo activities lately — something social might be a nice change.");
  if(!recent.length) notes.push("You haven't logged a new experience in the last two weeks.");
  const triedCategories=new Set((S.adventures||[]).map(a=>a.category).filter(Boolean));
  const untried=(S.adventureCategories||[]).find(c=>!triedCategories.has(c));
  if(untried) notes.push(`You haven't tried "${esc(untried)}" yet.`);
  return notes.slice(0,3);
}

// Have I already done something with (roughly) this exact name? Exact,
// case-insensitive match only — deliberately not fuzzy, so it never mislabels a
// different real place as "already visited."
function exploreAlreadyDone(name){
  if(!name) return false;
  const n=String(name).trim().toLowerCase();
  return (S.adventures||[]).some(a=>(a.title||a.text||'').trim().toLowerCase()===n);
}

function exploreDiscoveryCard(result){
  if(!result) return '';
  if(result.loading) return `<div class="mentor-typing" style="margin-top:10px"><span></span><span></span><span></span></div>`;
  if(result.error) return `<div class="card" style="margin-top:10px"><p class="small" style="margin:0">${esc(result.error)}</p></div>`;
  if(!result.text&&!result.recommendation) return `<div class="card" style="margin-top:10px"><div class="empty">Nothing useful turned up right now.</div></div>`;
  const already=result.recommendation&&exploreAlreadyDone(result.recommendation.name);
  return `<div style="margin-top:10px">
${result.text?`<p style="margin:0 0 8px">${esc(result.text)}</p>`:''}
${result.recommendation?`<div style="position:relative">${already?`<span class="pill" style="position:absolute;top:10px;right:10px">Already visited</span>`:''}${mentorRenderRecommendationCard(result.recommendation)}</div>`:''}
</div>`;
}

function exploreHistoryCard(a){
  const label=a.title||a.text||'Untitled adventure';
  const tag=a.soloOrWithOthers==='Solo'?'Solo':(a.soloOrWithOthers==='With others'?'Social':'');
  const stars=a.rating?('★'.repeat(a.rating)+'☆'.repeat(5-a.rating)):'';
  return `<div class="explore-history-card">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<b>${esc(label)}</b>
<div class="row" style="gap:4px">
<button class="btn secondary qty-btn" title="Edit" onclick="editAdventure('${a.id}')">✎</button>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteAdventure('${a.id}')">×</button>
</div>
</div>
<div class="small muted">${daysAgoLabel(a.date)}${a.category?` · ${esc(a.category)}`:''}${tag?` · ${tag}`:''}</div>
${stars?`<div class="small" style="letter-spacing:1px;margin-top:2px">${stars}</div>`:''}
${a.notes?`<div class="small" style="margin-top:4px">“${esc(a.notes)}”</div>`:''}
</div>`;
}

views.explore=()=>{
  const week=adventureWeeklyStats(S.adventures,today());
  const activeGoals=(S.adventureGoals||[]).filter(g=>g.active);
  const activeIdeas=(S.adventureIdeas||[]).filter(i=>i.status==='Idea'||i.status==='Planned');
  const doneIdeasCount=(S.adventureIdeas||[]).filter(i=>i.status==='Done').length;
  const totalExperiences=(S.adventures||[]).length;

  // Compact "Your Adventures" history filter — reuses the same adventureHistoryFilter
  // state as before, plus two new lightweight buckets (Solo/Social) that don't
  // require any new stored field.
  const historyPool=S.adventures||[];
  const filteredHistory=historyPool.filter(a=>{
    if(adventureHistoryFilter==='all') return true;
    if(adventureHistoryFilter==='solo') return a.soloOrWithOthers==='Solo';
    if(adventureHistoryFilter==='social') return a.soloOrWithOthers==='With others';
    return a.category===adventureHistoryFilter;
  });
  // Exclude any category whose name collides with the fixed Solo/Social quick-filters
  // above (both happen to exist as default category names too) — a button can't
  // ambiguously mean two different filter criteria at once. Index is preserved from
  // the ORIGINAL S.adventureCategories array since setAdventureHistoryFilterByIndex
  // looks up by that same index.
  const topCategories=(S.adventureCategories||[])
    .map((c,i)=>({c,i}))
    .filter(({c})=>c!=='Solo'&&c!=='Social')
    .slice(0,4);

  const forYouNotes=exploreForYouNotes();

  const progressionCounts=(S.adventureChallenges||[]).map(lvl=>({
    level:lvl.level,name:lvl.name,
    count:(S.adventureChallengeCompletions||[]).filter(c=>c.level===lvl.level).length
  }));
  const totalLadderDone=(S.adventureChallengeCompletions||[]).length;
  let nextLadderItem=null;
  ladderSearch: for(const lvl of (S.adventureChallenges||[])){
    for(const item of lvl.items){
      if(!(S.adventureChallengeCompletions||[]).some(c=>c.level===lvl.level&&c.challengeText===item)){nextLadderItem=item;break ladderSearch;}
    }
  }

  return `<div class="explore-hero">
<div class="kicker">EXPLORE</div>
<h2>Find something worth doing.</h2>
<p class="muted">${esc(exploreLocationLabel())}</p>
</div>

<div class="card explore-find-card">
<label class="small muted" for="explore_find_input">What do you feel like doing?</label>
<div class="row" style="align-items:flex-end;flex-wrap:nowrap;margin-top:6px">
<input id="explore_find_input" class="input" placeholder="Find something..." onkeydown="if(event.key==='Enter'){event.preventDefault();exploreFindSomething();}">
<button type="button" class="btn" ${exploreBusy?'disabled':''} onclick="exploreFindSomething()">${exploreBusy?'Searching…':'Find'}</button>
</div>
<div class="row explore-chip-row">${EXPLORE_QUICK_PROMPTS.map(p=>`<button type="button" class="btn secondary explore-chip" ${exploreBusy?'disabled':''} onclick="exploreRunQuickPrompt('${esc(p)}')">${esc(p)}</button>`).join('')}</div>
${exploreDiscoveryCard(exploreDiscovery)}
</div>

<h3 class="section">Happening Soon</h3>
<div class="card">
${!exploreHappeningSoon?`<button type="button" class="btn secondary" ${exploreBusy?'disabled':''} onclick="exploreFindHappeningSoon()">Find things happening soon</button>`:`
<div class="row" style="justify-content:space-between;align-items:center">
<span class="small muted">Updated ${esc(relativeTimeLabel(exploreHappeningSoon.fetchedAt))}</span>
<button type="button" class="btn secondary" ${exploreBusy?'disabled':''} onclick="exploreFindHappeningSoon()">Refresh</button>
</div>
<div class="explore-soon-grid">
<div><div class="small" style="font-weight:700">Tonight</div>${exploreDiscoveryCard(exploreHappeningSoon.tonight)}</div>
<div><div class="small" style="font-weight:700">This Weekend</div>${exploreDiscoveryCard(exploreHappeningSoon.weekend)}</div>
</div>`}
</div>

<h3 class="section">For You</h3>
<div class="card">${forYouNotes.map(n=>`<div class="explore-foryou-note">${n}</div>`).join('')}</div>

<h3 class="section">Try Something New</h3>
<div class="card status-active"><p style="margin:0;font-weight:700">${nextAdventureSuggestion()}</p></div>

<h2 class="section-major">Your Activity</h2>
<h3 class="section">Saved Ideas</h3>
<div class="card">
<div class="row" style="align-items:flex-end;flex-wrap:nowrap">
<input id="explore_quick_idea" class="input" placeholder="e.g. Try indoor rock climbing" onkeydown="if(event.key==='Enter'){event.preventDefault();quickSaveExploreIdea();}">
<button type="button" class="btn secondary" onclick="quickSaveExploreIdea()">Save</button>
</div>
</div>
${activeIdeas.length?`<div class="list">${activeIdeas.map(renderIdeaItem).join('')}</div>`:`<div class="card"><div class="empty">No saved ideas yet.<div class="small muted" style="margin-top:4px">Save anything that sounds worth trying.</div></div></div>`}
${doneIdeasCount?`<div class="small muted" style="margin-top:6px">${doneIdeasCount} idea${doneIdeasCount===1?'':'s'} marked done.</div>`:''}

<h3 class="section">Your Adventures</h3>
<div class="card">
<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
<div class="small muted">${totalExperiences} experience${totalExperiences===1?'':'s'} logged · ${week.experiences} this week</div>
</div>
<div class="row" style="margin-top:8px">
<button class="btn ${adventureHistoryFilter==='all'?'':'secondary'}" onclick="setAdventureHistoryFilter('all')">All</button>
<button class="btn ${adventureHistoryFilter==='solo'?'':'secondary'}" onclick="setAdventureHistoryFilter('solo')">Solo</button>
<button class="btn ${adventureHistoryFilter==='social'?'':'secondary'}" onclick="setAdventureHistoryFilter('social')">Social</button>
${topCategories.map(({c,i})=>`<button class="btn ${adventureHistoryFilter===c?'':'secondary'}" onclick="setAdventureHistoryFilterByIndex(${i})">${esc(c)}</button>`).join('')}
</div>
<div class="explore-history-grid" style="margin-top:10px">${filteredHistory.length?filteredHistory.slice(-30).reverse().map(exploreHistoryCard).join(''):'<div class="empty">Start by logging your first adventure below.</div>'}</div>
</div>

<h3 class="section">Log an activity</h3>
<div class="card">
<div class="grid two"><input id="adv_title" class="input" placeholder="Title (e.g. Visited a new coffee shop)"><select id="adv_category" class="input"><option value="">Category (optional)</option>${(S.adventureCategories||[]).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><input id="adv_location" class="input" placeholder="Location (optional)"><select id="adv_solo" class="input"><option value="">Solo or with others (optional)</option>${ADVENTURE_SOLO_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><input id="adv_duration" class="input" type="number" min="0" inputmode="numeric" placeholder="Duration min (optional)"><input id="adv_cost" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Cost (optional)"></div>
<div class="grid two" style="margin-top:8px"><select id="adv_difficulty" class="input"><option value="">Difficulty (optional)</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select><select id="adv_novelty" class="input"><option value="">Novelty (optional)</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></div>
<select id="adv_rating" class="input" style="margin-top:8px"><option value="">Rating (optional)</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select>
<button class="btn" style="margin-top:9px" onclick="logAdventure()">Log adventure</button>
</div>
<div class="card" style="margin-top:10px"><div class="grid three"><input id="aidea_title" class="input" placeholder="Idea title"><select id="aidea_category" class="input"><option value="">Category (optional)</option>${(S.adventureCategories||[]).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><select id="aidea_solo" class="input"><option value="">Solo/group (optional)</option>${ADVENTURE_SOLO_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><input id="aidea_cost" class="input" type="number" min="0" step="0.01" placeholder="Est. cost (optional)"><input id="aidea_duration" class="input" type="number" min="0" placeholder="Est. duration min (optional)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="createAdventureIdea()">Save idea (with details)</button>
</div>

<h3 class="section">Adventure Level</h3>
<div class="card">
<div class="small">Experiences completed</div><div class="metric">${totalExperiences}</div>
<div class="small muted" style="margin-top:6px">${nextLadderItem?`Next: "${esc(nextLadderItem)}"`:'All current ladder challenges logged at least once.'}</div>
<div class="grid" style="grid-template-columns:repeat(5,1fr);margin-top:10px">${progressionCounts.map(p=>`<div><div class="small">${esc(p.name)}</div><div class="metric">${p.count}</div></div>`).join('')}</div>
</div>

<h3 class="section">Adventure goals</h3>
<div class="card">
${activeGoals.length?activeGoals.map(renderAdventureGoalItem).join(''):'<div class="empty">No active adventure goals — add one below.</div>'}
<div class="grid three" style="margin-top:10px"><input id="agoal_name" class="input" placeholder="e.g. Explore 3 new towns"><input id="agoal_desc" class="input" placeholder="Description (optional)"><input id="agoal_freq" class="input" type="number" min="0" placeholder="Target/week (optional)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="createAdventureGoal()">Add goal</button>
</div>

<h3 class="section">Adventure ladder</h3>
${(S.adventureChallenges||[]).map(lvl=>{
  const isOpen=adventureChallengeExpandedLevel===lvl.level;
  const doneCount=(S.adventureChallengeCompletions||[]).filter(c=>c.level===lvl.level).length;
  return `<div class="card" style="margin-top:8px">
<div class="row" style="justify-content:space-between;cursor:pointer" onclick="toggleAdventureChallengeLevel(${lvl.level})">
<div><b>Level ${lvl.level}: ${esc(lvl.name)}</b> <span class="small muted">(${doneCount} logged)</span></div><span class="pill">${isOpen?'▲':'▼'}</span>
</div>
${isOpen?lvl.items.map((item,idx)=>{
  const itemCount=(S.adventureChallengeCompletions||[]).filter(c=>c.level===lvl.level&&c.challengeText===item).length;
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div>${esc(item)}${itemCount?`<div class="small muted">Done ${itemCount}×</div>`:''}</div><button class="btn secondary" onclick="markAdventureChallengeDone(${lvl.level},${idx})">Mark done</button></div></div>`;
}).join(''):''}
</div>`;
}).join('')}

<h3 class="section">Adventure experiments</h3>
<div class="card"><div class="grid two"><input id="aexp_title" class="input" placeholder="e.g. Spend Saturday exploring somewhere new"><input id="aexp_plan" class="input" placeholder="What I plan to do (optional)"></div><button class="btn" style="margin-top:9px" onclick="createAdventureExperiment()">Start experiment</button></div>
${(S.adventureExperiments||[]).length?(S.adventureExperiments||[]).slice().reverse().map(renderAdventureExperimentCard).join(''):''}

<h3 class="section">Categories</h3>
<div class="card"><div class="row"><input id="adv_new_category" class="input" placeholder="New category name"><button class="btn secondary" onclick="addAdventureCategory()">Add</button></div></div>`;
};
