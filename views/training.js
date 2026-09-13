function formatTimer(sec){
  sec=Math.max(0,Math.round(sec));
  return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}
function setRestTimer(){
  const n=Math.max(5,ensureNumber($('rest_seconds').value,90));
  S.restTimer.seconds=n; S.restTimer.remaining=n; S.restTimer.running=false; S.restTimer.updatedAt=new Date().toISOString(); save();render('training');
}
let restInterval=null, restTickCount=0;
// Bug fix: this used to update S.restTimer silently every second without ever
// touching the DOM, so the on-screen countdown appeared frozen until the timer
// finished or the view was re-rendered for an unrelated reason. It now updates the
// two visible countdown elements directly (cheap, and safe even mid-edit of an
// active workout's set inputs, unlike a full render() which would blow away focus).
// localStorage is still only written every 5 ticks — resumeRestTimerIfNeeded()
// reconciles any gap using wall-clock time, so this never desyncs on reload, it
// just avoids re-serializing the entire app state once per second.
function tickRestTimerOnce(){
  if(S.restTimer.remaining<=1){
    clearInterval(restInterval);restInterval=null;S.restTimer.remaining=0;S.restTimer.running=false;S.restTimer.updatedAt=new Date().toISOString();save();
    // Only force a full re-render if the user is actually still on Training — on any
    // other tab this would silently blow away whatever they're currently looking at.
    // The toast itself is global/non-destructive, so it always fires either way.
    if(lastRenderedTab==='training')render('training');
    toast('Rest complete');
    return;
  }
  S.restTimer.remaining--;
  restTickCount++;
  const label=formatTimer(S.restTimer.remaining);
  const statEl=$('rest_timer_stat'), mainEl=$('rest_timer_main');
  if(statEl) statEl.textContent=label;
  if(mainEl) mainEl.textContent=label;
  if(restTickCount%5===0){
    S.restTimer.updatedAt=new Date().toISOString();
    localStorage.setItem(KEY,JSON.stringify(S));
  }
}
function startRestTimer(){
  if(restInterval)clearInterval(restInterval);
  if(!S.restTimer.remaining)S.restTimer.remaining=S.restTimer.seconds||90;
  S.restTimer.running=true; S.restTimer.updatedAt=new Date().toISOString(); save(); render('training');
  restInterval=setInterval(tickRestTimerOnce,1000);
}
function pauseRestTimer(){if(restInterval)clearInterval(restInterval);restInterval=null;S.restTimer.running=false;S.restTimer.updatedAt=new Date().toISOString();save();render('training')}
function resetRestTimer(){pauseRestTimer();S.restTimer.remaining=S.restTimer.seconds||90;S.restTimer.updatedAt=new Date().toISOString();save();render('training')}
// Fixes the known reload-desync issue: if the timer was running when the page was
// closed/reloaded, correct `remaining` using the elapsed wall-clock time and resume
// ticking, instead of silently freezing on a stale value. Runs once at load.
function resumeRestTimerIfNeeded(){
  const rt=S.restTimer;
  if(!rt||!rt.running) return;
  const last=rt.updatedAt?Date.parse(rt.updatedAt):NaN;
  if(!Number.isFinite(last)){ rt.running=false; rt.remaining=0; return; }
  const elapsedSec=Math.max(0,Math.round((Date.now()-last)/1000));
  rt.remaining=Math.max(0,(rt.remaining||0)-elapsedSec);
  if(rt.remaining<=0){
    rt.running=false; rt.remaining=0;
  }else{
    restInterval=setInterval(tickRestTimerOnce,1000);
  }
}

