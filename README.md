# Life OS — Cloud Sync Edition

This is the private/local-first Life OS PWA with optional cross-device cloud sync.

## v1.1 — Curriculum, Nutrition, Photos & Mentor

- **BJJ curriculum**: pre-populated with 119 techniques/concepts across all nine categories (Positions, Controls, Escapes, Takedowns, Guard, Passing, Submissions, Transitions, Defense), each tagged Foundation/Developing/Intermediate/Advanced. You can still add your own custom techniques — the app never overwrites them, and a "Today's BJJ practice" suggestion picks from your curriculum based on confidence, recency, and prerequisites.
- **Nutrition**: meals are now logged into Breakfast/Lunch/Dinner/Snack, with a real quantity + unit (grams, oz, kg, lb, ml, fl oz, or servings) instead of a flat "servings" multiplier. Mass and volume are never cross-converted without a real density for that food — if a unit isn't supported for a given food, the app says so instead of guessing.
- **Body progress photos**: front/side/back photos with optional weight/body-fat/notes, and a side-by-side comparison view. Photos are stored locally in this browser's IndexedDB, never uploaded automatically, and are **not** included in the JSON export (only the date/pose/weight/notes are) — use "Export all photos" in the Body tab to download them individually before switching devices or clearing browser data.
- **Personal Mentor** (new tab): answers questions like "What should I do today?", "How much protein do I have left?", or "Log 200g chicken breast" using only your own Life OS data. Works in two modes — see "Real AI Mentor" below. Local mode is always available, works offline, and never uses the internet.

### Mentor architecture — Local Mode

The local Mentor is a rule-based intent matcher (keyword/pattern matching, not a language model) that reads and writes the same Life OS state as every other tab — it reuses the existing Coach signal pipeline, the BJJ recommendation logic, and the nutrition search/logging functions rather than duplicating any of them. It can genuinely log food (by chaining the same USDA/Open Food Facts search already used in Nutrition) and it asks for confirmation before deleting anything. This mode requires no setup and is always the fallback if Real AI Mentor isn't configured, isn't reachable, or you're offline.

## Real AI Mentor (Phase 15)

The app can optionally connect the Mentor tab to a real LLM (a genuine language model, not pattern matching) through a small secure backend you deploy yourself. **Writing this project's backend files does not deploy them or make this live** — until you complete the setup below, the Mentor tab always uses Local Mode.

### Architecture

```
Life OS PWA (browser)
    │  message + compact context + bounded history
    │  Authorization: Bearer <your Supabase session JWT>
    ▼
Supabase Edge Function  (supabase/functions/mentor/index.ts)
    │  verifies the JWT via supabase.auth.getUser() — never trusts a client-supplied user id
    │  holds the GROQ_API_KEY/LLM_API_KEY secret — the browser never sees it
    ▼
LLM provider (Groq Chat Completions API by default — free; Anthropic Messages API
available as an optional alternative via LLM_PROVIDER=anthropic)
    │  may respond with a tool_call (e.g. "getBJJFocus") instead of a final answer
    ▼
Edge Function returns {type:'tool_call', tool, args} to the browser
    ▼
Browser executes the tool locally against your OWN live Life OS state
(the same functions the rest of the app already uses — nutrition search,
BJJ recommendation, Coach signals, etc.) and sends the result back
    ▼
Edge Function forwards the tool result to the LLM, which either asks for
another tool or gives a final answer — looped, bounded, back to the browser
```

The Edge Function never reads or writes any Supabase table and never needs a service-role key — it only verifies who you are and relays messages. All your Life OS data stays exactly where it already lives (local state + your `life_os_state` row); nothing new is stored in Supabase for this feature, and **no database schema change was made**.

### Where secrets belong

| Secret | Belongs in | Never in |
|---|---|---|
| LLM provider API key (`GROQ_API_KEY` for the default Groq provider, or `LLM_API_KEY` if using `LLM_PROVIDER=anthropic`) | Supabase Edge Function secrets (`supabase secrets set`) | Any file in this repo, `localStorage`, the JSON export, or the client |
| Supabase service-role key | Nowhere in this project — not needed | Client or Edge Function |
| Supabase anon/public key | `sync.js` client config (existing, unchanged) | N/A — this one is meant to be public; RLS protects it |

