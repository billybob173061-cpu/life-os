// Plain-language check-in reminder derived from the last logged entry and the
// user's own cadence preference. Purely informational — no notifications/permissions;
// see the "check-in reminder" note in the Save summary for why that's out of scope here.
function checkInReminderText(){
  const cadence=S.profile.checkInCadenceDays||7;
  const last=S.weightLog[S.weightLog.length-1];
  if(!last) return `No check-ins yet. Aim for one every ${cadence} day${cadence===1?'':'s'}.`;
  const label=daysAgoLabel(last.date);
  const daysSince=label==='today'?0:label==='yesterday'?1:(parseInt(label,10)||0);
  if(daysSince>=cadence) return `Last check-in was ${label} — you're due for another (every ${cadence} day${cadence===1?'':'s'}).`;
  const dueIn=cadence-daysSince;
  return `Last check-in was ${label}. Next one suggested in ${dueIn} day${dueIn===1?'':'s'}.`;
}
function setCheckInCadence(){
  const n=Math.max(1,Math.min(30,Math.round(ensureNumber($('checkin_cadence').value,7))));
  S.profile.checkInCadenceDays=n;
  save();render('body');toast('Check-in reminder updated');
}
// Exposed for a future Today integration (Phase 3 explicitly does not wire this into
// the Today view — see the "Today integration" note in the Save summary).
function bodyProgressInsight(){
  const p=S.profile;
  const goal=weightGoalStats(S.weightLog,p.weight,p.targetWeight);
  const trend=weightRateOfChange(S.weightLog,today());
  const pctText=`${Math.round(goal.pct)}% toward your weight goal.`;
  return trend?`${describeWeightTrend(trend.ratePerWeek,goal.start,goal.target)} ${pctText}`:pctText;
}

