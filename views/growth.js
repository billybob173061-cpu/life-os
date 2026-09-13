const CAREER_CATEGORIES=['Technical','Digital','Business','Creative','Other'];
const CAREER_STATUSES=['Exploring','Active','Paused','Completed','Rejected'];
const CAREER_RATING_FIELDS=[['interest','Interest'],['earningPotential','Earning potential'],['difficulty','Difficulty'],['confidence','Confidence'],['fit','Fit']];

// ---- Career experiments ----
function createCareerExperiment(){
  const name=($('exp_title').value||'').trim();
  if(!name){toast('Name the experiment (e.g. CAD, AI automation, sales)');return}
  const category=$('exp_category').value||'';
  S.career.push({
    id:uid('career'),name,category,status:'Exploring',
    dateStarted:today(),date:today(),dateCompleted:null,lastActivity:null,
    timeInvested:0,whatIActuallyDid:'',whatILearned:'',whatILiked:'',whatIDisliked:'',
    difficulty:null,earningPotential:null,interest:null,confidence:null,fit:null,
    nextStep:'',notes:'',sessions:[],roadmap:{current:'',next:'',after:'',goal:''}
  });
  save();render('growth');toast('Experiment created');
}
let careerExpandedId='';
function toggleCareerExpand(id){careerExpandedId=(careerExpandedId===id)?'':id;render('growth');}
function updateExperimentStatus(id,status){
  const e=(S.career||[]).find(x=>x.id===id); if(!e)return;
  e.status=status;
  if(status==='Completed'&&!e.dateCompleted) e.dateCompleted=today();
  save();render('growth');toast('Status updated');
}
function deleteCareerExperiment(id){
  if(!confirm('Delete this experiment? This cannot be undone.'))return;
  S.career=(S.career||[]).filter(x=>x.id!==id);
  save();render('growth');toast('Experiment deleted');
}
function setExperimentRating(id,field,value){
  const e=(S.career||[]).find(x=>x.id===id); if(!e)return;
  const n=value===''?null:Math.max(1,Math.min(5,ensureNumber(value,NaN)));
  e[field]=(n===null||Number.isFinite(n))?n:e[field];
  save();render('growth');
}
function updateExperimentText(id,field,value){
  const e=(S.career||[]).find(x=>x.id===id); if(!e)return;
  e[field]=value; save();
}
function updateExperimentRoadmap(id,field,value){
  const e=(S.career||[]).find(x=>x.id===id); if(!e)return;
  e.roadmap=e.roadmap||{current:'',next:'',after:'',goal:''};
  e.roadmap[field]=value; save();
}
function logCareerSession(id){
  const e=(S.career||[]).find(x=>x.id===id);
  if(!e){toast('That experiment no longer exists');return}
  const duration=ensureNumber($(`sess_dur_${id}`).value,NaN);
  const date=($(`sess_date_${id}`).value||'').trim()||today();
  const whatIWorkedOn=($(`sess_did_${id}`).value||'').trim();
  const learned=($(`sess_learned_${id}`).value||'').trim();
  const nextStep=($(`sess_next_${id}`).value||'').trim();
  if(!Number.isFinite(duration)||duration<=0){toast('Enter a session duration greater than zero');return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('Enter a valid date');return}
  e.sessions.push({id:uid('sess'),date,duration,whatIWorkedOn,whatILearned:learned,nextStep});
  e.timeInvested=ensureNumber(e.timeInvested,0)+duration;
  e.lastActivity=today();
  if(whatIWorkedOn) e.whatIActuallyDid=(e.whatIActuallyDid?e.whatIActuallyDid+'\n':'')+`${date}: ${whatIWorkedOn}`;
  if(learned) e.whatILearned=(e.whatILearned?e.whatILearned+'\n':'')+`${date}: ${learned}`;
  if(nextStep) e.nextStep=nextStep;
  save();render('growth');toast('Session logged');
}
let careerSortKey='interest';
function setCareerSortKey(k){careerSortKey=k;render('growth');}
// C7: practical edit for a mistaken duration/description on an already-logged
// session — reuses the app's existing prompt()-based quick-edit pattern. Keeps
// e.timeInvested consistent by removing the old duration before adding the new one.
function editCareerSession(expId,sessId){
  const e=(S.career||[]).find(x=>x.id===expId); if(!e){toast('That experiment no longer exists');return}
  const s=(e.sessions||[]).find(x=>x.id===sessId); if(!s){toast('That session no longer exists');return}
  const durationRaw=prompt('Duration (minutes):',s.duration);
  if(durationRaw===null)return;
  const duration=ensureNumber(durationRaw,NaN);
  if(!Number.isFinite(duration)||duration<=0){toast('Enter a session duration greater than zero');return}
  const whatRaw=prompt('What I worked on (optional):',s.whatIWorkedOn||'');
  if(whatRaw===null)return;
  e.timeInvested=Math.max(0,ensureNumber(e.timeInvested,0)-ensureNumber(s.duration,0)+duration);
  s.duration=duration;
  s.whatIWorkedOn=whatRaw.trim();
  save();render('growth');toast('Session updated');
}

