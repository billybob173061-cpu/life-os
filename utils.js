const $=x=>document.getElementById(x);
const today=()=>new Date().toISOString().slice(0,10);
function ensureNumber(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d}
// Fiber/sugar are tracked separately as "known" vs "unknown" so a food that simply
// doesn't report them is never silently displayed as an actual zero (see Phase 5).
// cal/prot/carbs/fat are unaffected and keep their original always-summed behavior.
function foodTotals(list){
  return (list||[]).reduce((a,x)=>{
    a.cal+=ensureNumber(x.cal);
    a.prot+=ensureNumber(x.prot);
    a.carbs+=ensureNumber(x.carbs);
    a.fat+=ensureNumber(x.fat);
    if(x.fiber===null||x.fiber===undefined){a.fiberUnknownCount++}
    else{a.fiber+=ensureNumber(x.fiber);a.fiberKnownCount++}
    if(x.sugar===null||x.sugar===undefined){a.sugarUnknownCount++}
    else{a.sugar+=ensureNumber(x.sugar);a.sugarKnownCount++}
    return a;
  },{cal:0,prot:0,carbs:0,fat:0,fiber:0,sugar:0,fiberKnownCount:0,fiberUnknownCount:0,sugarKnownCount:0,sugarUnknownCount:0})
}
// Displays a gram value that may legitimately be "not provided by the source" —
// never renders an unknown value as a misleading 0.
function formatOptionalGrams(v){
  return (v===null||v===undefined)?'—':`${Math.round(ensureNumber(v)*10)/10}g`;
}
// ---- Nutrition quantity/unit conversion (v1.1). Deliberately does not guess a
// mass<->volume density for any food — a food's "basis" (the amount+unit its stored
// nutrient values are FOR) can only be scaled within the same measurement family
// (mass<->mass or volume<->volume), or via a known servingGrams/servingMl for the
// "serving" convenience unit. Returns null rather than fabricating a conversion.
const MASS_TO_G={g:1,kg:1000,oz:28.3495,lb:453.592};
const VOL_TO_ML={ml:1,floz:29.5735};
const NUTRITION_UNITS=['g','oz','kg','lb','ml','floz','serving'];
// Parses a free-text serving-size string (e.g. "30 g", "250ml", "1 bar (40 g)") into
// a normalized {amount, unit:'g'|'ml'|null} — returns unit:null (not zero) when the
// string doesn't contain a recognizable mass/volume amount, so callers never invent
// a serving size that isn't really there.
function parseServingSizeString(str){
  const s=String(str||'');
  const m=s.match(/([\d.]+)\s*(kg|g|lb|oz|fl ?oz|ml|l)\b/i);
  if(!m) return {amount:null,unit:null};
  const amount=Number(m[1]);
  if(!Number.isFinite(amount)||amount<=0) return {amount:null,unit:null};
  let unit=m[2].toLowerCase().replace(' ','');
  if(unit==='l') return {amount:amount*1000,unit:'ml'};
  if(unit==='floz') return {amount,unit:'floz'};
  if(unit in MASS_TO_G) return {amount:amount*MASS_TO_G[unit],unit:'g'};
  if(unit in VOL_TO_ML) return {amount:amount*VOL_TO_ML[unit],unit:'ml'};
  return {amount:null,unit:null};
}
// Which quantity units make sense to offer for a given food record. A food's
// nutrient "basis" gates mass or volume units; "serving" is offered only when a
// concrete serving size in grams or ml is actually known for this food.
function availableUnitsForFood(food){
  const units=[];
  if(food.basis&&food.basis.unit==='g') units.push('g','oz','kg','lb');
  if(food.basis&&food.basis.unit==='ml') units.push('ml','floz');
  if((food.basis&&food.basis.unit==='serving')||food.servingGrams||food.servingMl) units.push('serving');
  return units.length?units:['serving'];
}
// Returns the multiplier to apply to the food's basis nutrient values for the given
// user-entered quantity+unit, or null if that unit isn't supported for this food
// (e.g. asking for ml on a food with no known volume/density) — never fabricates a
// conversion factor.
function convertQuantityToBasisMultiplier(food,quantity,unit){
  const q=ensureNumber(quantity,NaN);
  if(!Number.isFinite(q)||q<0||!food||!food.basis) return null;
  const basis=food.basis;
  if(unit==='serving'){
    if(basis.unit==='serving') return q;
    if(basis.unit==='g'&&food.servingGrams) return (q*food.servingGrams)/basis.amount;
    if(basis.unit==='ml'&&food.servingMl) return (q*food.servingMl)/basis.amount;
    return null;
  }
  if(unit in MASS_TO_G){
    if(basis.unit!=='g') return null;
    return (q*MASS_TO_G[unit])/basis.amount;
  }
  if(unit in VOL_TO_ML){
    if(basis.unit!=='ml') return null;
    return (q*VOL_TO_ML[unit])/basis.amount;
  }
  return null;
}
// Scales a food's per-basis nutrition by a multiplier. Fiber/sugar stay null
// (unknown) rather than becoming a fabricated zero, matching foodTotals()'s
// existing convention.
function scaleFoodNutrition(food,multiplier){
  const m=ensureNumber(multiplier,0);
  const scaleOrNull=(v)=>(v===null||v===undefined)?null:ensureNumber(v)*m;
  return {
    cal:ensureNumber(food.cal)*m,prot:ensureNumber(food.prot)*m,
    carbs:ensureNumber(food.carbs)*m,fat:ensureNumber(food.fat)*m,
    fiber:scaleOrNull(food.fiber),sugar:scaleOrNull(food.sugar)
  };
}
function formatBasisLabel(food){
  if(!food||!food.basis) return 'per serving';
  if(food.basis.unit==='serving') return '1 serving';
  return `${food.basis.amount} ${food.basis.unit}`;
}
// A simple, dependency-free fetch timeout guard shared by all nutrition network calls.
function fetchWithTimeout(url,opts={},ms=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return fetch(url,{...opts,signal:controller.signal}).finally(()=>clearTimeout(timer));
}
// Weekly average, computed only from days that actually have logged meals — never
// fabricates a zero-calorie day for a day nothing was logged. Returns null (empty
// state territory) when nothing was logged in the window at all.
function weeklyNutritionTrend(meals,asOf){
  const end=new Date(asOf+'T00:00:00');
  if(isNaN(end)) return null;
  const start=new Date(end); start.setDate(start.getDate()-6);
  const byDate={};
  (meals||[]).forEach(m=>{
    const d=new Date((m&&m.date||'')+'T00:00:00');
    if(isNaN(d)||d<start||d>end) return;
    (byDate[m.date]=byDate[m.date]||[]).push(m);
  });
  const loggedDates=Object.keys(byDate).sort();
  if(!loggedDates.length) return null;
  const dayTotals=loggedDates.map(d=>foodTotals(byDate[d]));
  const avg=(field)=>dayTotals.reduce((a,t)=>a+t[field],0)/dayTotals.length;
  return {daysLogged:loggedDates.length,daysInWindow:7,avgCal:avg('cal'),avgProt:avg('prot'),avgCarbs:avg('carbs'),avgFat:avg('fat'),dates:loggedDates};
}
// Always two decimal places (never $NaN/$Infinity/undefined) — invalid input is
// treated as $0.00 rather than displayed as broken text.
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(ensureNumber(n,0))}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){$('toast').textContent=s;$('toast').className='show';setTimeout(()=>$('toast').className='',1800)}
function pct(a,b){return Math.max(0,Math.min(100,a/b*100))}
function daysAgoLabel(dateStr){
  if(!dateStr) return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d)) return '';
  const diff=Math.round((new Date(today()+'T00:00:00')-d)/86400000);
  if(diff<=0) return 'today';
  if(diff===1) return 'yesterday';
  return diff+' days ago';
}
// Sub-day-granularity relative time for timestamps like "last synced" — daysAgoLabel
// is date-only (day granularity) and isn't useful for something that can happen
// every few seconds. Accepts a full ISO datetime string; returns '' for null/invalid.
function relativeTimeLabel(isoString){
  if(!isoString) return '';
  const d=new Date(isoString);
  if(isNaN(d)) return '';
  const diffMs=Date.now()-d.getTime();
  if(diffMs<0) return 'just now';
  const mins=Math.floor(diffMs/60000);
  if(mins<1) return 'just now';
  if(mins<60) return mins+' min ago';
  const hrs=Math.floor(mins/60);
  if(hrs<24) return hrs+' hr'+(hrs===1?'':'s')+' ago';
  const days=Math.floor(hrs/24);
  return days+' day'+(days===1?'':'s')+' ago';
}
function weightProgressPct(){
  const p=S.profile;
  const start=S.weightLog.length?S.weightLog[0].weight:p.weight;
  if(start===p.targetWeight) return 100;
  const raw=(p.weight-start)/(p.targetWeight-start)*100;
  return Math.max(0,Math.min(100,raw));
}
// Collision-resistant id generator (bare Date.now() can collide when two records
// are created within the same millisecond, e.g. a tight loop or a fast double-tap).
function uid(prefix){return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)}
function shiftDate(dateStr,deltaDays){
  const d=new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+deltaDays);
  return d.toISOString().slice(0,10);
}
// True calendar-window rolling average: only averages entries that actually fall
// within the window, so gaps/irregular check-in dates are handled correctly rather
// than assuming one measurement per day.
function rollingAverage(entries,days,asOf){
  const end=new Date(asOf+'T00:00:00');
  if(isNaN(end)) return null;
  const start=new Date(end); start.setDate(start.getDate()-(days-1));
  const inWindow=(entries||[]).filter(e=>{
    const d=new Date((e&&e.date||'')+'T00:00:00');
    return !isNaN(d) && d>=start && d<=end;
  });
  if(!inWindow.length) return null;
  const sum=inWindow.reduce((a,e)=>a+ensureNumber(e.weight),0);
  return {avg:sum/inWindow.length,count:inWindow.length};
}
// Compares this week's 7-day rolling average against the prior week's, so the rate
// reflects a real trend rather than day-to-day water-weight noise. Returns null
// (never a fabricated number) when either window has no check-ins.
function weightRateOfChange(entries,asOf){
  const recent=rollingAverage(entries,7,asOf);
  if(!recent) return null;
  const prior=rollingAverage(entries,7,shiftDate(asOf,-7));
  if(!prior) return null;
  return {ratePerWeek:recent.avg-prior.avg,recent,prior};
}
// Goal-progress stats, symmetric for both weight-loss and weight-gain targets.
function weightGoalStats(weightLog,currentWeight,targetWeight){
  const start=(weightLog&&weightLog.length)?weightLog[0].weight:currentWeight;
  const remaining=targetWeight-currentWeight;
  let pct;
  if(start===targetWeight) pct=100;
  else pct=Math.max(0,Math.min(100,((currentWeight-start)/(targetWeight-start))*100));
  return {start,current:currentWeight,target:targetWeight,remaining,pct};
}
// Turns a rate-of-change number into a plain-language sentence. Never invents a
// number of its own — only describes the rate/goal values it's given, and the
// 0.5–1.25 lb/week pace band mirrors the same guideline already shown on Nutrition.
function describeWeightTrend(ratePerWeek,startWeight,targetWeight){
  const goal=targetWeight<startWeight?'lose':targetWeight>startWeight?'gain':'maintain';
  const deadband=0.05;
  const dir=ratePerWeek<-deadband?'down':ratePerWeek>deadband?'up':'stable';
  const abs=Math.abs(ratePerWeek);
  const paceNote=abs<0.5?'slower than a typical 0.5–1.25 lb/week pace':abs<=1.25?'within a typical 0.5–1.25 lb/week pace':'faster than a typical 0.5–1.25 lb/week pace';
  if(goal==='maintain'){
    return dir==='stable'
      ? 'Weight has been holding steady, consistent with your maintenance goal.'
      : `Weight has drifted ${dir} recently while your goal is to maintain — worth a look.`;
  }
  if(dir==='stable') return `Weight has been roughly stable recently, but your goal is to ${goal} weight.`;
  const wantedDir=goal==='lose'?'down':'up';
  if(dir===wantedDir) return `Trending ${dir} about ${abs.toFixed(1)} lb/week — moving toward your ${goal} goal (${paceNote}).`;
  return `Trending ${dir} about ${abs.toFixed(1)} lb/week — moving away from your ${goal} goal.`;
}
// Minimal, dependency-free inline SVG line chart. Returns '' for no data so callers
// can show their own empty state instead. Uses viewBox only (no fixed width/height
// attributes) so it scales responsively via CSS.
function sparklineSVG(values,opts={}){
  const w=opts.width||300,h=opts.height||90,pad=opts.padding||10;
  const color=opts.color||'#0b1220';
  const n=(values||[]).length;
  if(!n) return '';
  if(n===1){
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="sparkline"><circle cx="${w/2}" cy="${h/2}" r="3.5" fill="${color}"/></svg>`;
  }
  const min=Math.min(...values),max=Math.max(...values);
  const range=(max-min)||1;
  const stepX=(w-pad*2)/(n-1);
  const pts=values.map((v,i)=>{
    const x=pad+i*stepX;
    const y=h-pad-((v-min)/range)*(h-pad*2);
    return [x,y];
  });
  const path=pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const dots=pts.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="sparkline"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}
function sameExerciseName(a,b){return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase()}
// Epley formula. Returns null (never a fabricated number) for zero/invalid/negative
// weight or a rep count under 1 — a 0-rep entry is not a valid performance.
function estimate1RM(weight,reps){
  const w=ensureNumber(weight,NaN), r=ensureNumber(reps,NaN);
  if(!Number.isFinite(w)||w<=0) return null;
  if(!Number.isFinite(r)||r<1) return null;
  return w*(1+r/30);
}
// Warm-up sets never count toward strength PRs, and a set needs a real weight and
// at least 1 rep to be a valid performance at all.
function isStrengthSet(set){
  if(!set||set.status==='warmup') return false;
  const w=ensureNumber(set.weight,NaN), r=ensureNumber(set.reps,NaN);
  return Number.isFinite(w)&&w>0&&Number.isFinite(r)&&r>=1;
}
// Derived, read-only: gathers every logged set for one exercise name across a list
// of completed workouts. Never a second source of truth — always recomputed from
// the existing S.workouts records.
function collectExerciseSets(workouts,name){
  const out=[];
  (workouts||[]).forEach(w=>{
    (w.exercises||[]).forEach(e=>{
      if(!sameExerciseName(e.name,name))return;
      (e.logs||[]).forEach(l=>{
        out.push({date:w.date,weight:l.weight,reps:l.reps,status:l.status,rpe:l.rpe,notes:l.notes});
      });
    });
  });
  return out;
}
// Pass in already-filtered strength sets (see isStrengthSet). Returns the heaviest
// weight and the best estimated 1RM, each with the set that produced it.
function exercisePRs(strengthSets){
  let heaviestWeight=null,best1RM=null;
  (strengthSets||[]).forEach(s=>{
    const w=ensureNumber(s.weight,NaN),r=ensureNumber(s.reps,NaN);
    if(!Number.isFinite(w)||w<=0||!Number.isFinite(r)||r<1)return;
    if(!heaviestWeight||w>heaviestWeight.weight)heaviestWeight={weight:w,reps:r,date:s.date};
    const e1=estimate1RM(w,r);
    if(e1!==null&&(!best1RM||e1>best1RM.est1RM))best1RM={est1RM:e1,weight:w,reps:r,date:s.date};
  });
  return {heaviestWeight,best1RM};
}
// Best weight lifted at an exact rep count — "best performance for a rep range"
// interpreted as the exact rep count, which is what a lifter can actually act on.
function bestAtRepCount(strengthSets,reps){
  const target=ensureNumber(reps,NaN);
  if(!Number.isFinite(target)||target<1) return null;
  let best=null;
  (strengthSets||[]).forEach(s=>{
    if(ensureNumber(s.reps,NaN)!==target)return;
    const w=ensureNumber(s.weight,NaN);
    if(!Number.isFinite(w)||w<=0)return;
    if(!best||w>best.weight)best={weight:w,reps:target,date:s.date};
  });
  return best;
}
// Derived BJJ session stats. Only ever counts/sums actual logged sessions — a day
// with nothing logged is simply not counted, never treated as a fabricated zero.
function bjjSessionStats(sessions,asOf){
  const list=sessions||[];
  const end=new Date(asOf+'T00:00:00');
  const weekStart=new Date(end); weekStart.setDate(weekStart.getDate()-6);
  const monthStart=new Date(end); monthStart.setDate(monthStart.getDate()-29);
  const inRange=(dateStr,start)=>{
    const d=new Date((dateStr||'')+'T00:00:00');
    return !isNaN(d)&&d>=start&&d<=end;
  };
  const sessionsThisWeek=list.filter(s=>inRange(s.date,weekStart)).length;
  const sessionsThisMonth=list.filter(s=>inRange(s.date,monthStart)).length;
  const totalMinutes=list.reduce((a,s)=>a+ensureNumber(s.duration),0);
  const totalDrilling=list.reduce((a,s)=>a+ensureNumber(s.drilling),0);
  const totalSparring=list.reduce((a,s)=>a+ensureNumber(s.sparring),0);
  const giCount=list.filter(s=>s.type==='gi').length;
  const nogiCount=list.filter(s=>s.type==='nogi').length;
  return {totalSessions:list.length,sessionsThisWeek,sessionsThisMonth,totalMinutes,totalDrilling,totalSparring,giCount,nogiCount};
}
// A read-only, derived 7-day view of which days had a strength session and/or a BJJ
// session, built entirely from existing workout/BJJ records — never a hard-coded
// weekly schedule, and never a second source of truth for either training system.
function trainingWeekOverview(workouts,bjjSessions,asOf){
  const days=[];
  for(let i=6;i>=0;i--){
    const d=shiftDate(asOf,-i);
    const dayName=new Date(d+'T00:00:00').toLocaleDateString(undefined,{weekday:'short'});
    days.push({
      date:d,dayName,
      hasStrength:(workouts||[]).some(w=>w.date===d),
      hasBjj:(bjjSessions||[]).some(s=>s.date===d),
      isToday:d===asOf
    });
  }
  return days;
}
// Flags curriculum categories whose techniques haven't been drilled recently (or ever),
// but only among categories the user has actually started — a category with zero
// techniques logged isn't "neglected," it's simply not started yet.
function bjjNeglectedAreas(techniques,asOf,staleDays=21){
  const byCategory={};
  (techniques||[]).forEach(t=>{(byCategory[t.category]=byCategory[t.category]||[]).push(t)});
  const neglected=[];
  Object.keys(byCategory).forEach(cat=>{
    const mostRecent=byCategory[cat].reduce((latest,t)=>{
      if(!t.lastDrilled) return latest;
      return (!latest||t.lastDrilled>latest)?t.lastDrilled:latest;
    },null);
    const daysSince=mostRecent?Math.round((new Date(asOf+'T00:00:00')-new Date(mostRecent+'T00:00:00'))/86400000):null;
    if(daysSince===null||daysSince>=staleDays) neglected.push({category:cat,daysSince});
  });
  return neglected.sort((a,b)=>(b.daysSince??Infinity)-(a.daysSince??Infinity));
}
// ---- BJJ curriculum practice recommendation (v1.1). Deterministic and transparent —
// scores each technique from real signals (prerequisites met, current focus match,
// neglect/recency, self-rated confidence, status, and a rough personal-level estimate
// derived from the user's own average confidence) so "what should I practice?" is
// always explainable from the underlying data, never a black box.
function bjjRecommendedPractice(techniques,focusItems,asOf,limit=4){
  const techs=techniques||[];
  if(!techs.length) return [];
  const levelOrder={Foundation:0,Developing:1,Intermediate:2,Advanced:3};
  const activeFocusTexts=(focusItems||[]).filter(f=>!f.done).map(f=>(f.text||'').toLowerCase());
  const avgConfidence=techs.reduce((a,t)=>a+ensureNumber(t.confidence,1),0)/techs.length;
  const userLevelBias=avgConfidence>=3.5?3:avgConfidence>=2.5?2:avgConfidence>=1.5?1:0;
  const byId={}; techs.forEach(t=>{byId[t.id]=t;});
  const scored=techs.map(t=>{
    let score=0;
    const unmetPrereq=(t.prerequisites||[]).some(pid=>byId[pid]&&byId[pid].status==='Not Started');
    if(unmetPrereq) score-=100;
    if(activeFocusTexts.some(f=>f&&(t.name.toLowerCase().includes(f)||f.includes(t.name.toLowerCase())))) score+=50;
    if(!t.lastDrilled) score+=30;
    else{
      const days=Math.round((new Date(asOf+'T00:00:00')-new Date(t.lastDrilled+'T00:00:00'))/86400000);
      score+=Math.max(0,Math.min(30,days));
      if(days<1) score-=20;
    }
    score+=(5-ensureNumber(t.confidence,1))*4;
    if(t.status==='Confident') score-=15;
    score-=Math.abs((levelOrder[t.level]??0)-userLevelBias)*3;
    return {t,score};
  });
  return scored.sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.t);
}
// ---- Money helpers (Phase 7). All derived from S.money transactions — never a
// second source of truth, and never fabricate a period's totals from missing data. ----
function monthKey(dateStr){return String(dateStr||'').slice(0,7)}
function shiftMonthKey(mk,delta){
  const parts=String(mk||'').split('-').map(Number);
  const d=new Date(parts[0]||1970,(parts[1]||1)-1+delta,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function moneyTransactionsInMonth(transactions,mk){
  return (transactions||[]).filter(t=>monthKey(t.date)===mk);
}
function sumByType(transactions,type){
  return (transactions||[]).filter(t=>t.type===type).reduce((a,t)=>a+ensureNumber(t.amount),0);
}
// Trailing N-day window, same convention as rollingAverage/bjjSessionStats.
function moneyInWindow(transactions,days,asOf){
  const end=new Date(asOf+'T00:00:00');
  if(isNaN(end)) return [];
  const start=new Date(end); start.setDate(start.getDate()-(days-1));
  return (transactions||[]).filter(t=>{
    const d=new Date((t&&t.date||'')+'T00:00:00');
    return !isNaN(d)&&d>=start&&d<=end;
  });
}
function moneyCategoryBreakdown(transactions,type){
  const byCat={};
  (transactions||[]).filter(t=>t.type===type).forEach(t=>{
    const cat=t.category||'Uncategorized';
    byCat[cat]=(byCat[cat]||0)+ensureNumber(t.amount);
  });
  return Object.entries(byCat).map(([category,total])=>({category,total})).sort((a,b)=>b.total-a.total);
}
// Savings Rate = (income - expenses) / income * 100. Returns null (never NaN/Infinity/
// a misleading percentage) whenever income is zero, negative, or not finite.
function savingsRate(income,expenses){
  const inc=ensureNumber(income,NaN),exp=ensureNumber(expenses,NaN);
  if(!Number.isFinite(inc)||inc<=0||!Number.isFinite(exp)) return null;
  const rate=((inc-exp)/inc)*100;
  return Number.isFinite(rate)?rate:null;
}
// Only averages over months that actually had an income transaction — never
// fabricates a zero month — and requires at least 2 such months before returning
// a number at all, otherwise the caller should show "Not enough data yet."
function averageMonthlyIncome(transactions,monthsBack,asOfMonthKey){
  const totals=[];
  for(let i=0;i<monthsBack;i++){
    const mk=shiftMonthKey(asOfMonthKey,-i);
    const total=sumByType(moneyTransactionsInMonth(transactions,mk),'income');
    if(total>0) totals.push(total);
  }
  if(totals.length<2) return null;
  return {avg:totals.reduce((a,b)=>a+b,0)/totals.length,monthsCounted:totals.length};
}
// Weekly expense totals for a lightweight trend chart — trailing 7-day buckets,
// stepped back one week at a time from asOf. Never fabricates a week with no data;
// a week with nothing logged is simply 0 (a real, known zero, not "unknown").
function weeklyExpenseTotals(transactions,weeks,asOf){
  const out=[];
  for(let i=weeks-1;i>=0;i--){
    const weekEnd=shiftDate(asOf,-7*i);
    out.push({weekEnd,total:sumByType(moneyInWindow(transactions,7,weekEnd),'expense')});
  }
  return out;
}
// Budgets are informational only — never blocks logging. level: 'ok'|'warning'|'exceeded'.
function budgetStatus(spent,limit){
  const lim=ensureNumber(limit,NaN);
  if(!Number.isFinite(lim)||lim<=0) return null;
  const s=ensureNumber(spent,0);
  const pctUsed=Math.max(0,(s/lim)*100);
  const level=s>=lim?'exceeded':(s>=lim*0.8?'warning':'ok');
  return {spent:s,limit:lim,remaining:lim-s,pctUsed,level};
}
// ---- Career/skill helpers (Phase 8). All derived from S.career/S.careerSkills —
// never a second source of truth for time invested or practice totals. ----
// A skill is only "neglected" if it HAS been practiced before but not recently —
// a never-practiced skill is "not started," not neglected.
function careerSkillNeglect(skill,asOf,staleDays=14){
  if(!skill||!skill.lastPracticed) return {neglected:false,daysSince:null};
  const d=new Date(skill.lastPracticed+'T00:00:00');
  if(isNaN(d)) return {neglected:false,daysSince:null};
  const daysSince=Math.round((new Date(asOf+'T00:00:00')-d)/86400000);
  return {neglected:daysSince>=staleDays,daysSince};
}
// Transparent average of whichever 1-5 ratings have actually been logged. Returns
// null (never a fabricated baseline) when nothing has been rated yet.
function careerExperimentScore(exp){
  const fields=['interest','earningPotential','difficulty','confidence','fit'];
  const rated=fields.map(f=>exp&&exp[f]).filter(v=>Number.isFinite(v));
  if(!rated.length) return null;
  return {avg:rated.reduce((a,b)=>a+b,0)/rated.length,count:rated.length,of:fields.length};
}
// Sum of session minutes across ALL experiments within the trailing 7-day window.
function careerWeeklyMinutes(experiments,asOf){
  const end=new Date(asOf+'T00:00:00'); const start=new Date(end); start.setDate(start.getDate()-6);
  let total=0;
  (experiments||[]).forEach(e=>(e.sessions||[]).forEach(s=>{
    const d=new Date((s&&s.date||'')+'T00:00:00');
    if(!isNaN(d)&&d>=start&&d<=end) total+=ensureNumber(s.duration);
  }));
  return total;
}
function careerTotalTimeInvested(experiments){
  return (experiments||[]).reduce((a,e)=>a+ensureNumber(e.timeInvested),0);
}
// ---- Social helpers (Phase 9). All derived from S.social/S.socialPeople — measures
// action and consistency (evidence from repetition), never a popularity/confidence score.
function socialRepsInWindow(reps,days,asOf){
  const end=new Date(asOf+'T00:00:00');
  if(isNaN(end)) return [];
  const start=new Date(end); start.setDate(start.getDate()-(days-1));
  return (reps||[]).filter(r=>{
    const d=new Date((r&&r.date||'')+'T00:00:00');
    return !isNaN(d)&&d>=start&&d<=end;
  });
}
// Concrete counts by rep type — evidence, not a single judged "score".
function socialWeeklyStats(social,asOf){
  const week=socialRepsInWindow(social,7,asOf);
  const count=(type)=>week.filter(r=>r.type===type).length;
  return {
    conversationsStarted:count('Started conversation'),
    conversationsContinued:count('Continued conversation'),
    peopleMet:count('Met someone new'),
    invitationsMade:count('Asked someone to hang out'),
    plansMade:count('Made plans'),
    eventsAttended:count('Attended event'),
    bjjSocial:count('BJJ social'),
    coworkerInteraction:count('Coworker interaction'),
    other:count('Other'),
    totalReps:week.length,
    totalMinutes:week.reduce((a,r)=>a+ensureNumber(r.duration),0)
  };
}
// Maps the 4 weekly-target categories to transparent, documented combinations of the
// raw counts above — never a hidden formula. Each returns {done, goal}; a goal of 0
// means "no target set" for that category.
function socialWeeklyTargetProgress(social,target,asOf){
  const w=socialWeeklyStats(social,asOf);
  const t=target||{conversations:0,initiations:0,plans:0,socialMinutes:0};
  return {
    conversations:{done:w.conversationsStarted+w.conversationsContinued,goal:ensureNumber(t.conversations,0)},
    initiations:{done:w.conversationsStarted+w.peopleMet+w.invitationsMade,goal:ensureNumber(t.initiations,0)},
    plans:{done:w.plansMade+w.eventsAttended,goal:ensureNumber(t.plans,0)},
    socialMinutes:{done:w.totalMinutes,goal:ensureNumber(t.socialMinutes,0)}
  };
}
// ---- Adventure helpers (Phase 10). All derived from S.adventures — measures actual
// logged experiences, never a fabricated "adventurousness" score.
function adventureRepsInWindow(records,days,asOf){
  const end=new Date(asOf+'T00:00:00');
  if(isNaN(end)) return [];
  const start=new Date(end); start.setDate(start.getDate()-(days-1));
  return (records||[]).filter(r=>{
    const d=new Date((r&&r.date||'')+'T00:00:00');
    return !isNaN(d)&&d>=start&&d<=end;
  });
}
function adventureWeeklyStats(adventures,asOf){
  const week=adventureRepsInWindow(adventures,7,asOf);
  const categories=new Set(week.map(a=>a.category).filter(Boolean));
  return {
    experiences:week.length,
    soloCount:week.filter(a=>a.soloOrWithOthers==='Solo').length,
    novelCount:week.filter(a=>Number.isFinite(a.novelty)&&a.novelty>=4).length,
    categoriesExplored:categories.size,
    categoryList:[...categories],
    totalMinutes:week.reduce((a,r)=>a+ensureNumber(r.duration),0),
    totalCost:week.reduce((a,r)=>a+ensureNumber(r.cost),0)
  };
}
// {experiences,minutes} target vs actual logged experiences — a goal of 0 means "no
// target set" for that category, never interpreted as a failed week.
function adventureWeeklyTargetProgress(adventures,target,asOf){
  const w=adventureWeeklyStats(adventures,asOf);
  const t=target||{experiences:0,minutes:0};
  return {
    experiences:{done:w.experiences,goal:ensureNumber(t.experiences,0)},
    minutes:{done:w.totalMinutes,goal:ensureNumber(t.minutes,0)}
  };
}
// ---- Weekly Review helpers (Phase 11). Every metric is derived from existing domain
// state for an explicit [weekStart,weekEnd] range — never a second source of truth.
// Counts (sessions/reps/experiences) are always real numbers, including 0, because a
// count is well-defined whether or not anything happened. Only genuinely undefined
// data (e.g. no nutrition logged at all, so no average exists) reports hasData:false,
// so callers can render "No data" instead of a misleading zero.

// Monday-Sunday calendar week, distinct from the trailing-N-day windows used
// elsewhere in the app — the review needs a fixed, shareable weekly anchor.
function weekStartFor(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d)) return null;
  const day=d.getDay();
  const diff=(day===0?-6:1-day);
  d.setDate(d.getDate()+diff);
  return d.toISOString().slice(0,10);
}
function weekEndFor(weekStart){ return shiftDate(weekStart,6); }
function reviewWeekInfo(asOf,offsetWeeks=0){
  const currentWeekStart=weekStartFor(asOf);
  const weekStart=shiftDate(currentWeekStart,offsetWeeks*7);
  const weekEnd=weekEndFor(weekStart);
  return {weekStart,weekEnd,isCurrent:weekStart===currentWeekStart};
}
function dateInRange(dateStr,start,end){
  const d=new Date((dateStr||'')+'T00:00:00');
  const s=new Date((start||'')+'T00:00:00'), e=new Date((end||'')+'T00:00:00');
  return !isNaN(d)&&!isNaN(s)&&!isNaN(e)&&d>=s&&d<=e;
}
function findWeeklySnapshot(snapshots,weekStart){
  return (snapshots||[]).find(r=>r.weekStart===weekStart)||null;
}
function defaultWeeklySnapshot(weekStart,weekEnd){
  return {
    id:uid('wreview'),weekStart,weekEnd,completed:false,completedAt:null,
    reflection:{wentWell:'',didnt:'',proud:'',learned:'',mostFriction:'',stopDoing:'',continueDoing:'',startDoing:''},
    wins:[],friction:[],priorities:[]
  };
}
function reviewBodyMetrics(weightLog,weekStart,weekEnd){
  const inWeek=(weightLog||[]).filter(w=>dateInRange(w.date,weekStart,weekEnd));
  if(!inWeek.length) return {hasData:false};
  const currentWeight=ensureNumber(inWeek[inWeek.length-1].weight);
  const weekAvg=inWeek.reduce((a,w)=>a+ensureNumber(w.weight),0)/inWeek.length;
  const priorStart=shiftDate(weekStart,-7), priorEnd=shiftDate(weekEnd,-7);
  const priorWeek=(weightLog||[]).filter(w=>dateInRange(w.date,priorStart,priorEnd));
  const priorAvg=priorWeek.length?priorWeek.reduce((a,w)=>a+ensureNumber(w.weight),0)/priorWeek.length:null;
  const bfEntries=inWeek.filter(w=>Number.isFinite(w.bf));
  return {
    hasData:true,checkIns:inWeek.length,currentWeight,weekAvg,
    change:priorAvg!==null?weekAvg-priorAvg:null,
    bf:bfEntries.length?bfEntries[bfEntries.length-1].bf:null
  };
}
function reviewTrainingMetrics(workouts,bjjSessions,weekStart,weekEnd){
  const liftSessions=(workouts||[]).filter(w=>dateInRange(w.date,weekStart,weekEnd));
  const bjjInWeek=(bjjSessions||[]).filter(s=>dateInRange(s.date,weekStart,weekEnd));
  const liftMinutes=liftSessions.reduce((a,w)=>{
    if(w.startedAt&&w.finishedAt){
      const ms=new Date(w.finishedAt)-new Date(w.startedAt);
      if(Number.isFinite(ms)&&ms>0) return a+ms/60000;
    }
    return a;
  },0);
  const bjjMinutes=bjjInWeek.reduce((a,s)=>a+ensureNumber(s.duration),0);
  return {
    hasData:liftSessions.length>0||bjjInWeek.length>0,
    liftSessions:liftSessions.length,bjjSessions:bjjInWeek.length,
    totalSessions:liftSessions.length+bjjInWeek.length,
    liftMinutes:Math.round(liftMinutes),bjjMinutes:Math.round(bjjMinutes),
    totalMinutes:Math.round(liftMinutes+bjjMinutes)
  };
}
function reviewNutritionMetrics(meals,weekStart,weekEnd){
  const byDate={};
  (meals||[]).forEach(m=>{ if(dateInRange(m.date,weekStart,weekEnd)) (byDate[m.date]=byDate[m.date]||[]).push(m); });
  const loggedDates=Object.keys(byDate);
  if(!loggedDates.length) return {hasData:false};
  const dayTotals=loggedDates.map(d=>foodTotals(byDate[d]));
  const daysInWeek=Math.round((new Date(weekEnd+'T00:00:00')-new Date(weekStart+'T00:00:00'))/86400000)+1;
  return {
    hasData:true,daysLogged:loggedDates.length,daysInWeek,
    avgCal:dayTotals.reduce((a,t)=>a+t.cal,0)/dayTotals.length,
    avgProt:dayTotals.reduce((a,t)=>a+t.prot,0)/dayTotals.length
  };
}
function moneyInRange(transactions,start,end){ return (transactions||[]).filter(t=>dateInRange(t.date,start,end)); }
function reviewMoneyMetrics(money,weekStart,weekEnd){
  const week=moneyInRange(money,weekStart,weekEnd);
  const hasData=week.length>0;
  const income=sumByType(week,'income'), expenses=sumByType(week,'expense'), savings=sumByType(week,'savings');
  return {hasData,income,expenses,savings,savingsRate:hasData?savingsRate(income,expenses):null};
}
function reviewCareerMetrics(career,careerSkills,weekStart,weekEnd){
  let sessions=0,minutes=0;
  (career||[]).forEach(e=>(e.sessions||[]).forEach(s=>{ if(dateInRange(s.date,weekStart,weekEnd)){sessions++;minutes+=ensureNumber(s.duration);} }));
  const skillsPracticed=(careerSkills||[]).filter(sk=>(sk.practiceHistory||[]).some(p=>dateInRange(p.date,weekStart,weekEnd))).length;
  return {hasData:sessions>0||skillsPracticed>0,sessions,minutes:Math.round(minutes),skillsPracticed};
}
function reviewSocialMetrics(social,socialExperiments,weekStart,weekEnd){
  const week=(social||[]).filter(r=>dateInRange(r.date,weekStart,weekEnd));
  const count=(type)=>week.filter(r=>r.type===type).length;
  const experimentsCompleted=(socialExperiments||[]).filter(e=>e.completed&&dateInRange(e.date,weekStart,weekEnd)).length;
  return {
    hasData:week.length>0||experimentsCompleted>0,
    totalReps:week.length,
    conversationsStarted:count('Started conversation'),
    conversationsContinued:count('Continued conversation'),
    invitationsMade:count('Asked someone to hang out'),
    plansMade:count('Made plans'),
    experimentsCompleted
  };
}
function reviewAdventureMetrics(adventures,adventureExperiments,weekStart,weekEnd){
  const week=(adventures||[]).filter(a=>dateInRange(a.date,weekStart,weekEnd));
  const experimentsCompleted=(adventureExperiments||[]).filter(e=>e.completed&&dateInRange(e.date,weekStart,weekEnd)).length;
  const categories=new Set(week.map(a=>a.category).filter(Boolean));
  return {
    hasData:week.length>0||experimentsCompleted>0,
    experiences:week.length,
    totalMinutes:week.reduce((a,r)=>a+ensureNumber(r.duration),0),
    soloCount:week.filter(a=>a.soloOrWithOthers==='Solo').length,
    novelCount:week.filter(a=>Number.isFinite(a.novelty)&&a.novelty>=4).length,
    categoriesExplored:categories.size,
    experimentsCompleted
  };
}
// Days-active-out-of-days-elapsed, never out of a fixed 7 for a week still in
// progress — a Tuesday isn't "behind" on Friday's worth of days yet.
function reviewDaysActive(dates,weekStart,weekEnd,asOf){
  const cappedEnd=asOf<weekEnd?asOf:weekEnd;
  const daysElapsed=Math.max(0,Math.round((new Date(cappedEnd+'T00:00:00')-new Date(weekStart+'T00:00:00'))/86400000)+1);
  const uniqueDays=new Set((dates||[]).filter(d=>dateInRange(d,weekStart,cappedEnd)));
  return {daysActive:uniqueDays.size,daysElapsed};
}
function reviewConsistency(S,weekStart,weekEnd,asOf){
  const trainingDates=[...new Set([...(S.workouts||[]).map(w=>w.date),...(S.bjj||[]).map(s=>s.date)])];
  const nutritionDates=[...new Set((S.meals||[]).map(m=>m.date))];
  const careerDates=[...new Set([
    ...[].concat(...((S.career||[]).map(e=>(e.sessions||[]).map(s=>s.date)))),
    ...[].concat(...((S.careerSkills||[]).map(sk=>(sk.practiceHistory||[]).map(p=>p.date))))
  ])];
  const socialDates=[...new Set((S.social||[]).map(r=>r.date))];
  const adventureDates=[...new Set((S.adventures||[]).map(a=>a.date))];
  const moneyDates=[...new Set((S.money||[]).filter(t=>t.type==='income'||t.type==='savings').map(t=>t.date))];
  return {
    training:reviewDaysActive(trainingDates,weekStart,weekEnd,asOf),
    nutrition:reviewDaysActive(nutritionDates,weekStart,weekEnd,asOf),
    career:reviewDaysActive(careerDates,weekStart,weekEnd,asOf),
    social:reviewDaysActive(socialDates,weekStart,weekEnd,asOf),
    adventure:reviewDaysActive(adventureDates,weekStart,weekEnd,asOf),
    money:reviewDaysActive(moneyDates,weekStart,weekEnd,asOf)
  };
}
// Deterministic, evidence-only PR detection: a new heaviest weight this week for an
// exercise, compared against every strength set logged for that exercise before this
// week began. Never fabricates a PR — an exercise with no valid sets this week is
// simply skipped.
function reviewTrainingPRWins(workouts,weekStart,weekEnd){
  const priorWorkouts=(workouts||[]).filter(w=>w.date<weekStart);
  const weekWorkouts=(workouts||[]).filter(w=>dateInRange(w.date,weekStart,weekEnd));
  const names=new Set();
  weekWorkouts.forEach(w=>(w.exercises||[]).forEach(e=>{ if(e.name) names.add(e.name); }));
  const wins=[];
  names.forEach(name=>{
    const weekSets=collectExerciseSets(weekWorkouts,name).filter(isStrengthSet);
    if(!weekSets.length) return;
    const priorSets=collectExerciseSets(priorWorkouts,name).filter(isStrengthSet);
    const priorPR=exercisePRs(priorSets).heaviestWeight;
    const weekPR=exercisePRs(weekSets).heaviestWeight;
    if(weekPR&&(!priorPR||weekPR.weight>priorPR.weight)) wins.push({text:`New PR on ${name}: ${weekPR.weight}×${weekPR.reps}`,category:'Training'});
  });
  return wins;
}
// Auto-surfaced wins are entirely derived and re-computed every render — never
// stored, so they can never go stale or duplicate a manually-added win, and never
// claim a win the underlying state doesn't actually support.
function reviewAutoWins(S,weekStart,weekEnd){
  const wins=[];
  const priorWeights=(S.weightLog||[]).filter(w=>w.date<weekStart).map(w=>ensureNumber(w.weight));
  const weekWeights=(S.weightLog||[]).filter(w=>dateInRange(w.date,weekStart,weekEnd)).map(w=>ensureNumber(w.weight));
  if(priorWeights.length&&weekWeights.length){
    const priorMin=Math.min(...priorWeights), weekMin=Math.min(...weekWeights);
    if(weekMin<priorMin) wins.push({text:`New body-weight low: ${weekMin} lb`,category:'Body'});
  }
  wins.push(...reviewTrainingPRWins(S.workouts,weekStart,weekEnd));
  const bjjWeek=(S.bjj||[]).filter(s=>dateInRange(s.date,weekStart,weekEnd)).length;
  if(bjjWeek>=2) wins.push({text:`${bjjWeek} BJJ sessions completed this week`,category:'Training'});
  const nutri=reviewNutritionMetrics(S.meals,weekStart,weekEnd);
  if(nutri.hasData&&nutri.daysLogged>=5&&nutri.avgProt>=ensureNumber(S.profile.protein))
    wins.push({text:`Protein target met on average across ${nutri.daysLogged} logged days`,category:'Nutrition'});
  const moneyWk=reviewMoneyMetrics(S.money,weekStart,weekEnd);
  if(moneyWk.hasData&&moneyWk.savings>0) wins.push({text:`Savings contribution this week: ${money(moneyWk.savings)}`,category:'Money'});
  const careerWk=reviewCareerMetrics(S.career,S.careerSkills,weekStart,weekEnd);
  if(careerWk.sessions>0) wins.push({text:`${careerWk.sessions} career session${careerWk.sessions===1?'':'s'} logged this week`,category:'Career'});
  (S.careerSkills||[]).forEach(sk=>{
    const times=(sk.practiceHistory||[]).filter(p=>dateInRange(p.date,weekStart,weekEnd)).length;
    if(times>=2) wins.push({text:`${sk.name} practiced ${times} times this week`,category:'Career'});
  });
  const socialChallengesWk=(S.socialChallengeCompletions||[]).filter(c=>dateInRange(c.date,weekStart,weekEnd)).length;
  if(socialChallengesWk>0) wins.push({text:`${socialChallengesWk} social challenge${socialChallengesWk===1?'':'s'} completed this week`,category:'Social'});
  const invitesWk=(S.social||[]).filter(r=>dateInRange(r.date,weekStart,weekEnd)&&(r.type==='Asked someone to hang out'||r.type==='Made plans')).length;
  if(invitesWk>0) wins.push({text:`${invitesWk} invitation${invitesWk===1?'':'s'} or plan${invitesWk===1?'':'s'} made this week`,category:'Social'});
  const adv=reviewAdventureMetrics(S.adventures,S.adventureExperiments,weekStart,weekEnd);
  if(adv.experiences>0) wins.push({text:`${adv.experiences} new adventure${adv.experiences===1?'':'s'} completed this week`,category:'Adventure'});
  if(adv.soloCount>0) wins.push({text:`${adv.soloCount} solo experience${adv.soloCount===1?'':'s'} completed this week`,category:'Adventure'});
  return wins;
}
// Descriptive-only pattern detection: states what the numbers did, never why. A
// pattern is only reported when at least one side of the comparison has real data,
// so two silent weeks never produce a fabricated "increased from 0 to 0".
function reviewPatterns(S,weekStart,weekEnd){
  const patterns=[];
  const prevStart=shiftDate(weekStart,-7), prevEnd=shiftDate(weekEnd,-7);
  const cur=reviewTrainingMetrics(S.workouts,S.bjj,weekStart,weekEnd);
  const prev=reviewTrainingMetrics(S.workouts,S.bjj,prevStart,prevEnd);
  if(cur.hasData||prev.hasData){
    if(cur.totalSessions!==prev.totalSessions) patterns.push(`Training frequency ${cur.totalSessions>prev.totalSessions?'increased':'decreased'} from ${prev.totalSessions} to ${cur.totalSessions} session${cur.totalSessions===1?'':'s'} compared to last week.`);
    if(cur.bjjSessions!==prev.bjjSessions) patterns.push(`BJJ frequency changed from ${prev.bjjSessions} to ${cur.bjjSessions} session${cur.bjjSessions===1?'':'s'} compared to last week.`);
  }
  const bodyCur=reviewBodyMetrics(S.weightLog,weekStart,weekEnd);
  if(bodyCur.hasData&&bodyCur.change!==null&&Math.abs(bodyCur.change)>=0.3)
    patterns.push(`Your logged weight trend ${bodyCur.change<0?'decreased':'increased'} by about ${Math.abs(bodyCur.change).toFixed(1)} lb compared to last week's average.`);
  const nutriCur=reviewNutritionMetrics(S.meals,weekStart,weekEnd), nutriPrev=reviewNutritionMetrics(S.meals,prevStart,prevEnd);
  if(nutriCur.hasData||nutriPrev.hasData){
    const c=nutriCur.hasData?nutriCur.daysLogged:0, p=nutriPrev.hasData?nutriPrev.daysLogged:0;
    if(c<p) patterns.push(`Nutrition logging became less consistent: ${c} day${c===1?'':'s'} logged this week vs ${p} last week.`);
    else if(c>p) patterns.push(`Nutrition logging became more consistent: ${c} day${c===1?'':'s'} logged this week vs ${p} last week.`);
  }
  const moneyCur=reviewMoneyMetrics(S.money,weekStart,weekEnd), moneyPrev=reviewMoneyMetrics(S.money,prevStart,prevEnd);
  if(moneyCur.hasData||moneyPrev.hasData){
    if(moneyCur.savings>moneyPrev.savings) patterns.push(`Savings activity increased from ${money(moneyPrev.savings)} to ${money(moneyCur.savings)} compared to last week.`);
    else if(moneyCur.savings<moneyPrev.savings) patterns.push(`Savings activity decreased from ${money(moneyPrev.savings)} to ${money(moneyCur.savings)} compared to last week.`);
  }
  const careerCur=reviewCareerMetrics(S.career,S.careerSkills,weekStart,weekEnd), careerPrev=reviewCareerMetrics(S.career,S.careerSkills,prevStart,prevEnd);
  if(careerCur.hasData||careerPrev.hasData){
    if(careerCur.sessions<careerPrev.sessions) patterns.push(`Career practice declined from ${careerPrev.sessions} session${careerPrev.sessions===1?'':'s'} to ${careerCur.sessions} compared to last week.`);
    else if(careerCur.sessions>careerPrev.sessions) patterns.push(`Career practice increased from ${careerPrev.sessions} session${careerPrev.sessions===1?'':'s'} to ${careerCur.sessions} compared to last week.`);
  }
  const socialCur=reviewSocialMetrics(S.social,S.socialExperiments,weekStart,weekEnd), socialPrev=reviewSocialMetrics(S.social,S.socialExperiments,prevStart,prevEnd);
  if(socialCur.hasData||socialPrev.hasData){
    if(socialCur.totalReps>socialPrev.totalReps) patterns.push(`Social activity increased from ${socialPrev.totalReps} to ${socialCur.totalReps} logged rep${socialCur.totalReps===1?'':'s'} compared to last week.`);
    else if(socialCur.totalReps<socialPrev.totalReps) patterns.push(`Social activity decreased from ${socialPrev.totalReps} to ${socialCur.totalReps} logged rep${socialCur.totalReps===1?'':'s'} compared to last week.`);
  }
  const advCur=reviewAdventureMetrics(S.adventures,S.adventureExperiments,weekStart,weekEnd);
  if(!advCur.hasData) patterns.push('Adventure activity was absent this week.');
  return patterns;
}
// Neutral, sign-explicit delta formatting for the previous-week comparison strip.
// Returns '—' when either side is unavailable rather than a misleading +0.
function formatDelta(cur,prev,suffix=''){
  if(!Number.isFinite(cur)||!Number.isFinite(prev)) return '—';
  const diff=cur-prev;
  if(diff===0) return `±0${suffix}`;
  return `${diff>0?'+':'−'}${Math.abs(diff).toFixed(Number.isInteger(diff)?0:1)}${suffix}`;
}
function formatMoneyDelta(cur,prev){
  if(!Number.isFinite(cur)||!Number.isFinite(prev)) return '—';
  const diff=cur-prev;
  if(diff===0) return '±$0.00';
  return `${diff>0?'+':'−'}${money(Math.abs(diff))}`;
}
// ---- Personal Coach v2 signal pipeline (Phase 12). Deterministic and local — no AI,
// no network calls. collectCoachSignals gathers evidence-based candidate signals from
// every domain; dedupeCoachSignals/prioritizeCoachSignals resolve conflicts and pick
// the few that matter most; formatCoachSignal renders one to a plain evidence+action
// sentence. Nothing here computes a single aggregate "life score" — only concrete,
// sourced observations about actual logged behavior.
const COACH_TIERS={SAFETY:1,GOAL_BLOCKER:2,REPEATED_PROBLEM:3,REVIEW_PRIORITY:4,CONSISTENCY:5,OPPORTUNITY:6,REINFORCEMENT:7,FALLBACK:8};

// Calendar-week (Mon-Sun) training totals for the last N weeks, newest first — used to
// detect drops/declines/unusually-high load against a real recent baseline instead of
// reacting to a single day.
function trainingWeeklyHistory(workouts,bjjSessions,asOf,weeksBack=4){
  const out=[];
  for(let i=0;i<weeksBack;i++){
    const wk=reviewWeekInfo(asOf,-i);
    out.push({...reviewTrainingMetrics(workouts,bjjSessions,wk.weekStart,wk.weekEnd),weekStart:wk.weekStart});
  }
  return out;
}
// No history at all is "no data" (fallback territory), never "overdue" — overdue only
// applies once there is at least one real check-in to measure against.
function bodyCheckInStatus(weightLog,cadenceDays,asOf){
  const last=(weightLog||[])[weightLog.length-1];
  if(!last) return {overdue:false,daysSinceLast:null};
  const d=new Date(last.date+'T00:00:00');
  if(isNaN(d)) return {overdue:false,daysSinceLast:null};
  const daysSince=Math.round((new Date(asOf+'T00:00:00')-d)/86400000);
  return {overdue:daysSince>=ensureNumber(cadenceDays,7),daysSinceLast:daysSince};
}
// Signals sharing a dedupeGroup describe the same underlying issue from different
// angles — only the single most important (lowest tier number) one survives, so the
// user sees one clear priority instead of several overlapping ones about the same
// thing. Signals without a dedupeGroup are never touched.
function dedupeCoachSignals(signals){
  const bestByGroup={};
  signals.forEach(s=>{
    if(!s.dedupeGroup) return;
    if(!(s.dedupeGroup in bestByGroup)||s.tier<bestByGroup[s.dedupeGroup].tier) bestByGroup[s.dedupeGroup]=s;
  });
  const winningIds=new Set(Object.values(bestByGroup).map(s=>s.id));
  return signals.filter(s=>!s.dedupeGroup||winningIds.has(s.id));
}
// Stable sort by tier (ascending = most important first). Ties keep their original
// (insertion) order rather than depending on which domain happened to run first.
function prioritizeCoachSignals(signals,limit=6){
  return signals.slice().sort((a,b)=>a.tier-b.tier).slice(0,limit);
}
function formatCoachSignal(sig){
  return `${sig.title} — ${sig.evidence}. ${sig.action}`;
}
// Shared by Today's "Mentor's Plan" card and the Mentor tab itself (v1.1) — reuses
// the exact same Coach pipeline rather than a second decision system, plus one BJJ
// practice suggestion when curriculum data exists and isn't already covered. A
// short list of concrete actions, never a fabricated hour-by-hour schedule (the app
// has no work-schedule/calendar data source to build one from).
function mentorDailyPlan(S,asOf){
  const signals=prioritizeCoachSignals(dedupeCoachSignals(collectCoachSignals(S,asOf)),3);
  const items=signals.map(s=>s.action);
  if((S.bjjTechniques||[]).length){
    const rec=bjjRecommendedPractice(S.bjjTechniques,S.bjjFocus,asOf,1)[0];
    if(rec&&!items.some(i=>i.includes(rec.name))) items.push(`BJJ: work on ${rec.name}.`);
  }
  return items.slice(0,4);
}
// Compact context sent to the Real AI Mentor backend (Phase 15) — deliberately NOT
// the raw S object. Excludes secrets (USDA key, cloud config), photo blobs, raw
// conversation history, and anything not needed to answer a typical question, per
// the "minimum necessary data" requirement. Every field here is already derived
// elsewhere in the app — this just packages it compactly.
function buildMentorContext(S,asOf,currentCoords){
  const p=S.profile;
  const mt=foodTotals((S.meals||[]).filter(x=>x.date===asOf));
  const bodyTrend=weightRateOfChange(S.weightLog,asOf);
  const wk=reviewWeekInfo(asOf,0);
  const reviewSnap=findWeeklySnapshot(S.weeklyReviewSnapshots,wk.weekStart);
  const coachSignals=prioritizeCoachSignals(dedupeCoachSignals(collectCoachSignals(S,asOf)),5);
  // Phase 3: the Mentor's real-world research needs a location and a sense of
  // "right now" (day-of-week/local time) it didn't need before — both are cheap,
  // already-available, non-precise data (a saved city string, the device's own
  // clock). `currentCoords` (optional {lat,lng}) is device geolocation, resolved
  // just-in-time by resolveCurrentLocationForRequest() per the user's location
  // mode — never persisted, only ever passed through for THIS one request.
  const now=new Date();
  return {
    today:asOf,
    now:{weekday:now.toLocaleDateString(undefined,{weekday:'long'}),localTime:now.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})},
    location:{city:p.city||null,current:currentCoords?{lat:currentCoords.lat,lng:currentCoords.lng}:null},
    body:{weight:p.weight,target:p.targetWeight,ratePerWeek:bodyTrend?Math.round(bodyTrend.ratePerWeek*100)/100:null},
    nutritionToday:{cal:Math.round(mt.cal),prot:Math.round(mt.prot),carbs:Math.round(mt.carbs),fat:Math.round(mt.fat),calTarget:p.cal,protTarget:p.protein},
    training:{recentSessionDates:(S.workouts||[]).slice(-3).map(w=>w.date)},
    bjj:{recommended:bjjRecommendedPractice(S.bjjTechniques,S.bjjFocus,asOf,2).map(t=>t.name)},
    money:{savings:p.savings,savingsGoal:p.savingsGoal},
    career:{activeExperiment:(S.career||[]).find(e=>e.status==='Active')?.name||null},
    social:{activeGoal:(S.socialGoals||[]).find(g=>g.active)?.name||null},
    adventure:{activeGoal:(S.adventureGoals||[]).find(g=>g.active)?.name||null},
    review:{openPriorities:reviewSnap?reviewSnap.priorities.filter(pr=>!pr.completed).map(pr=>pr.priority):[]},
    coachSignals:coachSignals.map(s=>({title:s.title,evidence:s.evidence}))
  };
}

