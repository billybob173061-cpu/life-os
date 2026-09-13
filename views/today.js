views.today=()=>{
  let p=S.profile, done=Object.values(S.checks).filter(Boolean).length;
  let todayMeals=S.meals.filter(x=>x.date===today());
  let mt=foodTotals(todayMeals);
  let lastWorkout=S.workouts[S.workouts.length-1];
  let workoutsRecent=S.workouts.slice(-7).length;
  let lastBjj=S.bjj[S.bjj.length-1];
  let bjjRecent=S.bjj.slice(-7).length;
  let bjjToday=S.bjj.some(x=>x.date===today());
  let bjjFocusTop=(S.bjjFocus||[]).find(f=>!f.done);
  let plan=S.coach.plans[0];
  let weightPct=weightProgressPct();
  let savingsPct=pct(p.savings,p.savingsGoal);
  let calPct=pct(mt.cal,p.cal);
  let monthMoneyTx=moneyTransactionsInMonth(S.money,monthKey(today()));
  let monthNet=sumByType(monthMoneyTx,'income')-sumByType(monthMoneyTx,'expense');
  let exceededBudget=Object.entries(S.moneyBudgets||{}).find(([cat,limit])=>{
    const spent=moneyCategoryBreakdown(monthMoneyTx,'expense').find(c=>c.category===cat)?.total||0;
    return spent>=limit;
  });
  let moneyNote=exceededBudget?`${esc(exceededBudget[0])} budget exceeded this month`:`Net this month: ${monthNet<0?'−':''}${money(Math.abs(monthNet))}`;
  let neglectedSkill=(S.careerSkills||[]).map(s=>({s,n:careerSkillNeglect(s,today())})).find(x=>x.n.neglected);
  let activeExperiment=(S.career||[]).find(e=>e.status==='Active');
  let careerTarget=S.careerWeeklyTarget||{text:'',minutesGoal:0};
  let careerWeekMin=careerWeeklyMinutes(S.career,today());
  let careerNote=neglectedSkill?`${esc(neglectedSkill.s.name)} hasn't been practiced in ${neglectedSkill.n.daysSince} days.`
    :(activeExperiment&&activeExperiment.nextStep?`${esc(activeExperiment.name)} — next: ${esc(activeExperiment.nextStep)}`
    :(careerTarget.minutesGoal>0?`Weekly target: ${Math.round(careerWeekMin)}/${careerTarget.minutesGoal} min (${Math.round(pct(careerWeekMin,careerTarget.minutesGoal))}%)`
    :'Log a career experiment or skill practice this week.'));
  let activeSocialGoal=(S.socialGoals||[]).find(g=>g.active);
  let uncompletedChallenge=null;
  socialChallengeSearch: for(const lvl of (S.socialChallenges||[])){
    for(const item of lvl.items){
      if(!(S.socialChallengeCompletions||[]).some(c=>c.level===lvl.level&&c.challengeText===item)){uncompletedChallenge=item;break socialChallengeSearch;}
    }
  }
  let socialTargetProg=socialWeeklyTargetProgress(S.social,S.socialWeeklyTarget,today());
  let hasSocialTarget=(S.socialWeeklyTarget.conversations||S.socialWeeklyTarget.initiations||S.socialWeeklyTarget.plans||S.socialWeeklyTarget.socialMinutes)>0;
  let socialNote=activeSocialGoal?`Goal: ${esc(activeSocialGoal.name)}`
    :(uncompletedChallenge?`Try: ${esc(uncompletedChallenge)}`
    :(hasSocialTarget?`Conversations: ${socialTargetProg.conversations.done}/${socialTargetProg.conversations.goal} this week`
    :'Start one conversation today.'));
  let curReviewWeek=reviewWeekInfo(today(),0);
  let curReviewSnapshot=findWeeklySnapshot(S.weeklyReviewSnapshots,curReviewWeek.weekStart);
  let weeklyReviewNote=(curReviewSnapshot&&curReviewSnapshot.completed)?'Weekly review complete.':'Weekly review is ready.';
  const cloudConfigured=!!(CLOUD.url&&CLOUD.anon);
  const syncMetaToday=(typeof getSyncMeta==='function')?getSyncMeta():{dirty:false,lastSyncError:null};
  let syncAlert=null;
  if(cloudConfigured&&!(SB&&CLOUD.user)) syncAlert="You're signed out. Your local data is still on this device.";
  else if(syncMetaToday.lastSyncError) syncAlert=syncMetaToday.lastSyncError;
  else if(syncMetaToday.dirty) syncAlert='You have unsynced local changes.';
  const mentorPlanItems=mentorDailyPlan(S,today());
  // Phase 6 (Home): reuses exploreForYouNotes() (pure local heuristics, zero web
  // calls) and, when Explore's "Happening Soon" has already been fetched THIS
  // session, shows a condensed peek at that SAME cached result — Home never
  // triggers its own web search, per the "no automatic expensive search" rule.
  const forYouNotes=(typeof exploreForYouNotes==='function')?exploreForYouNotes():[];
  const soonCache=(typeof exploreHappeningSoon!=='undefined')?exploreHappeningSoon:null;
  const soonPeek=(r)=>{
    if(!r||r.loading) return '';
    if(r.error||(!r.text&&!r.recommendation)) return '';
    return `<div class="small" style="margin-top:6px">${r.recommendation?`<b>${esc(r.recommendation.name)}</b>`:esc((r.text||'').slice(0,90))}</div>`;
  };
  const happeningSoonBlock=soonCache
    ?`<div class="card"><div class="small muted">From Explore, updated ${esc(relativeTimeLabel(soonCache.fetchedAt))}</div>${soonPeek(soonCache.tonight)}${soonPeek(soonCache.weekend)}<button class="btn secondary" style="margin-top:9px" onclick="go('explore')">See more in Explore</button></div>`
    :`<div class="card"><div class="small muted">Check Explore for real, current things happening tonight and this weekend.</div><button class="btn secondary" style="margin-top:9px" onclick="go('explore')">Find things happening soon</button></div>`;
  return `<div class="hero"><div class="kicker">HOME</div><h2>${p.name?'Good to see you, '+esc(p.name)+'.':'What matters right now.'}</h2><p>Win today. Review weekly. Adjust intelligently. Don't wait to feel confident before acting.</p></div>

<h3 class="section">Snapshot</h3>
<div class="card">${mentorPlanItems.length?mentorPlanItems.map((it,i)=>`<div class="task"><div class="pill">${i+1}</div><div>${esc(it)}</div></div>`).join(''):'<p class="muted">Not enough recent data yet for a specific plan — log a few things and check back.</p>'}<button class="btn secondary" style="margin-top:9px" onclick="go('mentor')">Ask Mentor</button></div>
<div class="card" style="margin-top:10px">${task('hydrate','Hydrate','Water throughout the day')}${task('protein','Hit protein','Aim for '+p.protein+'g')}${task('steps','Move','Reach '+p.steps.toLocaleString()+'+ steps')}${task('training','Train',`Follow today's BJJ/lifting plan`)}${task('social','Courage rep',`One conversation you normally would avoid`)}${task('career','Build your future','30 minutes on a valuable skill')}</div>
${syncAlert?`<div class="card" style="margin-top:10px"><div class="small muted">${esc(syncAlert)}</div><button class="btn secondary" style="margin-top:9px" onclick="go('settings')">Go to Settings</button></div>`:''}

${forYouNotes.length?`<h3 class="section">For You</h3><div class="card">${forYouNotes.map(n=>`<div class="explore-foryou-note">${n}</div>`).join('')}</div>`:''}

<h3 class="section">Happening Soon</h3>
${happeningSoonBlock}

<h3 class="section">Progress</h3>
<div class="grid four">
<div class="card"><div class="small">Weight</div><div class="metric">${p.weight}<span class="unit">lb</span></div><div class="small">Target ${p.targetWeight} lb</div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${weightPct}%"></div></div></div>
<div class="card"><div class="small">Savings</div><div class="metric">${money(p.savings)}</div><div class="small">Goal ${money(p.savingsGoal)}</div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${savingsPct}%"></div></div><div class="small muted" style="margin-top:4px">${moneyNote}</div></div>
<div class="card"><div class="small">Calories today</div><div class="metric">${Math.round(mt.cal)}<span class="unit">/${p.cal}</span></div><div class="small">P ${mt.prot.toFixed(0)}g · C ${mt.carbs.toFixed(0)}g · F ${mt.fat.toFixed(0)}g</div><div class="barbg" style="margin-top:8px"><div class="bar" style="width:${calPct}%"></div></div></div>
<div class="card"><div class="small">Core actions</div><div class="metric">${done}<span class="unit">/6</span></div><div class="small">completed today</div></div>
</div>
${S.activeWorkout?`<div class="card status-active" style="margin-top:10px"><span class="pill pill-active">IN PROGRESS</span><h3 style="margin:8px 0 2px">${esc(S.activeWorkout.name)}</h3><p class="muted">Started ${daysAgoLabel(S.activeWorkout.startedAt.slice(0,10))}.</p><button class="btn" onclick="go('training')">Resume workout</button></div>`:''}
<!-- Consolidated below into one card with lightweight rows (rather than five
     separate elevated cards) — same links, same information, far less "wall of
     cards" weight on the page a user scans every single day. -->
<div class="card" style="margin-top:10px">
<div class="item"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>Training</b><div class="small muted">${workoutsRecent} session${workoutsRecent===1?'':'s'} this week${lastWorkout?` · Last: ${esc(lastWorkout.template||'Workout')}, ${daysAgoLabel(lastWorkout.date)}`:' · No workouts logged yet'}</div></div><button type="button" class="btn tertiary" onclick="go('training')">Open →</button></div></div>
<div class="item"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>BJJ</b><div class="small muted">${bjjRecent} session${bjjRecent===1?'':'s'} this week${bjjToday?' · Logged today ✓':(lastBjj?` · Last ${daysAgoLabel(lastBjj.date)}`:' · No sessions logged yet')}${bjjFocusTop?` · Focus: ${esc(bjjFocusTop.text)}`:''}</div></div><button type="button" class="btn tertiary" onclick="go('bjj')">Open →</button></div></div>
<div class="item"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>Career</b><div class="small muted">${careerNote}</div></div><button type="button" class="btn tertiary" onclick="go('growth')">Open →</button></div></div>
<div class="item"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>Social</b><div class="small muted">${socialNote}</div></div><button type="button" class="btn tertiary" onclick="go('social')">Open →</button></div></div>
<div class="item"><div class="row" style="justify-content:space-between;align-items:center;gap:10px"><div><b>Weekly Review</b><div class="small muted">${weeklyReviewNote}</div></div><button type="button" class="btn tertiary" onclick="go('review')">Open →</button></div></div>
</div>

<h3 class="section">Quick actions</h3>
<div class="row">
<button type="button" class="btn secondary" onclick="go('mentor')">Ask Mentor</button>
<button type="button" class="btn secondary" onclick="go('training')">Log workout</button>
<button type="button" class="btn secondary" onclick="go('bjj')">Log BJJ</button>
<button type="button" class="btn secondary" onclick="go('body')">Log weight</button>
<button type="button" class="btn secondary" onclick="go('money')">Log expense</button>
<button type="button" class="btn secondary" onclick="go('explore')">Explore</button>
</div>

<h3 class="section">Coach highlight</h3><div class="card">${plan?(plan.topSignal?`<div class="pill">${esc(plan.date)}</div><h3 style="margin:8px 0 4px">${esc(plan.topSignal.title)}</h3><p class="muted" style="margin:4px 0">${esc(plan.topSignal.evidence)}</p><p style="margin:4px 0"><b>&rarr; ${esc(plan.topSignal.action)}</b></p>`:`<div class="pill">${esc(plan.date)}</div><h3 style="margin:8px 0 4px">${esc(plan.headline)}</h3><p style="margin:4px 0"><b>${esc(plan.items[0]||'')}</b></p>${plan.items[1]?`<p class="muted" style="margin:4px 0">${esc(plan.items[1])}</p>`:''}`)+`<button class="btn secondary" style="margin-top:6px" onclick="go('coach')">View full plan</button>`:`<p class="muted">No coaching plan yet. Generate one from your logged data.</p><button class="btn" onclick="go('coach')">Go to Coach</button>`}</div>`;
};
