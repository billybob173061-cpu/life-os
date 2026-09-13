const MONEY_CATEGORIES={
  income:['Paycheck','Side income','Other income'],
  expense:['Food','Transportation','Bills','Entertainment','Shopping','Subscriptions','Health','Education','Other'],
  savings:['Transfer to savings','Other savings contribution']
};
const MONEY_TYPE_LABELS={income:'Income',expense:'Expense',savings:'Savings'};

function updateMoneyCategoryOptions(){
  const type=$('mt').value;
  const sel=$('mcat');
  if(sel) sel.innerHTML=(MONEY_CATEGORIES[type]||[]).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

// ---- Transaction logging ----
function logMoneyTransaction(){
  const type=$('mt').value;
  const amount=ensureNumber($('ma').value,NaN);
  const category=$('mcat').value||'';
  const date=($('mdate').value||'').trim()||today();
  const note=($('mn').value||'').trim();
  if(!Number.isFinite(amount)||amount<=0){toast('Enter an amount greater than zero');return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){toast('Enter a valid date');return}
  S.money.push({id:uid('money'),date,type,amount,category,note});
  if(type==='income'||type==='savings') S.profile.savings+=amount; else S.profile.savings-=amount;
  save();render('money');toast('Transaction logged');
}
function deleteMoneyTransaction(id){
  if(!confirm('Delete this transaction? This cannot be undone.'))return;
  const entry=(S.money||[]).find(x=>x.id===id);
  if(!entry)return;
  // Reverse its effect on the tracked balance so every derived total stays consistent.
  if(entry.type==='income'||entry.type==='savings') S.profile.savings-=ensureNumber(entry.amount);
  else S.profile.savings+=ensureNumber(entry.amount);
  S.money=(S.money||[]).filter(x=>x.id!==id);
  save();render('money');toast('Transaction deleted');
}
let moneyHistoryFilter='all';
function setMoneyHistoryFilter(f){moneyHistoryFilter=f;render('money');}

// ---- Monthly overview navigation (never goes into the future) ----
let moneyOverviewMonthOffset=0;
function shiftMoneyOverviewMonth(delta){
  const next=moneyOverviewMonthOffset+delta;
  if(next>0)return;
  moneyOverviewMonthOffset=next;
  render('money');
}

// ---- Budgets (optional, informational only — never blocks logging) ----
function setMoneyBudget(){
  const category=$('budget_category').value;
  const raw=($('budget_amount').value||'').trim();
  if(!category){toast('Choose a category');return}
  if(raw===''){
    delete S.moneyBudgets[category];
    save();render('money');toast('Budget removed');
    return;
  }
  const limit=ensureNumber(raw,NaN);
  if(!Number.isFinite(limit)||limit<=0){toast('Enter a budget amount greater than zero, or leave it blank to remove one');return}
  S.moneyBudgets[category]=limit;
  save();render('money');toast('Budget saved');
}
function removeMoneyBudget(category){
  delete S.moneyBudgets[category];
  save();render('money');toast('Budget removed');
}
// Index-based wrapper so a budget category (which normally only ever comes from the
// fixed MONEY_CATEGORIES list, but could in principle contain arbitrary text via an
// imported backup) is never interpolated directly into an inline onclick string.
function removeMoneyBudgetAt(i){
  const cat=Object.keys(S.moneyBudgets||{})[i];
  if(cat!==undefined) removeMoneyBudget(cat);
}

// ---- Additional financial goals (simple, separate from the main savings pool) ----
function addMoneyGoal(){
  const name=($('goal_name').value||'').trim();
  const target=ensureNumber($('goal_target').value,NaN);
  const deadline=($('goal_deadline').value||'').trim();
  if(!name){toast('Name the goal');return}
  if(!Number.isFinite(target)||target<=0){toast('Enter a target amount greater than zero');return}
  S.moneyGoals.push({id:uid('goal'),name,target,current:0,deadline:deadline||null});
  save();render('money');toast('Goal created');
}
function contributeToGoal(id){
  const raw=prompt('How much would you like to add to this goal?');
  if(raw===null)return;
  const amount=ensureNumber(raw,NaN);
  if(!Number.isFinite(amount)||amount<=0){toast('Enter an amount greater than zero');return}
  const g=(S.moneyGoals||[]).find(x=>x.id===id); if(!g)return;
  g.current=ensureNumber(g.current,0)+amount;
  save();render('money');toast('Contribution added');
}
function removeMoneyGoal(id){
  if(!confirm('Remove this goal? This cannot be undone.'))return;
  S.moneyGoals=(S.moneyGoals||[]).filter(x=>x.id!==id);
  save();render('money');toast('Goal removed');
}

function moneyHistoryRows(){
  const list=(S.money||[]).filter(t=>moneyHistoryFilter==='all'||t.type===moneyHistoryFilter);
  return list.slice().reverse().slice(0,50).map(t=>`<div class="item"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><b>${t.type==='expense'?'−':'+'}${money(t.amount)}</b> <span class="pill">${esc(MONEY_TYPE_LABELS[t.type]||t.type)}</span>${t.category?` <span class="small muted">${esc(t.category)}</span>`:''}<div class="small muted">${t.date}${t.note?' · '+esc(t.note):''}</div></div><button class="btn secondary qty-btn" title="Remove" onclick="deleteMoneyTransaction('${t.id}')">×</button></div></div>`).join('')||'<div class="empty">No transactions match this filter.</div>';
}

views.money=()=>{
  const p=S.profile;
  const asOfMK=monthKey(today());
  const viewMK=shiftMonthKey(asOfMK,moneyOverviewMonthOffset);
  const viewMonthTx=moneyTransactionsInMonth(S.money,viewMK);
  const viewIncome=sumByType(viewMonthTx,'income');
  const viewExpense=sumByType(viewMonthTx,'expense');
  const viewSavingsContrib=sumByType(viewMonthTx,'savings');
  const viewNet=viewIncome-viewExpense;
  const viewTopCats=moneyCategoryBreakdown(viewMonthTx,'expense').slice(0,3);
  const viewMonthLabel=new Date(viewMK+'-01T00:00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'});

  const thisMonthTx=moneyTransactionsInMonth(S.money,asOfMK);
  const monthIncome=sumByType(thisMonthTx,'income');
  const monthExpense=sumByType(thisMonthTx,'expense');
  const monthNet=monthIncome-monthExpense;
  const rate=savingsRate(monthIncome,monthExpense);

  const weekTx=moneyInWindow(S.money,7,today());
  const weekIncome=sumByType(weekTx,'income');
  const weekExpense=sumByType(weekTx,'expense');
  const weekSavings=sumByType(weekTx,'savings');

  const avgIncome=averageMonthlyIncome(S.money,6,asOfMK);
  const expenseBreakdown=moneyCategoryBreakdown(thisMonthTx,'expense');
  const recentIncome=(S.money||[]).filter(t=>t.type==='income').slice(-8).reverse();
  const recentExpenses=(S.money||[]).filter(t=>t.type==='expense').slice(-8).reverse();
  const recentSavings=(S.money||[]).filter(t=>t.type==='savings').slice(-8).reverse();

  const weeklyBars=weeklyExpenseTotals(S.money,8,today());
  const savingsPct=pct(p.savings,p.savingsGoal);

  return `<p class="page-intro">Every number here comes from a transaction you logged — nothing is estimated or pulled from a bank on your behalf.</p>
<div class="grid four">
<div class="card"><div class="small">Tracked balance</div><div class="metric">${money(p.savings)}</div><div class="small muted">Money tracked in this app — not a bank balance</div></div>
<div class="card"><div class="small">Savings goal</div><div class="metric">${Math.round(savingsPct)}<span class="unit">%</span></div><div class="barbg" style="margin-top:6px"><div class="bar" style="width:${savingsPct}%"></div></div><div class="small muted" style="margin-top:4px">${money(p.savings)} of ${money(p.savingsGoal)}</div></div>
<div class="card"><div class="small">Income this month</div><div class="metric">${money(monthIncome)}</div></div>
<div class="card"><div class="small">Expenses this month</div><div class="metric">${money(monthExpense)}</div></div>
</div>
<div class="grid two" style="margin-top:12px">
<div class="card"><div class="small">Net this month</div><div class="metric">${monthNet<0?'−':''}${money(Math.abs(monthNet))}</div><div class="small muted">Income minus expenses</div></div>
<div class="card"><div class="small">Savings rate this month</div><div class="metric">${rate===null?'—':Math.round(rate)+'%'}</div><div class="small muted">${rate===null?'No income logged this month yet':'(income − expenses) ÷ income'}</div></div>
</div>

<h3 class="section">Log a transaction</h3>
<div class="card">
<div class="grid two"><select id="mt" class="input" onchange="updateMoneyCategoryOptions()"><option value="income">Income</option><option value="expense" selected>Expense</option><option value="savings">Savings</option></select><select id="mcat" class="input">${MONEY_CATEGORIES.expense.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
<div class="grid two" style="margin-top:8px"><input id="ma" class="input" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Amount"><input id="mdate" class="input" type="date" value="${today()}"></div>
<input id="mn" class="input" style="margin-top:8px" placeholder="Description (optional)">
<button class="btn" style="margin-top:9px" onclick="logMoneyTransaction()">Log transaction</button>
</div>

<h3 class="section">Monthly overview</h3>
<div class="card">
<div class="row" style="justify-content:space-between;align-items:center">
<button class="btn secondary" onclick="shiftMoneyOverviewMonth(-1)">← Previous</button>
<b>${viewMonthLabel}</b>
<button class="btn secondary" ${moneyOverviewMonthOffset>=0?'disabled style="opacity:.4"':''} onclick="shiftMoneyOverviewMonth(1)">Next →</button>
</div>
${viewMonthTx.length?`<div class="grid three" style="margin-top:10px"><div><div class="small">Income</div><div class="metric">${money(viewIncome)}</div></div><div><div class="small">Expenses</div><div class="metric">${money(viewExpense)}</div></div><div><div class="small">Net</div><div class="metric">${viewNet<0?'−':''}${money(Math.abs(viewNet))}</div></div></div>
<div class="small muted" style="margin-top:8px">Savings contributions: ${money(viewSavingsContrib)}</div>
${viewTopCats.length?`<div class="small" style="margin-top:8px"><b>Top spending:</b> ${viewTopCats.map(c=>`${esc(c.category)} (${money(c.total)})`).join(', ')}</div>`:''}`
:'<div class="empty">No transactions logged in this month.</div>'}
</div>

<h3 class="section">Income</h3>
<div class="card">
<div class="grid three"><div><div class="small">This week</div><div class="metric">${money(weekIncome)}</div></div><div><div class="small">This month</div><div class="metric">${money(monthIncome)}</div></div><div><div class="small">Avg. monthly</div><div class="metric">${avgIncome?money(avgIncome.avg):'—'}</div></div></div>
${avgIncome?`<div class="small muted" style="margin-top:6px">Based on ${avgIncome.monthsCounted} months with income logged</div>`:'<div class="small muted" style="margin-top:6px">Not enough data yet — log income across at least 2 months to see an average.</div>'}
<div class="list" style="margin-top:8px">${recentIncome.length?recentIncome.map(t=>`<div class="item">+${money(t.amount)} ${t.category?`<span class="small muted">${esc(t.category)}</span>`:''}<div class="small muted">${t.date}${t.note?' · '+esc(t.note):''}</div></div>`).join(''):'<div class="empty">No income logged yet.</div>'}</div>
</div>

<h3 class="section">Expenses</h3>
<div class="card">
<div class="grid two"><div><div class="small">This week</div><div class="metric">${money(weekExpense)}</div></div><div><div class="small">This month</div><div class="metric">${money(monthExpense)}</div></div></div>
<h4 style="margin:12px 0 6px">Where it went this month</h4>
${expenseBreakdown.length?expenseBreakdown.map(c=>`<div class="item"><b>${esc(c.category)}</b> <span class="small muted">${money(c.total)}</span></div>`).join(''):'<div class="empty">No expenses logged yet.</div>'}
<div class="list" style="margin-top:8px">${recentExpenses.length?recentExpenses.map(t=>`<div class="item">−${money(t.amount)} ${t.category?`<span class="small muted">${esc(t.category)}</span>`:''}<div class="small muted">${t.date}${t.note?' · '+esc(t.note):''}</div></div>`).join(''):''}</div>
</div>

<h3 class="section">Spending trend (last 8 weeks)</h3>
<div class="card">${weeklyBars.some(w=>w.total>0)?sparklineSVG(weeklyBars.map(w=>w.total),{color:'#0b1220'})+`<div class="trend-caption small"><span>${weeklyBars[0].weekEnd}</span><span>${weeklyBars[weeklyBars.length-1].weekEnd}</span></div>`:'<div class="empty">Log a few weeks of expenses to see a trend.</div>'}</div>

<h3 class="section">Savings</h3>
<div class="card">
<div class="grid three"><div><div class="small">Tracked balance</div><div class="metric">${money(p.savings)}</div></div><div><div class="small">Goal</div><div class="metric">${money(p.savingsGoal)}</div></div><div><div class="small">Remaining</div><div class="metric">${money(Math.max(0,p.savingsGoal-p.savings))}</div></div></div>
<div class="small muted" style="margin-top:8px">Recent contributions:</div>
${recentSavings.length?recentSavings.map(t=>`<div class="item">+${money(t.amount)} ${t.category?`<span class="small muted">${esc(t.category)}</span>`:''}<div class="small muted">${t.date}${t.note?' · '+esc(t.note):''}</div></div>`).join(''):'<div class="empty">No savings contributions logged yet.</div>'}
</div>

<h3 class="section">Category budgets (optional)</h3>
<div class="card">
${Object.keys(S.moneyBudgets||{}).length?Object.entries(S.moneyBudgets).map(([cat,limit],i)=>{
  const spent=moneyCategoryBreakdown(thisMonthTx,'expense').find(c=>c.category===cat)?.total||0;
  const status=budgetStatus(spent,limit);
  const pillClass=status.level==='exceeded'?'pill-danger':(status.level==='warning'?'pill-warning':'pill-active');
  const statusText=status.level==='exceeded'?'Over budget':(status.level==='warning'?'Approaching limit':'On track');
  return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(cat)}</b><span class="pill ${pillClass}">${statusText}</span></div><div class="small muted">${money(status.spent)} of ${money(status.limit)} · ${Math.round(status.pctUsed)}%</div><div class="barbg" style="margin-top:6px"><div class="bar" style="width:${Math.min(100,status.pctUsed)}%"></div></div><button class="btn secondary" style="margin-top:6px" onclick="removeMoneyBudgetAt(${i})">Remove budget</button></div>`;
}).join(''):'<div class="empty">No category budgets set.</div>'}
<div class="grid two" style="margin-top:10px"><select id="budget_category" class="input">${MONEY_CATEGORIES.expense.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><input id="budget_amount" class="input" type="number" min="0.01" step="0.01" placeholder="Monthly limit (blank = remove)"></div>
<button class="btn secondary" style="margin-top:9px" onclick="setMoneyBudget()">Save budget</button>
<p class="small muted" style="margin-top:8px">Budgets are informational only — logging an expense is never blocked by a budget.</p>
</div>

<h3 class="section">Other financial goals</h3>
<div class="card">
${(S.moneyGoals||[]).length?S.moneyGoals.map(g=>{
  const gp=pct(g.current,g.target);
  return `<div class="item"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b><button class="btn secondary qty-btn" title="Remove" onclick="removeMoneyGoal('${g.id}')">×</button></div><div class="small muted">${money(g.current)} of ${money(g.target)}${g.deadline?` · by ${g.deadline}`:''}</div><div class="barbg" style="margin-top:6px"><div class="bar" style="width:${gp}%"></div></div><button class="btn secondary" style="margin-top:6px" onclick="contributeToGoal('${g.id}')">Add contribution</button></div>`;
}).join(''):'<div class="empty">No additional goals yet — your main savings goal above always applies.</div>'}
<div class="grid three" style="margin-top:10px"><input id="goal_name" class="input" placeholder="Goal name (e.g. Emergency fund)"><input id="goal_target" class="input" type="number" min="0.01" step="0.01" placeholder="Target amount"><input id="goal_deadline" class="input" type="date" placeholder="Deadline (optional)"></div>
<button class="btn" style="margin-top:9px" onclick="addMoneyGoal()">Create goal</button>
</div>

<h3 class="section">Transaction history</h3>
<div class="card">
<div class="row">${['all','income','expense','savings'].map(f=>`<button class="btn ${moneyHistoryFilter===f?'':'secondary'}" onclick="setMoneyHistoryFilter('${f}')">${f==='all'?'All':MONEY_TYPE_LABELS[f]}</button>`).join('')}</div>
<div class="list" style="margin-top:8px">${(S.money||[]).length?moneyHistoryRows():'<div class="empty">Start by logging your first income or expense.</div>'}</div>
</div>`;
};