// ---- Device location (real, opt-in) — shared infrastructure for Mentor today,
// Explore later. Three modes, stored as ONE small preference string in
// S.settings.locationMode ('off' default | 'whileUsing' | 'live'): this is the
// only part of location that is ever persisted (it's just a mode name, not a
// coordinate). Actual coordinates live ONLY in LOCATION_RUNTIME below — a plain
// module-level object, never written into S, never saved(), never synced —
// cleared on sign-out, mode change, or when live mode is turned off.
const LOCATION_RUNTIME={coords:null,watchId:null,lastError:null};

function locationMode(){ return (S.settings&&S.settings.locationMode)||'off'; }

function geolocationSupported(){ return typeof navigator!=='undefined' && !!navigator.geolocation; }

function mapGeolocationError(err){
  if(!err) return 'unavailable';
  if(err.code===1) return 'denied'; // PERMISSION_DENIED
  if(err.code===2) return 'unavailable'; // POSITION_UNAVAILABLE
  if(err.code===3) return 'timeout'; // TIMEOUT
  return 'unavailable';
}

// One-shot fetch for "while using Mentor/Explore" mode — resolved fresh right
// before a request that needs it, never cached beyond a single call, never
// touches S. Always resolves (never rejects) so a caller can just await it.
function getCurrentLocationOnce(timeoutMs){
  return new Promise(resolve=>{
    if(!geolocationSupported()){ LOCATION_RUNTIME.lastError='unsupported'; resolve({error:'unsupported'}); return; }
    navigator.geolocation.getCurrentPosition(
      pos=>{ const c={lat:pos.coords.latitude,lng:pos.coords.longitude}; LOCATION_RUNTIME.coords=c; LOCATION_RUNTIME.lastError=null; resolve({coords:c}); },
      err=>{ const mapped=mapGeolocationError(err); LOCATION_RUNTIME.lastError=mapped; resolve({error:mapped}); },
      {enableHighAccuracy:false,timeout:timeoutMs||8000,maximumAge:60000}
    );
  });
}

