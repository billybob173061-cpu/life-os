// ---- Local-only pre-operation safety snapshot (Phase 13). Kept in its own
// localStorage key, never inside S, so it never round-trips through cloud sync or
// a JSON export/import — it exists purely so an import or reset on THIS device can
// be undone once from within the app.
const PRE_OP_SNAPSHOT_KEY='lifeos-pre-op-snapshot';
function savePreOpSnapshot(label){
  try{localStorage.setItem(PRE_OP_SNAPSHOT_KEY,JSON.stringify({label,at:new Date().toISOString(),state:S}))}catch(e){}
}
function getPreOpSnapshot(){
  try{return JSON.parse(localStorage.getItem(PRE_OP_SNAPSHOT_KEY)||'null')}catch(e){return null}
}
function restorePreOpSnapshot(){
  const snap=getPreOpSnapshot();
  if(!snap||!snap.state){toast('No previous snapshot to restore.');return}
  if(!confirm('Restore your local data from before the last import/reset? This replaces your current local data on this device.'))return;
  let migrated;
  try{migrated=migrateState(snap.state)}catch(e){toast('That snapshot could not be restored.');return}
  S=migrated;
  save();render('settings');
  toast('Previous local data restored.');
}

function setLocationModeFromSettings(mode){
  setLocationMode(mode);
  render('settings');
  toast(mode==='off'?'Location access turned off — using your saved city only.':mode==='whileUsing'?'Location will be requested only when Mentor/Explore need it.':'Live location enabled — your position updates while this is on.');
}

views.settings=()=>{
  let p=S.profile;
  // Fire-and-forget: cheap no-op if already known this session; only re-renders
  // Settings if the browser's answer actually changed. Never blocks the render.
  if(typeof refreshGeoPermissionStatus==='function') refreshGeoPermissionStatus();
  const pending=(typeof getPendingAccountChoice==='function')?getPendingAccountChoice():null;
  const preSnap=getPreOpSnapshot();

  const pendingPanel=pending?`<div class="card" style="margin-top:12px;border-color:#b91c1c">
    <h3>Existing data found for ${esc(pending.email)}</h3>
    <p class="muted">This device already has local data, and this account already has cloud data from before. Pick which one to keep — the other side will be overwritten for this account. This can't be undone automatically afterward, so export a backup first if you're unsure.</p>
    <div class="row" style="margin-top:10px"><button class="btn" onclick="resolveKeepLocal()">Keep local data (overwrite cloud)</button><button class="btn secondary" onclick="resolveUseCloud()">Use cloud data (overwrite local)</button></div>
  </div>`:'';

  const locMode=(typeof locationMode==='function')?locationMode():'off';
  const locPermLabel=(typeof locationPermissionStatusLabel==='function')?locationPermissionStatusLabel():'Unknown';
  const locationCard=`<div class="card" style="margin-top:12px"><h3>&#128205; Location</h3>
<p class="muted">Controls whether Mentor (and later Explore) can use your device's current location for nearby recommendations. Precise location is never permanently stored — only the saved city above is kept in your data. In "While using" or "Live" mode, your exact coordinates are used just-in-time for a request and held only in this browser tab's memory, never written to your saved profile or cloud sync.</p>
<div style="margin-top:10px">
<label class="row" style="align-items:flex-start;gap:8px;margin-bottom:8px"><input type="radio" name="loc_mode" value="off" ${locMode==='off'?'checked':''} onchange="setLocationModeFromSettings('off')" style="margin-top:3px"><span><b>Off</b><br><span class="small muted">Use my saved city only. Never asks for device location.</span></span></label>
<label class="row" style="align-items:flex-start;gap:8px;margin-bottom:8px"><input type="radio" name="loc_mode" value="whileUsing" ${locMode==='whileUsing'?'checked':''} onchange="setLocationModeFromSettings('whileUsing')" style="margin-top:3px"><span><b>While using Mentor / Explore</b><br><span class="small muted">Use my current location for nearby recommendations — asked for fresh each time it's actually needed, never tracked continuously.</span></span></label>
<label class="row" style="align-items:flex-start;gap:8px"><input type="radio" name="loc_mode" value="live" ${locMode==='live'?'checked':''} onchange="setLocationModeFromSettings('live')" style="margin-top:3px"><span><b>Live location</b><br><span class="small muted">Keep my current location updated while this is on. Stops automatically when turned off, on sign-out, or when the app doesn't need it.</span></span></label>
</div>
<div class="small muted" style="margin-top:10px">Location permission: <b>${esc(locPermLabel)}</b></div>
</div>`;

  const aiCfg=(typeof getAiConfig==='function')?getAiConfig():{enabled:false};

  // Progressive disclosure: Account/Preferences/Data are the sections almost
  // every visit touches, so they're always expanded. Location and AI are
  // one-time/occasional setup — collapsed by default UNLESS the user has
  // already turned them on, so an active setting is never hidden from them.
  const baselineCard=`<div class="card"><h3>Your baseline</h3><div class="grid two">${[['name','Name','text'],['city','Location','text'],['weight','Weight','number'],['bf','Body fat %','number'],['targetWeight','Target weight','number'],['targetBF','Target BF %','number'],['cal','Calories','number'],['protein','Protein','number'],['carbs','Carbs','number'],['fat','Fat','number'],['steps','Steps','number'],['income','Weekly income','number'],['savings','Savings','number'],['savingsGoal','Savings goal','number']].map(a=>`<label>${a[1]}<input id="p_${a[0]}" class="input" type="${a[2]}" value="${esc(p[a[0]])}"></label>`).join('')}</div><button class="btn" style="margin-top:12px" onclick="settings()">Save</button></div>`;
  const foodCard=`<div class="card" style="margin-top:12px"><h3>Food database</h3><p class="muted">USDA FoodData Central provides food search and a current branded-food database. Its API requires an API key; the demo key is included for testing but has low limits. For a serious/public version, use your own USDA key through a server-side proxy so the key is not exposed in the browser. This key is kept on this device only — it is never uploaded to cloud sync.</p><label>USDA API key<input id="usda_key" class="input" placeholder="Optional — DEMO_KEY works for testing" value="${esc(S.settings.usdaKey||'')}"></label><button class="btn" style="margin-top:8px" onclick="saveFoodSettings()">Save food settings</button></div>`;
  const dataCard=`<div class="card" style="margin-top:12px"><h3>Data &amp; Backup</h3><p class="muted">Your data lives on this device (and in your cloud account if signed in). Export a JSON backup occasionally even with cloud sync — it's the one copy fully under your control.</p><div class="row"><button class="btn" onclick="exportData()">Export backup</button><button class="btn secondary" onclick="importData()">Import backup</button><button class="btn danger" onclick="resetAll()">Erase local data</button></div>
${preSnap?`<div class="small muted" style="margin-top:10px">A recovery snapshot from ${esc(relativeTimeLabel(preSnap.at))} (before ${esc((preSnap.label||'').replace('before-',''))}) is available on this device.</div><button class="btn secondary" style="margin-top:6px" onclick="restorePreOpSnapshot()">Restore that snapshot</button>`:''}
</div>`;

  return `<div class="section-major">Account</div>
${renderAccountCard()}
${pendingPanel}
<div class="section-major">Preferences</div>
${baselineCard}
${foodCard}
<details class="settings-group" ${locMode!=='off'?'open':''}><summary class="section-major">Location</summary>${locationCard}</details>
<details class="settings-group" ${aiCfg.enabled?'open':''}><summary class="section-major">AI</summary>${renderRealAiMentorSettingsCard()}</details>
<div class="section-major">Data &amp; Backup</div>
${dataCard}
${renderAdvancedCloudCard()}`;
};