// ---- Skills ----
function createCareerSkill(){
  const name=($('skill_name').value||'').trim();
  if(!name){toast('Name the skill');return}
  if((S.careerSkills||[]).some(s=>sameExerciseName(s.name,name))){toast('That skill is already tracked');return}
  const category=$('skill_category').value||'';
  S.careerSkills.push({id:uid('skill'),name,category,currentLevel:1,targetLevel:3,whyItMatters:'',earningPotential:null,lastPracticed:null,practiceMinutes:0,notes:'',practiceHistory:[]});
  save();render('growth');toast('Skill added');
}
function adjustSkillLevel(id,field,delta){
  const s=(S.careerSkills||[]).find(x=>x.id===id); if(!s)return;
  s[field]=Math.max(1,Math.min(5,ensureNumber(s[field],1)+delta));
  save();render('growth');
}
function updateSkillField(id,field,value){
  const s=(S.careerSkills||[]).find(x=>x.id===id); if(!s)return;
  if(field==='earningPotential'){ s[field]=value===''?null:Math.max(1,Math.min(5,ensureNumber(value,NaN))); }
  else s[field]=value;
  save();
}
function logSkillPractice(id){
  const s=(S.careerSkills||[]).find(x=>x.id===id);
  if(!s){toast('That skill no longer exists');return}
  const duration=ensureNumber($(`prac_dur_${id}`).value,NaN);
  const what=($(`prac_what_${id}`).value||'').trim();
  const notes=($(`prac_notes_${id}`).value||'').trim();
  if(!Number.isFinite(duration)||duration<=0){toast('Enter a practice duration greater than zero');return}
  s.practiceHistory.push({id:uid('prac'),date:today(),minutes:duration,whatIPracticed:what,notes});
  s.practiceMinutes=ensureNumber(s.practiceMinutes,0)+duration;
  s.lastPracticed=today();
  save();render('growth');toast('Practice logged');
}
// C7: practical edit for a mistaken duration/description on an already-logged
// practice entry — mirrors editCareerSession's approach for the sessions list.
function editSkillPractice(skillId,practiceId){
  const s=(S.careerSkills||[]).find(x=>x.id===skillId); if(!s){toast('That skill no longer exists');return}
  const p=(s.practiceHistory||[]).find(x=>x.id===practiceId); if(!p){toast('That practice entry no longer exists');return}
  const minutesRaw=prompt('Minutes practiced:',p.minutes);
  if(minutesRaw===null)return;
  const minutes=ensureNumber(minutesRaw,NaN);
  if(!Number.isFinite(minutes)||minutes<=0){toast('Enter a practice duration greater than zero');return}
  const whatRaw=prompt('What I practiced (optional):',p.whatIPracticed||'');
  if(whatRaw===null)return;
  s.practiceMinutes=Math.max(0,ensureNumber(s.practiceMinutes,0)-ensureNumber(p.minutes,0)+minutes);
  p.minutes=minutes;
  p.whatIPracticed=whatRaw.trim();
  save();render('growth');toast('Practice updated');
}
function deleteCareerSkill(id){
  if(!confirm('Delete this skill? This cannot be undone.'))return;
  S.careerSkills=(S.careerSkills||[]).filter(x=>x.id!==id);
  save();render('growth');toast('Skill deleted');
}

