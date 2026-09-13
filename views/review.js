const REVIEW_FRICTION_CATEGORIES=['Sleep','Time','Energy','Money','Training','Nutrition','Social','Career','Environment','Other'];
const REVIEW_PRIORITY_CATEGORIES=['Body','Training','Nutrition','BJJ','Money','Career','Social','Adventure','Personal'];

// Ephemeral navigation only (which week is being viewed) — never persisted, so it
// always resets to the current week on reload rather than becoming a second source
// of truth for "what week is it".
let reviewWeekOffset=0;

// Read-only view of a week's snapshot: never mutates S, so simply looking at a past
// or empty week can never silently create state.
function getWeeklySnapshotView(weekStart,weekEnd){
  return findWeeklySnapshot(S.weeklyReviewSnapshots,weekStart)||defaultWeeklySnapshot(weekStart,weekEnd);
}
// Only called from an actual save/add/toggle action — creates the real record at
// the moment the user's data needs somewhere to live.
function ensureWeeklySnapshot(weekStart,weekEnd){
  let snap=findWeeklySnapshot(S.weeklyReviewSnapshots,weekStart);
  if(!snap){ snap=defaultWeeklySnapshot(weekStart,weekEnd); S.weeklyReviewSnapshots.push(snap); }
  return snap;
}
function reviewGoToWeek(offset){
  reviewWeekOffset=Math.max(-104,Math.min(0,Math.round(offset)||0));
  render('review');
}
function reviewShiftWeek(delta){ reviewGoToWeek(reviewWeekOffset+delta); }
function openWeeklyReviewSnapshot(weekStart){
  const currentStart=reviewWeekInfo(today(),0).weekStart;
  const deltaWeeks=Math.round((new Date(weekStart+'T00:00:00')-new Date(currentStart+'T00:00:00'))/(7*86400000));
  reviewGoToWeek(deltaWeeks);
}

function saveWeeklyReflection(){
  const {weekStart,weekEnd}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=ensureWeeklySnapshot(weekStart,weekEnd);
  snap.reflection={
    wentWell:($('wr_wentwell')?.value||'').trim(),
    didnt:($('wr_didnt')?.value||'').trim(),
    proud:($('wr_proud')?.value||'').trim(),
    learned:($('wr_learned')?.value||'').trim(),
    mostFriction:($('wr_mostfriction')?.value||'').trim(),
    stopDoing:($('wr_stop')?.value||'').trim(),
    continueDoing:($('wr_continue')?.value||'').trim(),
    startDoing:($('wr_start')?.value||'').trim()
  };
  save();render('review');toast('Reflection saved');
}

function addWeeklyWin(){
  const text=($('win_text')?.value||'').trim();
  if(!text) return;
  const category=($('win_category')?.value||'').trim();
  const {weekStart,weekEnd}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=ensureWeeklySnapshot(weekStart,weekEnd);
  snap.wins.push({id:uid('win'),text,category,date:today()});
  save();render('review');toast('Win added');
}
function deleteWeeklyWin(snapId,winId){
  const snap=(S.weeklyReviewSnapshots||[]).find(r=>r.id===snapId);
  if(!snap) return;
  snap.wins=snap.wins.filter(w=>w.id!==winId);
  save();render('review');
}

function addWeeklyFriction(){
  const problem=($('friction_problem')?.value||'').trim();
  if(!problem) return;
  const category=$('friction_category')?.value||'Other';
  const severityRaw=Number($('friction_severity')?.value);
  const severity=(Number.isFinite(severityRaw)&&severityRaw>=1&&severityRaw<=5)?severityRaw:null;
  const cause=($('friction_cause')?.value||'').trim();
  const adjustment=($('friction_adjustment')?.value||'').trim();
  const {weekStart,weekEnd}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=ensureWeeklySnapshot(weekStart,weekEnd);
  snap.friction.push({id:uid('friction'),problem,category,severity,cause,adjustment,date:today()});
  save();render('review');toast('Friction logged');
}
function deleteWeeklyFriction(snapId,frictionId){
  const snap=(S.weeklyReviewSnapshots||[]).find(r=>r.id===snapId);
  if(!snap) return;
  snap.friction=snap.friction.filter(f=>f.id!==frictionId);
  save();render('review');
}

