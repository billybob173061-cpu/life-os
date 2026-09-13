const SOCIAL_REP_TYPES=['Started conversation','Continued conversation','Met someone new','Asked someone to hang out','Made plans','Attended event','BJJ social','Coworker interaction','Other'];
const SOCIAL_RELATIONSHIP_TYPES=['Friend','Acquaintance','Coworker','BJJ','Other'];

// ---- Social rep logging: fastest path is Type -> optional note -> Save ----
function logSocialRep(){
  const type=$('srep_type').value;
  const text=($('srep_note').value||'').trim();
  const durationRaw=$('srep_duration').value;
  const duration=durationRaw===''?null:ensureNumber(durationRaw,NaN);
  const personId=$('srep_person').value||null;
  const context=($('srep_context').value||'').trim();
  const diffRaw=$('srep_difficulty').value;
  if(duration!==null&&(!Number.isFinite(duration)||duration<0)){toast('Duration must be zero or more minutes');return}
  let difficulty=null;
  if(diffRaw!==''){
    difficulty=ensureNumber(diffRaw,NaN);
    if(!Number.isFinite(difficulty)||difficulty<1||difficulty>5){toast('Difficulty should be between 1 and 5, or left blank');return}
  }
  S.social.push({id:uid('social'),date:today(),text,type,duration,personId:personId||null,context,difficulty,outcome:'',lesson:''});
  if(personId){
    const p=(S.socialPeople||[]).find(x=>x.id===personId);
    if(p){p.interactionCount=ensureNumber(p.interactionCount,0)+1;p.lastInteraction=today();}
  }
  save();render('social');toast('Rep logged — that\'s evidence.');
}
function deleteSocialRep(id){
  if(!confirm('Delete this rep? This cannot be undone.'))return;
  S.social=(S.social||[]).filter(x=>x.id!==id);
  save();render('social');toast('Rep deleted');
}
// C7: practical edit for a mistaken note/duration on an already-logged rep — reuses
// the app's existing prompt()-based quick-edit pattern rather than a new inline form.
function editSocialRep(id){
  const r=(S.social||[]).find(x=>x.id===id);
  if(!r){toast('That rep no longer exists');return}
  const textRaw=prompt('Note (optional):',r.text||'');
  if(textRaw===null)return;
  const durationRaw=prompt('Duration in minutes (optional, blank = none):',r.duration!=null?r.duration:'');
  if(durationRaw===null)return;
  let duration=null;
  if(durationRaw.trim()!==''){
    duration=ensureNumber(durationRaw,NaN);
    if(!Number.isFinite(duration)||duration<0){toast('Duration must be zero or more minutes');return}
  }
  r.text=textRaw.trim();
  r.duration=duration;
  save();render('social');toast('Rep updated');
}
let socialHistoryFilter='all';
function setSocialHistoryFilter(f){socialHistoryFilter=f;render('social');}
function socialFilterMatches(rep,filter){
  if(filter==='all') return true;
  if(filter==='conversations') return rep.type==='Started conversation'||rep.type==='Continued conversation';
  if(filter==='met') return rep.type==='Met someone new';
  if(filter==='plans') return rep.type==='Asked someone to hang out'||rep.type==='Made plans';
  if(filter==='events') return rep.type==='Attended event';
  if(filter==='bjj') return rep.type==='BJJ social';
  if(filter==='coworker') return rep.type==='Coworker interaction';
  if(filter==='other') return rep.type==='Other';
  return true;
}

// ---- Goals ----
function createSocialGoal(){
  const name=($('sgoal_name').value||'').trim();
  if(!name){toast('Name the goal');return}
  const description=($('sgoal_desc').value||'').trim();
  const freqRaw=$('sgoal_freq').value;
  const targetFrequency=freqRaw===''?null:ensureNumber(freqRaw,NaN);
  if(targetFrequency!==null&&(!Number.isFinite(targetFrequency)||targetFrequency<0)){toast('Target frequency must be zero or more');return}
  S.socialGoals.push({id:uid('sgoal'),name,description,targetFrequency,active:true,createdDate:today()});
  save();render('social');toast('Goal created');
}
function toggleSocialGoalActive(id){
  const g=(S.socialGoals||[]).find(x=>x.id===id); if(!g)return;
  g.active=!g.active; save();render('social');
}
function deleteSocialGoal(id){
  if(!confirm('Delete this goal? This cannot be undone.'))return;
  S.socialGoals=(S.socialGoals||[]).filter(x=>x.id!==id);
  save();render('social');toast('Goal deleted');
}