// ---- Weekly career target ----
function setCareerWeeklyTarget(){
  const text=($('career_target_text').value||'').trim();
  const minutesGoal=Math.max(0,ensureNumber($('career_target_minutes').value,0));
  S.careerWeeklyTarget={text,minutesGoal};
  save();render('growth');toast('Weekly target saved');
}

// ---- Deterministic, transparent "decision evidence" signal — never a fabricated verdict ----
function careerExperimentSignal(e){
  const i=e.interest,ep=e.earningPotential;
  if(!Number.isFinite(i)&&!Number.isFinite(ep)) return 'Add interest/earning-potential ratings to get a personal signal here.';
  if(Number.isFinite(i)&&i<=2) return 'Low interest logged — this might not be worth more of your time.';
  if(Number.isFinite(i)&&Number.isFinite(ep)&&i>=4&&ep>=4) return 'High interest and high earning potential logged — a promising signal to keep testing.';
  if(Number.isFinite(i)&&i>=4&&Number.isFinite(ep)&&ep<=2) return 'You like this, but the earning potential you\'ve logged is low — worth thinking about how it could actually pay.';
  if(Number.isFinite(ep)&&ep>=4&&Number.isFinite(i)&&i<=2) return 'Earning potential looks good, but your interest is low — a tough long-term combination.';
  return 'Mixed or partial signal so far — keep logging sessions and ratings to get a clearer picture.';
}

