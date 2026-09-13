// This is a PRIVATE, single-user app that only ever points at one known
// Supabase project — same reasoning as PRODUCTION_MENTOR_ENDPOINT in
// mentor.js. The project URL is not a secret (Row Level Security is what
// actually protects your data, not obscurity of the URL — see README), so
// defaulting to it here means a normal user never has to know or type it. A
// saved localStorage value always wins over this default and is never
// touched/overwritten by it — this is a pure in-memory fallback for whatever
// wasn't already saved, exactly like loadAiConfig()'s endpointUrl default.
const PRODUCTION_SUPABASE_URL='https://ubmntbusoooucbdkeqzp.supabase.co';
const CLOUD_KEY='lifeos-cloud-config';
function loadCloudConfig(){
  let raw=null;
  try{ raw=JSON.parse(localStorage.getItem(CLOUD_KEY)||'null'); }catch(e){ raw=null; }
  const saved=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
  const url=(typeof saved.url==='string'&&saved.url.trim())?saved.url:PRODUCTION_SUPABASE_URL;
  return {url,anon:saved.anon||'',email:saved.email||'',client:null,user:null};
}
let CLOUD=loadCloudConfig();
let SB=null;
// Guards the setInterval/visibilitychange/online registrations below so
// re-running initCloud() (e.g. after saveAdvancedCloudConfig() reconnects to a
// different project) never stacks up additional duplicate timers/listeners —
// each prior extra set meant compounding duplicate autoSync() network calls
// and re-renders for the rest of the session.
let cloudBackgroundTasksStarted=false;

// ---- Auth state machine (ChatGPT-style persistent sign-in) ----
// One canonical source of truth for "is the user signed in," instead of the old
// scattered `SB && CLOUD.user` checks sprinkled across sync.js/settings.js/
// mentor.js. LOADING is the crucial addition: the app now sits in LOADING (and
// renders a neutral "Restoring session…" placeholder, never a flash of the
// signed-out UI) for the brief window while a previously-saved session is being
// restored on startup — see main.js. A real device/network/Supabase call is
// never trusted to have "signed the user out" unless Supabase itself reports a
// genuine SIGNED_OUT event; a temporarily-unreachable network or a failed
// background refresh leaves the existing session in place and is treated as
// AUTH_ERROR (recoverable), never AUTH_SIGNED_OUT.
const AUTH_STATE={LOADING:'loading',SIGNED_OUT:'signed_out',SIGNING_IN:'signing_in',SIGNED_IN:'signed_in',REFRESHING:'refreshing',ERROR:'error'};
let authState=AUTH_STATE.LOADING;
let authError=null; // last friendly auth-related error, cleared on any successful transition
function getAuthState(){ return authState; }
function getAuthError(){ return authError; }
function setAuthState(next,err){ authState=next; authError=err||null; }

