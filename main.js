// go() already renders synchronously; location.hash=v then fires this handler again
// asynchronously. Skipping a no-op re-render (same tab already showing) avoids a
// wasted duplicate full-app render on every tab click, while direct hash edits,
// bookmarks, and back/forward navigation (which don't go through go()) still work.
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1)||'today';if(v!==lastRenderedTab)render(v);});
// Auth redesign: initCloud() is now async and restores any previously-saved
// session BEFORE the very first render — this is what stops the app from ever
// flashing a signed-out UI for a user who's actually still signed in. Only show
// the brief "Restoring session…" placeholder when there's actually a saved
// cloud connection to restore; a fresh device or a Local-Mode-only user (no
// CLOUD.url/anon saved yet) goes straight to the normal first render with zero
// added delay, since initCloud() resolves that case synchronously-fast anyway.
if(typeof CLOUD!=='undefined' && CLOUD.url && CLOUD.anon){
  $('app').innerHTML='<div class="card" style="margin-top:40px;text-align:center"><p class="muted">Restoring session…</p></div>';
}
Promise.resolve(initCloud()).finally(render);