views.body=()=>{
  let p=S.profile;
  const log=S.weightLog;
  const goal=weightGoalStats(log,p.weight,p.targetWeight);
  const trend=weightRateOfChange(log,today());
  const trendText=trend?describeWeightTrend(trend.ratePerWeek,goal.start,goal.target):null;
  const avg7=rollingAverage(log,7,today());
  const weightChart=sparklineSVG(log.map(x=>ensureNumber(x.weight)),{color:'#0b1220'});
  // Bug fix: only chart entries with a real bf value — ensureNumber(...,0) on a
  // missing/legacy entry would have plotted a fabricated 0% dip instead of simply
  // omitting that point.
  const bfEntries=log.filter(x=>Number.isFinite(ensureNumber(x.bf,NaN)));
  const bfChart=bfEntries.length?sparklineSVG(bfEntries.map(x=>ensureNumber(x.bf)),{color:'#64748b',height:64}):'';
  const remainingAbs=Math.abs(goal.remaining).toFixed(1);
  const remainingWord=goal.remaining>0?'to gain':goal.remaining<0?'to lose':'— at target';
  const recentLog=log.slice(-12);
  const startIdx=log.length-recentLog.length;
  const rows=recentLog.map((x,i)=>{
    const prevEntry=log[startIdx+i-1];
    const delta=prevEntry?(ensureNumber(x.weight)-ensureNumber(prevEntry.weight)):null;
    return {...x,delta,idx:startIdx+i};
  }).reverse();
  const cadence=p.checkInCadenceDays||7;

  return `<p class="page-intro">${esc(bodyProgressInsight())}</p>
<div class="grid four"><div class="card"><div class="small">Weight</div><div class="metric">${p.weight} lb</div></div><div class="card"><div class="small">BF estimate</div><div class="metric">${p.bf}%</div></div><div class="card"><div class="small">Target</div><div class="metric">${p.targetWeight} lb</div></div><div class="card"><div class="small">Target BF</div><div class="metric">${p.targetBF}%</div></div></div>

<h3 class="section">Goal progress</h3>
<div class="card">
<div class="row" style="justify-content:space-between">
<div><div class="small">Start</div><div class="metric">${goal.start} lb</div></div>
<div><div class="small">Current</div><div class="metric">${goal.current} lb</div></div>
<div><div class="small">Target</div><div class="metric">${goal.target} lb</div></div>
</div>
<div class="barbg" style="margin-top:10px"><div class="bar" style="width:${goal.pct}%"></div></div>
<div class="small" style="margin-top:6px">${Math.round(goal.pct)}% toward target · ${remainingAbs} lb ${remainingWord}</div>
</div>

<h3 class="section">Weight trend</h3>
<div class="card">${weightChart?`${weightChart}<div class="trend-caption small"><span>${log[0].date}</span><span>${log[log.length-1].date}</span></div>`:'<div class="empty">Log check-ins to see your weight trend.</div>'}</div>

<h3 class="section">Body-fat trend</h3>
<div class="card">
<p class="small muted" style="margin:0 0 8px">Body fat % is an estimate based on your own input method, not a lab measurement — track the direction, not the exact number.</p>
${bfChart?`${bfChart}<div class="trend-caption small"><span>${bfEntries[0].bf}% (estimate)</span><span>${bfEntries[bfEntries.length-1].bf}% (estimate)</span></div>`:'<div class="empty">Log check-ins to see your body-fat trend.</div>'}
</div>

<h3 class="section">Trend analysis</h3>
<div class="grid two">
<div class="card"><div class="small">7-day average</div>${avg7?`<div class="metric">${avg7.avg.toFixed(1)} lb</div><div class="small">from ${avg7.count} check-in${avg7.count===1?'':'s'} this week</div>`:'<div class="empty">Not enough recent check-ins yet. Log a few to see a 7-day average.</div>'}</div>
<div class="card"><div class="small">Rate of change</div>${trendText?`<p style="margin:6px 0 0">${trendText}</p>`:'<div class="empty">Log check-ins across at least two weeks to see a trend rate.</div>'}</div>
</div>

<h3 class="section">Check-in reminder</h3>
<div class="card">
<p class="small" style="margin:0 0 8px">${checkInReminderText()}</p>
<div class="row" style="align-items:center"><label class="small" style="display:flex;align-items:center;gap:8px">Remind me every<input id="checkin_cadence" class="input" style="max-width:80px" type="number" min="1" max="30" value="${cadence}">days</label><button class="btn secondary" onclick="setCheckInCadence()">Save</button></div>
</div>

<h3 class="section">Check in</h3>
<div class="card">
<div class="row">
<label class="small" style="flex:1;min-width:140px">Weight (lb)<input id="wv" class="input" type="number" step=".1" inputmode="decimal" value="${p.weight}"></label>
<label class="small" style="flex:1;min-width:140px">Body fat % (estimate)<input id="bfv" class="input" type="number" step=".1" inputmode="decimal" value="${p.bf}"></label>
</div>
<button class="btn" style="margin-top:10px" onclick="addWeight()">Log check-in</button>
</div>

<h3 class="section">Check-in history</h3>
<div class="card">${rows.length?rows.map(x=>`<div class="item"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${x.weight} lb</b>${Number.isFinite(x.bf)?` · ${x.bf}%`:''} <span class="small">${x.date} · ${daysAgoLabel(x.date)}${x.delta!==null?` · ${x.delta>0?'+':''}${x.delta.toFixed(1)} lb vs previous`:''}</span></div><button class="btn secondary qty-btn" title="Delete" onclick="deleteWeightEntry(${x.idx})">×</button></div></div>`).join(''):'<div class="empty">Weekly check-ins will build your trend.</div>'}</div>

${renderBodyPhotosSection()}`;
};