// "Live location" mode only — keeps LOCATION_RUNTIME.coords fresh via
// watchPosition() while enabled. Never starts twice; always stoppable.
function startLiveLocation(){
  if(!geolocationSupported()){ LOCATION_RUNTIME.lastError='unsupported'; return; }
  if(LOCATION_RUNTIME.watchId!=null) return;
  LOCATION_RUNTIME.watchId=navigator.geolocation.watchPosition(
    pos=>{ LOCATION_RUNTIME.coords={lat:pos.coords.latitude,lng:pos.coords.longitude}; LOCATION_RUNTIME.lastError=null; },
    err=>{ LOCATION_RUNTIME.lastError=mapGeolocationError(err); },
    {enableHighAccuracy:false,maximumAge:30000,timeout:15000}
  );
}
// Called on mode change away from 'live', app sign-out, or whenever live
// tracking should stop — always safe to call even if nothing is running.
function stopLiveLocation(){
  if(LOCATION_RUNTIME.watchId!=null && geolocationSupported()){
    try{ navigator.geolocation.clearWatch(LOCATION_RUNTIME.watchId); }catch(e){}
  }
  LOCATION_RUNTIME.watchId=null;
}

function setLocationMode(mode){
  if(!['off','whileUsing','live'].includes(mode)) return;
  stopLiveLocation();
  LOCATION_RUNTIME.coords=null;
  LOCATION_RUNTIME.lastError=null;
  S.settings=S.settings||{};
  S.settings.locationMode=mode;
  save();
  if(mode==='live') startLiveLocation();
}