function newTemplate(){
  const name=$('template_name').value.trim(); if(!name){toast('Name your template');return}
  S.workoutTemplates.push({id:'t-'+Date.now(),name,days:[],exercises:[]});save();render('training');toast('Template created');
}
function addExerciseToTemplate(i){
  const name=$(`new_ex_${i}`).value.trim(); if(!name)return;
  S.workoutTemplates[i].exercises.push({name,sets:3,reps:'8-12',rest:S.restTimer.seconds||90});
  save();render('training');toast('Exercise added');
}
function deleteExerciseFromTemplate(ti,ei){S.workoutTemplates[ti].exercises.splice(ei,1);save();render('training')}
function pickLibraryExerciseForTemplate(ti){
  const sel=$(`lib_ex_${ti}`);
  if(sel&&sel.value)$(`new_ex_${ti}`).value=sel.value;
}
function startWorkout(ti){
  const t=S.workoutTemplates[ti];
  if(!t)return;
  if(S.activeWorkout&&!confirm('Starting a new workout will discard your current in-progress workout. Continue?'))return;
  S.activeWorkout={templateId:t.id,name:t.name,startedAt:new Date().toISOString(),exercises:t.exercises.map(e=>({
    ...e,logs:Array.from({length:e.sets||1},()=>({weight:'',reps:'',status:'working',rpe:'',notes:''}))
  }))};
  save();render('training');toast(`${t.name} started`);
}
function updateSet(ei,si,field,value){
  if(!S.activeWorkout)return;
  S.activeWorkout.exercises[ei].logs[si][field]=value;save();render('training');
}
function adjustSetWeight(ei,si,delta){
  if(!S.activeWorkout)return;
  const cur=ensureNumber(S.activeWorkout.exercises[ei].logs[si].weight,0);
  const next=Math.max(0,cur+delta);
  S.activeWorkout.exercises[ei].logs[si].weight=next;
  save();render('training');
}
function addSetToActive(ei){
  const ex=S.activeWorkout.exercises[ei];
  const prev=ex.logs[ex.logs.length-1];
  // Pre-fill from the previous set (minimal typing between sets of the same exercise);
  // RPE is cleared since it typically varies set to set.
  ex.logs.push(prev?{weight:prev.weight,reps:prev.reps,status:prev.status,rpe:'',notes:''}:{weight:'',reps:'',status:'working',rpe:'',notes:''});
  save();render('training');
}
function removeSetFromActive(ei,si){
  S.activeWorkout.exercises[ei].logs.splice(si,1);save();render('training');
}
function finishWorkout(){
  if(!S.activeWorkout)return;
  const w=S.activeWorkout;
  S.workouts.push({
    date:today(),template:w.name,startedAt:w.startedAt,finishedAt:new Date().toISOString(),
    exercises:w.exercises.map(e=>({name:e.name,logs:e.logs}))
  });
  S.activeWorkout=null;save();render('training');toast('Workout completed');
}
function cancelWorkout(){if(confirm('Discard this workout?')){S.activeWorkout=null;save();render('training')}}

// ---- Custom exercise library ----
function createCustomExercise(){
  const name=($(`ex_lib_name`).value||'').trim();
  const category=($(`ex_lib_category`).value||'').trim();
  const notes=($(`ex_lib_notes`).value||'').trim();
  if(!name){toast('Name the exercise');return}
  if((S.exerciseLibrary||[]).some(x=>sameExerciseName(x.name,name))){toast('That exercise already exists');return}
  S.exerciseLibrary.push({id:'ex-'+Date.now(),name,category,notes});
  save();render('training');toast('Exercise added to your library');
}

// ---- Exercise history browser (derived from S.workouts, no duplicate storage) ----
let selectedHistoryExercise='';
function selectHistoryExercise(){
  selectedHistoryExercise=$('history_exercise').value;
  render('training');
}
function allKnownExerciseNames(){
  const names=new Set();
  (S.exerciseLibrary||[]).forEach(x=>names.add(x.name));
  (S.workoutTemplates||[]).forEach(t=>(t.exercises||[]).forEach(e=>names.add(e.name)));
  (S.workouts||[]).forEach(w=>(w.exercises||[]).forEach(e=>names.add(e.name)));
  return [...names].filter(Boolean).sort((a,b)=>a.localeCompare(b));
}
function renderExerciseHistoryBlock(name){
  const sets=collectExerciseSets(S.workouts,name);
  if(!sets.length) return `<p class="muted" style="margin-top:8px">No history yet for ${esc(name)}.</p>`;
  const strength=sets.filter(isStrengthSet);
  const prs=exercisePRs(strength);
  const rows=sets.slice(-15).reverse().map(s=>`<div class="item"><b>${esc(s.weight)} lb</b> × ${esc(s.reps)} <span class="pill">${esc(s.status||'working')}</span>${s.rpe?` <span class="small">RPE ${esc(s.rpe)}</span>`:''} <span class="small">${s.date}</span></div>`).join('');
  const prLine=`<div class="small" style="margin:8px 0"><b>PRs:</b> ${prs.heaviestWeight?`Heaviest ${prs.heaviestWeight.weight} lb × ${prs.heaviestWeight.reps} (${prs.heaviestWeight.date})`:'none yet'}${prs.best1RM?` · Est. 1RM ${prs.best1RM.est1RM.toFixed(0)} lb (${prs.best1RM.date})`:''}</div>`;
  return `${prLine}${rows}`;
}