function settings(){let p=S.profile;['name','city','weight','bf','targetWeight','targetBF','cal','protein','carbs','fat','steps','income','savings','savingsGoal'].forEach(k=>{let e=$('p_'+k);if(e)p[k]=e.type==='text'?e.value:+e.value});save();render('settings');toast('Settings saved')}

function exportData(){
  let a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}));
  a.download='life-os-backup.json';
  a.click();
}

function importData(){
  let i=document.createElement('input');i.type='file';i.accept='.json';
  i.onchange=()=>{
    const file=i.files&&i.files[0];
    if(!file)return;
    let r=new FileReader();
    r.onerror=()=>toast('This backup file could not be read.');
    r.onload=()=>{
      let parsed;
      try{parsed=JSON.parse(r.result)}
      catch(e){toast('This backup file could not be read.');return}
      if(!looksLikeLifeOsState(parsed)){toast('This backup is missing required data and was not imported.');return}
      const cloudNote=(SB&&CLOUD.user)?' If cloud sync is on, this will also update your cloud copy shortly after.':'';
      if(!confirm('Import this backup? This will replace your current local data on this device. A recovery snapshot of your current data will be kept.'+cloudNote))return;
      savePreOpSnapshot('before-import');
      let migrated;
      try{migrated=migrateState(parsed)}
      catch(e){toast('This backup could not be migrated and was not imported.');return}
      S=migrated;
      save();render('settings');
      toast('Backup imported. Your previous local data was saved as a recovery snapshot.');
    };
    r.readAsText(file);
  };
  i.click();
}

function resetAll(){
  const cloudConnected=!!(SB&&CLOUD.user);
  const warning=cloudConnected
    ? "Erase ALL local Life OS data on this device? This does NOT delete your cloud data — your cloud copy stays as it was at your last successful sync. Local data will differ from the cloud afterward until you sync again."
    : "Erase ALL local Life OS data on this device? A recovery snapshot will be kept on this device.";
  if(!confirm(warning))return;
  if(cloudConnected&&!confirm('Second confirmation: your LOCAL data on this device will be erased now. Continue?'))return;
  savePreOpSnapshot('before-reset');
  S=migrateState(structuredClone(D));
  // Intentionally bypasses save()/scheduleSync(): a reset must never silently push
  // an empty state to the cloud. Cloud data only changes from an explicit sync.
  localStorage.setItem(KEY,JSON.stringify(S));
  go('today');
  toast(cloudConnected?'Local data erased. Cloud data was not changed.':'Local data erased.');
}

function saveFoodSettings(){S.settings.usdaKey=$('usda_key').value.trim();save();toast('Food settings saved')}