// ---- Local-only sync metadata (Phase 13). Deliberately kept OUT of S so it never
// round-trips through Supabase's JSONB blob or a JSON export/import — it only
// describes this device's relationship to the cloud, never user data.
const SYNC_META_KEY='lifeos-sync-meta';
function defaultSyncMeta(){return {lastSuccessfulSyncAt:null,lastSyncAttemptAt:null,lastSyncError:null,dirty:false,localAccountId:null};}
function loadSyncMeta(){
  let raw=null;
  try{raw=JSON.parse(localStorage.getItem(SYNC_META_KEY)||'null')}catch(e){raw=null}
  return {...defaultSyncMeta(),...((raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{})};
}
let SYNC_META=loadSyncMeta();
function saveSyncMeta(){try{localStorage.setItem(SYNC_META_KEY,JSON.stringify(SYNC_META))}catch(e){}}
function setSyncMeta(patch){SYNC_META={...SYNC_META,...patch};saveSyncMeta();}
function getSyncMeta(){return {...SYNC_META};}

// Ephemeral (never persisted) — set only while a genuine account-switch choice is
// pending, so Settings can render an explicit "keep local / use cloud" panel.
let pendingAccountChoice=null;
function getPendingAccountChoice(){return pendingAccountChoice;}

// A cloud state payload must look like a real Life OS state object, not e.g. a
// string/number/array/empty object — protects local data from ever being replaced
// by a malformed or unrelated cloud value.
function looksLikeLifeOsState(x){
  return !!x&&typeof x==='object'&&!Array.isArray(x)&&('profile' in x||'schemaVersion' in x||'weightLog' in x||'checks' in x);
}
// Treats a state as "meaningful" if the user has actually logged something,
// anywhere — used only to decide whether an account transition needs an explicit
// choice, never to judge or display anything to the user.
function hasMeaningfulLocalData(s){
  if(!s||typeof s!=='object') return false;
  const arrays=[s.weightLog,s.workouts,s.bjj,s.meals,s.money,s.career,s.social,s.adventures,s.reviews,s.weeklyReviewSnapshots,s.coach&&s.coach.plans];
  if(arrays.some(a=>Array.isArray(a)&&a.length>0)) return true;
  if(s.checks&&Object.values(s.checks).some(Boolean)) return true;
  return false;
}
// Best-effort timeout wrapper for any promise (including Supabase client calls) —
// never aborts the underlying request, just stops it from wedging the sync lock
// forever if the network hangs.
function withTimeout(promise,ms,label){
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error((label||'Request')+' timed out')),ms))
  ]);
}
// Maps whatever Supabase/network threw into one honest, non-technical sentence.
// Never exposes a raw stack trace or error object to the user.
function friendlySyncError(e){
  const msg=String((e&&e.message)||e||'');
  if(typeof navigator!=='undefined'&&navigator.onLine===false) return "You're offline. Your local data is safe; cloud sync will retry when you're connected.";
  if(/timed out/i.test(msg)) return 'Cloud sync timed out. Your local changes were kept and sync will retry.';
  if(/jwt|session|401|not authenticated|invalid.*token/i.test(msg)) return 'Your session expired. Sign in again to resume cloud sync.';
  if(/network|fetch|failed to fetch/i.test(msg)) return 'Cloud sync failed due to a network problem. Your local changes were kept.';
  return 'Cloud sync failed. Your local changes were kept.';
}