// ---- People / relationships (lightweight — not a CRM) ----
function createSocialPerson(){
  const name=($('sperson_name').value||'').trim();
  if(!name){toast('Enter a name');return}
  const context=($('sperson_context').value||'').trim();
  const relationshipType=$('sperson_type').value||'Other';
  const isDup=(S.socialPeople||[]).some(p=>sameExerciseName(p.name,name));
  S.socialPeople.push({id:uid('person'),name,context,lastInteraction:null,interactionCount:0,notes:'',relationshipType});
  save();render('social');
  toast(isDup?`Added — you already had a "${name}" too, that's fine if they're different people`:'Person added');
}
function logPersonInteraction(id){
  const p=(S.socialPeople||[]).find(x=>x.id===id); if(!p)return;
  p.interactionCount=ensureNumber(p.interactionCount,0)+1;
  p.lastInteraction=today();
  save();render('social');toast('Interaction logged');
}
function updatePersonField(id,field,value){
  const p=(S.socialPeople||[]).find(x=>x.id===id); if(!p)return;
  p[field]=value; save();
}
function deleteSocialPerson(id){
  if(!confirm('Delete this person? This cannot be undone.'))return;
  S.socialPeople=(S.socialPeople||[]).filter(x=>x.id!==id);
  save();render('social');toast('Person deleted');
}

// ---- Weekly target ----
function setSocialWeeklyTarget(){
  const num=(id)=>Math.max(0,ensureNumber($(id).value,0));
  S.socialWeeklyTarget={conversations:num('starget_conv'),initiations:num('starget_init'),plans:num('starget_plans'),socialMinutes:num('starget_min')};
  save();render('social');toast('Weekly target saved');
}

// ---- Experiments: a failed invitation is still a completed rep ----
function createSocialExperiment(){
  const title=($('sexp_title').value||'').trim();
  if(!title){toast('Name the experiment');return}
  const whatIPlanned=($('sexp_plan').value||'').trim();
  S.socialExperiments.push({id:uid('sexp'),title,date:today(),whatIPlanned,whatHappened:'',whatILearned:'',difficulty:null,completed:false});
  save();render('social');toast('Experiment created');
}
function updateSocialExperimentText(id,field,value){
  const e=(S.socialExperiments||[]).find(x=>x.id===id); if(!e)return;
  e[field]=value; save();
}
function setSocialExperimentDifficulty(id,value){
  const e=(S.socialExperiments||[]).find(x=>x.id===id); if(!e)return;
  e.difficulty=value===''?null:Math.max(1,Math.min(5,ensureNumber(value,NaN)));
  save();render('social');
}
function completeSocialExperiment(id){
  const e=(S.socialExperiments||[]).find(x=>x.id===id); if(!e)return;
  e.completed=true; save();render('social');toast('Logged as evidence — outcome doesn\'t matter, the rep does');
}
function deleteSocialExperiment(id){
  if(!confirm('Delete this experiment? This cannot be undone.'))return;
  S.socialExperiments=(S.socialExperiments||[]).filter(x=>x.id!==id);
  save();render('social');toast('Experiment deleted');
}

// ---- Challenges: repeatable, not one-time checkboxes ----
let socialChallengeExpandedLevel=0;
function toggleSocialChallengeLevel(level){socialChallengeExpandedLevel=(socialChallengeExpandedLevel===level)?0:level;render('social');}
function markSocialChallengeDone(level,itemIndex){
  const lvl=(S.socialChallenges||[]).find(l=>l.level===level);
  const item=lvl&&lvl.items[itemIndex];
  if(!item)return;
  S.socialChallengeCompletions.push({id:uid('chal'),challengeText:item,level,date:today()});
  save();render('social');toast('Nice — logged as a rep');
}