function addWeeklyPriority(){
  const {weekStart,weekEnd}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=ensureWeeklySnapshot(weekStart,weekEnd);
  if(snap.priorities.length>=5){toast('Max 5 priorities — remove one first');return}
  const priority=($('priority_text')?.value||'').trim();
  if(!priority) return;
  const why=($('priority_why')?.value||'').trim();
  const action=($('priority_action')?.value||'').trim();
  const target=($('priority_target')?.value||'').trim();
  const category=$('priority_category')?.value||'Personal';
  snap.priorities.push({id:uid('priority'),priority,why,action,target,category,completed:false});
  save();render('review');toast('Priority added');
}
function togglePriorityComplete(snapId,priorityId){
  const snap=(S.weeklyReviewSnapshots||[]).find(r=>r.id===snapId);
  if(!snap) return;
  const p=snap.priorities.find(x=>x.id===priorityId);
  if(!p) return;
  p.completed=!p.completed;
  save();render('review');
}
function deleteWeeklyPriority(snapId,priorityId){
  const snap=(S.weeklyReviewSnapshots||[]).find(r=>r.id===snapId);
  if(!snap) return;
  snap.priorities=snap.priorities.filter(p=>p.id!==priorityId);
  save();render('review');
}

function toggleWeeklyReviewCompleted(){
  const {weekStart,weekEnd}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=ensureWeeklySnapshot(weekStart,weekEnd);
  snap.completed=!snap.completed;
  snap.completedAt=snap.completed?new Date().toISOString():null;
  save();render('review');toast(snap.completed?'Weekly review marked complete':'Weekly review reopened');
}

function renderWeeklyWinItem(snap,w,isAuto){
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(w.text)}</b>${w.category?` <span class="pill">${esc(w.category)}</span>`:''}</div>${isAuto?'<span class="small muted">auto</span>':`<button class="btn danger qty-btn" title="Remove" onclick="deleteWeeklyWin('${snap.id}','${w.id}')">&times;</button>`}</div></div>`;
}
function renderWeeklyFrictionItem(snap,f){
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${esc(f.problem)}</b> <span class="pill">${esc(f.category)}</span>${f.severity?` <span class="small muted">severity ${f.severity}/5</span>`:''}${f.cause?`<div class="small muted" style="margin-top:4px">Cause: ${esc(f.cause)}</div>`:''}${f.adjustment?`<div class="small muted" style="margin-top:2px">Adjustment: ${esc(f.adjustment)}</div>`:''}</div><button class="btn danger qty-btn" title="Remove" onclick="deleteWeeklyFriction('${snap.id}','${f.id}')">&times;</button></div></div>`;
}
function renderWeeklyPriorityItem(snap,p){
  return `<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><label class="row" style="align-items:center;gap:8px"><input type="checkbox" ${p.completed?'checked':''} onchange="togglePriorityComplete('${snap.id}','${p.id}')"><b style="${p.completed?'text-decoration:line-through':''}">${esc(p.priority)}</b></label> <span class="pill">${esc(p.category)}</span>${p.why?`<div class="small muted" style="margin-top:4px">Why: ${esc(p.why)}</div>`:''}${p.action?`<div class="small muted" style="margin-top:2px">Action: ${esc(p.action)}</div>`:''}${p.target?`<div class="small muted" style="margin-top:2px">Target: ${esc(p.target)}</div>`:''}</div><button class="btn danger qty-btn" title="Remove" onclick="deleteWeeklyPriority('${snap.id}','${p.id}')">&times;</button></div></div>`;
}

