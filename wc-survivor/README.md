# World Cup 2026 Survivor Pool — multi-user, live results

A real, multi-user Splash-style World Cup Survivor contest:

- **Auth:** email magic link **and** Google sign-in (Supabase Auth).
- **Multi-user:** every player gets one entry; picks, standings, and the
  bracket are shared and update **live** (Supabase Realtime).
- **Live results:** a scheduled Edge Function ingests real fixtures from a
  sports API and auto-resolves each round, with a **commissioner override**.
- **Live stage progression:** the group stage locks → resolves → the Round of
  32 opens with only the surviving teams selectable, and so on through the Final.
- **Splash format enforced server-side:** exactly 4 unique group picks, one
  team per knockout round, each team usable once ever, one wrong pick = out.
  Before-lock you only see your own picks; after lock everything (and pick
  percentages) goes public.

```
wc-survivor/
├─ supabase/
│  ├─ migrations/                 # run in order 0001 → 0004
│  │  ├─ 0001_schema.sql
│  │  ├─ 0002_rls_functions.sql   # RLS, contest logic, RPCs, grants, realtime
│  │  ├─ 0003_seed.sql            # 48 teams + contest + 6 rounds
│  │  └─ 0004_cron.sql            # optional auto-lock + periodic sync
│  └─ functions/sync-results/index.ts   # real-results ingestion
└─ web/                           # static frontend (host anywhere)
   ├─ index.html  styles.css  app.js
   └─ config.example.js → copy to config.js
```

## What you provide

1. A **Supabase project** (free tier is fine).
2. A **sports-data API key** for live results — either
   [football-data.org](https://www.football-data.org/) (free tier) or
   [API-Football](https://www.api-football.com/) (api-sports.io). Optional: you
   can run the whole thing on **commissioner-entered results** with no API key.

Everything else (schema, security, contest logic, UI) is in this folder.

---

## Setup

### 1. Create the project & run migrations
```bash
# Supabase CLI
supabase link --project-ref <PROJECT_REF>
supabase db push                      # applies migrations/*.sql in order
```
Or paste each `migrations/*.sql` file (in order) into the Supabase SQL editor.

### 2. Enable auth providers
Supabase Dashboard → **Authentication → Providers**:
- **Email** — on (magic link works by default).
- **Google** — on; add your Google OAuth client id/secret and set the redirect
  URL to where you host `web/` (e.g. `https://your-site/wc-survivor/web/`).
Add that same URL under **Authentication → URL Configuration → Redirect URLs**.

### 3. Configure the frontend
```bash
cd web
cp config.example.js config.js
# edit config.js: SUPABASE_URL, SUPABASE_ANON_KEY (Dashboard → Settings → API)
```
Host the `web/` folder as static files (Netlify, Vercel, GitHub Pages, your
existing site — anywhere). Open it, sign in, and **Join contest**.

### 4. Become the commissioner
The **first** signed-in user can claim it: Overview → *Claim commissioner role*
(or the Admin tab). Commissioners get the **🛠️ Admin** tab to set deadlines,
open/lock/resolve rounds, run live sync, and manually override results.

### 5. Wire up live results (sports API)
Set the provider on the contest (SQL editor):
```sql
-- football-data.org (competition code for the World Cup is usually 'WC')
update contests set provider='football-data', provider_comp_id='WC', provider_season='2026'
where id='00000000-0000-0000-0000-0000000000c1';

-- OR API-Football: provider='api-football', provider_comp_id='<league id>', provider_season='2026'
```
Deploy the Edge Function and give it the API key:
```bash
supabase functions deploy sync-results
supabase secrets set PROVIDER_API_KEY=<your_sports_api_key>
# (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
```
Test it from the Admin tab → **Sync real results now**, or:
```bash
curl -X POST https://<PROJECT_REF>.functions.supabase.co/sync-results \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"contest_id":"00000000-0000-0000-0000-0000000000c1","dry":true}'
```
`{"dry":true}` previews what it *would* resolve without writing.

### 6. Automate (optional, recommended)
Run `0004_cron.sql` to install:
- **auto-lock** every minute (picks lock at each round's `lock_at`), and
- **periodic sync** every 5 minutes (uncomment that block; store the
  service-role key in Supabase Vault as shown).

---

## How a round progresses (the live flow)

```
GROUP  open ──(lock_at passes / admin Lock)──► locked ──(real results / admin Resolve)──► resolved
                                                                       │
                                                                       ▼  opens automatically
R32    open ──► locked ──► resolved ──► R16 open ──► … ──► FINAL resolved ──► winner(s)
```
- **Lock** makes all picks + percentages public and stops edits.
- **Resolve** writes the teams that advanced (`round_advancers`), which
  instantly recomputes every entry's survival status (`v_entry_status`) and
  **opens the next round** with only the advancing teams pickable.
- The sports-API sync does Lock-time results automatically; the commissioner
  can override any round from the Admin tab (select the advancing teams →
  *Resolve*).

## Results accuracy & the override

The sync function maps provider team names to our team ids by FIFA/TLA code
then by a name-alias table. The 2026 tournament introduces a **Round of 32**;
provider stage labels for it aren't final yet, so `STAGE_MAP` in
`functions/sync-results/index.ts` may need a one-line tweak once the live feed
is published. Anything the feed can't resolve cleanly is left **unresolved for
the commissioner** to confirm — the payout never hinges on an unverified feed.

## Security model (summary)

- All contest logic (eliminations, pick limits, team-reuse, participation,
  lock timing) is enforced in Postgres via constraints, a validation trigger,
  `SECURITY DEFINER` RPCs, and RLS — not trusted to the browser.
- `picks` RLS hides other players' picks until a round locks; the elimination
  function exposes only the *round* of elimination, never hidden picks.
- The anon key shipped to the browser can only do what RLS allows.

## Notes / next steps

- This is wired for **one contest** (the seeded id). The schema supports many;
  the UI targets `CONTEST_ID` from `config.js`.
- A polished `display_name` profile, email notifications on lock/elimination,
  and multi-contest selection are natural follow-ups.
- There's also a zero-backend **demo** (`../world-cup-survivor.html`) that
  simulates opponents and results entirely in the browser — handy for trying
  the format before standing up Supabase.
```