function renderPersonCard(p){
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<div><b>${esc(p.name)}</b> <span class="pill">${esc(p.relationshipType)}</span><div class="small muted">${p.context?esc(p.context)+' · ':''}${p.interactionCount||0} interaction${p.interactionCount===1?'':'s'}</div><div class="small muted">${p.lastInteraction?`Last interaction ${daysAgoLabel(p.lastInteraction)}`:'No interaction logged yet'}</div></div>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteSocialPerson('${p.id}')">×</button>
</div>
<div class="row" style="margin-top:8px"><button class="btn secondary" onclick="logPersonInteraction('${p.id}')">Log interaction</button></div>
<input class="input" style="margin-top:8px" placeholder="Notes (private)" value="${esc(p.notes||'')}" onchange="updatePersonField('${p.id}','notes',this.value)">
</div>`;
}
function renderGoalItem(g){
  return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b><span class="pill ${g.active?'pill-active':''}">${g.active?'Active':'Inactive'}</span></div>${g.description?`<div class="small muted">${esc(g.description)}</div>`:''}${g.targetFrequency?`<div class="small muted">Target: ${g.targetFrequency}× per week</div>`:''}<div class="row" style="margin-top:6px"><button class="btn secondary" onclick="toggleSocialGoalActive('${g.id}')">${g.active?'Deactivate':'Reactivate'}</button><button class="btn danger" onclick="deleteSocialGoal('${g.id}')">Delete</button></div></div>`;
}
function renderSocialExperimentCard(e){
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<div><b>${esc(e.title)}</b> <span class="pill ${e.completed?'pill-active':''}">${e.completed?'Completed':'Planned'}</span><div class="small muted">${e.date}</div>${e.whatIPlanned?`<div class="small muted">Plan: ${esc(e.whatIPlanned)}</div>`:''}</div>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteSocialExperiment('${e.id}')">×</button>
</div>
<label class="small" style="margin-top:8px;display:block">What happened<textarea class="input" rows="2" onchange="updateSocialExperimentText('${e.id}','whatHappened',this.value)">${esc(e.whatHappened)}</textarea></label>
<label class="small" style="margin-top:8px;display:block">What I learned<textarea class="input" rows="2" onchange="updateSocialExperimentText('${e.id}','whatILearned',this.value)">${esc(e.whatILearned)}</textarea></label>
<div class="row" style="margin-top:8px;align-items:center"><span class="small">Difficulty</span><select class="input" style="max-width:90px" onchange="setSocialExperimentDifficulty('${e.id}',this.value)"><option value="">—</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${e.difficulty===n?'selected':''}>${n}</option>`).join('')}</select>${!e.completed?`<button class="btn" onclick="completeSocialExperiment('${e.id}')">Mark done</button>`:''}</div>
<p class="small muted" style="margin-top:6px">A failed invitation is still a completed rep — the evidence is that you tried.</p>
</div>`;
}
function renderSocialRepItem(r){
  const person=r.personId?(S.socialPeople||[]).find(p=>p.id===r.personId):null;
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(r.type)}</b>${person?` · ${esc(person.name)}`:(r.context?` · ${esc(r.context)}`:'')}<div class="small muted">${r.date} · ${daysAgoLabel(r.date)}${r.duration?` · ${r.duration} min`:''}${r.difficulty?` · Difficulty ${r.difficulty}/5`:''}</div>${r.text?`<div class="small muted">${esc(r.text)}</div>`:''}</div><div class="row" style="gap:6px"><button class="btn secondary qty-btn" title="Edit" onclick="editSocialRep('${r.id}')">✎</button><button class="btn secondary qty-btn" title="Remove" onclick="deleteSocialRep('${r.id}')">×</button></div></div></div>`;
}

views.social=()=>{
  const week=socialWeeklyStats(S.social,today());
  const targetProgress=socialWeeklyTargetProgress(S.social,S.socialWeeklyTarget,today());
  const hasTarget=(S.socialWeeklyTarget.conversations||S.socialWeeklyTarget.initiations||S.socialWeeklyTarget.plans||S.socialWeeklyTarget.socialMinutes)>0;
  const activeGoals=(S.socialGoals||[]).filter(g=>g.active);
  const inactiveGoals=(S.socialGoals||[]).filter(g=>!g.active);
  const filteredHistory=(S.social||[]).filter(r=>socialFilterMatches(r,socialHistoryFilter));
  const progressionCounts=(S.socialChallenges||[]).map(lvl=>({
    level:lvl.level,name:lvl.name,
    count:(S.socialChallengeCompletions||[]).filter(c=>c.level===lvl.level).length
  }));

  return `<p class="page-intro">Confidence is evidence from repetition — this tracks the reps, not a popularity score.</p>