views.review=()=>{
  const {weekStart,weekEnd,isCurrent}=reviewWeekInfo(today(),reviewWeekOffset);
  const snap=getWeeklySnapshotView(weekStart,weekEnd);
  const prevInfo=reviewWeekInfo(today(),reviewWeekOffset-1);

  const body=reviewBodyMetrics(S.weightLog,weekStart,weekEnd);
  const training=reviewTrainingMetrics(S.workouts,S.bjj,weekStart,weekEnd);
  const trainingPrev=reviewTrainingMetrics(S.workouts,S.bjj,prevInfo.weekStart,prevInfo.weekEnd);
  const nutrition=reviewNutritionMetrics(S.meals,weekStart,weekEnd);
  const moneyM=reviewMoneyMetrics(S.money,weekStart,weekEnd);
  const moneyPrev=reviewMoneyMetrics(S.money,prevInfo.weekStart,prevInfo.weekEnd);
  const careerM=reviewCareerMetrics(S.career,S.careerSkills,weekStart,weekEnd);
  const socialM=reviewSocialMetrics(S.social,S.socialExperiments,weekStart,weekEnd);
  const socialPrev=reviewSocialMetrics(S.social,S.socialExperiments,prevInfo.weekStart,prevInfo.weekEnd);
  const adventureM=reviewAdventureMetrics(S.adventures,S.adventureExperiments,weekStart,weekEnd);
  const adventurePrev=reviewAdventureMetrics(S.adventures,S.adventureExperiments,prevInfo.weekStart,prevInfo.weekEnd);
  const consistency=reviewConsistency(S,weekStart,weekEnd,today());
  const autoWins=reviewAutoWins(S,weekStart,weekEnd);
  const patterns=reviewPatterns(S,weekStart,weekEnd);

  const target=S.careerWeeklyTarget||{text:'',minutesGoal:0};
  const targetPct=target.minutesGoal>0?pct(careerM.minutes,target.minutesGoal):null;

  const fmt=(d)=>{const dt=new Date(d+'T00:00:00');return isNaN(dt)?d:dt.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
  const weekLabel=`${fmt(weekStart)} - ${fmt(weekEnd)}, ${weekEnd.slice(0,4)}`;

  const history=(S.weeklyReviewSnapshots||[]).slice().sort((a,b)=>a.weekStart<b.weekStart?1:(a.weekStart>b.weekStart?-1:0));

  return `<p class="page-intro">${isCurrent?'This week, in progress.':'A past week.'} Be honest — a bad week is data, not a verdict on you.</p>

<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
<button class="btn secondary" onclick="reviewShiftWeek(-1)">&larr; Previous week</button>
<div style="text-align:center"><div style="font-weight:var(--weight-black);font-size:var(--text-md)">${esc(weekLabel)}</div><span class="pill ${isCurrent?'pill-active':''}">${isCurrent?'CURRENT WEEK':'PAST WEEK'}</span></div>
<button class="btn secondary" ${isCurrent?'disabled':''} onclick="reviewShiftWeek(1)">Next week &rarr;</button>
</div>

<div class="card">
<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
<div><span class="pill ${snap.completed?'pill-active':''}">${snap.completed?'REVIEW COMPLETE':'NOT YET COMPLETED'}</span>${snap.completed&&snap.completedAt?`<div class="small muted" style="margin-top:4px">Completed ${daysAgoLabel(snap.completedAt.slice(0,10))}</div>`:''}</div>
<button class="btn ${snap.completed?'secondary':''}" onclick="toggleWeeklyReviewCompleted()">${snap.completed?'Reopen review':'Mark review complete'}</button>
</div>
<p class="small muted" style="margin-top:8px">Completing a review only means the week was reviewed — not that it went well.</p>
</div>

<h3 class="section">Weekly scorecard</h3>
<div class="grid two">
<div class="card"><div class="small">BODY</div>${body.hasData?`<div class="metric">${body.currentWeight}<span class="unit">lb</span></div><div class="small">7-day avg ${body.weekAvg.toFixed(1)} lb &middot; change ${body.change!==null?(body.change>0?'+':'')+body.change.toFixed(1)+' lb':'—'}</div><div class="small muted" style="margin-top:4px">Body fat: ${body.bf!==null?body.bf+'%':'—'}</div>`:'<div class="small muted" style="margin-top:6px">No data logged this week.</div>'}</div>
<div class="card"><div class="small">TRAINING</div><div class="metric">${training.totalSessions}<span class="unit">sessions</span></div><div class="small">Lifting ${training.liftSessions} &middot; BJJ ${training.bjjSessions}${training.totalMinutes>0?` &middot; ${training.totalMinutes} min`:''}</div></div>
<div class="card"><div class="small">NUTRITION</div>${nutrition.hasData?`<div class="metric">${Math.round(nutrition.avgCal)}<span class="unit">avg cal</span></div><div class="small">Protein avg ${Math.round(nutrition.avgProt)}g &middot; ${nutrition.daysLogged}/${nutrition.daysInWeek} days logged</div>`:'<div class="small muted" style="margin-top:6px">No data</div>'}</div>
<div class="card"><div class="small">MONEY</div>${moneyM.hasData?`<div class="metric">${money(moneyM.income-moneyM.expenses)}<span class="unit">net</span></div><div class="small">Income ${money(moneyM.income)} &middot; Spend ${money(moneyM.expenses)} &middot; Savings ${money(moneyM.savings)}</div><div class="small muted" style="margin-top:4px">Savings rate: ${moneyM.savingsRate!==null?Math.round(moneyM.savingsRate)+'%':'—'}</div>`:'<div class="small muted" style="margin-top:6px">No data logged this week.</div>'}</div>
<div class="card"><div class="small">CAREER</div><div class="metric">${careerM.sessions}<span class="unit">sessions</span></div><div class="small">${careerM.minutes} min &middot; ${careerM.skillsPracticed} skill${careerM.skillsPracticed===1?'':'s'} practiced</div>${targetPct!==null?`<div class="small muted" style="margin-top:4px">Weekly target "${esc(target.text||'')}": ${careerM.minutes}/${target.minutesGoal} min (${Math.round(targetPct)}%)</div>`:''}</div>
<div class="card"><div class="small">SOCIAL</div><div class="metric">${socialM.totalReps}<span class="unit">reps</span></div><div class="small">Conversations ${socialM.conversationsStarted+socialM.conversationsContinued} &middot; Invitations/plans ${socialM.invitationsMade+socialM.plansMade}${socialM.experimentsCompleted?` &middot; ${socialM.experimentsCompleted} experiment${socialM.experimentsCompleted===1?'':'s'}`:''}</div></div>
<div class="card"><div class="small">ADVENTURE</div><div class="metric">${adventureM.experiences}<span class="unit">experiences</span></div><div class="small">${adventureM.totalMinutes} min &middot; Solo ${adventureM.soloCount} &middot; Novel ${adventureM.novelCount}${adventureM.experimentsCompleted?` &middot; ${adventureM.experimentsCompleted} experiment${adventureM.experimentsCompleted===1?'':'s'}`:''}</div></div>
</div>

<h3 class="section">Consistency this week</h3>
<div class="card"><div class="grid two">
<div class="small">Training: <b>${consistency.training.daysActive}/${consistency.training.daysElapsed} days</b></div>
<div class="small">Nutrition logged: <b>${consistency.nutrition.daysActive}/${consistency.nutrition.daysElapsed} days</b></div>
<div class="small">Career activity: <b>${consistency.career.daysActive}/${consistency.career.daysElapsed} days</b></div>
<div class="small">Social activity: <b>${consistency.social.daysActive}/${consistency.social.daysElapsed} days</b></div>
<div class="small">Adventure activity: <b>${consistency.adventure.daysActive}/${consistency.adventure.daysElapsed} days</b></div>
<div class="small">Income/savings activity: <b>${consistency.money.daysActive}/${consistency.money.daysElapsed} days</b></div>
</div></div>

<h3 class="section">Compared to last week</h3>
<div class="card"><div class="grid two">
<div class="small">Training sessions: <b>${formatDelta(training.totalSessions,trainingPrev.totalSessions)}</b></div>
<div class="small">BJJ minutes: <b>${(training.hasData||trainingPrev.hasData)?formatDelta(training.bjjMinutes,trainingPrev.bjjMinutes,' min'):'—'}</b></div>
<div class="small">Weight: <b>${body.hasData&&body.change!==null?(body.change>0?'+':'')+body.change.toFixed(1)+' lb':'—'}</b></div>
<div class="small">Savings: <b>${(moneyM.hasData||moneyPrev.hasData)?formatMoneyDelta(moneyM.savings,moneyPrev.savings):'—'}</b></div>
<div class="small">Social reps: <b>${formatDelta(socialM.totalReps,socialPrev.totalReps)}</b></div>
<div class="small">Adventure experiences: <b>${formatDelta(adventureM.experiences,adventurePrev.experiences)}</b></div>
</div></div>

<h3 class="section">Wins</h3>
<div class="card">
${autoWins.length||snap.wins.length?[...autoWins.map(w=>renderWeeklyWinItem(snap,w,true)),...snap.wins.map(w=>renderWeeklyWinItem(snap,w,false))].join(''):'<div class="empty">No wins surfaced yet — log some activity or add one manually.</div>'}
<div class="grid two" style="margin-top:10px"><input id="win_text" class="input" placeholder="Add a win"><input id="win_category" class="input" placeholder="Category (optional)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="addWeeklyWin()">Add win</button>
</div>

<h3 class="section">Friction</h3>
<div class="card">
${snap.friction.length?snap.friction.map(f=>renderWeeklyFrictionItem(snap,f)).join(''):'<div class="empty">Nothing logged yet.</div>'}
<div class="grid two" style="margin-top:10px"><input id="friction_problem" class="input" placeholder="What got in the way?"><select id="friction_category" class="input">${REVIEW_FRICTION_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><select id="friction_severity" class="input"><option value="">Severity (optional)</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('')}</select><input id="friction_cause" class="input" placeholder="What caused it (optional)"></div>
<input id="friction_adjustment" class="input" style="margin-top:8px" placeholder="Possible adjustment (optional)">
<button class="btn secondary" style="margin-top:9px" onclick="addWeeklyFriction()">Log friction</button>
</div>

<h3 class="section">Patterns</h3>
<div class="card">${patterns.length?patterns.map(p=>`<p class="small" style="margin:6px 0">${esc(p)}</p>`).join(''):'<p class="small muted">No clear patterns yet — patterns need at least a couple of weeks of logged data to compare.</p>'}</div>

<h3 class="section">Weekly reflection</h3>
<div class="card">
<label class="small" style="display:block;margin-top:4px">What went well?<textarea id="wr_wentwell" class="input" rows="2">${esc(snap.reflection.wentWell)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What didn't?<textarea id="wr_didnt" class="input" rows="2">${esc(snap.reflection.didnt)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What am I proud of?<textarea id="wr_proud" class="input" rows="2">${esc(snap.reflection.proud)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What did I learn?<textarea id="wr_learned" class="input" rows="2">${esc(snap.reflection.learned)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What created the most friction?<textarea id="wr_mostfriction" class="input" rows="2">${esc(snap.reflection.mostFriction)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What should I stop doing?<textarea id="wr_stop" class="input" rows="2">${esc(snap.reflection.stopDoing)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What should I continue?<textarea id="wr_continue" class="input" rows="2">${esc(snap.reflection.continueDoing)}</textarea></label>
<label class="small" style="display:block;margin-top:8px">What should I start?<textarea id="wr_start" class="input" rows="2">${esc(snap.reflection.startDoing)}</textarea></label>
<button class="btn" style="margin-top:9px" onclick="saveWeeklyReflection()">Save reflection</button>
</div>

<h3 class="section">Next week's priorities</h3>
<div class="card">
${snap.priorities.length?snap.priorities.map(p=>renderWeeklyPriorityItem(snap,p)).join(''):'<div class="empty">No priorities set yet.</div>'}
${snap.priorities.length<5?`<div class="grid two" style="margin-top:10px"><input id="priority_text" class="input" placeholder="Priority"><select id="priority_category" class="input">${REVIEW_PRIORITY_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
<input id="priority_why" class="input" style="margin-top:8px" placeholder="Why it matters (optional)">
<div class="grid two" style="margin-top:8px"><input id="priority_action" class="input" placeholder="Concrete action (optional)"><input id="priority_target" class="input" placeholder="Target (optional)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="addWeeklyPriority()">Add priority</button>`:'<p class="small muted" style="margin-top:8px">Maximum of 5 priorities — remove one to add another.</p>'}
</div>

<h3 class="section">Review history</h3>
<div class="card">
${history.length?history.map(r=>{
  const preview=r.reflection.wentWell||r.reflection.proud||r.reflection.learned||r.reflection.didnt||'';
  return `<div class="item" style="cursor:pointer" onclick="openWeeklyReviewSnapshot('${r.weekStart}')"><div class="row" style="justify-content:space-between;align-items:center"><b>${esc(r.weekStart)} &rarr; ${esc(r.weekEnd)}</b><span class="pill ${r.completed?'pill-active':''}">${r.completed?'Complete':'Open'}</span></div>${preview?`<p class="muted small" style="margin:4px 0">${esc(preview.slice(0,140))}${preview.length>140?'…':''}</p>`:''}<div class="small muted">${r.wins.length} win${r.wins.length===1?'':'s'} &middot; ${r.friction.length} friction item${r.friction.length===1?'':'s'} &middot; ${r.priorities.length} priorit${r.priorities.length===1?'y':'ies'}</div></div>`;
}).join(''):'<div class="empty">Complete a weekly review to build your history.</div>'}
</div>

<h3 class="section">Free-form review (legacy)</h3>
<div class="card"><textarea id="rv" rows="9" placeholder="What went well? What failed? What did I learn? What will I change next week? What am I proud of?"></textarea><button class="btn" style="margin-top:9px" onclick="review()">Save review</button></div>
<div class="card" style="margin-top:10px">${S.reviews.map(x=>`<div class="item"><b>${esc(x.date)}</b><p class="muted">${esc(x.text)}</p></div>`).join('')||'<div class="empty">Your reviews will create your personal history.</div>'}</div>`;
};

function review(){let n=$('rv').value;if(n){S.reviews.unshift({date:today(),text:n.slice(0,5000)});save();render('review');toast('Review saved')}}