// Now async and AWAITED by main.js before the very first render() — this is what
// eliminates the old "briefly shows signed-out, then flips to signed-in a moment
// later" flicker. If there's no saved project URL/anon key at all, there's
// nothing to restore and this resolves immediately (no artificial delay for a
// fresh device or a Local-Mode-only user who never configured cloud sync).
async function initCloud(){
  if(!(CLOUD.url && CLOUD.anon && window.supabase)){
    setAuthState(AUTH_STATE.SIGNED_OUT);
    return;
  }
  try{
    SB=window.supabase.createClient(CLOUD.url.replace(/\/$/,''),CLOUD.anon,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data,error}=await withTimeout(SB.auth.getSession(),15000,'Restore session');
    if(error) throw error;
    CLOUD.user=data.session?.user||null;
    if(CLOUD.user){
      setAuthState(AUTH_STATE.SIGNED_IN);
      try{await resolveAccountTransition(CLOUD.user)}catch(e){console.warn(e)}
    } else {
      setAuthState(AUTH_STATE.SIGNED_OUT);
    }
    attachAuthListener();
    startCloudBackgroundTasks();
  }catch(e){
    // A restore failure here is very likely transient (offline on startup, a
    // slow/unreachable Supabase project) — the persisted session itself is still
    // sitting in localStorage untouched, and supabase-js will keep trying to use
    // it. Never treat this as "sign the user out"; surface it as a recoverable
    // error and let normal use (going online, a later request) resolve it.
    setAuthState(AUTH_STATE.ERROR,friendlySyncError(e));
    // SB may already be a valid client even though getSession's own network call
    // failed — keep it so autoSync/onAuthStateChange can still recover the
    // session later rather than being permanently stuck with SB=null.
    if(!SB){ setAuthState(AUTH_STATE.SIGNED_OUT); }
    else { attachAuthListener(); startCloudBackgroundTasks(); }
  }
}
let authListenerAttached=false;
function attachAuthListener(){
  if(authListenerAttached||!SB) return;
  authListenerAttached=true;
  // Event-aware on purpose: a falsy/undefined session on some OTHER event (there
  // isn't really one in supabase-js v2 for a transient failure — a failed
  // background refresh simply doesn't fire an event at all, it keeps the
  // existing session) must never be treated as equivalent to a genuine
  // SIGNED_OUT. Only SIGNED_OUT actually clears the authenticated user.
  SB.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){
      CLOUD.user=null;
      pendingAccountChoice=null;
      setAuthState(AUTH_STATE.SIGNED_OUT);
      render(location.hash.slice(1)||'settings');
      return;
    }
    if(session?.user){
      CLOUD.user=session.user;
      setAuthState(AUTH_STATE.SIGNED_IN);
      // TOKEN_REFRESHED fires silently and often — re-rendering on every one of
      // those would be pointless churn (and mid-typing jank). SIGNED_IN (a fresh
      // sign-in, including a detectSessionInUrl magic-link/OAuth completion this
      // app doesn't currently expose but might later) and USER_UPDATED are the
      // cases where the UI actually needs to reflect something new.
      if(event==='SIGNED_IN'||event==='USER_UPDATED') render(location.hash.slice(1)||'settings');
    }
  });
}
function startCloudBackgroundTasks(){
  if(cloudBackgroundTasksStarted) return;
  cloudBackgroundTasksStarted=true;
  setInterval(()=>autoSync(),15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoSync()});
  // Coming back online after an outage is exactly when a stuck AUTH_ERROR should
  // clear itself — try to restore/refresh the session, not just re-sync data.
  window.addEventListener('online',()=>{ recoverSessionIfNeeded(); autoSync(); });
}
// Called when connectivity returns (or anything else warrants a retry) while the
// app still believes a session SHOULD exist but is sitting in AUTH_ERROR from a
// prior failed restore/refresh — never called for a genuine signed-out state.
async function recoverSessionIfNeeded(){
  if(!SB||authState!==AUTH_STATE.ERROR) return;
  try{
    const {data,error}=await SB.auth.getSession();
    if(error) throw error;
    if(data.session?.user){
      CLOUD.user=data.session.user;
      setAuthState(AUTH_STATE.SIGNED_IN);
      render(location.hash.slice(1)||'settings');
    }
  }catch(e){ /* still offline/unreachable — stay in ERROR, try again next signal */ }
}

let syncTimer=null, syncBusy=false, syncPending=false, lastCloudUpdated=0;

// Single shared lock across push/pull/autoSync so overlapping calls (a debounced
// save, the 15s poll, a visibility/online event, and a manual "Sync now") can never
// run concurrently or pile up into a request storm.
async function withSyncLock(fn){
  if(syncBusy) return;
  syncBusy=true;
  try{ return await fn(); }
  finally{ syncBusy=false; }
}