function renderExperimentCard(e){
  const score=careerExperimentScore(e);
  const isOpen=careerExpandedId===e.id;
  const ratingsLine=CAREER_RATING_FIELDS.map(([f,label])=>`${label[0]}:${Number.isFinite(e[f])?e[f]:'—'}`).join(' ');
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<div><b>${esc(e.name||'Untitled experiment')}</b>${e.category?` <span class="pill">${esc(e.category)}</span>`:''}<div class="small muted">${Math.round(e.timeInvested||0)} min invested · ${ratingsLine}</div>${e.nextStep?`<div class="small muted">Next: ${esc(e.nextStep)}</div>`:''}</div>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteCareerExperiment('${e.id}')">×</button>
</div>
<div class="row" style="margin-top:8px;align-items:center">
<select class="input" style="max-width:150px" onchange="updateExperimentStatus('${e.id}',this.value)">${CAREER_STATUSES.map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s}</option>`).join('')}</select>
<button class="btn secondary" onclick="toggleCareerExpand('${e.id}')">${isOpen?'Hide details':'Details / Log session'}</button>
</div>
${isOpen?`
<div class="card" style="margin-top:10px">
<h4 style="margin:0 0 8px">Log a session</h4>
<div class="grid two"><input id="sess_dur_${e.id}" class="input" type="number" min="1" inputmode="numeric" placeholder="Minutes"><input id="sess_date_${e.id}" class="input" type="date" value="${today()}"></div>
<input id="sess_did_${e.id}" class="input" style="margin-top:8px" placeholder="What I worked on">
<input id="sess_learned_${e.id}" class="input" style="margin-top:8px" placeholder="What I learned">
<input id="sess_next_${e.id}" class="input" style="margin-top:8px" placeholder="Next step">
<button class="btn" style="margin-top:9px" onclick="logCareerSession('${e.id}')">Log session</button>
${e.sessions&&e.sessions.length?`<div class="list" style="margin-top:8px">${e.sessions.slice(-5).reverse().map(s=>`<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${s.duration} min</b> <span class="small muted">${s.date}</span>${s.whatIWorkedOn?`<div class="small muted">${esc(s.whatIWorkedOn)}</div>`:''}</div><button class="btn secondary qty-btn" title="Edit" onclick="editCareerSession('${e.id}','${s.id}')">✎</button></div></div>`).join('')}</div>`:'<div class="empty">No sessions logged yet.</div>'}
</div>
<div class="card" style="margin-top:10px">
<h4 style="margin:0 0 8px">Scorecard <span class="small muted">(your personal experiment signal — not a career verdict)</span></h4>
<div class="grid two">${CAREER_RATING_FIELDS.map(([f,label])=>`<label class="small">${label}<select class="input" onchange="setExperimentRating('${e.id}','${f}',this.value)"><option value="">Not rated</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${e[f]===n?'selected':''}>${n}</option>`).join('')}</select></label>`).join('')}</div>
<div class="small muted" style="margin-top:8px">${score?`Average of your ${score.count}/${score.of} logged ratings: ${score.avg.toFixed(1)}/5`:'No ratings logged yet.'}</div>
</div>
<div class="card" style="margin-top:10px">
<h4 style="margin:0 0 8px">Notes &amp; evidence</h4>
<label class="small">What I actually did<textarea class="input" rows="2" onchange="updateExperimentText('${e.id}','whatIActuallyDid',this.value)">${esc(e.whatIActuallyDid)}</textarea></label>
<label class="small" style="margin-top:8px;display:block">What I learned<textarea class="input" rows="2" onchange="updateExperimentText('${e.id}','whatILearned',this.value)">${esc(e.whatILearned)}</textarea></label>
<div class="grid two" style="margin-top:8px"><label class="small">What I liked<textarea class="input" rows="2" onchange="updateExperimentText('${e.id}','whatILiked',this.value)">${esc(e.whatILiked)}</textarea></label><label class="small">What I disliked<textarea class="input" rows="2" onchange="updateExperimentText('${e.id}','whatIDisliked',this.value)">${esc(e.whatIDisliked)}</textarea></label></div>
<label class="small" style="margin-top:8px;display:block">Notes<textarea class="input" rows="2" onchange="updateExperimentText('${e.id}','notes',this.value)">${esc(e.notes)}</textarea></label>
<p class="small muted" style="margin-top:8px"><b>Signal:</b> ${esc(careerExperimentSignal(e))}</p>
</div>
<div class="card" style="margin-top:10px">
<h4 style="margin:0 0 8px">Roadmap</h4>
<label class="small">Current<input class="input" value="${esc(e.roadmap?.current||'')}" onchange="updateExperimentRoadmap('${e.id}','current',this.value)"></label>
<label class="small" style="margin-top:8px;display:block">Next<input class="input" value="${esc(e.roadmap?.next||'')}" onchange="updateExperimentRoadmap('${e.id}','next',this.value)"></label>
<label class="small" style="margin-top:8px;display:block">After<input class="input" value="${esc(e.roadmap?.after||'')}" onchange="updateExperimentRoadmap('${e.id}','after',this.value)"></label>
<label class="small" style="margin-top:8px;display:block">Goal<input class="input" value="${esc(e.roadmap?.goal||'')}" onchange="updateExperimentRoadmap('${e.id}','goal',this.value)"></label>
</div>`:''}
</div>`;
}

function renderSkillCard(s){
  const neglect=careerSkillNeglect(s,today());
  return `<div class="card" style="margin-top:10px">