function renderBodyPhotosSection(){
  const photos=(S.bodyPhotos||[]).slice().sort((a,b)=>a.date<b.date?1:-1);
  const posePhotos=(pose)=>photos.filter(p=>p.pose===pose);
  const comparePhotos=(S.bodyPhotos||[]).filter(p=>p.pose===bodyComparePose).slice().sort((a,b)=>a.date<b.date?1:-1);
  const leftPhoto=comparePhotos.find(p=>p.id===bodyCompareLeftId);
  const rightPhoto=comparePhotos.find(p=>p.id===bodyCompareRightId);
  const storageOk=bodyPhotoStorageAvailable();
  return `
<h3 class="section">Progression photos</h3>
<div class="card">
${storageOk?'':'<p class="small" style="margin:0 0 8px">This browser doesn\'t support local photo storage (IndexedDB), so photo tracking is unavailable here.</p>'}
<p class="small muted" style="margin:0 0 8px">Photos stay on this device only — they are never uploaded automatically, and they are NOT included in your JSON export/backup (only the date/pose/weight/notes are). See the note below before relying on this for long-term backup.</p>
<div class="row"><input id="body_photo_file" class="input" type="file" accept="image/*" ${storageOk?'':'disabled'}></div>
<div class="row" style="margin-top:8px">${['front','side','back'].map(p=>`<button class="btn ${bodyPhotoUploadPose===p?'':'secondary'}" onclick="setBodyPhotoUploadPose('${p}')">${p[0].toUpperCase()+p.slice(1)}</button>`).join('')}</div>
<div class="grid two" style="margin-top:8px"><input id="photo_weight" class="input" type="number" step=".1" inputmode="decimal" placeholder="Weight (optional)"><input id="photo_bf" class="input" type="number" step=".1" inputmode="decimal" placeholder="Body fat % (optional)"></div>
<input id="photo_notes" class="input" style="margin-top:8px" placeholder="Notes (optional)">
<button class="btn" style="margin-top:9px" onclick="uploadBodyPhoto()" ${storageOk?'':'disabled'}>Save photo</button>
</div>

${photos.length?`<div class="card" style="margin-top:10px"><button class="btn secondary" onclick="exportAllBodyPhotos()">Export all photos (downloads each individually)</button></div>`:''}
${['front','side','back'].map(pose=>{
  const list=posePhotos(pose);
  return `<div class="card" style="margin-top:10px"><h4 style="margin:0 0 8px">${pose[0].toUpperCase()+pose.slice(1)}</h4>${list.length?`<div class="grid two">${list.map(renderBodyPhotoCard).join('')}</div>`:'<div class="empty">No front/side/back photos logged yet for this pose.</div>'}</div>`;
}).join('')}

<h3 class="section">Compare photos</h3>
<div class="card">
<div class="row">${['front','side','back'].map(p=>`<button class="btn ${bodyComparePose===p?'':'secondary'}" onclick="setBodyComparePose('${p}')">${p[0].toUpperCase()+p.slice(1)}</button>`).join('')}</div>
${comparePhotos.length>=1?`<div class="grid two" style="margin-top:8px">
<select class="input" onchange="setBodyCompareLeft(this.value)"><option value="">Earlier date…</option>${comparePhotos.map(p=>`<option value="${p.id}" ${bodyCompareLeftId===p.id?'selected':''}>${esc(p.date)}</option>`).join('')}</select>
<select class="input" onchange="setBodyCompareRight(this.value)"><option value="">Later date…</option>${comparePhotos.map(p=>`<option value="${p.id}" ${bodyCompareRightId===p.id?'selected':''}>${esc(p.date)}</option>`).join('')}</select>
</div>
${(leftPhoto&&rightPhoto)?`<div class="grid two" style="margin-top:8px">${renderBodyPhotoCard(leftPhoto)}${renderBodyPhotoCard(rightPhoto)}</div>
<p class="small muted" style="margin-top:8px">Visual comparison only — the app can't objectively measure muscle or fat change from a photo. Use your weight/body-fat trend above for the numbers.</p>`:'<p class="small muted" style="margin-top:8px">Pick two dates to compare side by side.</p>'}`:'<div class="empty" style="margin-top:8px">Log at least one photo in this pose to compare.</div>'}
</div>`;
}

