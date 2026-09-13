const views={};
// "today" stays the internal route key (go('today'), render('today'),
// views.today, the render() default) for stability — only the NAV LABEL and
// page title changed to "Home" for Phase 6. Renaming the key itself would touch
// far more call sites (task(), migrateState, etc.) for zero user-facing benefit.
//
// Phase 16 (Progress/Life navigation), refined in the mobile transformation
// pass: the primary tab bar went from 13 flat tabs to 6 (Home, Mentor, Explore,
// Progress, Life, Settings), and now to 5 (Settings moved to a small icon in
// the topbar — see index.html — since it's a secondary destination, not one of
// the app's core daily surfaces). Every ORIGINAL route key (today/body/
// training/nutrition/bjj/money/growth/social/explore/review/coach/mentor/
// settings) is UNCHANGED and still a real, directly renderable route reachable
// via location.hash — this has only ever been a navigation/presentation
// change, never a routing change, so every existing deep link, go('x') call,
// and bookmark keeps working exactly as before.
// "progress" and "life" are NEVER real routes (no views.progress/views.life,
// no such hash is ever written) — they're pure presentation groupings. Tapping
// one jumps straight to whichever real route in that group was last visited
// this session (or the group's first item on a fresh session), so
// location.hash always holds a genuine, bookmarkable route.
const PROGRESS_ROUTES=['body','training','nutrition','bjj','review','coach'];
const LIFE_ROUTES=['money','growth','social'];
const ROUTE_LABELS={today:'Home',body:'Body',training:'Training',nutrition:'Nutrition',bjj:'BJJ',money:'Money',growth:'Career',social:'Social',explore:'Explore',review:'Review',coach:'Coach',mentor:'Mentor',settings:'Settings'};
let lastProgressTab='body';
let lastLifeTab='money';
function routeGroup(v){if(PROGRESS_ROUTES.includes(v))return 'progress';if(LIFE_ROUTES.includes(v))return 'life';return v}
function goGroup(g){go(g==='progress'?lastProgressTab:lastLifeTab)}
// Small, self-contained line icons (no icon font/CDN — this is an offline-first
// PWA, so a network-dependent icon set would be a real reliability regression,
// not just a style choice) for the 5 primary destinations + the Settings
// button in the topbar. Deliberately simple geometry (lines/circles, no
// complex hand-authored bezier paths) so they render predictably everywhere.
const NAV_ICONS={
  today:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/></svg>',
  mentor:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H8l-4 4V4z"/></svg>',
  explore:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  progress:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="9"/><line x1="18" y1="20" x2="18" y2="4"/></svg>',
  life:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>',
  settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/></svg>'
};
// Settings moved OUT of the primary 5 (see index.html's topbar icon button) —
// it's a secondary destination, not one of the app's core daily surfaces.
function tabbar(v){
  const activeGroup=routeGroup(v);
  const primary=[
    ['today','Home',"go('today')"],
    ['mentor','Mentor',"go('mentor')"],
    ['explore','Explore',"go('explore')"],
    ['progress','Progress',"goGroup('progress')"],
    ['life','Life',"goGroup('life')"]
  ];
  return `<div class="tabs" role="tablist" aria-label="Primary">${primary.map(([key,label,onclick])=>`<button type="button" class="tab ${key===activeGroup?'active':''}" role="tab" aria-selected="${key===activeGroup}" onclick="${onclick}"><span class="tab-icon" aria-hidden="true">${NAV_ICONS[key]}</span><span class="tab-label">${label}</span></button>`).join('')}</div>`;
}
// Secondary section-switcher chip row — shown only while inside a Progress or
// Life sub-route, so it's always obvious where Body/Training/Nutrition/BJJ/
// Review/Coach (Progress) or Money/Career/Social (Life) actually live, and
// jumping between siblings never requires a trip back through the top tab.
function subtabbar(v){
  const group=routeGroup(v);
  const routes=group==='progress'?PROGRESS_ROUTES:(group==='life'?LIFE_ROUTES:null);
  if(!routes)return '';
  return `<div class="subtabs" role="tablist" aria-label="${group==='progress'?'Progress sections':'Life sections'}">${routes.map(x=>`<button type="button" class="subtab ${x===v?'active':''}" role="tab" aria-selected="${x===v}" onclick="go('${x}')">${ROUTE_LABELS[x]}</button>`).join('')}</div>`;
}
// Phase 8: wraps the primary tabs + (when present) the Progress/Life secondary
// chip row in one visually-connected "shelf" — see .nav-shelf in styles.css.
// Kept as its own function (rather than inlined in render()) so nothing else
// that might reference tabbar()/subtabbar() directly has to change.
function navShelf(v){ return `<div class="nav-shelf">${tabbar(v)}${subtabbar(v)}</div>`; }
function task(id,title,sub){return `<div class="task ${S.checks[id]?'done':''}"><input type="checkbox" ${S.checks[id]?'checked':''} onchange="check('${id}')"><div><b>${title}</b><div class="small">${sub}</div></div></div>`}
function go(v){location.hash=v;render(v)}
function check(id){S.checks[id]=!S.checks[id];save();render('today')}
let lastRenderedTab=null;
function render(v=location.hash.slice(1)||'today'){let titles={today:'Home',body:'Body',training:'Training',nutrition:'Nutrition',bjj:'BJJ',money:'Money',growth:'Career',social:'Social',explore:'Explore',review:'Weekly Review',coach:'AI Coach',mentor:'Mentor',settings:'Settings'};lastRenderedTab=v;if(PROGRESS_ROUTES.includes(v))lastProgressTab=v;else if(LIFE_ROUTES.includes(v))lastLifeTab=v;$('title').textContent=titles[v]||'Home';$('date').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});$('app').innerHTML=navShelf(v)+(views[v]?views[v]():views.today());}
// Accepts both the old ("adventure") and new ("explore") typed keyword so old
// muscle memory still works — both route to the same tab.
function quickAdd(){let x=prompt('Type: social, explore, career, review, bjj');if(x==='social')go('social');else if(x==='adventure'||x==='explore')go('explore');else if(x==='career')go('growth');else if(x==='review')go('review');else if(x==='bjj')go('bjj')}