<div class="row" style="justify-content:space-between;align-items:flex-start">
<div><b>${esc(s.name)}</b>${s.category?` <span class="pill">${esc(s.category)}</span>`:''}${neglect.neglected?`<span class="pill pill-warning">Neglected · ${neglect.daysSince}d</span>`:''}<div class="small muted">Level ${s.currentLevel}/5 (target ${s.targetLevel}/5) · ${Math.round(s.practiceMinutes||0)} min practiced</div><div class="small muted">${s.lastPracticed?`Last practiced ${daysAgoLabel(s.lastPracticed)}`:'Never practiced yet'}</div></div>
<button class="btn secondary qty-btn" title="Remove" onclick="deleteCareerSkill('${s.id}')">×</button>
</div>
<div class="row" style="margin-top:8px;align-items:center">
<span class="small">Current:</span><button class="btn secondary qty-btn" onclick="adjustSkillLevel('${s.id}','currentLevel',-1)">−</button><span class="pill">${s.currentLevel}/5</span><button class="btn secondary qty-btn" onclick="adjustSkillLevel('${s.id}','currentLevel',1)">+</button>
<span class="small" style="margin-left:8px">Target:</span><button class="btn secondary qty-btn" onclick="adjustSkillLevel('${s.id}','targetLevel',-1)">−</button><span class="pill">${s.targetLevel}/5</span><button class="btn secondary qty-btn" onclick="adjustSkillLevel('${s.id}','targetLevel',1)">+</button>
</div>
<div class="grid two" style="margin-top:8px"><input id="prac_dur_${s.id}" class="input" type="number" min="1" inputmode="numeric" placeholder="Practice minutes"><input id="prac_what_${s.id}" class="input" placeholder="What I practiced"></div>
<button class="btn secondary" style="margin-top:8px" onclick="logSkillPractice('${s.id}')">Log practice</button>
${s.practiceHistory&&s.practiceHistory.length?`<div class="list" style="margin-top:8px">${s.practiceHistory.slice(-3).reverse().map(p=>`<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${p.minutes} min</b> <span class="small muted">${p.date}</span>${p.whatIPracticed?`<div class="small muted">${esc(p.whatIPracticed)}</div>`:''}</div><button class="btn secondary qty-btn" title="Edit" onclick="editSkillPractice('${s.id}','${p.id}')">✎</button></div></div>`).join('')}</div>`:'<div class="empty">No practice logged yet.</div>'}
</div>`;
}

views.growth=()=>{
  const experiments=S.career||[];
  const skills=S.careerSkills||[];
  const active=experiments.filter(e=>e.status==='Active');
  const completed=experiments.filter(e=>e.status==='Completed');
  const developing=skills.filter(s=>s.currentLevel<s.targetLevel);
  const totalMinutes=careerTotalTimeInvested(experiments);
  const neglectedSkills=skills.map(s=>({s,n:careerSkillNeglect(s,today())})).filter(x=>x.n.neglected);
  const rated=(field)=>experiments.filter(e=>Number.isFinite(e[field]));
  const topInterest=rated('interest').sort((a,b)=>b.interest-a.interest)[0];
  const topEarning=rated('earningPotential').sort((a,b)=>b.earningPotential-a.earningPotential)[0];
  const weeklyMinutes=careerWeeklyMinutes(experiments,today());
  const target=S.careerWeeklyTarget||{text:'',minutesGoal:0};
  const targetPct=target.minutesGoal>0?pct(weeklyMinutes,target.minutesGoal):0;
  const comparable=experiments.filter(e=>e.status==='Active'||e.status==='Completed');
  const sortField=careerSortKey==='timeInvested'?'timeInvested':careerSortKey;
  const sorted=comparable.slice().sort((a,b)=>{
    const av=sortField==='timeInvested'?ensureNumber(a.timeInvested,0):(Number.isFinite(a[sortField])?a[sortField]:-1);
    const bv=sortField==='timeInvested'?ensureNumber(b.timeInvested,0):(Number.isFinite(b[sortField])?b[sortField]:-1);
    return bv-av;
  });

  return `<p class="page-intro">The goal isn't to pick your career today — it's to test paths, build transferable skills, and let real evidence, not guesses, point toward higher earning power.</p>