// ---- Per-exercise progression context, used while actively logging ----
function exercisePRBaseline(name){
  return exercisePRs(collectExerciseSets(S.workouts,name).filter(isStrengthSet));
}
function exerciseContext(name){
  const sets=collectExerciseSets(S.workouts,name);
  const prs=exercisePRs(sets.filter(isStrengthSet));
  let lastSession=null;
  for(let i=S.workouts.length-1;i>=0;i--){
    const ex=(S.workouts[i].exercises||[]).find(e=>sameExerciseName(e.name,name));
    if(ex){ lastSession={date:S.workouts[i].date,logs:ex.logs||[]}; break; }
  }
  return {hasHistory:sets.length>0,prs,lastSession};
}
function exerciseProgressionLine(name){
  const ctx=exerciseContext(name);
  if(!ctx.hasHistory) return `<div class="small muted">No prior history for this exercise yet.</div>`;
  const parts=[];
  if(ctx.lastSession){
    const strengthLogs=(ctx.lastSession.logs||[]).filter(isStrengthSet);
    const summary=strengthLogs.map(l=>`${esc(l.weight)}×${esc(l.reps)}`).join(', ')||'—';
    parts.push(`Last session (${daysAgoLabel(ctx.lastSession.date)}): ${summary}`);
  }
  if(ctx.prs.heaviestWeight) parts.push(`PR: ${ctx.prs.heaviestWeight.weight} lb × ${ctx.prs.heaviestWeight.reps}`);
  if(ctx.prs.best1RM) parts.push(`Est. 1RM: ${ctx.prs.best1RM.est1RM.toFixed(0)} lb`);
  return `<div class="small muted">${parts.join(' · ')}</div>`;
}

// ---- Workout summary, fully derived from S.workouts (no second source of truth) ----
function buildWorkoutSummary(workout,priorWorkouts){
  const exercises=workout.exercises||[];
  let totalWorkingSets=0;
  const prHighlights=[];
  exercises.forEach(e=>{
    const baseline=exercisePRs(collectExerciseSets(priorWorkouts,e.name).filter(isStrengthSet));
    (e.logs||[]).forEach(l=>{
      if(!isStrengthSet(l))return;
      totalWorkingSets++;
      const w=ensureNumber(l.weight,NaN),r=ensureNumber(l.reps,NaN);
      if(!baseline.heaviestWeight||w>baseline.heaviestWeight.weight){
        prHighlights.push({exercise:e.name,type:'weight',weight:w,reps:r});
      }else{
        const e1=estimate1RM(w,r);
        if(e1!==null&&(!baseline.best1RM||e1>baseline.best1RM.est1RM)){
          prHighlights.push({exercise:e.name,type:'1rm',weight:w,reps:r,est1RM:e1});
        }
      }
    });
  });
  let durationMin=null;
  if(workout.startedAt&&workout.finishedAt){
    const ms=new Date(workout.finishedAt)-new Date(workout.startedAt);
    if(Number.isFinite(ms)&&ms>0) durationMin=Math.round(ms/60000);
  }
  return {exerciseCount:exercises.length,totalWorkingSets,prHighlights,durationMin};
}
function lastWorkoutSummaryBlock(){
  if(!S.workouts.length) return '';
  const last=S.workouts[S.workouts.length-1];
  const prior=S.workouts.slice(0,-1);
  const summary=buildWorkoutSummary(last,prior);
  const durationText=summary.durationMin!==null?`${summary.durationMin} min`:'—';
  return `<h3 class="section">Last workout summary</h3><div class="card">
<div class="grid three">
<div><div class="small">Exercises</div><div class="metric">${summary.exerciseCount}</div></div>
<div><div class="small">Working sets</div><div class="metric">${summary.totalWorkingSets}</div></div>
<div><div class="small">Duration</div><div class="metric">${durationText}</div></div>
</div>
${summary.prHighlights.length?`<div class="small" style="margin-top:10px"><b>PRs this session:</b></div>${summary.prHighlights.slice(0,5).map(h=>`<div class="item">🏆 ${esc(h.exercise)} — ${h.type==='weight'?`${h.weight} lb × ${h.reps} (new heaviest)`:`Est. 1RM ${h.est1RM.toFixed(0)} lb`}</div>`).join('')}`:'<p class="muted" style="margin-top:10px">No new PRs this session — still solid work.</p>'}
</div>`;
}