// The single reusable resolution step Mentor (and later Explore) calls right
// before building context for a request — never blocks more than a few
// seconds, never throws, never requests location at all in 'off' mode.
async function resolveCurrentLocationForRequest(){
  const mode=locationMode();
  if(mode==='off') return null;
  if(mode==='live') return LOCATION_RUNTIME.coords; // kept fresh by watchPosition already
  if(mode==='whileUsing'){ const r=await getCurrentLocationOnce(6000); return r.coords||null; }
  return null;
}

// Best-effort synchronous label from what's already been observed on this
// device/session — Settings additionally does an async Permissions API check
// for a more authoritative "Allowed/Denied" status where the browser supports it.
function locationPermissionStatusLabel(){
  if(_geoPermissionState==='granted') return 'Allowed';
  if(_geoPermissionState==='denied') return 'Denied';
  if(_geoPermissionState==='unsupported') return 'Not supported by this browser';
  if(LOCATION_RUNTIME.lastError==='denied') return 'Denied';
  if(LOCATION_RUNTIME.lastError==='unsupported') return 'Not supported by this browser';
  if(LOCATION_RUNTIME.coords) return 'Allowed';
  return 'Not requested yet';
}

// Async, best-effort, browser-controlled — the Permissions API only reflects
// what the BROWSER already decided; the app can never grant/read this itself.
// Re-renders Settings once if the answer changes AND Settings is still the
// visible tab, so a permission prompt answered elsewhere (or revoked in browser
// site settings) is reflected without the user needing to navigate away and back.
let _geoPermissionState='unknown';
function refreshGeoPermissionStatus(){
  if(typeof navigator==='undefined'||!navigator.permissions||!navigator.permissions.query){ _geoPermissionState='unsupported'; return; }
  navigator.permissions.query({name:'geolocation'}).then(status=>{
    const changed=_geoPermissionState!==status.state;
    _geoPermissionState=status.state;
    if(changed&&typeof lastRenderedTab!=='undefined'&&lastRenderedTab==='settings') render('settings');
  }).catch(()=>{});
}