<div class="grid four">
<div class="card"><div class="small">Active experiments</div><div class="metric">${active.length}</div></div>
<div class="card"><div class="small">Skills developing</div><div class="metric">${developing.length}</div></div>
<div class="card"><div class="small">Completed</div><div class="metric">${completed.length}</div></div>
<div class="card"><div class="small">Total time invested</div><div class="metric">${Math.round(totalMinutes/60*10)/10}<span class="unit">hrs</span></div></div>
</div>
<div class="grid two" style="margin-top:12px">
<div class="card"><div class="small">Highest interest</div><div class="metric" style="font-size:var(--text-lg)">${topInterest?esc(topInterest.name):'—'}</div><div class="small muted">${topInterest?`${topInterest.interest}/5 interest logged`:'No ratings logged yet'}</div></div>
<div class="card"><div class="small">Highest earning potential</div><div class="metric" style="font-size:var(--text-lg)">${topEarning?esc(topEarning.name):'—'}</div><div class="small muted">${topEarning?`${topEarning.earningPotential}/5 earning potential logged`:'No ratings logged yet'}</div></div>
</div>
${neglectedSkills.length?`<div class="card" style="margin-top:12px"><div class="small">Skills neglected recently</div>${neglectedSkills.slice(0,3).map(x=>`<div class="small muted">${esc(x.s.name)} — ${x.n.daysSince} days since practice</div>`).join('')}</div>`:''}

<h3 class="section">Weekly career target</h3>
<div class="card">
${target.minutesGoal>0?`<div class="small">${esc(target.text||'This week\'s target')}</div><div class="metric">${Math.round(weeklyMinutes)}<span class="unit">/${target.minutesGoal} min</span></div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${targetPct}%"></div></div><div class="small muted" style="margin-top:6px">${Math.round(targetPct)}% complete this week</div>`:'<div class="empty">No weekly career target set yet.</div>'}
<div class="grid two" style="margin-top:10px"><input id="career_target_text" class="input" placeholder="e.g. Spend 2 hours testing AI automation" value="${esc(target.text||'')}"><input id="career_target_minutes" class="input" type="number" min="0" inputmode="numeric" placeholder="Minutes goal" value="${target.minutesGoal||''}"></div>
<button class="btn secondary" style="margin-top:9px" onclick="setCareerWeeklyTarget()">Save target</button>
</div>

<h3 class="section">New experiment</h3>
<div class="card"><div class="grid two"><input id="exp_title" class="input" placeholder="e.g. CAD, AI automation, sales, CNC"><select id="exp_category" class="input">${CAREER_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div><button class="btn" style="margin-top:9px" onclick="createCareerExperiment()">Start experiment</button></div>

<h3 class="section">Experiments</h3>
${experiments.length?experiments.slice().reverse().map(renderExperimentCard).join(''):'<div class="card"><div class="empty">No experiments yet — start one above.</div></div>'}

<h3 class="section">Skills</h3>
<div class="card"><div class="grid two"><input id="skill_name" class="input" placeholder="Skill name (e.g. CAD, welding, sales)"><select id="skill_category" class="input">${CAREER_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div><button class="btn" style="margin-top:9px" onclick="createCareerSkill()">Add skill</button></div>
${skills.length?skills.slice().reverse().map(renderSkillCard).join(''):'<div class="card"><div class="empty">No skills tracked yet.</div></div>'}

<h3 class="section">Compare experiments</h3>
<div class="card">
<div class="row">${[['interest','Interest'],['earningPotential','Earning potential'],['confidence','Confidence'],['timeInvested','Time invested']].map(([k,label])=>`<button class="btn ${careerSortKey===k?'':'secondary'}" onclick="setCareerSortKey('${k}')">${label}</button>`).join('')}</div>
<p class="small muted" style="margin-top:8px">These are your own logged scores — not an objective ranking of any career.</p>
${sorted.length?sorted.map(e=>`<div class="item"><b>${esc(e.name)}</b> <span class="pill">${esc(e.status)}</span><div class="small muted">${CAREER_RATING_FIELDS.map(([f,label])=>`${label}: ${Number.isFinite(e[f])?e[f]:'—'}`).join(' · ')} · ${Math.round(e.timeInvested||0)} min</div></div>`).join(''):'<div class="empty">No active or completed experiments to compare yet.</div>'}
</div>`;
};