views.training=()=>{const ts=S.workoutTemplates||[], active=S.activeWorkout, libNames=allKnownExerciseNames();return `
<p class="page-intro">Log sets, track PRs automatically, and let the rest timer keep you honest between them.</p>
<div class="grid three">
<div class="card"><div class="small">Workout templates</div><div class="metric">${ts.length}</div><div class="small">custom programs</div></div>
<div class="card"><div class="small">Rest timer</div><div class="metric" id="rest_timer_stat">${formatTimer(S.restTimer.remaining||S.restTimer.seconds||90)}</div><div class="small">${S.restTimer.running?'running':'ready'}</div></div>
<div class="card"><div class="small">Recent sessions</div><div class="metric">${S.workouts.slice(-7).length}</div><div class="small">last 7 logged</div></div>
</div>
<div class="card" style="margin-top:12px"><h3>Rest timer</h3><div class="row"><input id="rest_seconds" class="input" style="max-width:140px" type="number" min="5" value="${S.restTimer.seconds||90}"><button class="btn secondary" onclick="setRestTimer()">Set</button><button class="btn" onclick="startRestTimer()">${S.restTimer.running?'Restart':'Start'}</button><button class="btn secondary" onclick="pauseRestTimer()">Pause</button><button class="btn secondary" onclick="resetRestTimer()">Reset</button></div><div class="metric" style="margin-top:10px" id="rest_timer_main">${formatTimer(S.restTimer.remaining||S.restTimer.seconds||90)}</div><p class="muted">Set any rest period you want — 30 sec, 90 sec, 3 min, etc.</p></div>
${active?`<div class="card" style="margin-top:12px"><div class="row" style="justify-content:space-between"><div><span class="pill">ACTIVE</span><h2>${esc(active.name)}</h2></div><div><button class="btn" onclick="finishWorkout()">Finish</button><button class="btn danger" onclick="cancelWorkout()">Discard</button></div></div>
${active.exercises.map((e,ei)=>{
  const baseline=exercisePRBaseline(e.name);
  return `<div class="card" style="margin:10px 0"><div class="row" style="justify-content:space-between"><div><h3>${esc(e.name)}</h3><div class="small">Target: ${esc(e.reps)} · ${e.sets} sets</div></div><button class="btn secondary" onclick="addSetToActive(${ei})">+ Set</button></div>
${exerciseProgressionLine(e.name)}
${e.logs.map((l,si)=>{
  const w=ensureNumber(l.weight,NaN),r=ensureNumber(l.reps,NaN);
  let prBadge='';
  if(isStrengthSet(l)){
    if(!baseline.heaviestWeight||w>baseline.heaviestWeight.weight) prBadge='<span class="pill pill-active">🏆 Weight PR</span>';
    else{
      const e1=estimate1RM(w,r);
      if(e1!==null&&(!baseline.best1RM||e1>baseline.best1RM.est1RM)) prBadge='<span class="pill pill-active">🏆 Est. 1RM PR</span>';
    }
  }
  const e1rmText=isStrengthSet(l)?(()=>{const e1=estimate1RM(w,r);return e1!==null?`<span class="small muted">est. 1RM ${e1.toFixed(0)} lb</span>`:'';})():'';
  // D6: a set only silently vanishes from PR/1RM math (isStrengthSet) when its
  // weight/reps don't parse as a real number at all — flag that specific case so
  // it's not a mystery why a filled-in set "didn't count." Doesn't fire for a
  // blank (not-yet-filled) field or an intentional 0 weight (bodyweight work),
  // both of which are already normal, expected states elsewhere in the app.
  const weightRaw=String(l.weight??'').trim(), repsRaw=String(l.reps??'').trim();
  const nonNumericInput=(weightRaw!==''&&!Number.isFinite(ensureNumber(weightRaw,NaN)))||(repsRaw!==''&&!Number.isFinite(ensureNumber(repsRaw,NaN)));
  const invalidHint=nonNumericInput?'<span class="small" style="color:var(--color-danger-ink)">Enter a number to count this set</span>':'';
  return `<div class="set-row"><span class="pill">${si+1}</span><button class="btn secondary qty-btn" onclick="adjustSetWeight(${ei},${si},-5)">−5</button><input class="input" style="max-width:100px" placeholder="lb" inputmode="decimal" value="${esc(l.weight)}" onchange="updateSet(${ei},${si},'weight',this.value)"><button class="btn secondary qty-btn" onclick="adjustSetWeight(${ei},${si},5)">+5</button><input class="input" style="max-width:80px" placeholder="reps" inputmode="numeric" value="${esc(l.reps)}" onchange="updateSet(${ei},${si},'reps',this.value)"><select class="input" style="max-width:135px" onchange="updateSet(${ei},${si},'status',this.value)"><option ${l.status==='warmup'?'selected':''} value="warmup">Warm-up</option><option ${l.status==='working'?'selected':''} value="working">Working</option><option ${l.status==='failure'?'selected':''} value="failure">To failure</option><option ${l.status==='drop'?'selected':''} value="drop">Drop set</option><option ${l.status==='backoff'?'selected':''} value="backoff">Back-off</option></select><select class="input" style="max-width:100px" onchange="updateSet(${ei},${si},'rpe',this.value)"><option value="">RPE</option>${[6,7,8,9,10].map(x=>`<option ${String(l.rpe)===String(x)?'selected':''}>${x}</option>`).join('')}</select>${prBadge}${e1rmText}${invalidHint}<button class="btn secondary qty-btn" title="Remove" onclick="removeSetFromActive(${ei},${si})">×</button><input class="input" placeholder="note (optional)" style="flex:1 1 100%" value="${esc(l.notes||'')}" onchange="updateSet(${ei},${si},'notes',this.value)"></div>`;
}).join('')}</div>`;
}).join('')}</div>`:''}
${lastWorkoutSummaryBlock()}
<h3 class="section">Exercise history</h3>
<div class="card">
<select id="history_exercise" class="input" onchange="selectHistoryExercise()">
<option value="">Choose an exercise…</option>
${libNames.map(n=>`<option value="${esc(n)}" ${n===selectedHistoryExercise?'selected':''}>${esc(n)}</option>`).join('')}
</select>
${selectedHistoryExercise?renderExerciseHistoryBlock(selectedHistoryExercise):'<p class="muted" style="margin-top:8px">Select an exercise to see its history and PRs.</p>'}
</div>
<h3 class="section">Custom exercise library</h3>
<div class="card">
<div class="grid three"><input id="ex_lib_name" class="input" placeholder="Exercise name"><input id="ex_lib_category" class="input" placeholder="Category (optional)"><input id="ex_lib_notes" class="input" placeholder="Notes (optional)"></div>
<button class="btn" style="margin-top:9px" onclick="createCustomExercise()">Add to library</button>
<div class="list">${(S.exerciseLibrary||[]).map(x=>`<div class="item"><b>${esc(x.name)}</b>${x.category?` · ${esc(x.category)}`:''}${x.notes?`<div class="small muted">${esc(x.notes)}</div>`:''}</div>`).join('')||'<div class="empty">No custom exercises yet.</div>'}</div>
</div>
<h3 class="section">Workout templates</h3>
<div class="card"><div class="grid two"><input id="template_name" class="input" placeholder="New template name (e.g. Upper A)"><button class="btn" onclick="newTemplate()">Create template</button></div></div>
${ts.map((t,ti)=>`<div class="card" style="margin-top:10px"><div class="row" style="justify-content:space-between"><div><h3>${esc(t.name)}</h3><div class="small">${t.exercises.length} exercises</div></div><button class="btn" onclick="startWorkout(${ti})">Start workout</button></div>
${t.exercises.map((e,ei)=>`<div class="item"><b>${esc(e.name)}</b> · ${e.sets} × ${esc(e.reps)} · ${e.rest}s rest <button class="btn secondary" onclick="deleteExerciseFromTemplate(${ti},${ei})">×</button></div>`).join('')||'<div class="empty">No exercises yet.</div>'}
<div class="row" style="margin-top:9px">${libNames.length?`<select id="lib_ex_${ti}" class="input" style="max-width:200px" onchange="pickLibraryExerciseForTemplate(${ti})"><option value="">From library…</option>${libNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`:''}<input id="new_ex_${ti}" class="input" placeholder="Add exercise"><button class="btn secondary" onclick="addExerciseToTemplate(${ti})">Add exercise</button></div></div>`).join('')}
<h3 class="section">Workout history</h3><div class="card">${S.workouts.slice(-20).reverse().map(w=>{
  const durationMin=(w.startedAt&&w.finishedAt&&Number.isFinite(new Date(w.finishedAt)-new Date(w.startedAt)))?Math.round((new Date(w.finishedAt)-new Date(w.startedAt))/60000):null;
  const workingSets=(w.exercises||[]).reduce((a,e)=>a+(e.logs||[]).filter(isStrengthSet).length,0);
  return `<div class="item"><b>${esc(w.template||'Workout')}</b> <span class="small">${w.date}${durationMin!==null?` · ${durationMin} min`:''} · ${workingSets} working set${workingSets===1?'':'s'}</span>${(w.exercises||[]).map(e=>`<div class="small">${esc(e.name)}: ${(e.logs||[]).map(l=>`${esc(l.weight)}×${esc(l.reps)} [${esc(l.status)}${l.rpe?`, RPE ${esc(l.rpe)}`:''}]`).join(' · ')}</div>`).join('')}</div>`;
}).join('')||'<div class="empty">No workouts completed yet.</div>'}</div>`};

resumeRestTimerIfNeeded();