async function syncPush(){
  if(!SB||!CLOUD.user) return;
  syncPending=false;
  setSyncMeta({lastSyncAttemptAt:new Date().toISOString()});
  // usdaKey is intentionally local-only — never uploaded to Supabase, per Phase 13.
  const payload={user_id:CLOUD.user.id,state:{...S,settings:{...S.settings,usdaKey:undefined}},updated_at:new Date().toISOString()};
  try{
    const {error}=await withTimeout(SB.from('life_os_state').upsert(payload,{onConflict:'user_id'}),15000,'Cloud save');
    if(error) throw error;
    lastCloudUpdated=Date.now();
    setSyncMeta({lastSuccessfulSyncAt:new Date().toISOString(),lastSyncError:null,dirty:false,localAccountId:CLOUD.user.id});
    snapshotBackup();
  }catch(e){
    setSyncMeta({lastSyncError:friendlySyncError(e)});
    throw e;
  }
}
// Best-effort point-in-time snapshot for recovery. Never blocks or fails the main sync path —
// safe to call even before the life_os_backups table exists (fails silently until it does).
async function snapshotBackup(){
  if(!SB||!CLOUD.user) return;
  try{
    await withTimeout(SB.from('life_os_backups').insert({user_id:CLOUD.user.id,state:S}),15000,'Backup snapshot');
    const {data,error}=await withTimeout(SB.from('life_os_backups').select('id,created_at').eq('user_id',CLOUD.user.id).order('created_at',{ascending:false}),15000,'Backup list');
    if(!error&&data&&data.length>10){
      const ids=data.slice(10).map(r=>r.id);
      await withTimeout(SB.from('life_os_backups').delete().in('id',ids),15000,'Backup cleanup');
    }
  }catch(e){console.warn('Life OS backup snapshot failed (non-fatal, sync unaffected)',e)}
}
function scheduleSync(){
  if(!SB||!CLOUD.user) return;
  syncPending=true;
  setSyncMeta({dirty:true});
  clearTimeout(syncTimer);
  syncTimer=setTimeout(()=>{
    withSyncLock(async()=>{
      try{await syncPush()}catch(e){console.warn('Life OS sync failed',e)}
      finally{if(syncPending)scheduleSync()}
    });
  },700);
}
// Applies a cloud row to local state, but only once it has been validated to
// actually look like a Life OS state — a malformed/unexpected payload is rejected
// and local data is left completely untouched.
async function acceptCloudState(cloudState,updatedAt){
  if(!looksLikeLifeOsState(cloudState)){
    setSyncMeta({lastSyncError:'Cloud data appears invalid; your local data was kept.'});
    return false;
  }
  const preservedUsdaKey=(S&&S.settings&&S.settings.usdaKey)||'';
  S=migrateState(cloudState);
  if(!S.settings.usdaKey) S.settings.usdaKey=preservedUsdaKey;
  localStorage.setItem(KEY,JSON.stringify(S));
  lastCloudUpdated=updatedAt?Date.parse(updatedAt):Date.now();
  setSyncMeta({lastSuccessfulSyncAt:new Date().toISOString(),lastSyncError:null,dirty:false,localAccountId:CLOUD.user?CLOUD.user.id:SYNC_META.localAccountId});
  return true;
}
async function syncPull(){
  if(!SB||!CLOUD.user) return false;
  setSyncMeta({lastSyncAttemptAt:new Date().toISOString()});
  let data;
  try{
    const res=await withTimeout(SB.from('life_os_state').select('state,updated_at').eq('user_id',CLOUD.user.id).maybeSingle(),15000,'Cloud sync');
    if(res.error) throw res.error;
    data=res.data;
  }catch(e){
    setSyncMeta({lastSyncError:friendlySyncError(e)});
    throw e;
  }
  if(data?.state){
    // A pending local change is newer evidence than a slow/stale pull response —
    // push first rather than silently discarding it.
    if(SYNC_META.dirty){
      try{await syncPush()}catch(e){/* handled/logged inside syncPush */}
      return false;
    }
    return await acceptCloudState(data.state,data.updated_at);
  }
  await syncPush(); return false;
}
async function autoSync(){
  if(!SB||!CLOUD.user||pendingAccountChoice) return;
  await withSyncLock(async()=>{
    try{
      const {data,error}=await withTimeout(SB.from('life_os_state').select('updated_at').eq('user_id',CLOUD.user.id).maybeSingle(),15000,'Cloud check');
      if(error) throw error;
      if(data?.updated_at && Date.parse(data.updated_at)>lastCloudUpdated){
        await syncPull();
        render(location.hash.slice(1)||'today');
      } else if(!data){
        await syncPush();
      }
    }catch(e){
      setSyncMeta({lastSyncError:friendlySyncError(e)});
      console.warn('Life OS background sync failed',e);
    }
  });
}