function addWeight(){
  const w=ensureNumber($('wv').value,NaN);
  const bfRaw=$('bfv').value;
  const bfProvided=bfRaw!==''&&bfRaw!==null&&bfRaw!==undefined;
  const b=bfProvided?ensureNumber(bfRaw,NaN):NaN;
  if(!Number.isFinite(w)||w<=0||w>1000){toast('Enter a realistic weight (1–1000 lb)');return}
  if(bfProvided&&(!Number.isFinite(b)||b<0||b>80)){toast('Body fat % should be between 0 and 80');return}
  S.profile.weight=w;
  if(bfProvided&&Number.isFinite(b))S.profile.bf=b;
  // C6 fix: a second check-in on the same day updates today's own entry in place
  // rather than adding a second row for the same date — otherwise the 7-day rolling
  // average (utils.js rollingAverage) double-weights that one day relative to every
  // other day in the window, silently skewing the trend/rate-of-change shown here.
  // This only ever consolidates multiple check-ins YOU made today into one — it
  // never touches or merges any other day's history.
  const todayStr=today();
  const existingIdx=S.weightLog.findIndex(e=>e.date===todayStr);
  // D4 fix: a check-in that didn't include a body-fat reading never fabricates one —
  // it no longer copies S.profile.bf as if it were re-measured just now. If today
  // already has a real bf value from an earlier check-in this same day, that's kept
  // (not nulled out just because this particular call didn't re-supply it).
  const bfForEntry=bfProvided?S.profile.bf:(existingIdx>=0?S.weightLog[existingIdx].bf:null);
  if(existingIdx>=0){
    S.weightLog[existingIdx]={date:todayStr,weight:w,bf:bfForEntry};
  }else{
    S.weightLog.push({date:todayStr,weight:w,bf:bfForEntry});
  }
  save();render('body');toast(existingIdx>=0?'Check-in updated for today':'Check-in saved');
}
function deleteWeightEntry(idx){
  const entry=S.weightLog[idx];
  if(!entry)return;
  if(!confirm(`Delete the ${entry.weight} lb check-in from ${entry.date}?`))return;
  S.weightLog.splice(idx,1);
  save();render('body');toast('Check-in deleted');
}