The only thing the browser stores about the AI Mentor is the **endpoint URL** (Settings → Real AI Mentor) — a plain address, not a secret, since the Edge Function itself requires a valid signed-in session to do anything.

### Deploying the backend

Deployment requires your own Supabase CLI login (or the Dashboard's own Edge Function editor) — this environment does not have Supabase CLI access, so any change to `supabase/functions/mentor/*` needs to be deployed by you:

```
supabase functions deploy mentor

# Primary provider — Groq (free):
supabase secrets set GROQ_API_KEY=YOUR_GROQ_API_KEY
supabase secrets set LLM_MODEL=openai/gpt-oss-120b   # optional, this is the default for Groq

# Automatic fallback — Gemini (also free-tier only, never Vertex AI/billed):
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY   # optional — get a free key at aistudio.google.com/apikey
supabase secrets set GEMINI_MODEL=gemini-2.0-flash        # optional, this is the default

# Optional alternative — Anthropic (paid, replaces Groq+Gemini entirely):
supabase secrets set LLM_PROVIDER=anthropic
supabase secrets set LLM_API_KEY=YOUR_ANTHROPIC_API_KEY
supabase secrets set LLM_MODEL=claude-sonnet-5       # optional, this is the default for Anthropic
```

`LLM_PROVIDER` defaults to `groq` — you only need to set it if you want `anthropic` instead. `GEMINI_API_KEY` is entirely optional: without it, Mentor behaves exactly as it always has (Groq only, single attempt per request). With it set, Mentor automatically falls back to Gemini within the same request whenever Groq is rate-limited (HTTP 429) or has a transient server error — see "Provider router" below.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided automatically to every Edge Function — you don't set those yourself. After deploying, copy the function's URL (shown by the deploy command, typically `https://<project-ref>.supabase.co/functions/v1/mentor`) into Life OS → Settings → Real AI Mentor → Backend endpoint URL, and enable it.

### Provider router (Groq primary + Gemini free-tier fallback)

Both providers are used on their free tiers only — this app never adds a paid provider or paid usage. When both `GROQ_API_KEY` and `GEMINI_API_KEY` are set (and `LLM_PROVIDER` is left at its `groq` default):

- **Primary**: every request tries Groq first.
- **Automatic fallback**: if Groq returns a rate-limit (429) or a transient server error, the *same request* automatically retries against Gemini instead of failing — no extra round-trip from the client, no blind retry against Groq itself.
- **Provider cooldowns**: once a provider 429s, it's skipped entirely (not even attempted) on subsequent requests for a short window — using that provider's own `Retry-After` header when it sends one, or 30 seconds otherwise. This is in-memory/best-effort (resets on a cold start), not a persisted setting.
- **Response cache + dedup**: an identical request from the same signed-in user (same message, same point in a tool-call conversation) within ~20 seconds is served from a short-lived in-memory cache instead of calling the provider again — this mainly absorbs a double-tap Send or a client retry firing while the previous identical request is still in flight. Only successful answers are ever cached; a rate-limit/error response never is, so a legitimate retry after a cooldown always actually retries.
- **Mentor priority**: Explore's own live-discovery research reuses this same backend, but it never gets the Gemini fallback — only a real Mentor chat message does. If Groq is cooling down, an Explore request fails fast instead of spending Gemini's shared free-tier quota, which is reserved for the conversation the user is actually having.
- **Never falls back to Local Mentor**: if every available provider is unavailable, the Edge Function returns an honest rate-limit/unavailable error — the client (`views/mentor.js`) never silently substitutes the deterministic Local Mentor for a Real AI failure; that's a deliberate, pre-existing design decision this feature does not change.

### Authentication

The Edge Function requires a valid Supabase session — it reads the `Authorization: Bearer <token>` header the client sends (the same access token your existing Cloud Sync session already has) and verifies it server-side with `supabase.auth.getUser()`. A request with no token, or an expired/invalid one, is rejected before it ever reaches the LLM. If you're signed out, Real AI Mentor is unavailable and the app automatically uses Local Mode instead.

### Available Mentor tools

Read (always safe, run automatically when the model asks): `getTodayPlan`, `getNutritionProgress`, `getBJJFocus`, `getTrainingProgress`, `getBodyProgress`, `getMoneySummary`, `getCareerNextStep`, `getSocialProgress`, `getAdventureProgress` (bounded activity memory — recent activities and tried/untried categories only, never the full app state), `getWeeklyReview`, `getCoachSignals`, `getGoals`, `getRecentActivity`.

Write (execute immediately, no confirmation needed): `logFood` (reuses the real nutrition search/scaling — the model never estimates nutrition itself), `logBJJSession`, `logSocialRep`, `logAdventure`, `logWorkout`.

Destructive (requires your explicit "yes" first): `deleteRecentFood` — the app shows exactly what would be deleted and waits for you to confirm or cancel before anything changes. The model cannot set its own confirmation — every destructive call always routes through the client-side confirmation UI regardless of what the model sends. There is no tool to reset the app, erase all data, delete your account, change cloud sync settings, or run arbitrary code/SQL — those are permanently outside the Mentor's reach.

Server-executed (run on the Edge Function itself, not the client — see "Live web search" below): `webSearch`, `presentRecommendation`.

### Offline / local-only behavior

Local Mode always works, with or without internet, with or without being signed in. Real AI Mentor requires internet + being signed in + the backend being configured and reachable; if any of those aren't true, the Mentor tab clearly shows "LOCAL MODE" or "REAL AI unavailable" (never a silent guess about which one answered you), and falls back to a real local answer rather than leaving you with nothing.

### Rate limiting / cost protection

The Edge Function enforces request/response size limits, a request timeout, a hard cap on how many tool-call round-trips one question can take, and a cap on web search results per call — so a single request can never run away indefinitely. There is no artificial per-user message cap on the client (an earlier "20 messages/hour" courtesy counter was removed at the user's request); the protections above are the real backstop. True per-user server-side rate limiting would need a small additional Postgres table; that schema change was intentionally not made without your explicit approval — ask if you'd like it added.

### Live web search & real-world recommendations

Implemented via [Tavily](https://tavily.com) — Mentor and Explore share the exact same research path (`webSearch` → `presentRecommendation`), so a live query like "where can I get good coffee open late tonight" gets a real, verified answer, not an invented one. The Edge Function holds the `TAVILY_API_KEY` secret and calls Tavily server-side; the browser never sees that key. Results come back to the model wrapped as explicitly **untrusted** content — the system prompt instructs the model to treat anything in a search result as data, never as an instruction to follow (so a page containing "ignore previous instructions" is just scraped text, not a command). The model is instructed to only state a business's address, hours, price, or distance when a search result actually said so, and never to construct or guess a Google Maps URL — the app always builds that link itself from the verified name/address, using Google's documented Maps-search URL format (never a fabricated Place ID). If search is unavailable or turns up nothing usable, the Mentor says so honestly instead of naming a business from its own training data.

To enable it: `supabase secrets set TAVILY_API_KEY=YOUR_TAVILY_KEY`. Without that secret set, `webSearch` reports itself unavailable and Mentor/Explore fall back to being honest that live research isn't configured — never a silent guess.

### Location

Settings → Location offers three modes: **Off** (saved city only, never asks for device location), **While using Mentor/Explore** (asks fresh each time a request actually needs it), and **Live** (keeps your position updated via `watchPosition` while enabled). Priority when a request needs a location: (1) a location you name in the message itself, (2) your device location if enabled, (3) your saved city, (4) the Mentor asks rather than assuming. Raw coordinates are never written to your saved profile, backups, or cloud sync — they exist only in memory for the current browser tab and are cleared whenever location mode is turned off.

### Troubleshooting

- **"LOCAL MODE" always shows, never "REAL AI"**: check Settings → Real AI Mentor is enabled with the correct endpoint URL, and that you're signed in to Cloud Sync.
- **"Sign in required" / "session expired"**: sign in again in Settings — the backend needs a fresh session token.
- **"The AI Mentor backend is not configured"**: the Edge Function is deployed but the active provider's key isn't set — `GROQ_API_KEY` by default, or `LLM_API_KEY` if `LLM_PROVIDER=anthropic`. Run the `supabase secrets set` command above for whichever provider you're using.
- **Requests hang or time out**: check your Supabase project is on a plan with Edge Functions enabled and that the LLM provider is reachable from it.

## Navigation

The app has six primary sections: **Home** (today's plan and quick actions), **Mentor** (chat), **Explore** (real-world discovery — natural-language search, "Happening Soon," saved ideas, and your own logged activity history), **Progress** (Body / Training / Nutrition / BJJ / Review / Coach), **Life** (Money / Career / Social), and **Settings**. Progress and Life are groupings for presentation only — every underlying route (`body`, `training`, `nutrition`, `bjj`, `money`, `growth`, `social`, `review`, `coach`, `explore`, `mentor`, `settings`, plus `today` for Home) is still a real, independently linkable/bookmarkable page; tapping "Progress" or "Life" just jumps to whichever of its pages you last visited. This is a client-side hash-routed single-page app (`shell.js` → `render()`), not a framework — there is no build step, and `main.js`/`shell.js` own all navigation.

## Architecture at a glance

- **Frontend**: vanilla JS, no framework, no build step — `index.html` loads `utils.js`/`state.js`/`sync.js`/`shell.js` then each `views/*.js` file (one `views.<name> = () => "<html>"` function per section) as plain `<script>` tags. `utils.js` holds shared pure-logic helpers (formatting, validation, the recommendation-card renderer, location resolution); `state.js` owns the state shape and additive-only migration; `sync.js` owns Supabase Auth/cloud sync; `sw.js` is the service worker (bump `CACHE_VERSION` whenever a cached asset changes).
- **Backend**: a single Supabase Edge Function (`supabase/functions/mentor/`) is the only server-side code in this project. It verifies the caller's Supabase session, relays messages to the configured LLM provider, and executes two of its own tools (`webSearch` via Tavily, `presentRecommendation`) — every other Mentor tool (nutrition, BJJ, money, etc.) executes on the client, against your own already-loaded local state, never sent to any server.
- **AI provider**: [Groq](https://groq.com) (`openai/gpt-oss-120b` by default, free tier) is the default LLM provider; Anthropic remains available as an opt-in alternative (`LLM_PROVIDER=anthropic`). Neither the frontend nor this repo ever contains a live API key — see "Where secrets belong" above.

## Local development

This is a static, no-build app — there's nothing to compile. Serve the folder with any static file server (e.g. `npx serve .`, or `python -m http.server`) and open the printed URL; opening `index.html` directly via `file://` mostly works too, except the service worker won't register (service workers require `http(s)://` or `localhost`). There is no `npm start`/`npm run dev` script — `package.json` only lists the Supabase CLI as a dev dependency for deploying the Edge Function.

## What this version does

- Works on Windows and iPhone.
- Works over different Wi-Fi networks and cellular data once hosted.
- Automatically synchronizes your Life OS data through your own Supabase project.
- Pulls the latest cloud data when you sign in, return to the app, regain internet, or switch devices.
- Uploads changes automatically after you make them (with a short debounce), so you do not normally need to press Sync now.
- Local data remains available even when cloud sync is not configured.
- Includes the Personal Coach and all existing Life OS sections.

## Cost

The app itself is free. Supabase has a free tier suitable for a personal app at this scale. A separate hosting service can also be used on a free tier.

## Installing as an app (PWA)

On iPhone (Safari): open the hosted site, tap Share, then "Add to Home Screen." On Android/desktop Chrome: open the site and use the browser's "Install app"/"Add to Home Screen" prompt, or the install icon in the address bar. The app then opens full-screen without browser chrome and continues to work offline for any page you've already visited, using the service worker's cache.

## Final polish (roadmap complete)

This build has been through a full final QA pass: every tab renders on both an empty account and a fully populated one, migration was tested against pre-Phase-0, mid-roadmap, and current-format backups, and the rest timer's on-screen countdown (previously frozen while running) now updates live. No functionality was removed and no Supabase schema changes were made.

## One-time cloud setup

1. Create a free Supabase project.
2. In Supabase, open SQL Editor.
3. Run:

```sql
create table if not exists public.life_os_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.life_os_state enable row level security;

create policy "Users can read their own Life OS"
on public.life_os_state for select
using (auth.uid() = user_id);

create policy "Users can insert their own Life OS"
on public.life_os_state for insert
with check (auth.uid() = user_id);

create policy "Users can update their own Life OS"
on public.life_os_state for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

4. In Supabase, copy your Project URL and the public `anon` key.
5. Open Life OS → Settings → Cloud Sync and enter the Project URL, anon key, email and password.
6. Create your account, then sign in & sync.

For easiest setup, you can disable email confirmation in Supabase Authentication settings. If confirmation is enabled, follow the email confirmation link before signing in.

## Optional: point-in-time backups

This adds a separate, additive table the app uses to keep a rolling history of past cloud states, purely as a recovery safety net. It does not change or replace `life_os_state` in any way — running it is optional, and skipping it just means the app quietly skips creating snapshots (nothing breaks either way).

In Supabase SQL Editor, run:

```sql
create table if not exists public.life_os_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.life_os_backups enable row level security;

create policy "Users can read their own Life OS backups"
on public.life_os_backups for select
using (auth.uid() = user_id);

create policy "Users can insert their own Life OS backups"
on public.life_os_backups for insert
with check (auth.uid() = user_id);

create policy "Users can delete their own Life OS backups"
on public.life_os_backups for delete
using (auth.uid() = user_id);
```

Once this exists, the app automatically stores a snapshot after each successful cloud sync and keeps only the 10 most recent per account. A "restore from backup" UI is planned for a later phase; for now these rows are visible/queryable directly in Supabase if you ever need to recover an older state.

## Production deployment (get a real HTTPS URL for your phone)

The app is a 100% static PWA — plain HTML/CSS/JS, no build step, no framework, no server of its own (the Mentor backend is a separately-hosted Supabase Edge Function — see "Deploying the backend" above, and hosting the static files below doesn't change that). This project currently has no git repository and no hosting account connected, so deployment was **prepared, not executed** — an AI assistant running in this environment has no credentials for GitHub/Netlify/Vercel/etc. and creating an account or pushing code on your behalf isn't something it can do without you. Below is the simplest path — **GitHub Pages** — chosen because it's free, gives you a real HTTPS URL, needs no build step, and (if you already have a GitHub account) needs no new third-party sign-up.

### Option A — GitHub Pages, no `git` command line needed

1. Go to github.com and sign in (or create a free account).
2. Click **New repository**. Name it something like `life-os` and set it to **Private** (recommended — this is your personal data's frontend, even though the data itself lives in your own Supabase project, not in this repo). Click **Create repository**.
3. On the new repo's page, click **uploading an existing file**.
4. Drag your entire Life OS project folder's contents into the browser (all the `.js`/`.html`/`.css`/`.json` files, the `icons/` folder, the `views/` folder, the `supabase/` folder, `manifest.json`, `sw.js` — everything at the top level of `Life-OS-Life-Fitness-Rebuild`). Commit the upload.
5. In the repo, go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, branch **main**, folder **/(root)**. Save.
6. Wait 1-2 minutes, then refresh that Pages settings page — it will show your live URL, something like `https://<your-username>.github.io/life-os/`.
7. Open that URL — everything (including the service worker and manifest) uses relative paths already, so it works correctly at that sub-path with no code changes needed.

### Option B — with `git` (if you already use it)

```
cd "Life-OS-Life-Fitness-Rebuild"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/life-os.git
git push -u origin main
```
Then do steps 5-7 above (Settings → Pages → Deploy from branch → main → /(root)).

### After it's live

On your phone (Safari on iPhone, or Chrome on Android): open the `https://...github.io/...` URL, sign in with your existing Life OS account (the same Supabase project — nothing about your account or cloud data changes based on where the static files are hosted), then use **Share → Add to Home Screen** (iPhone) or the browser's install prompt (Android/Chrome) — see "Installing as an app (PWA)" above. You'll then be able to open Life OS like a native app without your PC or localhost running at all.

### If you'd rather use Netlify or Vercel instead

Both also offer free static hosting with automatic HTTPS and support drag-and-drop deploys of a plain folder (no GitHub required for a one-off deploy, though connecting a repo gives you auto-redeploy on future changes). The steps are the same idea — create an account, drag in this project folder, get back an HTTPS URL — just skip GitHub Pages' repo/Settings-Pages steps above and follow that host's own "deploy a folder" flow instead.

## Important security note

Use the Supabase **anon/public** key in the app, never a service-role/secret key. The included Row Level Security policies restrict each account to its own row.

Your Life OS data is personal, so keep the Supabase account credentials private.


## Automatic sync behavior

After you sign in on a device, the app automatically pulls the latest cloud state — but only when it's actually safe to do so (see "Signing in with existing data" below). Changes you make are saved locally immediately and uploaded automatically shortly afterward. While the app is open, it checks for newer cloud data about every 15 seconds and checks again when the app becomes visible or the device comes back online. Settings shows the last successful sync time, whether local changes are still waiting to sync, and the last sync error in plain language if one occurred.

The **Sync now** button remains available as a manual fallback.

For a personal app this is intentionally simple: the cloud record is treated as the shared latest state, and there is no true multi-device conflict resolution. If you edit the same Life OS account on two devices within moments of each other, whichever device's change syncs last wins for anything they both touched — the app does not attempt to merge concurrent edits, since the current schema (one JSONB blob per account) has no way to do that safely. Avoid editing the same Life OS record on two devices at exactly the same moment.

The USDA API key (Settings → Food database) is intentionally never uploaded to cloud sync — it stays local to each device, since it's a personal key for an unrelated third-party service, not part of your Life OS data.

## Signing in with existing data / switching accounts

If a device already has local data and you sign in to an account that also already has cloud data, the app will **not** silently pick one for you. It shows an explicit choice in Settings: **Keep local data** (uploads this device's data, overwriting that account's cloud copy) or **Use cloud data** (downloads that account's cloud copy, overwriting this device's local data). Nothing is merged automatically, and nothing is deleted until you choose.

If a device's local data is empty/default, or the account you're signing into has no cloud data yet, the app resolves this safely on its own (pulls the existing cloud data, or uploads local data to start the account's cloud copy) without asking.

Signing out never deletes anything on the device — it only ends the cloud session. Your local data remains exactly as it was; you just won't get automatic sync updates until you sign in again.

## Backup, import and reset safety

**Export** produces a full JSON snapshot of your local data (including everything from every Life OS section) and never includes your Supabase URL/key, password, or session — those live in a separate local setting and are never part of the exported file.

**Import** validates that the selected file actually looks like a Life OS backup before touching anything; a corrupted or unrelated file is rejected with a clear message and nothing is changed. Before applying a valid backup, the app saves a one-time local recovery snapshot of your current data, so an import can be undone once from Settings ("Restore that snapshot") if it turns out to be a mistake.

**Erase local data** requires confirmation (a second confirmation if cloud sync is connected) and also saves a one-time recovery snapshot first. Erasing local data never touches your cloud copy directly — your cloud data stays exactly as it was at your last successful sync. If you keep using the app afterward, normal sync will eventually upload the freshly-reset (empty) state to the cloud like any other change, so export a backup first if you want to keep the old data around long-term.


## Fitness rebuild

This edition adds a substantially more structured fitness layer:

### Nutrition
- Daily calories, protein, carbs and fat.
- Search across USDA FoodData Central and Open Food Facts.
- Brand/product results.
- Barcode lookup through Open Food Facts.
- Favorites and basic recipes.
- Food source and serving size are retained with each log.
- Packaged-food accuracy is designed around the actual Nutrition Facts label. FDA explains that nutrition values are tied to the declared serving size, so the app keeps servings explicit.

USDA FoodData Central provides API access to food search and a current branded-food database. The API requires a data.gov key; the demo key is only for testing and has low limits. For a public commercial release, put the USDA key behind a server-side proxy rather than exposing it in the browser.

Open Food Facts can provide a very large packaged-food catalog and barcode-based product lookup, but its data is community-sourced, so product labels should remain the authority when exactness matters.

### Training
- Unlimited custom workout templates.
- Push / Pull / Legs and custom templates.
- Exercises inside each template.
- Set-by-set weight and reps.
- Set type: warm-up, working, failure, drop set, back-off.
- RPE field.
- Add/remove sets during a workout.
- Workout history.
- Per-template rest settings.
- Global customizable rest timer with start/pause/reset.

### Next commercial-grade upgrade
For the eventual paid app, the best architecture is a server-side nutrition service that normalizes USDA + licensed/approved branded sources, stores verified product records, and uses barcode lookup. This avoids putting a USDA API key in the client and makes the database more reliable at scale.