<div class="grid four">
<div class="card"><div class="small">Conversations started</div><div class="metric">${week.conversationsStarted}</div><div class="small muted">this week</div></div>
<div class="card"><div class="small">People met</div><div class="metric">${week.peopleMet}</div><div class="small muted">this week</div></div>
<div class="card"><div class="small">Invitations / plans</div><div class="metric">${week.invitationsMade+week.plansMade}</div><div class="small muted">this week</div></div>
<div class="card"><div class="small">Total reps</div><div class="metric">${week.totalReps}</div><div class="small muted">this week</div></div>
</div>

<h3 class="section">This week's target</h3>
<div class="card">
${hasTarget?`<div class="grid four">
<div><div class="small">Conversations</div><div class="metric">${targetProgress.conversations.done}<span class="unit">/${targetProgress.conversations.goal}</span></div></div>
<div><div class="small">Initiations</div><div class="metric">${targetProgress.initiations.done}<span class="unit">/${targetProgress.initiations.goal}</span></div></div>
<div><div class="small">Plans</div><div class="metric">${targetProgress.plans.done}<span class="unit">/${targetProgress.plans.goal}</span></div></div>
<div><div class="small">Minutes</div><div class="metric">${targetProgress.socialMinutes.done}<span class="unit">/${targetProgress.socialMinutes.goal}</span></div></div>
</div>`:'<div class="empty">No weekly social target set yet.</div>'}
<div class="grid four" style="margin-top:10px"><input id="starget_conv" class="input" type="number" min="0" placeholder="Conversations" value="${S.socialWeeklyTarget.conversations||''}"><input id="starget_init" class="input" type="number" min="0" placeholder="Initiations" value="${S.socialWeeklyTarget.initiations||''}"><input id="starget_plans" class="input" type="number" min="0" placeholder="Plans" value="${S.socialWeeklyTarget.plans||''}"><input id="starget_min" class="input" type="number" min="0" placeholder="Minutes" value="${S.socialWeeklyTarget.socialMinutes||''}"></div>
<button class="btn secondary" style="margin-top:9px" onclick="setSocialWeeklyTarget()">Save target</button>
</div>