// ---- Shared real-world recommendation card renderer (Phase 3) — moved here from
// mentor.js (unchanged) so both Mentor and Explore (Phase 4) can render the exact
// same card from the exact same data shape, instead of two implementations that
// could quietly drift apart. Every caller keeps using the same function name. ----

// Only allow http(s) links through to a clickable anchor — defensive even though no
// current code path populates a recommendation with attacker-influenced data yet.
function mentorSafeUrl(u){ return /^https?:\/\//i.test(String(u||''))?u:null; }
// A message/card MAY optionally carry a `recommendation` object shaped like {name,
// address, cityState, why, hours, price, distance, source, mapUrl, websiteUrl,
// date, startTime} — every field optional except `name`. Phase 3 feeds this from
// real, verified webSearch results via the presentRecommendation tool (see
// supabase/functions/mentor/index.ts); this renderer never invents data, only
// displays whatever fields the server actually sent. date/startTime are shown
// when present so the same card can represent an event, not just a place.
// Phase 8: visual hierarchy now matches the spec exactly — NAME, ADDRESS and
// WHY THIS PICK lead (the three things a real decision needs), then hours/
// price/distance/date/time follow as clearly secondary supporting metadata,
// then the two actions, then source last. No field was removed or reordered
// out of existence — every value the server actually sent is still shown,
// this only changes which HTML class (and so which visual weight) each gets.
function mentorRenderRecommendationCard(rec){
  if(!rec||!rec.name) return '';
  const addressLine=[rec.address,rec.cityState].filter(Boolean).map(esc).join(', ');
  const metaBits=[
    (rec.date||rec.startTime)&&[rec.date,rec.startTime].filter(Boolean).map(esc).join(' &middot; '),
    rec.hours&&`Hours: ${esc(rec.hours)}`,
    rec.price&&`Price: ${esc(rec.price)}`,
    rec.distance&&`${esc(rec.distance)} away`
  ].filter(Boolean);
  const mapUrl=mentorSafeUrl(rec.mapUrl), websiteUrl=mentorSafeUrl(rec.websiteUrl);
  // Maps is the prominent action (solid button) — a real, specific place should
  // always be one tap from photos/reviews/directions. Website stays secondary
  // and separate; Maps is additive, never a replacement for it.
  const actions=[
    mapUrl?`<a class="btn" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">View on Google Maps</a>`:'',
    websiteUrl?`<a class="btn secondary" href="${esc(websiteUrl)}" target="_blank" rel="noopener noreferrer">Website</a>`:''
  ].filter(Boolean).join('');
  return `<div class="mentor-rec-card">
<div class="mentor-rec-name">${esc(rec.name)}</div>
${addressLine?`<div class="mentor-rec-address">${addressLine}</div>`:''}
${rec.why?`<div class="mentor-rec-why"><b>Why this pick:</b> ${esc(rec.why)}</div>`:''}
${metaBits.length?`<div class="mentor-rec-meta small muted">${metaBits.join(' &middot; ')}</div>`:''}
${actions?`<div class="row" style="margin-top:10px">${actions}</div>`:''}
${rec.source?`<div class="small muted" style="margin-top:8px">Source: ${esc(rec.source)}</div>`:''}
</div>`;
}

// Only for the case where collectCoachSignals found literally nothing — never mixed in
// alongside real signals, and only ever suggests logging for a domain that has zero
// history at all (not just a quiet week).
function fallbackCoachSignals(S){
  const out=[];
  if(!(S.weightLog||[]).length) out.push({id:'fallback-body',domain:'Body',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No weight check-ins logged yet',evidence:'Body has no history yet',action:"Log today's weight to start building a trend."});
  if(!(S.workouts||[]).length&&!(S.bjj||[]).length) out.push({id:'fallback-training',domain:'Training',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No training sessions logged yet',evidence:'Training has no history yet',action:'Complete one planned lifting or BJJ session and log it.'});
  if(!(S.meals||[]).length) out.push({id:'fallback-nutrition',domain:'Nutrition',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No meals logged yet',evidence:'Nutrition has no history yet',action:"Log today's meals."});
  if(!(S.career||[]).some(e=>(e.sessions||[]).length)) out.push({id:'fallback-career',domain:'Career',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No career sessions logged yet',evidence:'Career has no history yet',action:'Log one 30-minute career session.'});
  if(!(S.social||[]).length) out.push({id:'fallback-social',domain:'Social',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No social reps logged yet',evidence:'Social has no history yet',action:'Complete one small social rep and log it.'});
  if(!(S.adventures||[]).length) out.push({id:'fallback-adventure',domain:'Adventure',type:'fallback',tier:COACH_TIERS.FALLBACK,
    title:'No adventures logged yet',evidence:'Adventure has no history yet',action:'Log one small new experience.'});
  return out.slice(0,4);
}
// The single evidence-collection pass. Reads S, returns plain signal objects — never
// mutates state, never a single aggregate score. Each signal states WHAT is going on,
// the WHY (evidence it's based on), and a concrete NEXT ACTION.
function collectCoachSignals(S,asOf){
  const signals=[];
  const p=S.profile;
  const curWk=reviewWeekInfo(asOf,0), prevWk=reviewWeekInfo(asOf,-1);

  // ---- BODY ----
  const bodyTrend=weightRateOfChange(S.weightLog,asOf);
  if(bodyTrend){
    const goal=weightGoalStats(S.weightLog,p.weight,p.targetWeight);
    const goalDir=goal.target<goal.start?'lose':goal.target>goal.start?'gain':'maintain';
    const dir=bodyTrend.ratePerWeek<-0.05?'down':bodyTrend.ratePerWeek>0.05?'up':'stable';
    const wantedDir=goalDir==='lose'?'down':'up';
    const rateTxt=`${Math.abs(bodyTrend.ratePerWeek).toFixed(1)} lb/week`;
    if(goalDir!=='maintain'&&dir!=='stable'&&dir!==wantedDir){
      signals.push({id:'body-trend-away',domain:'Body',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'body-weight-trend',
        title:'Weight trend is moving away from your target',
        evidence:`Your logged weight is trending ${dir} about ${rateTxt}, while your goal is to ${goalDir}`,
        action:'Your logged behavior suggests reviewing recent nutrition logging this week before changing anything else.'});
    } else if(goalDir!=='maintain'&&dir===wantedDir){
      signals.push({id:'body-trend-toward',domain:'Body',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'body-weight-trend',
        title:'Weight trend is moving toward your target',
        evidence:`Trending ${dir} about ${rateTxt}, consistent with your ${goalDir} goal`,
        action:'Keep the same pattern going into next week.'});
    } else if(goalDir==='maintain'&&dir!=='stable'){
      signals.push({id:'body-trend-drift',domain:'Body',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'body-weight-trend',
        title:'Weight has drifted while your goal is to maintain',
        evidence:`Trending ${dir} about ${rateTxt}`,
        action:'No action needed unless this continues next week — keep logging check-ins.'});
    }
  }
  const checkIn=bodyCheckInStatus(S.weightLog,p.checkInCadenceDays||7,asOf);
  if(checkIn.overdue){
    signals.push({id:'body-checkin-overdue',domain:'Body',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'body-checkin',
      title:'Body check-in is overdue',
      evidence:`Last check-in was ${checkIn.daysSinceLast} day${checkIn.daysSinceLast===1?'':'s'} ago, your cadence is every ${p.checkInCadenceDays||7} day${(p.checkInCadenceDays||7)===1?'':'s'}`,
      action:"Log today's weight."});
  }

  // ---- TRAINING ----
  const trainHist=trainingWeeklyHistory(S.workouts,S.bjj,asOf,4);
  const [tw0,tw1,tw2,tw3]=trainHist;
  const trainingBaselineWeeks=[tw1,tw2,tw3].filter(w=>w&&w.hasData);
  let trainingLoadHigh=false;
  if(trainingBaselineWeeks.length>=2){
    const baselineAvg=trainingBaselineWeeks.reduce((a,w)=>a+w.totalSessions,0)/trainingBaselineWeeks.length;
    if(baselineAvg>0&&tw0.totalSessions>=6&&tw0.totalSessions>=baselineAvg*1.5){
      trainingLoadHigh=true;
      signals.push({id:'training-load-high',domain:'Training',type:'recovery',tier:COACH_TIERS.SAFETY,dedupeGroup:'training-activity',
        title:'Training load is high relative to your recent baseline',
        evidence:`${tw0.totalSessions} sessions this week vs a recent average of ${baselineAvg.toFixed(1)}`,
        action:'Consider prioritizing recovery before adding more volume.'});
    }
  }
  const hasTrainingHistory=(S.workouts||[]).length>0||(S.bjj||[]).length>0;
  if(!trainingLoadHigh&&hasTrainingHistory){
    const declining3=tw0&&tw1&&tw2&&tw0.totalSessions<tw1.totalSessions&&tw1.totalSessions<tw2.totalSessions&&tw2.totalSessions>0;
    if(declining3){
      signals.push({id:'training-declining-3wk',domain:'Training',type:'bottleneck',tier:COACH_TIERS.REPEATED_PROBLEM,dedupeGroup:'training-activity',
        title:'Training consistency has declined for three weeks in a row',
        evidence:`${tw2.totalSessions} → ${tw1.totalSessions} → ${tw0.totalSessions} sessions over the last three weeks`,
        action:'Pick one realistic session to complete in the next 2 days before planning anything bigger.'});
    } else if(tw1&&tw1.hasData&&tw0.totalSessions<=tw1.totalSessions-2){
      signals.push({id:'training-drop-1wk',domain:'Training',type:'bottleneck',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'training-activity',
        title:'Training consistency dropped this week',
        evidence:`${tw0.totalSessions} session${tw0.totalSessions===1?'':'s'} vs ${tw1.totalSessions} last week`,
        action:'Get your next planned session completed before adding anything else.'});
    } else if(tw0.totalSessions<3){
      signals.push({id:'training-low-freq',domain:'Training',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'training-activity',
        title:'Training frequency is low this week',
        evidence:`${tw0.totalSessions} session${tw0.totalSessions===1?'':'s'} logged so far`,
        action:'Schedule your next session in the next 2 days.'});
    } else if(tw1&&tw1.hasData&&tw0.totalSessions>tw1.totalSessions){
      signals.push({id:'training-improving',domain:'Training',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'training-activity',
        title:'Training consistency improved this week',
        evidence:`${tw0.totalSessions} sessions vs ${tw1.totalSessions} last week`,
        action:'Keep the same pattern going into next week.'});
    }
  }
  const prWins=reviewTrainingPRWins(S.workouts,curWk.weekStart,curWk.weekEnd);
  if(prWins.length){
    signals.push({id:'training-pr',domain:'Training',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,
      title:'New strength PR this week',
      evidence:prWins.map(w=>w.text).join('; '),
      action:'Keep progressing this movement with good form.'});
  }

  // ---- NUTRITION ----
  const nutriCur=reviewNutritionMetrics(S.meals,curWk.weekStart,curWk.weekEnd);
  const nutriPrev=reviewNutritionMetrics(S.meals,prevWk.weekStart,prevWk.weekEnd);
  if((S.meals||[]).length){
    if(nutriCur.hasData&&nutriCur.daysLogged<4){
      signals.push({id:'nutrition-inconsistent',domain:'Nutrition',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'nutrition-logging',
        title:'Nutrition logging is inconsistent this week',
        evidence:`${nutriCur.daysLogged}/${nutriCur.daysInWeek} days logged`,
        action:"Log today's meals."});
    } else if(nutriCur.hasData&&nutriPrev.hasData&&nutriCur.daysLogged>nutriPrev.daysLogged){
      signals.push({id:'nutrition-improving',domain:'Nutrition',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'nutrition-logging',
        title:'Nutrition logging consistency improved',
        evidence:`${nutriCur.daysLogged} days logged this week vs ${nutriPrev.daysLogged} last week`,
        action:'Keep the same pattern going into next week.'});
    }
    if(nutriCur.hasData&&nutriCur.daysLogged>=3&&nutriCur.avgProt<ensureNumber(p.protein)*0.8){
      signals.push({id:'nutrition-protein-low',domain:'Nutrition',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
        title:'Protein intake is below target on logged days',
        evidence:`Averaging ${Math.round(nutriCur.avgProt)}g vs a ${p.protein}g target across ${nutriCur.daysLogged} logged days`,
        action:'Prepare one reliable protein source ahead of time for tomorrow.'});
    }
  }

  // ---- MONEY ----
  const income30=sumByType(moneyInWindow(S.money,30,asOf),'income');
  const savings30=sumByType(moneyInWindow(S.money,30,asOf),'savings');
  const hasMoneyHistory=(S.money||[]).length>0;
  const hasSavingsGoal=ensureNumber(p.savingsGoal)>0&&ensureNumber(p.savings)<ensureNumber(p.savingsGoal);
  let moneyBottleneckPresent=false;
  if(hasMoneyHistory&&hasSavingsGoal&&savings30<=0){
    signals.push({id:'money-savings-goal-blocked',domain:'Money',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'money-savings',
      title:'Savings goal has had no contribution in 30 days',
      evidence:`$${Math.round(p.savingsGoal-p.savings)} remaining to reach your $${p.savingsGoal} savings goal`,
      action:'Log one transfer this week, even a small one.'});
    moneyBottleneckPresent=true;
  } else if(savings30>0){
    signals.push({id:'money-savings-reinforce',domain:'Money',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'money-savings',
      title:'Savings contribution logged recently',
      evidence:`$${savings30.toFixed(0)} saved in the last 30 days`,
      action:'Keep the same pattern going into next month.'});
  }
  if(hasMoneyHistory&&income30<=0){
    signals.push({id:'money-no-income',domain:'Money',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
      title:'No income logged in 30 days',
      evidence:'Income has no entries in the last 30 days',
      action:'Log paychecks or side income to keep your money picture accurate.'});
  }
  const curMK=monthKey(asOf), prevMK=shiftMonthKey(curMK,-1);
  const curExpense=sumByType(moneyTransactionsInMonth(S.money,curMK),'expense');
  const prevExpense=sumByType(moneyTransactionsInMonth(S.money,prevMK),'expense');
  if(prevExpense>0&&curExpense>prevExpense*1.2){
    signals.push({id:'money-spending-spike',domain:'Money',type:'warning',tier:COACH_TIERS.CONSISTENCY,
      title:'Spending is running higher than last month',
      evidence:`$${Math.round(curExpense)} this month vs $${Math.round(prevExpense)} last month`,
      action:'Take a quick look at where the increase came from.'});
    moneyBottleneckPresent=true;
  }
  const exceededBudget=Object.entries(S.moneyBudgets||{}).find(([cat,limit])=>(moneyCategoryBreakdown(moneyTransactionsInMonth(S.money,curMK),'expense').find(c=>c.category===cat)?.total||0)>=limit);
  if(exceededBudget){
    signals.push({id:'money-budget-exceeded',domain:'Money',type:'warning',tier:COACH_TIERS.CONSISTENCY,
      title:`${exceededBudget[0]} budget is over its limit this month`,
      evidence:'Category spending has reached or passed the configured limit',
      action:'Not a crisis — just worth noticing before next month starts.'});
    moneyBottleneckPresent=true;
  }

  // ---- CAREER ----
  const careerTarget=S.careerWeeklyTarget||{text:'',minutesGoal:0};
  const careerDoneMin=careerWeeklyMinutes(S.career,asOf);
  const careerSessionsLast7=[]; (S.career||[]).forEach(e=>(e.sessions||[]).forEach(s=>{if(s.date>=shiftDate(asOf,-6))careerSessionsLast7.push(s);}));
  if(careerTarget.minutesGoal>0&&careerDoneMin<careerTarget.minutesGoal){
    signals.push({id:'career-target-behind',domain:'Career',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'career-activity',
      title:'Career target is behind pace',
      evidence:`${Math.round(careerDoneMin)}/${careerTarget.minutesGoal} min logged toward "${careerTarget.text||'your target'}"`,
      action:'Schedule one focused session before the week ends.'});
  } else if(careerTarget.minutesGoal<=0&&careerSessionsLast7.length===0&&(S.career||[]).length>0){
    signals.push({id:'career-no-session',domain:'Career',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'career-activity',
      title:'No career session logged in 7 days',
      evidence:'Career has no sessions in the last 7 days',
      action:'Schedule one 30-minute session.'});
  } else if(careerTarget.minutesGoal>0&&careerDoneMin>=careerTarget.minutesGoal){
    signals.push({id:'career-target-met',domain:'Career',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'career-activity',
      title:'Career weekly target met',
      evidence:`${Math.round(careerDoneMin)}/${careerTarget.minutesGoal} min logged`,
      action:'Keep the same pattern going into next week.'});
  }
  const activeNoNextStep=(S.career||[]).find(e=>e.status==='Active'&&!e.nextStep);
  if(activeNoNextStep){
    signals.push({id:'career-no-next-step',domain:'Career',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
      title:`${activeNoNextStep.name} has no next step defined`,
      evidence:'This active experiment has an empty next-step field',
      action:'Write down one small next action for it.'});
  }
  const mostNeglectedSkill=(S.careerSkills||[]).map(s=>({s,n:careerSkillNeglect(s,asOf)})).filter(x=>x.n.neglected).sort((a,b)=>b.n.daysSince-a.n.daysSince)[0];
  if(mostNeglectedSkill){
    signals.push({id:'career-skill-neglected',domain:'Career',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
      title:`${mostNeglectedSkill.s.name} skill hasn't been practiced recently`,
      evidence:`${mostNeglectedSkill.n.daysSince} days since last practice`,
      action:'Consider a short practice session.'});
  }

  // ---- SOCIAL ----
  const socialLast7=socialRepsInWindow(S.social,7,asOf);
  const activeSocialGoal=(S.socialGoals||[]).find(g=>g.active);
  const socialTarget=S.socialWeeklyTarget||{conversations:0,initiations:0,plans:0,socialMinutes:0};
  const socialTargetProg=socialWeeklyTargetProgress(S.social,socialTarget,asOf);
  if(activeSocialGoal&&socialLast7.length===0){
    signals.push({id:'social-goal-blocked',domain:'Social',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'social-activity',
      title:'Active social goal has no activity this week',
      evidence:`Goal "${activeSocialGoal.name}" has 0 reps logged this week`,
      action:'Complete one small social rep to move it forward.'});
  } else if(socialTarget.conversations>0&&socialTargetProg.conversations.done<socialTarget.conversations){
    signals.push({id:'social-target-behind',domain:'Social',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'social-activity',
      title:'Weekly conversation target is behind pace',
      evidence:`${socialTargetProg.conversations.done}/${socialTarget.conversations} conversations logged`,
      action:'Have one more conversation before the week ends.'});
  } else if(socialLast7.length===0&&(S.social||[]).length>0){
    signals.push({id:'social-no-reps',domain:'Social',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'social-activity',
      title:'No social rep logged in 7 days',
      evidence:'Social has no reps in the last 7 days',
      action:'Try one small conversation this week.'});
  } else {
    const priorWeekSocialReps=socialRepsInWindow(S.social,7,shiftDate(asOf,-7)).length;
    if(priorWeekSocialReps>0&&socialLast7.length>priorWeekSocialReps){
      signals.push({id:'social-trending-up',domain:'Social',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'social-activity',
        title:'Social activity is trending up',
        evidence:`${socialLast7.length} reps this week, up from ${priorWeekSocialReps} last week`,
        action:'Keep the same pattern going into next week.'});
    }
  }
  const lastInvite=(S.social||[]).filter(r=>r.type==='Asked someone to hang out'||r.type==='Made plans').slice().sort((a,b)=>(a.date<b.date?1:-1))[0];
  if(lastInvite){
    const daysSinceInvite=Math.round((new Date(asOf+'T00:00:00')-new Date(lastInvite.date+'T00:00:00'))/86400000);
    const afterInviteCount=(S.social||[]).filter(r=>r.date>lastInvite.date).length;
    if(daysSinceInvite>=7&&afterInviteCount===0){
      signals.push({id:'social-invite-followup',domain:'Social',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
        title:'An invitation was made with no follow-up logged since',
        evidence:`${daysSinceInvite} days since the last invitation or plan, nothing logged after it`,
        action:'A quick check-in could be worth it.'});
    }
  }
  const socialLast30=socialRepsInWindow(S.social,30,asOf);
  const easySocialCount=socialLast30.filter(r=>['Started conversation','Continued conversation'].includes(r.type)).length;
  const harderSocialCount=socialLast30.filter(r=>['Asked someone to hang out','Made plans','Attended event'].includes(r.type)).length;
  if(easySocialCount>=5&&harderSocialCount===0){
    signals.push({id:'social-plateaued',domain:'Social',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
      title:'Social reps have plateaued at the easier level',
      evidence:`${easySocialCount} easier conversation reps in 30 days, 0 higher-effort ones`,
      action:'Consider one slightly more uncomfortable action, like an invitation.'});
  }

  // ---- ADVENTURE ----
  if(!moneyBottleneckPresent){
    const adventureLast30=adventureRepsInWindow(S.adventures,30,asOf);
    const novelAdventures30=adventureLast30.filter(a=>Number.isFinite(a.novelty)&&a.novelty>=4).length;
    if(adventureLast30.length>=5&&novelAdventures30===0){
      signals.push({id:'adventure-plateaued',domain:'Adventure',type:'opportunity',tier:COACH_TIERS.OPPORTUNITY,
        title:'Adventure experiences have plateaued in novelty',
        evidence:`${adventureLast30.length} experiences in 30 days, none rated novelty 4+`,
        action:'Consider increasing novelty slightly on the next one.'});
    }
  }
  const adventureLast7=adventureRepsInWindow(S.adventures,7,asOf);
  const activeAdventureGoal=(S.adventureGoals||[]).find(g=>g.active);
  if(activeAdventureGoal&&adventureLast7.length===0){
    signals.push({id:'adventure-goal-blocked',domain:'Adventure',type:'bottleneck',tier:COACH_TIERS.GOAL_BLOCKER,dedupeGroup:'adventure-activity',
      title:'Active adventure goal has no activity this week',
      evidence:`Goal "${activeAdventureGoal.name}" has 0 experiences logged this week`,
      action:'Log one small experience to move it forward.'});
  } else {
    const adventureLast14=adventureRepsInWindow(S.adventures,14,asOf);
    if(adventureLast14.length===0&&(S.adventures||[]).length>0){
      signals.push({id:'adventure-inactive',domain:'Adventure',type:'consistency',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'adventure-activity',
        title:'No adventure activity in 14 days',
        evidence:'Adventure has no experiences logged in the last 14 days',
        action:'One small experience would add to the evidence.'});
    } else {
      const priorWeekAdventureReps=adventureRepsInWindow(S.adventures,7,shiftDate(asOf,-7)).length;
      if(priorWeekAdventureReps>0&&adventureLast7.length>priorWeekAdventureReps){
        signals.push({id:'adventure-trending-up',domain:'Adventure',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'adventure-activity',
          title:'Adventure activity is trending up',
          evidence:`${adventureLast7.length} experiences this week, up from ${priorWeekAdventureReps} last week`,
          action:'Keep the same pattern going into next week.'});
      }
    }
  }
  const soloAdventureLast7=adventureLast7.filter(a=>a.soloOrWithOthers==='Solo').length;
  if(soloAdventureLast7>0){
    signals.push({id:'adventure-solo-evidence',domain:'Adventure',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,
      title:'Solo experience logged this week',
      evidence:`${soloAdventureLast7} solo experience${soloAdventureLast7===1?'':'s'} this week`,
      action:'Real evidence of independent action — keep it up.'});
  }

  // ---- WEEKLY REVIEW ----
  // A "review not completed" nudge is only meaningful once the user has actually
  // started using the app somewhere — telling a brand-new, all-empty account that
  // its review isn't done yet would be presumptuous, not evidence-based, and would
  // permanently starve the fallback path (a review is "not completed" by default).
  const hasAnyHistoryForReview=(S.weightLog||[]).length||(S.workouts||[]).length||(S.bjj||[]).length||(S.meals||[]).length||(S.money||[]).length||(S.career||[]).some(e=>(e.sessions||[]).length)||(S.social||[]).length||(S.adventures||[]).length||(S.weeklyReviewSnapshots||[]).length;
  if(hasAnyHistoryForReview){
    const priorReviewSnapshot=findWeeklySnapshot(S.weeklyReviewSnapshots,prevWk.weekStart);
    if(!priorReviewSnapshot||!priorReviewSnapshot.completed){
      signals.push({id:'review-not-completed',domain:'Review',type:'review',tier:COACH_TIERS.CONSISTENCY,dedupeGroup:'review-completion',
        title:"Last week's review hasn't been completed",
        evidence:'No completed weekly review found for last week',
        action:'A few minutes of reflection keeps this plan grounded in what actually happened.'});
    } else {
      signals.push({id:'review-completed',domain:'Review',type:'reinforcement',tier:COACH_TIERS.REINFORCEMENT,dedupeGroup:'review-completion',
        title:"Last week's review was completed",
        evidence:'A completed weekly review was found for last week',
        action:'Keep the same habit going this week.'});
    }
  }
  const allReviewSnapshotsSorted=(S.weeklyReviewSnapshots||[]).slice().sort((a,b)=>a.weekStart<b.weekStart?1:-1);
  const mostRecentReviewSnapshot=allReviewSnapshotsSorted[0];
  if(mostRecentReviewSnapshot){
    const openPriorities=(mostRecentReviewSnapshot.priorities||[]).filter(pr=>!pr.completed);
    if(openPriorities.length>0){
      const domainsInPlay=new Set(signals.map(s=>s.domain));
      const chosen=openPriorities.find(pr=>domainsInPlay.has(pr.category))||openPriorities[0];
      signals.push({id:'review-open-priority',domain:'Review',type:'review',tier:COACH_TIERS.REVIEW_PRIORITY,
        title:`Weekly review priority "${chosen.priority}" is still open`,
        evidence:openPriorities.length>1?`${openPriorities.length} priorities from your last review are still open`:'Set in your last weekly review, not yet marked complete',
        action:chosen.action||'Pick one concrete step for it today.'});
    }
  }
  const recentReviewSnapshots=allReviewSnapshotsSorted.slice(0,3);
  const frictionCategoryCounts={};
  recentReviewSnapshots.forEach(r=>(r.friction||[]).forEach(f=>{frictionCategoryCounts[f.category]=(frictionCategoryCounts[f.category]||0)+1;}));
  const repeatedFrictionEntry=Object.entries(frictionCategoryCounts).find(([cat,count])=>count>=2);
  if(repeatedFrictionEntry){
    const [cat,count]=repeatedFrictionEntry;
    const isRecovery=cat==='Sleep'||cat==='Energy';
    signals.push({id:'review-repeated-friction',domain:'Review',type:isRecovery?'recovery':'warning',tier:isRecovery?COACH_TIERS.SAFETY:COACH_TIERS.REPEATED_PROBLEM,
      title:`"${cat}" has come up as friction repeatedly`,
      evidence:`Appeared in ${count} of your last ${recentReviewSnapshots.length} weekly reviews`,
      action:isRecovery?'Before adding more training or responsibilities, test one concrete change for the next 7 days.':'Worth a closer look before adding anything new in this area.'});
  }
  const reviewPatternsThisWeek=reviewPatterns(S,curWk.weekStart,curWk.weekEnd);
  const reviewPatternsLastWeek=reviewPatterns(S,prevWk.weekStart,prevWk.weekEnd);
  // Excludes the trivial "Adventure activity was absent this week." pattern: it is
  // real (see reviewPatterns), but it repeats forever for anyone who has never used
  // Adventure at all and is not a meaningful bottleneck signal on its own.
  const repeatedReviewPattern=reviewPatternsThisWeek.find(pt=>pt!=='Adventure activity was absent this week.'&&reviewPatternsLastWeek.includes(pt));
  if(repeatedReviewPattern){
    signals.push({id:'review-repeated-pattern',domain:'Review',type:'warning',tier:COACH_TIERS.REPEATED_PROBLEM,
      title:'The same pattern showed up again this week',
      evidence:repeatedReviewPattern,
      action:'Worth addressing directly rather than letting it repeat a third time.'});
  }

  // ---- CONFLICT RESOLUTION: recovery friction takes priority over "add more training" ----
  const recoveryFrictionActive=signals.some(s=>s.id==='review-repeated-friction'&&s.type==='recovery');
  if(recoveryFrictionActive){
    return signals.filter(s=>!(s.dedupeGroup==='training-activity'&&s.type!=='recovery'&&s.tier>=COACH_TIERS.CONSISTENCY));
  }
  return signals;
}