// ---- Account transitions (Phase 13) ----
// Runs whenever a session becomes active for a given user — on initial page load
// (restored session) and right after an explicit sign-in. Never blindly pushes one
// account's local data into another account, and never blindly overwrites local
// data with cloud data when both sides have real content from different accounts.
async function resolveAccountTransition(user){
  setSyncMeta({lastSyncAttemptAt:new Date().toISOString()});
  let cloudRow=null;
  try{
    const res=await withTimeout(SB.from('life_os_state').select('state,updated_at').eq('user_id',user.id).maybeSingle(),15000,'Cloud check');
    if(res.error) throw res.error;
    cloudRow=res.data||null;
  }catch(e){
    setSyncMeta({lastSyncError:friendlySyncError(e)});
    toast(friendlySyncError(e));
    return;
  }
  const cloudHasValidState=!!(cloudRow&&looksLikeLifeOsState(cloudRow.state)&&hasMeaningfulLocalData(cloudRow.state));
  const localHasData=hasMeaningfulLocalData(S);
  const sameAccountAsBefore=SYNC_META.localAccountId===user.id;

  if(cloudHasValidState&&localHasData&&!sameAccountAsBefore){
    pendingAccountChoice={userId:user.id,email:user.email||'',cloudUpdatedAt:cloudRow.updated_at||null};
    return;
  }
  if(cloudHasValidState){
    await acceptCloudState(cloudRow.state,cloudRow.updated_at);
    setSyncMeta({localAccountId:user.id});
  } else {
    try{await syncPush()}catch(e){/* logged inside syncPush; local data is unaffected */}
    setSyncMeta({localAccountId:user.id});
  }
}
// User explicitly chose "keep local data" during an account-switch conflict —
// pushes local state to the new account's cloud row (overwriting it).
async function resolveKeepLocal(){
  if(!pendingAccountChoice) return;
  const choice=pendingAccountChoice; pendingAccountChoice=null;
  try{await syncPush();toast('Kept your local data and saved it to this account.')}
  catch(e){toast(friendlySyncError(e))}
  setSyncMeta({localAccountId:choice.userId});
  render('settings');
}
// User explicitly chose "use cloud data" during an account-switch conflict —
// replaces local state with this account's cloud row.
async function resolveUseCloud(){
  if(!pendingAccountChoice) return;
  const choice=pendingAccountChoice; pendingAccountChoice=null;
  try{
    const res=await withTimeout(SB.from('life_os_state').select('state,updated_at').eq('user_id',choice.userId).maybeSingle(),15000,'Cloud sync');
    if(res.error) throw res.error;
    if(res.data?.state){await acceptCloudState(res.data.state,res.data.updated_at)}
    setSyncMeta({localAccountId:choice.userId});
    toast('Switched to this account\'s cloud data.');
  }catch(e){toast(friendlySyncError(e))}
  render('settings');
}