<h3 class="section">Log a social rep</h3>
<div class="card">
<div class="grid two"><select id="srep_type" class="input">${SOCIAL_REP_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select><input id="srep_note" class="input" placeholder="What happened (optional)"></div>
<div class="grid two" style="margin-top:8px"><select id="srep_person" class="input"><option value="">Person (optional)</option>${(S.socialPeople||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><input id="srep_context" class="input" placeholder="Context if no person (optional)"></div>
<div class="grid two" style="margin-top:8px"><input id="srep_duration" class="input" type="number" min="0" inputmode="numeric" placeholder="Duration min (optional)"><select id="srep_difficulty" class="input"><option value="">Difficulty (optional)</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select></div>
<button class="btn" style="margin-top:9px" onclick="logSocialRep()">Log rep</button>
</div>

<h3 class="section">Current goals</h3>
<div class="card">
${activeGoals.length?activeGoals.map(renderGoalItem).join(''):'<div class="empty">No active social goals — add one below.</div>'}
${inactiveGoals.length?`<div class="small muted" style="margin-top:8px">${inactiveGoals.length} inactive goal${inactiveGoals.length===1?'':'s'}</div>${inactiveGoals.map(renderGoalItem).join('')}`:''}
<div class="grid three" style="margin-top:10px"><input id="sgoal_name" class="input" placeholder="e.g. Talk to 3 new people"><input id="sgoal_desc" class="input" placeholder="Description (optional)"><input id="sgoal_freq" class="input" type="number" min="0" placeholder="Target/week (optional)"></div>
<button class="btn" style="margin-top:9px" onclick="createSocialGoal()">Add goal</button>
</div>

<h3 class="section">People</h3>
<div class="card"><p class="small muted" style="margin:0 0 8px">Who you actually want to stay connected with — not a contact list to collect. Names/notes are private and stay on this device (and your own cloud sync only).</p><div class="grid three"><input id="sperson_name" class="input" placeholder="Name"><input id="sperson_context" class="input" placeholder="Context (e.g. BJJ gym)"><select id="sperson_type" class="input">${SOCIAL_RELATIONSHIP_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div><button class="btn" style="margin-top:9px" onclick="createSocialPerson()">Add person</button></div>
${(S.socialPeople||[]).length?(S.socialPeople||[]).slice().reverse().map(renderPersonCard).join(''):'<div class="card"><div class="empty">No people tracked yet.</div></div>'}

<h3 class="section">Social experiments</h3>
<div class="card"><div class="grid two"><input id="sexp_title" class="input" placeholder="e.g. Talk to one new person at BJJ"><input id="sexp_plan" class="input" placeholder="What I plan to do (optional)"></div><button class="btn" style="margin-top:9px" onclick="createSocialExperiment()">Start experiment</button></div>
${(S.socialExperiments||[]).length?(S.socialExperiments||[]).slice().reverse().map(renderSocialExperimentCard).join(''):'<div class="card"><div class="empty">No experiments yet.</div></div>'}

<h3 class="section">Challenges</h3>
${(S.socialChallenges||[]).map(lvl=>{
  const isOpen=socialChallengeExpandedLevel===lvl.level;
  const doneCount=(S.socialChallengeCompletions||[]).filter(c=>c.level===lvl.level).length;
  return `<div class="card" style="margin-top:8px">
<div class="row" style="justify-content:space-between;cursor:pointer" onclick="toggleSocialChallengeLevel(${lvl.level})">
<div><b>Level ${lvl.level}: ${esc(lvl.name)}</b> <span class="small muted">(${doneCount} logged)</span></div><span class="pill">${isOpen?'▲':'▼'}</span>
</div>
${isOpen?lvl.items.map((item,idx)=>{
  const itemCount=(S.socialChallengeCompletions||[]).filter(c=>c.level===lvl.level&&c.challengeText===item).length;
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div>${esc(item)}${itemCount?`<div class="small muted">Done ${itemCount}×</div>`:''}</div><button class="btn secondary" onclick="markSocialChallengeDone(${lvl.level},${idx})">Mark done</button></div></div>`;
}).join(''):''}
</div>`;
}).join('')}

<h3 class="section">Recent interactions</h3>
<div class="card">
<div class="row">${[['all','All'],['conversations','Conversations'],['met','Met'],['plans','Invites/Plans'],['events','Events'],['bjj','BJJ'],['coworker','Coworker'],['other','Other']].map(([k,label])=>`<button class="btn ${socialHistoryFilter===k?'':'secondary'}" onclick="setSocialHistoryFilter('${k}')">${label}</button>`).join('')}</div>
<div class="list" style="margin-top:8px">${filteredHistory.length?filteredHistory.slice(-30).reverse().map(renderSocialRepItem).join(''):'<div class="empty">Start by logging your first social rep.</div>'}</div>
</div>

<h3 class="section">Evidence of progress</h3>
<div class="card">
<p class="small muted" style="margin:0 0 8px">Descriptive stages, not a judgment — how many logged reps/challenges fall into each area so far.</p>
<div class="grid four">${progressionCounts.map(p=>`<div><div class="small">${esc(p.name)}</div><div class="metric">${p.count}</div></div>`).join('')}</div>
</div>`;
};

