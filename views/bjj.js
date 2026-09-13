const BJJ_TYPE_LABELS={gi:'Gi',nogi:'No-Gi',openmat:'Open Mat',private:'Private'};
function bjjTypeLabel(t){return BJJ_TYPE_LABELS[t]||t||'Session'}
const BJJ_CONFIDENCE_LABELS={1:'Never learned',2:'Recognize it',3:'Can perform with instruction',4:'Can perform during drilling',5:'Can attempt during live training'};
const BJJ_LEVELS=['Foundation','Developing','Intermediate','Advanced'];
const BJJ_STATUSES=['Not Started','Learning','Practicing','Confident'];

// ---- Session logging: fast, few fields, sensible defaults ----
function logBjjSession(){
  const type=$('bjj_type').value;
  const duration=ensureNumber($('bjj_duration').value,NaN);
  const drillingRaw=$('bjj_drilling').value;
  const sparringRaw=$('bjj_sparring').value;
  const drilling=drillingRaw===''?0:ensureNumber(drillingRaw,NaN);
  const sparring=sparringRaw===''?0:ensureNumber(sparringRaw,NaN);
  const effortRaw=$('bjj_effort').value;
  const notes=($('bjj_notes').value||'').trim();
  const techniquesRaw=($('bjj_techniques').value||'').trim();

  if(!Number.isFinite(duration)||duration<0){toast('Enter a valid session duration (0 or more minutes)');return}
  if(!Number.isFinite(drilling)||drilling<0){toast('Drilling time must be a number, zero or more');return}
  if(!Number.isFinite(sparring)||sparring<0){toast('Sparring time must be a number, zero or more');return}
  if(drilling+sparring>duration+0.001){toast("Drilling + sparring can't exceed the total duration");return}
  let effort=null;
  if(effortRaw!==''){
    effort=ensureNumber(effortRaw,NaN);
    if(!Number.isFinite(effort)||effort<1||effort>10){toast('Effort should be between 1 and 10, or left blank');return}
  }
  const techniques=techniquesRaw?techniquesRaw.split(',').map(s=>s.trim()).filter(Boolean):[];

  S.bjj.push({id:uid('bjj'),date:today(),type,duration,drilling,sparring,notes,techniques,effort});
  // Best-effort: if a logged technique name matches a curriculum entry, credit it —
  // same status bump as markTechniqueDrilled, so a session log alone can move a
  // technique out of "Not Started" without a separate curriculum visit.
  techniques.forEach(name=>{
    const t=(S.bjjTechniques||[]).find(x=>sameExerciseName(x.name,name));
    if(t){
      t.timesDrilled=(t.timesDrilled||0)+1;t.lastDrilled=today();
      if(t.status==='Not Started') t.status='Learning';
    }
  });
  save();render('bjj');toast('Session logged');
}

// ---- Curriculum / technique tracking ----
function updateTechPositionOptions(){
  const cat=(S.bjjCurriculum||[]).find(c=>c.id===$('tech_category').value);
  const sel=$('tech_position');
  if(sel) sel.innerHTML='<option value="">Position/area (optional)</option>'+(cat?cat.areas:[]).map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');
}
function addBjjTechnique(){
  const name=($('tech_name').value||'').trim();
  const category=$('tech_category').value;
  if(!name){toast('Name the technique or concept');return}
  if(!category){toast('Choose a category');return}
  if((S.bjjTechniques||[]).some(t=>sameExerciseName(t.name,name))){toast('That technique is already in your curriculum');return}
  const position=($('tech_position').value||'').trim();
  const description=($('tech_description').value||'').trim();
  const level=$('tech_level')?.value||'Foundation';
  S.bjjTechniques.push({id:uid('tech'),name,category,position,level,description,keyConcepts:[],prerequisites:[],confidence:1,lastDrilled:null,timesDrilled:0,notes:'',status:'Not Started',isCustom:true});
  save();render('bjj');toast('Added to your curriculum');
}
function setTechniqueConfidence(id,delta){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  t.confidence=Math.max(1,Math.min(5,ensureNumber(t.confidence,1)+delta));
  save();render('bjj');
}
function setTechniqueStatus(id,status){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  if(!BJJ_STATUSES.includes(status))return;
  t.status=status;
  save();render('bjj');toast('Status updated');
}
function markTechniqueDrilled(id){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  t.timesDrilled=(t.timesDrilled||0)+1; t.lastDrilled=today();
  if(t.status==='Not Started') t.status='Learning';
  save();render('bjj');toast('Marked as drilled today');
}
function updateTechniqueNotes(id,value){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  t.notes=value; save();
}
function addTechniqueToFocus(id){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  if((S.bjjFocus||[]).some(f=>!f.done&&f.text===t.name)){toast('Already in current focus');return}
  if((S.bjjFocus||[]).filter(f=>!f.done).length>=5){toast('Keep it to a few active priorities — mark one done first');return}
  S.bjjFocus.push({id:uid('focus'),text:t.name,date:today(),done:false});
  save();render('bjj');toast('Added to current focus');
}
function removeBjjTechnique(id){
  const t=(S.bjjTechniques||[]).find(x=>x.id===id); if(!t)return;
  if(!t.isCustom){toast("Built-in curriculum techniques can't be removed — you can ignore them instead");return}
  if(!confirm('Remove this custom technique from your curriculum?'))return;
  S.bjjTechniques=(S.bjjTechniques||[]).filter(x=>x.id!==id);
  save();render('bjj');toast('Removed');
}
let bjjExpandedCategory='';
function toggleBjjCategory(id){bjjExpandedCategory=(bjjExpandedCategory===id)?'':id; render('bjj');}
let bjjTechniqueFilter='';
function setBjjTechniqueFilter(){bjjTechniqueFilter=($('bjj_tech_search').value||'').trim().toLowerCase(); render('bjj');}
let bjjExpandedTechnique='';
function toggleBjjTechnique(id){bjjExpandedTechnique=(bjjExpandedTechnique===id)?'':id; render('bjj');}
let bjjLevelFilter='';
function setBjjLevelFilter(level){bjjLevelFilter=(bjjLevelFilter===level)?'':level; render('bjj');}