// Translates a raw Supabase Auth error into one honest, specific, non-technical
// sentence — never a raw stack trace, status code, or SDK message. Distinct from
// friendlySyncError() (data-sync failures) because sign-in/sign-up have their
// own specific, well-known failure shapes worth naming precisely.
function friendlyAuthError(e){
  const msg=String((e&&e.message)||e||'');
  if(typeof navigator!=='undefined'&&navigator.onLine===false) return "Couldn't reach the server — you're offline. Try again once you're back online.";
  if(/invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
  if(/email.*not.*confirm/i.test(msg)) return 'Please confirm your email before signing in — check your inbox for the confirmation link.';
  if(/already registered|already exists|user already registered/i.test(msg)) return 'An account with this email already exists — try signing in instead.';
  if(/rate limit/i.test(msg)) return 'Too many attempts — wait a moment and try again.';
  if(/password/i.test(msg)&&/(least|short|6|characters)/i.test(msg)) return 'Password must be at least 6 characters.';
  if(/timed out/i.test(msg)) return 'That took too long. Check your connection and try again.';
  if(/network|fetch|failed to fetch/i.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
  if(/jwt|session|401|not authenticated|invalid.*token|refresh_token/i.test(msg)) return 'Your session expired. Please sign in again.';
  return 'Sign-in failed. Please check your details and try again.';
}
// Makes sure a Supabase client exists before sign-in/sign-up — CLOUD.url is
// always populated by now (either a saved value or PRODUCTION_SUPABASE_URL),
// so the only thing that can genuinely still be missing on a brand-new device
// is the anon key, which this app never fabricates (see saveAdvancedCloudConfig
// below) — that's the ONE thing a normal sign-in can't paper over. Returns true
// iff a client now exists to sign in against.
async function ensureCloudConnection(){
  if(!CLOUD.anon) return false;
  if(!SB) await initCloud();
  return !!SB;
}
async function cloudSignUp(){
  if(!(await ensureCloudConnection())){toast('This device isn\'t connected to a Supabase project yet — see Advanced configuration in Settings.');return}
  const email=$('cloud_email').value.trim(), password=$('cloud_password').value;
  if(!email||password.length<6){toast('Enter an email and 6+ character password');return}
  try{
    const {error}=await withTimeout(SB.auth.signUp({email,password}),15000,'Sign up');
    toast(error?friendlyAuthError(error):'Account created — check your email if confirmation is enabled');
  }catch(e){toast(friendlyAuthError(e))}
}
async function cloudSignIn(){
  if(!(await ensureCloudConnection())){toast('This device isn\'t connected to a Supabase project yet — see Advanced configuration in Settings.');return}
  const email=$('cloud_email').value.trim(), password=$('cloud_password').value;
  if(!email||!password){toast('Enter your email and password');return}
  setAuthState(AUTH_STATE.SIGNING_IN);
  render('settings');
  let user;
  try{
    const {data,error}=await withTimeout(SB.auth.signInWithPassword({email,password}),15000,'Sign in');
    if(error){ setAuthState(AUTH_STATE.SIGNED_OUT,friendlyAuthError(error)); render('settings'); toast(friendlyAuthError(error)); return; }
    user=data.user;
  }catch(e){ setAuthState(AUTH_STATE.SIGNED_OUT,friendlyAuthError(e)); render('settings'); toast(friendlyAuthError(e)); return; }
  CLOUD.user=user;
  CLOUD.email=email;
  localStorage.setItem(CLOUD_KEY,JSON.stringify(CLOUD));
  setAuthState(AUTH_STATE.SIGNED_IN);
  attachAuthListener();
  startCloudBackgroundTasks();
  await resolveAccountTransition(user);
  render('settings');
  toast(pendingAccountChoice?'Signed in — choose how to handle existing data below.':'Signed in and synced');
}
// Advanced/Developer configuration only — never shown in the normal sign-in
// flow. The anon key is genuinely not something this app can supply on its
// own (unlike the URL above): it was never given to this codebase and is
// never fabricated, so a brand-new device needs this ONE-TIME step before its
// first sign-in. Once saved, sign-in/sign-up never need it again.
async function saveAdvancedCloudConfig(){
  const url=($('adv_cloud_url')?.value||'').trim()||PRODUCTION_SUPABASE_URL;
  const anon=($('adv_cloud_anon')?.value||'').trim();
  if(!anon){toast('Enter the Supabase anon/public key');return}
  CLOUD.url=url; CLOUD.anon=anon;
  localStorage.setItem(CLOUD_KEY,JSON.stringify(CLOUD));
  SB=null; authListenerAttached=false; // force a clean reconnect against the (possibly new) project
  await initCloud();
  render('settings');
  toast(SB?'Cloud configuration saved.':'Saved, but could not connect — double-check the URL and key.');
}
async function cloudSyncNow(){
  if(!SB||!CLOUD.user){toast('Sign in first');return}
  if(pendingAccountChoice){toast('Resolve the account data choice below first');return}
  await withSyncLock(async()=>{
    try{
      await syncPush();
      await syncPull();
      render(location.hash.slice(1)||'settings');
      toast('Synced to cloud');
    }catch(e){
      render(location.hash.slice(1)||'settings');
      toast(friendlySyncError(e));
    }
  });
}
// ---- Settings UI: Account & Cloud Sync (ChatGPT-style redesign) ----
// Owned here, not settings.js, since it reads CLOUD/authState/SB directly —
// matches how views/mentor.js owns its own Real AI Mentor settings card. This
// card NEVER shows Supabase project URL/anon key fields, "Save connection," or
// "Sign in & sync" — those are pure infrastructure config and live only in the
// separate, collapsed Advanced card below. The normal Account card only ever
// shows account/sign-in/sign-up/sync-status/sign-out — nothing technical.
function renderAccountCard(){
  const state=getAuthState();
  const err=getAuthError();
  const pending=(typeof getPendingAccountChoice==='function')?getPendingAccountChoice():null;
  const meta=(typeof getSyncMeta==='function')?getSyncMeta():{lastSuccessfulSyncAt:null,lastSyncError:null,dirty:false};
  const connected=state===AUTH_STATE.SIGNED_IN&&!!(SB&&CLOUD.user);

  if(state===AUTH_STATE.LOADING){
    return `<div class="card" style="margin-top:12px"><h3>Account</h3><p class="muted">Restoring session…</p></div>`;
  }

  if(pending){
    return `<div class="card" style="margin-top:12px"><h3>Account</h3><p class="small muted">Signed in as ${esc(pending.email)} — resolve the data choice below to finish connecting sync.</p></div>`;
  }

  if(connected){
    const dotColor=meta.lastSyncError?'var(--color-danger-ink)':(meta.dirty?'var(--color-ink-muted)':'var(--color-success)');
    const statusLabel=meta.lastSyncError?'Sync issue':(meta.dirty?'Syncing…':'Connected');
    return `<div class="card" style="margin-top:12px"><h3>Account</h3>
<p class="small muted" style="margin:0 0 2px">Signed in as</p>
<p style="margin:0 0 12px;font-weight:var(--weight-heavy)">${esc(CLOUD.user.email||'')}</p>
<div class="row" style="align-items:center;gap:6px"><span style="color:${dotColor}">&#9679;</span><span class="small">Cloud Sync: ${statusLabel}</span></div>
<div class="small muted" style="margin-top:4px">Last synced: ${meta.lastSuccessfulSyncAt?esc(relativeTimeLabel(meta.lastSuccessfulSyncAt)):'not yet'}</div>
${meta.lastSyncError?`<div class="small" style="margin-top:4px;color:var(--color-danger-ink)">${esc(meta.lastSyncError)}</div>`:''}
<div class="row" style="margin-top:12px"><button type="button" class="btn secondary" onclick="cloudSyncNow()">Sync now</button><button type="button" class="btn danger" onclick="cloudSignOut()">Sign Out</button></div>
<p class="small muted" style="margin-top:8px">Signing out only ends this device's session — your local data stays here either way, and any other signed-in device is unaffected.</p>
</div>`;
  }

  // Signed out — whether or not this device has ever been connected to a
  // Supabase project. The ONLY thing that changes based on that is a small
  // note pointing at Advanced configuration; the form itself is always just
  // email/password, never URL/anon-key fields.
  const signingIn=state===AUTH_STATE.SIGNING_IN;
  const needsAdvancedSetup=!CLOUD.anon;
  return `<div class="card" style="margin-top:12px"><h3>Account</h3>
<p class="muted" style="margin:0 0 10px">Not signed in.</p>
${err?`<p class="small" style="margin:0 0 10px;color:var(--color-danger-ink)">${esc(err)}</p>`:''}
${needsAdvancedSetup?`<p class="small muted" style="margin:0 0 10px">This device isn't connected to a Supabase project yet — see Advanced configuration below.</p>`:''}
<label>Email<input id="cloud_email" class="input" type="email" placeholder="you@example.com" value="${esc(CLOUD.email||'')}"></label>
<label style="margin-top:8px">Password<input id="cloud_password" class="input" type="password" placeholder="6+ characters" onkeydown="if(event.key==='Enter'){event.preventDefault();cloudSignIn();}"></label>
<div class="row" style="margin-top:10px"><button type="button" class="btn" ${signingIn?'disabled':''} onclick="cloudSignIn()">${signingIn?'Signing in…':'Sign In'}</button></div>
<p class="small muted" style="margin-top:10px">New here? <a href="#" onclick="cloudSignUp();return false;">Create an account</a>.</p>
</div>`;
}
// Collapsed by default — technical Supabase project configuration, never part
// of normal sign-in. Only needs to be opened once per device (to paste the
// anon key this app can't supply on its own — see saveAdvancedCloudConfig),
// or to point this device at a different Supabase project entirely.
let settingsAdvancedCloudOpen=false;
function toggleAdvancedCloudConfig(){ settingsAdvancedCloudOpen=!settingsAdvancedCloudOpen; render('settings'); }
function renderAdvancedCloudCard(){
  return `<div class="card" style="margin-top:12px">
<div class="row" style="justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleAdvancedCloudConfig()">
<div><h3 style="margin:0">Advanced</h3><p class="small muted" style="margin:2px 0 0">Cloud infrastructure — the Supabase project this Life OS installation uses.</p></div>
<span class="pill">${settingsAdvancedCloudOpen?'&#9650;':'&#9660;'}</span>
</div>
${settingsAdvancedCloudOpen?`<div style="margin-top:12px">
<p class="small muted" style="margin:0 0 10px">Only needed once per device, or to point this device at a different Supabase project. Normal sign-in never needs this.</p>
<label>Supabase project URL<input id="adv_cloud_url" class="input" placeholder="https://your-project.supabase.co" value="${esc(CLOUD.url||'')}"></label>
<label style="margin-top:8px">Supabase anon/public key<input id="adv_cloud_anon" class="input" placeholder="eyJ..." value="${esc(CLOUD.anon||'')}"></label>
<button type="button" class="btn secondary" style="margin-top:9px" onclick="saveAdvancedCloudConfig()">Save configuration</button>
</div>`:''}
</div>`;
}

// Signing out never touches local app data — it only ends the cloud session, so
// everything already on this device remains exactly as it was.
// scope:'local' is deliberate — supabase-js's signOut() defaults to 'global'
// (revokes the refresh token everywhere, signing the account out on every other
// signed-in device too), which is NOT what "Sign Out" on one device should mean.
// 'local' only clears this browser's own session/storage, leaving any other
// device's session exactly as it was — matching how ChatGPT/every consumer app
// actually behaves for a single "Sign out" button.
async function cloudSignOut(){
  setAuthState(AUTH_STATE.SIGNED_OUT);
  if(SB){ try{await withTimeout(SB.auth.signOut({scope:'local'}),10000,'Sign out')}catch(e){/* proceed regardless — local state is cleared below either way */} }
  CLOUD.user=null;
  pendingAccountChoice=null;
  // D8: invalidates any Real AI Mentor request already in flight (see mentor.js) so
  // its reply gets silently discarded instead of appearing after the UI has already
  // moved on to signed-out.
  if(typeof mentorRequestGeneration!=='undefined') mentorRequestGeneration++;
  // A live retry countdown belongs to a request made while signed in — don't
  // leave its timer ticking (or its "try again" implicitly promising Real AI)
  // into a now-signed-out session.
  if(typeof mentorClearRetryCountdown==='function') mentorClearRetryCountdown();
  // Live location must never keep running for a signed-out session — stop the
  // watch and drop whatever coordinates were in runtime memory. The saved
  // locationMode preference itself is untouched (still in S.settings), so it
  // resumes correctly next sign-in; only the ephemeral runtime bits are cleared.
  if(typeof stopLiveLocation==='function') stopLiveLocation();
  if(typeof LOCATION_RUNTIME!=='undefined'){ LOCATION_RUNTIME.coords=null; LOCATION_RUNTIME.lastError=null; }
  toast("Signed out. Your local data is still on this device.");
  render('settings');
}