// ---- Body progression photos (v1.1) ----
// Only metadata (date/pose/weight/bf/notes) lives in S/localStorage/cloud sync/JSON
// export. The actual image is kept in IndexedDB, entirely on this device — it is
// never uploaded anywhere automatically and is NOT included in a JSON backup (see
// exportPhotosNotice below). This keeps localStorage/Supabase payloads small and
// keeps photos private by default.
const BODY_PHOTO_DB_NAME='lifeos-body-photos';
const BODY_PHOTO_STORE='photos';
let bodyPhotoDb=null;
function bodyPhotoStorageAvailable(){ return typeof indexedDB!=='undefined'&&!!indexedDB; }
function openBodyPhotoDb(){
  return new Promise((resolve,reject)=>{
    if(bodyPhotoDb){resolve(bodyPhotoDb);return}
    if(!bodyPhotoStorageAvailable()){reject(new Error('IndexedDB is not available in this browser'));return}
    let req;
    try{ req=indexedDB.open(BODY_PHOTO_DB_NAME,1); }catch(e){reject(e);return}
    req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(BODY_PHOTO_STORE)) req.result.createObjectStore(BODY_PHOTO_STORE,{keyPath:'id'}); };
    req.onsuccess=()=>{ bodyPhotoDb=req.result; resolve(bodyPhotoDb); };
    req.onerror=()=>reject(req.error||new Error('Could not open photo storage'));
  });
}
async function saveBodyPhotoBlob(id,blob){
  const db=await openBodyPhotoDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BODY_PHOTO_STORE,'readwrite');
    tx.objectStore(BODY_PHOTO_STORE).put({id,blob});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function loadBodyPhotoBlob(id){
  const db=await openBodyPhotoDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BODY_PHOTO_STORE,'readonly');
    const req=tx.objectStore(BODY_PHOTO_STORE).get(id);
    req.onsuccess=()=>resolve(req.result?req.result.blob:null);
    req.onerror=()=>reject(req.error);
  });
}
async function deleteBodyPhotoBlob(id){
  const db=await openBodyPhotoDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(BODY_PHOTO_STORE,'readwrite');
    tx.objectStore(BODY_PHOTO_STORE).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
// Object-URL cache for already-loaded photo blobs, keyed by photo id — loading is
// async (IndexedDB) but render() is synchronous, so a not-yet-loaded photo renders a
// placeholder and triggers a background load that re-renders once it resolves.
let bodyPhotoUrlCache={};
let bodyPhotoLoadFailed={};
function bodyPhotoUrlFor(id){
  if(id in bodyPhotoUrlCache) return bodyPhotoUrlCache[id];
  if(!bodyPhotoLoadFailed[id]){
    loadBodyPhotoBlob(id).then(blob=>{
      bodyPhotoUrlCache[id]=blob?URL.createObjectURL(blob):null;
      render('body');
    }).catch(()=>{ bodyPhotoLoadFailed[id]=true; render('body'); });
  }
  return undefined;
}
let bodyPhotoUploadPose='front';
function setBodyPhotoUploadPose(p){bodyPhotoUploadPose=p;render('body');}
async function uploadBodyPhoto(){
  const fileInput=$('body_photo_file');
  const file=fileInput&&fileInput.files&&fileInput.files[0];
  if(!file){toast('Choose a photo first');return}
  if(!bodyPhotoStorageAvailable()){toast("This browser doesn't support local photo storage (IndexedDB) — photo tracking isn't available here.");return}
  const weightRaw=($('photo_weight')?.value||'').trim();
  const bfRaw=($('photo_bf')?.value||'').trim();
  const notes=($('photo_notes')?.value||'').trim();
  const weight=weightRaw===''?null:ensureNumber(weightRaw,NaN);
  const bf=bfRaw===''?null:ensureNumber(bfRaw,NaN);
  if(weight!==null&&(!Number.isFinite(weight)||weight<=0||weight>1000)){toast('Weight should be a realistic number (1–1000 lb), or left blank');return}
  if(bf!==null&&(!Number.isFinite(bf)||bf<0||bf>80)){toast('Body fat % should be between 0 and 80, or left blank');return}
  const id=uid('photo');
  try{
    await saveBodyPhotoBlob(id,file);
  }catch(e){
    toast('Could not save this photo to local storage. It was not logged.');
    return;
  }
  S.bodyPhotos.push({id,date:today(),pose:bodyPhotoUploadPose,weight,bf,notes,photoKey:id});
  save();render('body');toast('Photo saved');
}
async function deleteBodyPhoto(id){
  if(!confirm('Delete this progress photo? This cannot be undone.'))return;
  S.bodyPhotos=(S.bodyPhotos||[]).filter(x=>x.id!==id);
  save();
  try{ await deleteBodyPhotoBlob(id); }catch(e){ /* metadata is already gone; the orphaned blob is harmless */ }
  delete bodyPhotoUrlCache[id];
  render('body');toast('Photo deleted');
}
// Photos are never part of the JSON export (see the note rendered in the photos
// section) — this is the documented alternative: download each photo individually.
// Browsers may throttle many rapid downloads; this is a known limitation of staying
// dependency-free (no zip library) rather than a bug.
async function exportAllBodyPhotos(){
  const photos=S.bodyPhotos||[];
  if(!photos.length){toast('No photos to export');return}
  if(!bodyPhotoStorageAvailable()){toast('Photo storage is not available in this browser');return}
  toast('Downloading photos — check your downloads folder');
  for(const p of photos){
    try{
      const blob=await loadBodyPhotoBlob(p.id);
      if(!blob) continue;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=`life-os-photo-${p.date}-${p.pose}-${p.id}.jpg`;
      a.click();
    }catch(e){ /* skip this one, continue with the rest */ }
  }
}
let bodyComparePose='front';
let bodyCompareLeftId='', bodyCompareRightId='';
function setBodyComparePose(p){bodyComparePose=p;bodyCompareLeftId='';bodyCompareRightId='';render('body');}
function setBodyCompareLeft(id){bodyCompareLeftId=id;render('body');}
function setBodyCompareRight(id){bodyCompareRightId=id;render('body');}
function renderBodyPhotoThumb(photo){
  const url=bodyPhotoUrlFor(photo.id);
  if(url===undefined) return '<div class="empty" style="padding:20px">Loading…</div>';
  if(url===null) return '<div class="empty" style="padding:20px">Photo unavailable</div>';
  return `<img src="${url}" style="width:100%;border-radius:var(--radius-sm);display:block" alt="Progress photo">`;
}
function renderBodyPhotoCard(photo){
  return `<div class="card" style="margin-top:8px">
${renderBodyPhotoThumb(photo)}
<div class="small muted" style="margin-top:6px">${esc(photo.date)} · ${esc(photo.pose)}${photo.weight!==null?` · ${esc(photo.weight)} lb`:''}${photo.bf!==null?` · ${esc(photo.bf)}% est. BF`:''}</div>
${photo.notes?`<div class="small muted">${esc(photo.notes)}</div>`:''}
<button class="btn secondary qty-btn" title="Delete" style="margin-top:6px" onclick="deleteBodyPhoto('${photo.id}')">×</button>
</div>`;
}