function renderTechniqueCard(t,forceOpen){
  const isOpen=forceOpen||bjjExpandedTechnique===t.id;
  const confLabel=BJJ_CONFIDENCE_LABELS[t.confidence]||BJJ_CONFIDENCE_LABELS[1];
  const prereqNames=(t.prerequisites||[]).map(pid=>{const p=(S.bjjTechniques||[]).find(x=>x.id===pid);return p?p.name:null}).filter(Boolean);
  const unmetPrereqs=(t.prerequisites||[]).map(pid=>(S.bjjTechniques||[]).find(x=>x.id===pid)).filter(p=>p&&p.status==='Not Started');
  return `<div class="item">
<div class="row" style="justify-content:space-between;align-items:flex-start;cursor:pointer" onclick="${forceOpen?'':`toggleBjjTechnique('${t.id}')`}">
<div><b>${esc(t.name)}</b> <span class="pill">${esc(t.level||'Foundation')}</span>${t.isCustom?' <span class="pill pill-warning">CUSTOM</span>':''}${t.position?` <span class="small muted">· ${esc(t.position)}</span>`:''}
<div class="small muted">${esc(t.status||'Not Started')} · Confidence ${t.confidence}/5 — ${esc(confLabel)}</div>
<div class="small muted">${t.lastDrilled?`Last drilled ${daysAgoLabel(t.lastDrilled)}`:'Never drilled'} · ${t.timesDrilled||0}× total</div>
</div>
${forceOpen?'':`<span class="pill">${isOpen?'▲':'▼'}</span>`}
</div>
${isOpen?`
${t.description?`<p class="small muted" style="margin-top:8px">${esc(t.description)}</p>`:''}
${(t.keyConcepts&&t.keyConcepts.length)?`<div class="small muted"><b>Key concepts:</b> ${t.keyConcepts.map(esc).join(', ')}</div>`:''}
${prereqNames.length?`<div class="small muted" style="margin-top:4px"><b>Prerequisites:</b> ${prereqNames.map(esc).join(', ')}${unmetPrereqs.length?' <span class="pill pill-warning">not started yet</span>':''}</div>`:''}
<div class="row" style="margin-top:8px;align-items:center">
<button class="btn secondary qty-btn" onclick="setTechniqueConfidence('${t.id}',-1)">−</button>
<span class="pill">${t.confidence}/5</span>
<button class="btn secondary qty-btn" onclick="setTechniqueConfidence('${t.id}',1)">+</button>
<button class="btn secondary" onclick="markTechniqueDrilled('${t.id}')">Mark drilled today</button>
</div>
<div class="row" style="margin-top:8px;align-items:center">
<span class="small">Status</span>
<select class="input" style="max-width:160px" onchange="setTechniqueStatus('${t.id}',this.value)">${BJJ_STATUSES.map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${s}</option>`).join('')}</select>
<button class="btn secondary" onclick="addTechniqueToFocus('${t.id}')">Add to focus</button>
${t.isCustom?`<button class="btn secondary qty-btn" title="Remove" onclick="removeBjjTechnique('${t.id}')">×</button>`:''}
</div>
<input class="input" style="margin-top:8px" placeholder="Notes (optional)" value="${esc(t.notes||'')}" onchange="updateTechniqueNotes('${t.id}',this.value)">
`:''}
</div>`;
}
function renderCurriculumCategory(cat){
  const allTechs=(S.bjjTechniques||[]).filter(t=>t.category===cat.id&&(!bjjLevelFilter||t.level===bjjLevelFilter));
  const isOpen=bjjExpandedCategory===cat.id;
  const bySub={};
  allTechs.forEach(t=>{ (bySub[t.position||'Other']=bySub[t.position||'Other']||[]).push(t); });
  const subNames=Object.keys(bySub).sort((a,b)=>(cat.areas.indexOf(a)-cat.areas.indexOf(b))||a.localeCompare(b));
  return `<div class="card" style="margin-top:8px">
<div class="row" style="justify-content:space-between;cursor:pointer" onclick="toggleBjjCategory('${cat.id}')">
<div><b>${esc(cat.name)}</b> <span class="small muted">(${allTechs.length} technique${allTechs.length===1?'':'s'})</span></div>
<span class="pill">${isOpen?'▲':'▼'}</span>
</div>
${isOpen?(allTechs.length?subNames.map(sub=>`<div style="margin-top:8px"><div class="small muted" style="margin-bottom:2px"><b>${esc(sub)}</b></div>${bySub[sub].map(t=>renderTechniqueCard(t)).join('')}</div>`).join(''):'<div class="empty">No techniques in this category at the selected level.</div>'):''}
</div>`;
}
function renderFilteredTechniques(){
  const q=bjjTechniqueFilter;
  const matches=(S.bjjTechniques||[]).filter(t=>t.name.toLowerCase().includes(q)||(t.position||'').toLowerCase().includes(q));
  return matches.length?matches.map(t=>renderTechniqueCard(t)).join(''):'<div class="empty">No techniques match your search.</div>';
}

// ---- Current focus ----
function addBjjFocus(){
  const text=($('bjj_focus_text').value||'').trim();
  if(!text){toast('Enter a focus priority');return}
  if((S.bjjFocus||[]).filter(f=>!f.done).length>=5){toast('Keep it to a few active priorities — mark one done first');return}
  S.bjjFocus.push({id:uid('focus'),text,date:today(),done:false});
  save();render('bjj');toast('Focus added');
}
function toggleBjjFocusDone(id){const f=(S.bjjFocus||[]).find(x=>x.id===id); if(f){f.done=!f.done; save();render('bjj');}}
function removeBjjFocus(id){S.bjjFocus=(S.bjjFocus||[]).filter(x=>x.id!==id); save();render('bjj');}
function deleteBjjSession(id){
  if(!confirm('Delete this BJJ session?'))return;
  S.bjj=(S.bjj||[]).filter(s=>s.id!==id);
  save();render('bjj');toast('Session deleted');
}
// C7: practical edit for a mistaken duration/notes on an already-logged session —
// reuses the app's existing prompt()-based quick-edit pattern (see money.js
// contributeToGoal) rather than building a new inline-edit form for one field pair.
function editBjjSession(id){
  const s=(S.bjj||[]).find(x=>x.id===id);
  if(!s){toast('That session no longer exists');return}
  const durationRaw=prompt('Duration (minutes):',s.duration);
  if(durationRaw===null)return;
  const duration=ensureNumber(durationRaw,NaN);
  if(!Number.isFinite(duration)||duration<0){toast('Enter a valid session duration (0 or more minutes)');return}
  const notesRaw=prompt('Notes (optional):',s.notes||'');
  if(notesRaw===null)return;
  s.duration=duration;
  s.notes=notesRaw.trim();
  save();render('bjj');toast('Session updated');
}

views.bjj=()=>{
  const stats=bjjSessionStats(S.bjj,today());
  const week=trainingWeekOverview(S.workouts,S.bjj,today());
  const activeFocus=(S.bjjFocus||[]).filter(f=>!f.done);
  const doneFocus=(S.bjjFocus||[]).filter(f=>f.done);
  const drilledCount=(S.bjjTechniques||[]).filter(t=>(t.timesDrilled||0)>0).length;
  const confidentCount=(S.bjjTechniques||[]).filter(t=>ensureNumber(t.confidence,1)>=4).length;
  const neglected=bjjNeglectedAreas(S.bjjTechniques,today());
  const recommended=bjjRecommendedPractice(S.bjjTechniques,S.bjjFocus,today(),4);
  const notStartedCount=(S.bjjTechniques||[]).filter(t=>t.status==='Not Started').length;
  const learningCount=(S.bjjTechniques||[]).filter(t=>t.status==='Learning').length;
  const practicingCount=(S.bjjTechniques||[]).filter(t=>t.status==='Practicing').length;
  const confidentStatusCount=(S.bjjTechniques||[]).filter(t=>t.status==='Confident').length;

  return `<p class="page-intro">Curriculum-backed suggestions based on what you haven't drilled recently and what's realistic at your level — not a random pick.</p>
<div class="grid four">
<div class="card"><div class="small">Total sessions</div><div class="metric">${stats.totalSessions}</div></div>
<div class="card"><div class="small">This week</div><div class="metric">${stats.sessionsThisWeek}</div></div>
<div class="card"><div class="small">This month</div><div class="metric">${stats.sessionsThisMonth}</div></div>
<div class="card"><div class="small">Total time</div><div class="metric">${Math.round(stats.totalMinutes/60*10)/10}<span class="unit">hrs</span></div></div>
</div>
<div class="grid two" style="margin-top:12px">
<div class="card"><div class="small">Drilling / sparring (all time)</div><div class="metric">${Math.round(stats.totalDrilling)}<span class="unit">/${Math.round(stats.totalSparring)} min</span></div></div>
<div class="card"><div class="small">Gi / No-Gi sessions</div><div class="metric">${stats.giCount}<span class="unit">/${stats.nogiCount}</span></div></div>
</div>

<h3 class="section">Today's BJJ practice</h3>
<div class="card">
<p class="small muted" style="margin:0 0 8px">Suggested from your curriculum: things you haven't drilled recently, your current focus, and what's realistic at your current level. Not a substitute for your instructor's plan.</p>
${recommended.length?recommended.map(t=>renderTechniqueCard(t,true)).join(''):'<div class="empty">Log a few techniques as practiced to get personalized suggestions here.</div>'}
</div>

<h3 class="section">Log a BJJ session</h3>
<div class="card">
<div class="grid two"><select id="bjj_type" class="input"><option value="gi">Gi</option><option value="nogi">No-Gi</option><option value="openmat">Open Mat</option><option value="private">Private</option></select><input id="bjj_duration" class="input" type="number" min="0" inputmode="numeric" placeholder="Duration (min)" value="60"></div>
<div class="grid two" style="margin-top:8px"><input id="bjj_drilling" class="input" type="number" min="0" inputmode="numeric" placeholder="Drilling min (optional)"><input id="bjj_sparring" class="input" type="number" min="0" inputmode="numeric" placeholder="Sparring min (optional)"></div>
<div class="grid two" style="margin-top:8px"><input id="bjj_techniques" class="input" placeholder="Techniques trained (comma-separated, optional)"><input id="bjj_effort" class="input" type="number" min="1" max="10" inputmode="numeric" placeholder="Effort 1-10 (optional)"></div>
<input id="bjj_notes" class="input" style="margin-top:8px" placeholder="Notes (optional)">
<button class="btn" style="margin-top:9px" onclick="logBjjSession()">Log session</button>
</div>

<h3 class="section">Training week</h3>
<div class="card"><div class="grid" style="grid-template-columns:repeat(7,1fr)">${week.map(d=>`<div style="text-align:center"><div class="small muted">${d.dayName}</div><div style="font-size:20px;margin:4px 0">${d.hasStrength?'🏋️':''}${d.hasBjj?'🥋':''}${(!d.hasStrength&&!d.hasBjj)?'—':''}</div>${d.isToday?'<span class="pill">today</span>':''}</div>`).join('')}</div><div class="small muted" style="margin-top:8px">🏋️ strength logged · 🥋 BJJ logged — last 7 days from your actual logs, not a fixed schedule.</div></div>

<h3 class="section">Current focus</h3>
<div class="card">
${activeFocus.length?activeFocus.map(f=>`<div class="item"><b>${esc(f.text)}</b><div class="row" style="margin-top:6px"><button class="btn secondary" onclick="toggleBjjFocusDone('${f.id}')">Mark done</button><button class="btn danger" onclick="removeBjjFocus('${f.id}')">Remove</button></div></div>`).join(''):'<div class="empty">No current focus set — pick a few things to prioritize.</div>'}
<div class="row" style="margin-top:9px"><input id="bjj_focus_text" class="input" placeholder="e.g. Improve guard retention"><button class="btn" onclick="addBjjFocus()">Add focus</button></div>
${doneFocus.length?`<div class="small muted" style="margin-top:8px">${doneFocus.length} completed focus item${doneFocus.length===1?'':'s'}</div>`:''}
</div>

<h3 class="section">Progress</h3>
<div class="card">
<div class="grid four"><div><div class="small">Not started</div><div class="metric">${notStartedCount}</div></div><div><div class="small">Learning</div><div class="metric">${learningCount}</div></div><div><div class="small">Practicing</div><div class="metric">${practicingCount}</div></div><div><div class="small">Confident</div><div class="metric">${confidentStatusCount}</div></div></div>
<div class="grid three" style="margin-top:10px"><div><div class="small">Techniques in curriculum</div><div class="metric">${(S.bjjTechniques||[]).length}</div></div><div><div class="small">Ever drilled</div><div class="metric">${drilledCount}</div></div><div><div class="small">Confidence ≥ 4</div><div class="metric">${confidentCount}</div></div></div>
<p class="small muted" style="margin-top:10px">Confidence and status are personal self-ratings, not proof of mastery — they just reflect how comfortable this feels right now.</p>
${(S.bjjTechniques||[]).length?(neglected.length?`<div class="small" style="margin-top:8px"><b>Could use attention:</b></div>${neglected.slice(0,5).map(n=>{const cat=(S.bjjCurriculum||[]).find(c=>c.id===n.category);const name=cat?cat.name:n.category;return `<div class="item">${esc(name)} ${n.daysSince===null?"hasn't been drilled yet":`hasn't been drilled in ${n.daysSince} days`}.</div>`;}).join('')}`:'<p class="muted" style="margin-top:8px">Nothing looks neglected right now.</p>'):''}
</div>

<h3 class="section">Curriculum</h3>
<div class="card">
<input id="bjj_tech_search" class="input" placeholder="Search your techniques" value="${esc(bjjTechniqueFilter)}" onchange="setBjjTechniqueFilter()">
<div class="row" style="margin-top:8px">${BJJ_LEVELS.map(l=>`<button class="btn ${bjjLevelFilter===l?'':'secondary'}" onclick="setBjjLevelFilter('${l}')">${l}</button>`).join('')}</div>
</div>
${bjjTechniqueFilter?`<div class="card" style="margin-top:8px">${renderFilteredTechniques()}</div>`:(S.bjjCurriculum||[]).map(renderCurriculumCategory).join('')}
<div class="card" style="margin-top:10px">
<h4 style="margin:0 0 8px">Add a custom technique or concept</h4>
<div class="grid two"><input id="tech_name" class="input" placeholder="Name (e.g. Scissor sweep)"><select id="tech_category" class="input" onchange="updateTechPositionOptions()"><option value="">Category…</option>${(S.bjjCurriculum||[]).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><select id="tech_position" class="input"><option value="">Position/area (optional)</option></select><select id="tech_level" class="input">${BJJ_LEVELS.map(l=>`<option value="${l}">${l}</option>`).join('')}</select></div>
<input id="tech_description" class="input" style="margin-top:8px" placeholder="Description (optional)">
<button class="btn" style="margin-top:9px" onclick="addBjjTechnique()">Add to curriculum</button>
</div>

<h3 class="section">Recent sessions</h3>
<div class="card">${(S.bjj||[]).slice(-15).reverse().map(s=>`<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${esc(bjjTypeLabel(s.type))}</b> <span class="small">${s.date} · ${daysAgoLabel(s.date)}</span></div><div class="row" style="gap:6px"><button class="btn secondary qty-btn" title="Edit" onclick="editBjjSession('${s.id}')">✎</button><button class="btn secondary qty-btn" title="Delete" onclick="deleteBjjSession('${s.id}')">×</button></div></div><div class="small muted">${ensureNumber(s.duration)} min total${s.drilling?` · ${ensureNumber(s.drilling)} min drilling`:''}${s.sparring?` · ${ensureNumber(s.sparring)} min sparring`:''}${s.effort?` · Effort ${esc(s.effort)}/10`:''}</div>${s.techniques&&s.techniques.length?`<div class="small muted">Techniques: ${s.techniques.map(esc).join(', ')}</div>`:''}${s.notes?`<div class="small muted">${esc(s.notes)}</div>`:''}</div>`).join('')||'<div class="empty">No BJJ sessions logged yet.</div>'}</div>`;
};
