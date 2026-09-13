views.coach=()=>{let p=S.profile, meals=S.meals.filter(x=>x.date===today()), pro=meals.reduce((a,x)=>a+x.prot,0), recent=S.workouts.slice(-7).length, bjj=S.bjj.slice(-7).length, social=S.social.slice(-7).length;let plan=S.coach.plans[0];let history=S.coach.plans.slice(1,11);return `<p class="page-intro">This local coach reads your logged data across every tracked area and prioritizes the few things that matter most right now — it never punishes a bad week, and never boils your life down to a single score.</p><div class="grid four"><div class="card"><div class="small">Recent lifts</div><div class="metric">${recent}</div><div class="small">logged recently</div></div><div class="card"><div class="small">BJJ</div><div class="metric">${bjj}</div><div class="small">logged recently</div></div><div class="card"><div class="small">Social reps</div><div class="metric">${social}</div><div class="small">total reps</div></div><div class="card"><div class="small">Today's protein</div><div class="metric">${pro}g</div><div class="small">target ${p.protein}g</div></div></div><h3 class="section">Generate this week's plan</h3><div class="card"><p class="muted">The coach collects evidence from body, training, nutrition, money, career, social, adventure and your weekly reviews, then shows only the highest-value items — never a wall of rules.</p><button class="btn" onclick="generateCoach()">Generate plan</button></div>${plan?`<h3 class="section">Latest coaching plan</h3><div class="card"><div class="pill">${esc(plan.date)}</div><h3>${esc(plan.headline)}</h3>${plan.items.map((x,i)=>`<div class="task"><div class="pill">${i+1}</div><div><b>${esc(x)}</b></div></div>`).join('')}<p class="quote">${esc(plan.note)}</p></div>`:''}<h3 class="section">Coach history</h3><div class="card">${history.length?history.map(pl=>`<div class="item"><b>${esc(pl.date)}</b><p class="muted small" style="margin:4px 0">${esc(pl.headline)}</p>${pl.items&&pl.items[0]?`<p class="small" style="margin:2px 0">${esc(pl.items[0])}</p>`:''}</div>`).join(''):'<div class="empty">Past plans will appear here once you generate more than one.</div>'}</div><div class="card" style="margin-top:10px"><h3>How this plan is built</h3><p class="muted">Every recommendation comes from your own logged data, never a generic tip. Safety and recovery signals come first, then active-goal blockers, then repeated patterns across weeks, then unfinished weekly-review priorities, then this week's consistency gaps, then opportunities, then reinforcement of what's already working. Signals about the same underlying issue are consolidated into one, so you get a short, clear plan instead of a long list.</p></div>`};

function generateCoach(){
  const asOf=today();
  const rawSignals=collectCoachSignals(S,asOf);
  const deduped=dedupeCoachSignals(rawSignals);
  const prioritized=prioritizeCoachSignals(deduped,6);
  let headline,items,note,topSignal;
  if(prioritized.length){
    topSignal={domain:prioritized[0].domain,type:prioritized[0].type,title:prioritized[0].title,evidence:prioritized[0].evidence,action:prioritized[0].action};
    headline=prioritized[0].title;
    items=prioritized.map(formatCoachSignal);
    note='This plan is generated from your logged activity and prioritized by what matters most right now — not a guess, and not a single score.';
  } else {
    const fallback=fallbackCoachSignals(S);
    headline='Not enough recent data to identify a clear bottleneck yet.';
    items=fallback.length?fallback.map(formatCoachSignal):['Log a few days of activity across any area to start building a picture.'];
    note='Once a bit more activity is logged, this plan will start pointing at your real bottlenecks and opportunities.';
    topSignal=fallback.length?{domain:fallback[0].domain,type:fallback[0].type,title:headline,evidence:fallback[0].evidence,action:fallback[0].action}:null;
  }
  S.coach.plans.unshift({date:asOf,headline,items,note,topSignal});
  save();render('coach');toast('New coaching plan created');
}
