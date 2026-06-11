// ============================================================================
// World Cup 2026 Survivor Pool — multi-user frontend (Supabase)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CFG = window.WC_CONFIG || {};
if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR_PROJECT")) {
  document.getElementById("root").innerHTML =
    `<div class="authwrap"><div class="authcard"><h1>⚙️ Setup needed</h1>
     <p>Copy <code>config.example.js</code> to <code>config.js</code> and fill in your Supabase URL and anon key.</p></div></div>`;
  throw new Error("WC_CONFIG not configured");
}
const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const CONTEST = CFG.CONTEST_ID;

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
const ORDER = ["GROUP", "R32", "R16", "QF", "SF", "FINAL"];
const KO = ["R32", "R16", "QF", "SF", "FINAL"];
const rIdx = (k) => ORDER.indexOf(k);
const PAGES = [["overview","Overview"],["rules","Rules"],["group","Group Picks"],
  ["knockout","Knockout"],["standings","Standings"],["history","Pick History"],["tracker","Entry Tracker"]];

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const ST = {
  user:null, page:"overview", koView:"R32",
  contest:null, teams:{}, teamList:[], rounds:{}, advancers:{}, entries:[], picks:{}, isAdmin:false,
  myEntry:null, draftGroup:[], draftKO:null, adminSel:{}, busy:false, msg:null,
};
const T = (id) => ST.teams[id];
const roundDef = (k) => ST.rounds[k];

// ---------------------------------------------------------------------------
// data loading
// ---------------------------------------------------------------------------
async function loadAll() {
  const [{ data: contest }, { data: teams }, { data: rounds }, { data: adv }, { data: entries }, { data: picks }] =
    await Promise.all([
      sb.from("contests").select("*").eq("id", CONTEST).single(),
      sb.from("teams").select("*").order("group_code"),
      sb.from("rounds").select("*").eq("contest_id", CONTEST).order("sort"),
      sb.from("round_advancers").select("*").eq("contest_id", CONTEST),
      sb.from("v_entry_status").select("*").eq("contest_id", CONTEST),
      sb.from("picks").select("entry_id,round_key,team_id"),
    ]);
  ST.contest = contest;
  ST.teams = {}; ST.teamList = teams || [];
  (teams || []).forEach((t) => (ST.teams[t.id] = t));
  ST.rounds = {}; (rounds || []).forEach((r) => (ST.rounds[r.key] = r));
  ST.advancers = {}; (adv || []).forEach((a) => (ST.advancers[a.round_key] ||= new Set()).add(a.team_id));
  ST.entries = entries || [];
  ST.picks = {};
  (picks || []).forEach((p) => { (ST.picks[p.entry_id] ||= {}); (ST.picks[p.entry_id][p.round_key] ||= []).push(p.team_id); });
  ST.myEntry = ST.user ? ST.entries.find((e) => e.user_id === ST.user.id) : null;

  if (ST.user) {
    const { data: admins } = await sb.from("contest_admins").select("user_id").eq("contest_id", CONTEST);
    ST.isAdmin = (admins || []).some((a) => a.user_id === ST.user.id);
    ST._noAdminYet = (admins || []).length === 0;
  }
}

// realtime: any change to these tables triggers a reload + re-render
function subscribe() {
  sb.channel("wc-survivor")
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "round_advancers" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "picks" }, refresh)
    .subscribe();
}
let refreshTimer = null;
function refresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(async () => { await loadAll(); render(); }, 250); }

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function currentRound() { for (const k of ORDER) if (ST.rounds[k] && ST.rounds[k].status !== "resolved") return k; return "FINAL"; }
function usedTeams(entry) {
  const s = new Set(); const p = ST.picks[entry?.id] || {};
  Object.values(p).forEach((arr) => arr.forEach((t) => s.add(t))); return s;
}
function participants(roundKey) {
  if (roundKey === "GROUP") return ST.teamList.map((t) => t.id);
  const prev = ORDER[rIdx(roundKey) - 1];
  return [...(ST.advancers[prev] || [])];
}
function aliveEntering(entry, roundKey) {
  if (!entry.eliminated_round) return true;
  return rIdx(entry.eliminated_round) >= rIdx(roundKey);
}
function pickPercentages(roundKey) {
  const counts = {}; let total = 0;
  ST.entries.forEach((e) => {
    if (!aliveEntering(e, roundKey)) return;
    const picks = (ST.picks[e.id] || {})[roundKey] || [];
    if (roundKey === "GROUP") { picks.forEach((t) => (counts[t] = (counts[t] || 0) + 1)); if (picks.length) total++; }
    else if (picks.length) { counts[picks[0]] = (counts[picks[0]] || 0) + 1; total++; }
  });
  return { counts, total };
}
const flag = (id) => (T(id) ? T(id).flag : "");
const tname = (id) => (T(id) ? T(id).name : id);
function teamPill(id, used) { return `<span class="pill ${used ? "used" : ""}"><span class="flag">${flag(id)}</span>${tname(id)}</span>`; }
function toast(m) { ST.msg = m; render(); setTimeout(() => { if (ST.msg === m) { ST.msg = null; render(); } }, 4000); }

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
async function signInEmail() {
  const email = document.getElementById("email")?.value?.trim();
  if (!email) return toast("Enter your email.");
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
  toast(error ? "Error: " + error.message : "Magic link sent — check your email.");
}
async function signInGoogle() {
  await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
}
async function signOut() { await sb.auth.signOut(); location.reload(); }

// ---------------------------------------------------------------------------
// actions (mutations)
// ---------------------------------------------------------------------------
async function joinContest() {
  const name = document.getElementById("joinname")?.value?.trim() ||
    ST.user.email?.split("@")[0] || "Entry";
  const { error } = await sb.rpc("join_contest", { p_contest: CONTEST, p_display_name: name });
  if (error) return toast("Error: " + error.message);
  await loadAll(); toast("You're in! Make your 4 group picks."); ST.page = "group"; render();
}
async function claimAdmin() {
  const { error } = await sb.rpc("claim_contest_admin", { p_contest: CONTEST });
  if (error) return toast("Error: " + error.message);
  await loadAll(); toast("You are now the commissioner."); render();
}
async function saveGroup() {
  if (ST.draftGroup.length !== 4) return;
  const { error } = await sb.rpc("submit_group_picks", { p_entry: ST.myEntry.id, p_teams: ST.draftGroup });
  if (error) return toast("Error: " + error.message);
  await loadAll(); toast("Group picks saved!"); render();
}
async function saveKO(round) {
  if (!ST.draftKO) return;
  const { error } = await sb.rpc("submit_ko_pick", { p_entry: ST.myEntry.id, p_round: round, p_team: ST.draftKO });
  if (error) return toast("Error: " + error.message);
  ST.draftKO = null; await loadAll(); toast("Pick saved for " + roundDef(round).name + "!"); render();
}
// admin
async function adminStatus(round, status) {
  const { error } = await sb.rpc("set_round_status", { p_contest: CONTEST, p_round: round, p_status: status });
  if (error) toast("Error: " + error.message); else { await loadAll(); render(); }
}
async function adminLock(round) {
  const v = document.getElementById("lock-" + round)?.value;
  const ts = v ? new Date(v).toISOString() : null;
  const { error } = await sb.rpc("set_round_lock", { p_contest: CONTEST, p_round: round, p_lock_at: ts });
  if (error) toast("Error: " + error.message); else { await loadAll(); toast("Deadline updated."); render(); }
}
async function adminResolve(round) {
  const sel = [...(ST.adminSel[round] || [])];
  if (!sel.length && !confirm("Resolve " + round + " with NO advancers? Everyone with a pick here is eliminated.")) return;
  const { error } = await sb.rpc("resolve_round", { p_contest: CONTEST, p_round: round, p_advancers: sel });
  if (error) toast("Error: " + error.message); else { ST.adminSel[round] = new Set(); await loadAll(); toast(round + " resolved."); render(); }
}
async function adminSync() {
  toast("Syncing real results…");
  const { data, error } = await sb.functions.invoke("sync-results", { body: { contest_id: CONTEST } });
  if (error) return toast("Sync error: " + error.message);
  await loadAll(); toast("Sync complete: " + JSON.stringify(data?.actions || data)); render();
}

// ---------------------------------------------------------------------------
// click delegation (module scope => no inline handlers)
// ---------------------------------------------------------------------------
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act, team = el.dataset.team, round = el.dataset.round, page = el.dataset.page;
  const acts = {
    nav: () => { ST.page = page; ST.msg = null; window.scrollTo(0, 0); render(); },
    "login-email": signInEmail, "login-google": signInGoogle, signout: signOut,
    join: joinContest, "claim-admin": claimAdmin,
    "group-toggle": () => { const i = ST.draftGroup.indexOf(team); if (i >= 0) ST.draftGroup.splice(i, 1); else if (ST.draftGroup.length < 4) ST.draftGroup.push(team); render(); },
    "group-clear": () => { ST.draftGroup = []; render(); },
    "group-save": saveGroup,
    "ko-view": () => { ST.koView = round; ST.draftKO = null; render(); },
    "ko-pick": () => { ST.draftKO = team; render(); },
    "ko-save": () => saveKO(round),
    "admin-open": () => adminStatus(round, "open"), "admin-lock": () => adminStatus(round, "locked"),
    "admin-reopen": () => adminStatus(round, "open"),
    "admin-setlock": () => adminLock(round),
    "admin-advtoggle": () => { (ST.adminSel[round] ||= new Set()); ST.adminSel[round].has(team) ? ST.adminSel[round].delete(team) : ST.adminSel[round].add(team); render(); },
    "admin-resolve": () => adminResolve(round),
    "admin-sync": adminSync,
  };
  if (acts[a]) { ev.preventDefault(); acts[a](); }
});

// ===========================================================================
// RENDER
// ===========================================================================
function render() {
  const root = document.getElementById("root");
  if (!ST.user) { root.innerHTML = viewAuth(); return; }
  if (!ST.myEntry) { root.innerHTML = shell(viewJoin()); return; }
  const body = ({ overview: pgOverview, rules: pgRules, group: pgGroup, knockout: pgKnockout,
    standings: pgStandings, history: pgHistory, tracker: pgTracker, admin: pgAdmin }[ST.page] || pgOverview)();
  root.innerHTML = shell(body);
}

function shell(inner) {
  const cr = currentRound(), ph = roundDef(cr)?.status;
  const alive = ST.entries.filter((e) => e.alive).length;
  const navItems = [...PAGES]; if (ST.isAdmin) navItems.push(["admin", "🛠️ Admin"]);
  const phaseLbl = { open: "Picks Open", locked: "Picks Locked", resolved: "Resolved", upcoming: "Upcoming" }[ph] || "";
  return `
  <div class="topbar">
    <div class="topbar-inner">
      <div class="brand"><span class="ball">⚽</span><div>World Cup 2026 Survivor<small>${ST.contest?.name || ""}</small></div></div>
      <div class="nav">
        ${navItems.map(([k, n]) => `<button class="${ST.page === k ? "active" : ""}" data-act="nav" data-page="${k}">${n}</button>`).join("")}
        <span class="userchip">· ${ST.user.email || "signed in"} <button class="btn ghost sm" data-act="signout">Sign out</button></span>
      </div>
    </div>
    <div class="statusstrip">
      <span><span class="dot live"></span><b>${roundDef(cr)?.name || ""}</b> · ${phaseLbl}</span>
      <span>Entries: <b>${ST.entries.length}</b></span>
      <span>Alive: <b style="color:var(--green)">${alive}</b></span>
      <span>Eliminated: <b style="color:var(--red)">${ST.entries.length - alive}</b></span>
      <span class="right">${roundDef(cr)?.lock_at ? "Locks: " + new Date(roundDef(cr).lock_at).toLocaleString() : ""}</span>
    </div>
  </div>
  <div class="wrap">
    ${ST.msg ? `<div class="notice info"><span>ℹ️</span><div>${ST.msg}</div></div>` : ""}
    ${inner}
    <div class="footer">Multi-user · live results · <a href="../../games.html">← Games</a></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// auth + join views
// ---------------------------------------------------------------------------
function viewAuth() {
  return `<div class="authwrap"><div class="authcard">
    <h1>⚽ World Cup 2026 Survivor</h1>
    <p>Sign in to join the pool. Last entry standing wins.</p>
    ${ST.msg ? `<div class="notice info"><span>ℹ️</span><div>${ST.msg}</div></div>` : ""}
    <input class="field" id="email" type="email" placeholder="you@email.com" autocomplete="email">
    <button class="btn block" data-act="login-email">Email me a magic link</button>
    <div class="divider">or</div>
    <button class="gbtn" data-act="login-google">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.7 38 46.5 31.8 46.5 24.5z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.9 2.3-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
      Continue with Google
    </button>
  </div></div>`;
}
function viewJoin() {
  return `<h1 class="page">Join the pool</h1>
  <p class="sub">Pick a display name other players will see on the leaderboard.</p>
  <div class="panel" style="max-width:480px">
    <input class="field" id="joinname" placeholder="Display name" value="${(ST.user.email || "").split("@")[0]}">
    <button class="btn block" data-act="join">Join contest →</button>
    ${ST._noAdminYet ? `<p class="muted" style="margin-top:14px;font-size:.82rem">No commissioner yet. After joining you can <b>claim commissioner</b> rights from the Admin tab to manage rounds &amp; results.</p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Overview
// ---------------------------------------------------------------------------
function pgOverview() {
  const alive = ST.entries.filter((e) => e.alive).length;
  const you = ST.myEntry, st = you;
  let winnerBanner = "";
  if (roundDef("FINAL")?.status === "resolved") {
    const surv = ST.entries.filter((e) => e.alive);
    winnerBanner = surv.length
      ? `<div class="notice ok"><span>🏆</span><div><b>Contest complete!</b> ${surv.length === 1
          ? `<b>${surv[0].display_name}</b> is the sole survivor and wins ${ST.contest.prize_pool || "the pool"}.`
          : `Co-winners: ${surv.map((s) => s.display_name).join(", ")}. ${ST.contest.tiebreaker || ""}`}</div></div>`
      : `<div class="notice warn"><span>🤷</span><div>No entry survived the Final.</div></div>`;
  }
  const gp = (ST.picks[you.id] || {}).GROUP || [];
  return `
  <h1 class="page">${ST.contest.name}</h1>
  <p class="sub">A live, multi-user Splash-style survivor pool · 48 teams · 12 groups · wired to real results</p>
  ${winnerBanner}
  ${ST._noAdminYet && !ST.isAdmin ? `<div class="notice warn"><span>🛠️</span><div>No commissioner has been set. <button class="btn sm" data-act="claim-admin">Claim commissioner role</button></div></div>` : ""}
  <div class="grid cols-4" style="margin-bottom:20px">
    <div class="stat blue"><div class="num">${ST.entries.length}</div><div class="lbl">Entries</div></div>
    <div class="stat green"><div class="num">${alive}</div><div class="lbl">Alive</div></div>
    <div class="stat red"><div class="num">${ST.entries.length - alive}</div><div class="lbl">Eliminated</div></div>
    <div class="stat amber"><div class="num">${ST.contest.prize_pool || "—"}</div><div class="lbl">Prize Pool</div></div>
  </div>
  <div class="grid cols-2">
    <div class="panel">
      <h2>📋 How it works</h2>
      <div class="step"><div class="n">1</div><div class="body"><h4>Group Stage</h4><p>Pick <b>exactly 4 teams</b> to reach the Round of 32. If any fail, you're out.</p></div></div>
      <div class="step"><div class="n">2</div><div class="body"><h4>Knockout Stage</h4><p>Pick <b>1 team per round</b> (R32→R16→QF→SF→Final). Wins in regulation, extra time, or penalties all count.</p></div></div>
      <div class="step"><div class="n">3</div><div class="body"><h4>One &amp; done</h4><p>Each team can be used <b>only once</b> all contest. One wrong pick eliminates you.</p></div></div>
      <div class="step"><div class="n">4</div><div class="body"><h4>Last standing wins</h4><p>The final surviving entry takes the pool; multiple survivors are co-winners.</p></div></div>
    </div>
    <div class="panel">
      <h2>🎯 Your entry — ${you.display_name}</h2>
      <div class="flexrow" style="margin-bottom:14px">
        <span class="badge ${st.alive ? "alive" : "out"}">${st.alive ? "● ALIVE" : "✕ ELIMINATED — " + roundDef(st.eliminated_round).name}</span>
      </div>
      <p class="muted" style="margin-bottom:6px">Group picks (${gp.length}/4):</p>
      <div style="margin-bottom:14px">${gp.length ? gp.map((t) => teamPill(t)).join("") : '<span class="muted">None yet.</span>'}</div>
      <p class="muted" style="margin-bottom:6px">Knockout picks:</p>
      <div style="margin-bottom:16px">${KO.some((k) => (ST.picks[you.id] || {})[k]) ? KO.filter((k) => (ST.picks[you.id] || {})[k]).map((k) => `<span class="pill"><span class="tag">${roundDef(k).name}:</span> ${flag((ST.picks[you.id][k])[0])} ${tname((ST.picks[you.id][k])[0])}</span>`).join("") : '<span class="muted">None yet.</span>'}</div>
      <button class="btn" data-act="nav" data-page="${gp.length < 4 ? "group" : "knockout"}">${gp.length < 4 ? "Make Group Picks →" : "Make Knockout Picks →"}</button>
    </div>
  </div>
  <div class="panel"><h2>🗓️ Timeline</h2><div class="tablewrap"><table>
    <tr><th>Round</th><th>Pick</th><th>Status</th><th>Lock deadline</th><th class="center">Result</th></tr>
    ${ORDER.map((k) => { const r = roundDef(k); const res = ST.advancers[k];
      const resTxt = k === "FINAL" && res && res.size === 1 ? `🏆 ${flag([...res][0])} ${tname([...res][0])}` : res ? `${res.size} advanced` : "—";
      return `<tr><td><b>${r.name}</b></td><td>${r.pick_count} team${r.pick_count > 1 ? "s" : ""}</td>
        <td><span class="badge ${r.status}">${r.status}</span></td>
        <td class="muted" style="font-size:.8rem">${r.lock_at ? new Date(r.lock_at).toLocaleString() : "—"}</td>
        <td class="center">${resTxt}</td></tr>`; }).join("")}
  </table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Rules
// ---------------------------------------------------------------------------
function pgRules() {
  return `<h1 class="page">Rules</h1><p class="sub">The exact Splash-style World Cup Survivor format.</p>
  <div class="grid cols-2">
    <div class="panel"><h2>Phase 1 — Group Stage</h2><ul class="ruleslist">
      <li>Select <b>exactly 4 teams</b> to advance to the Round of 32.</li>
      <li>All 4 must be <b>unique</b>.</li><li><b>All 4</b> must advance.</li>
      <li class="no">If any fails to advance, the entry is <b>eliminated</b>.</li>
      <li class="no">Group-stage teams <b>cannot be reused</b> later.</li></ul></div>
    <div class="panel"><h2>Phase 2 — Knockout Stage</h2><p class="muted" style="margin-bottom:10px">Pick <b>1 team per round</b>:</p><ul class="ruleslist">
      <li>Round of 32 — 1 team to advance.</li><li>Round of 16 — 1 team to advance.</li>
      <li>Quarterfinals — 1 team to advance.</li><li>Semifinals — 1 team to advance.</li>
      <li>Final — 1 team to win.</li></ul></div>
    <div class="panel"><h2>What counts as a win</h2><ul class="ruleslist">
      <li>Regulation wins count.</li><li>Extra time wins count.</li><li>Penalty shootout wins count.</li>
      <li>Each team usable <b>once during the entire contest</b>.</li>
      <li class="no">Any incorrect pick <b>immediately eliminates</b> the entry.</li></ul></div>
    <div class="panel"><h2>Deadlines &amp; visibility</h2><ul class="ruleslist">
      <li>Group picks lock <b>before the opening match</b>.</li>
      <li>Knockout picks lock <b>before the first match</b> of each round.</li>
      <li><b>Before lock:</b> you see only your own picks.</li>
      <li><b>After lock:</b> all picks &amp; pick percentages are public.</li></ul></div>
    <div class="panel"><h2>Winner</h2><p class="muted" style="line-height:1.7">The <b>last surviving entry</b> wins. If multiple survive the Final, <b>co-winners</b> are declared.</p>
      <p style="margin-top:10px"><span class="badge neutral">Tiebreaker</span> ${ST.contest.tiebreaker || ""}</p></div>
    <div class="panel"><h2>Eliminated entries stay visible</h2><p class="muted" style="line-height:1.7">Out entries remain on Standings &amp; the Entry Tracker with their elimination round, so the whole pool's survival history is visible.</p></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Group picks
// ---------------------------------------------------------------------------
function pgGroup() {
  const you = ST.myEntry, r = roundDef("GROUP"), ph = r.status;
  const saved = (ST.picks[you.id] || {}).GROUP || [];
  const locked = ph !== "open" || (r.lock_at && new Date(r.lock_at) <= new Date());
  if (!ST._dgInit) { ST.draftGroup = [...saved]; ST._dgInit = true; }

  let head = "";
  if (ph === "open" && !locked) head = `<div class="notice info"><span>🔓</span><div>Picks are <b>open</b>. Choose exactly 4 teams. ${r.lock_at ? "Locks " + new Date(r.lock_at).toLocaleString() : ""}</div></div>`;
  else if (ph === "resolved") head = `<div class="notice ok"><span>✅</span><div>Group Stage resolved — ${(ST.advancers.GROUP || new Set()).size} teams advanced.</div></div>`;
  else head = `<div class="notice warn"><span>🔒</span><div>Picks are <b>locked</b>. All picks &amp; percentages are public.</div></div>`;

  if (ph === "open" && !locked) {
    const groups = [...new Set(ST.teamList.map((t) => t.group_code))].sort();
    const body = groups.map((g) => {
      const opts = ST.teamList.filter((t) => t.group_code === g).map((t) => {
        const sel = ST.draftGroup.includes(t.id), dis = !sel && ST.draftGroup.length >= 4;
        return `<button class="teamopt ${sel ? "sel" : ""}" ${dis ? "disabled" : ""} data-act="group-toggle" data-team="${t.id}">
          <span class="flag">${t.flag}</span><span class="nm">${t.name}</span><span class="str">${"★".repeat(t.strength)}</span><span class="check">${sel ? "✓" : ""}</span></button>`;
      }).join("");
      return `<div class="group"><h3>GROUP ${g}</h3>${opts}</div>`;
    }).join("");
    return `<h1 class="page">Group Stage Picks</h1><p class="sub">Pick exactly 4 teams to advance to the Round of 32.</p>${head}
      <div class="grid cols-3">${body}</div>
      <div class="selbar"><b>Selected: <span style="color:var(--green)">${ST.draftGroup.length}</span> / 4</b>
        <span class="muted">${ST.draftGroup.map((t) => flag(t) + " " + tname(t)).join(" · ") || "none yet"}</span>
        <span class="right"></span>
        <button class="btn ghost sm" data-act="group-clear">Clear</button>
        <button class="btn" ${ST.draftGroup.length !== 4 ? "disabled" : ""} data-act="group-save">Lock in 4 picks</button></div>`;
  }
  return `<h1 class="page">Group Stage Picks</h1><p class="sub">Pick exactly 4 teams to advance to the Round of 32.</p>${head}${groupResults()}`;
}
function groupResults() {
  const { counts, total } = pickPercentages("GROUP");
  const resolved = roundDef("GROUP").status === "resolved";
  const adv = resolved ? ST.advancers.GROUP || new Set() : null;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const bars = ranked.map((t) => {
    const pct = total ? Math.round((counts[t] / total) * 100) : 0, out = resolved && !adv.has(t);
    return `<div class="pctrow"><span class="lab">${flag(t)} ${tname(t)} ${resolved ? (adv.has(t) ? '<span class="badge alive">ADV</span>' : '<span class="badge out">OUT</span>') : ""}</span>
      <div class="pctbar"><i style="width:${pct}%;${out ? "background:linear-gradient(90deg,#a33,#ff5d6c)" : ""}"></i></div><span class="val">${pct}% · ${counts[t]}</span></div>`;
  }).join("");
  const rows = ST.entries.map((e) => {
    const gp = (ST.picks[e.id] || {}).GROUP || [];
    const cells = gp.map((t) => { const ok = !resolved ? "" : adv.has(t) ? 'style="color:var(--green)"' : 'style="color:var(--red);text-decoration:line-through"'; return `<span ${ok}>${flag(t)} ${tname(t)}</span>`; }).join("<br>");
    return `<tr class="${e.id === ST.myEntry.id ? "you-row" : ""}"><td><b>${e.display_name}</b>${e.id === ST.myEntry.id ? ' <span class="tag">(you)</span>' : ""}</td>
      <td>${cells || '<span class="muted">hidden until lock</span>'}</td>
      <td>${resolved ? `<span class="badge ${e.alive ? "alive" : "out"}">${e.alive ? "ALIVE" : "OUT"}</span>` : '<span class="badge locked">locked</span>'}</td></tr>`;
  }).join("");
  return `<div class="panel"><h2>📊 Group pick percentages <span class="tag">(${total} entries)</span></h2>${bars || '<p class="muted">No visible picks yet.</p>'}</div>
    <div class="panel"><h2>🗂️ All entries — Group picks</h2><div class="tablewrap"><table><tr><th>Entry</th><th>4 Group Picks</th><th>Status</th></tr>${rows}</table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Knockout picks
// ---------------------------------------------------------------------------
function pgKnockout() {
  const you = ST.myEntry;
  const nav = KO.map((k) => { const ph = roundDef(k).status; const dis = ph === "upcoming";
    return `<button class="${ST.koView === k ? "active" : ""}" ${dis ? "disabled" : ""} data-act="ko-view" data-round="${k}">${roundDef(k).name}${ph === "resolved" ? " ✓" : ""}</button>`; }).join("");
  const k = ST.koView, r = roundDef(k), ph = r.status;
  const locked = ph !== "open" || (r.lock_at && new Date(r.lock_at) <= new Date());
  const groupResolved = roundDef("GROUP").status === "resolved";
  const youAlive = aliveEntering(you, k);

  let head = "";
  if (ph === "upcoming") head = `<div class="notice info"><span>⏳</span><div>${r.name} opens once the previous round resolves.</div></div>`;
  else if (ph === "open" && !locked) head = `<div class="notice info"><span>🔓</span><div>${r.name} picks are <b>open</b>. Pick 1 team to ${k === "FINAL" ? "win it all" : "advance"}. ${r.lock_at ? "Locks " + new Date(r.lock_at).toLocaleString() : ""}</div></div>`;
  else if (ph === "resolved") head = `<div class="notice ok"><span>✅</span><div>${r.name} resolved.${k === "FINAL" && ST.advancers.FINAL ? ` Champion: <b>${flag([...ST.advancers.FINAL][0])} ${tname([...ST.advancers.FINAL][0])}</b>` : ` ${(ST.advancers[k] || new Set()).size} advanced.`}</div></div>`;
  else head = `<div class="notice warn"><span>🔒</span><div>Picks <b>locked</b> — all picks &amp; percentages public.</div></div>`;

  let body = "";
  if (ph === "upcoming") body = "";
  else if (!groupResolved) body = `<div class="notice warn"><span>ℹ️</span><div>Knockout picking opens once the Group Stage is resolved.</div></div>`;
  else if (!youAlive) body = `<div class="notice bad"><span>✕</span><div>You were eliminated in the <b>${roundDef(you.eliminated_round).name}</b>. You can still watch below.</div></div>${ph !== "open" || locked ? koResults(k) : ""}`;
  else if (ph === "open" && !locked) body = koPickUI(you, k);
  else body = koResults(k);

  return `<h1 class="page">Knockout Picks</h1><p class="sub">One team per round. Each team can be used only once — ever.</p>
    <div class="roundnav">${nav}</div>${head}${inventory(you)}${body}`;
}
function inventory(you) {
  const used = [...usedTeams(you)];
  return `<div class="panel"><h2>🎽 Your team inventory</h2><div class="grid cols-2">
    <div><p class="muted" style="margin-bottom:8px">Used (${used.length}) — can't reuse:</p><div>${used.length ? used.map((t) => teamPill(t, true)).join("") : '<span class="muted">None used yet.</span>'}</div></div>
    <div><p class="muted" style="margin-bottom:8px">Remaining available:</p><div class="muted">${ST.teamList.length - used.length} of ${ST.teamList.length} teams still available.</div></div>
  </div></div>`;
}
function koPickUI(you, k) {
  const parts = participants(k), used = usedTeams(you), cur = ((ST.picks[you.id] || {})[k] || [])[0];
  if (ST.draftKO === null) ST.draftKO = cur || null;
  const opts = parts.map((t) => { const isUsed = used.has(t) && cur !== t, sel = ST.draftKO === t;
    return `<button class="teamopt ${sel ? "sel" : ""} ${isUsed ? "used" : ""}" ${isUsed ? "disabled" : ""} data-act="ko-pick" data-team="${t}">
      <span class="flag">${flag(t)}</span><span class="nm">${tname(t)}</span><span class="tag">Grp ${T(t)?.group_code || "-"}</span><span class="str">${"★".repeat(T(t)?.strength || 0)}</span><span class="check">${sel ? "✓" : ""}</span></button>`; }).join("");
  return `<div class="panel"><h2>Pick 1 team — ${roundDef(k).name} <span class="tag">(${parts.length} teams playing)</span></h2>
    <p class="muted" style="margin-bottom:14px">Grayed teams are ones you've already used.</p>
    <div class="grid cols-3">${opts || '<p class="muted">No participants yet — waiting on results.</p>'}</div>
    <div class="selbar"><b>Your pick: <span style="color:var(--green)">${ST.draftKO ? flag(ST.draftKO) + " " + tname(ST.draftKO) : "none"}</span></b>
      <span class="right"></span><button class="btn" ${!ST.draftKO ? "disabled" : ""} data-act="ko-save" data-round="${k}">Save pick</button></div></div>`;
}
function koResults(k) {
  const { counts, total } = pickPercentages(k);
  const resolved = roundDef(k).status === "resolved", adv = resolved ? ST.advancers[k] || new Set() : null;
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const bars = ranked.map((t) => { const pct = total ? Math.round((counts[t] / total) * 100) : 0, out = resolved && !adv.has(t);
    return `<div class="pctrow"><span class="lab">${flag(t)} ${tname(t)} ${resolved ? (adv.has(t) ? '<span class="badge alive">ADV</span>' : '<span class="badge out">OUT</span>') : ""}</span>
      <div class="pctbar"><i style="width:${pct}%;${out ? "background:linear-gradient(90deg,#a33,#ff5d6c)" : ""}"></i></div><span class="val">${pct}% · ${counts[t]}</span></div>`; }).join("");
  const rows = ST.entries.filter((e) => aliveEntering(e, k)).map((e) => { const p = ((ST.picks[e.id] || {})[k] || [])[0];
    const ok = !resolved ? "" : p && adv.has(p) ? 'style="color:var(--green)"' : 'style="color:var(--red);text-decoration:line-through"';
    return `<tr class="${e.id === ST.myEntry.id ? "you-row" : ""}"><td><b>${e.display_name}</b>${e.id === ST.myEntry.id ? ' <span class="tag">(you)</span>' : ""}</td>
      <td ${ok}>${p ? flag(p) + " " + tname(p) : '<span class="muted">hidden / no pick</span>'}</td>
      <td>${resolved ? `<span class="badge ${p && adv.has(p) ? "alive" : "out"}">${p && adv.has(p) ? "ADVANCED" : "OUT"}</span>` : '<span class="badge locked">locked</span>'}</td></tr>`; }).join("");
  return `<div class="panel"><h2>📊 ${roundDef(k).name} pick percentages <span class="tag">(${total} alive)</span></h2>${bars || '<p class="muted">No visible picks.</p>'}</div>
    <div class="panel"><h2>🗂️ Surviving entries — ${roundDef(k).name}</h2><div class="tablewrap"><table><tr><th>Entry</th><th>Pick</th><th>Result</th></tr>${rows}</table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Standings
// ---------------------------------------------------------------------------
function pgStandings() {
  const list = [...ST.entries].sort((a, b) => {
    const ra = a.alive ? 99 : rIdx(a.eliminated_round), rb = b.alive ? 99 : rIdx(b.eliminated_round);
    return rb !== ra ? rb - ra : a.display_name.localeCompare(b.display_name);
  });
  const alive = list.filter((x) => x.alive).length;
  let banner = "";
  if (roundDef("FINAL").status === "resolved") {
    const surv = list.filter((x) => x.alive).map((x) => x.display_name);
    banner = surv.length ? `<div class="notice ok"><span>🏆</span><div><b>Winner${surv.length > 1 ? "s (co-winners)" : ""}:</b> ${surv.join(", ")}</div></div>` : `<div class="notice warn"><span>🤷</span><div>No survivors through the Final.</div></div>`;
  }
  const rows = list.map((e, i) => `<tr class="${e.id === ST.myEntry.id ? "you-row" : ""}">
    <td class="center"><b>${i + 1}</b></td><td><b>${e.display_name}</b>${e.id === ST.myEntry.id ? ' <span class="tag">(you)</span>' : ""}</td>
    <td>${e.alive ? '<span class="badge alive">● ALIVE</span>' : '<span class="badge out">✕ OUT</span>'}</td>
    <td>${e.alive ? roundDef(currentRound()).name : roundDef(e.eliminated_round).name}</td></tr>`).join("");
  return `<h1 class="page">Live Standings</h1><p class="sub">Survivors first; eliminated entries stay visible with their out-round.</p>${banner}
    <div class="grid cols-3" style="margin-bottom:20px">
      <div class="stat green"><div class="num">${alive}</div><div class="lbl">Alive</div></div>
      <div class="stat red"><div class="num">${ST.entries.length - alive}</div><div class="lbl">Eliminated</div></div>
      <div class="stat blue"><div class="num">${roundDef(currentRound()).name}</div><div class="lbl">Current Round</div></div></div>
    <div class="panel"><div class="tablewrap"><table><tr><th class="center">#</th><th>Entry</th><th>Status</th><th>Round Reached / Out</th></tr>${rows}</table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Pick history (yours)
// ---------------------------------------------------------------------------
function pgHistory() {
  const you = ST.myEntry, mp = ST.picks[you.id] || {};
  let rows = "";
  const gAdv = ST.advancers.GROUP, gResolved = roundDef("GROUP").status === "resolved", gp = mp.GROUP || [];
  let gRes = "—";
  if (gResolved) { const failed = gp.filter((t) => !gAdv.has(t)); gRes = failed.length ? `<span class="badge out">OUT — ${failed.map(tname).join(", ")}</span>` : `<span class="badge alive">ALL 4 ADVANCED</span>`; }
  else if (roundDef("GROUP").status !== "open") gRes = `<span class="badge locked">locked</span>`;
  rows += `<tr><td><b>Group Stage</b></td><td>${gp.length ? gp.map((t) => flag(t) + " " + tname(t)).join(", ") : '<span class="muted">no picks</span>'}</td><td>${gRes}</td></tr>`;
  KO.forEach((k) => { const ph = roundDef(k).status, p = (mp[k] || [])[0]; let res = "—";
    if (ph === "resolved" && ST.advancers[k]) res = !p ? '<span class="badge out">no pick</span>' : ST.advancers[k].has(p) ? `<span class="badge alive">${k === "FINAL" ? "CHAMPION 🏆" : "ADVANCED"}</span>` : '<span class="badge out">OUT</span>';
    else res = `<span class="badge ${ph}">${ph}</span>`;
    const reached = rIdx(k) <= (you.alive ? ORDER.length : rIdx(you.eliminated_round));
    rows += `<tr style="${reached ? "" : "opacity:.5"}"><td><b>${roundDef(k).name}</b></td><td>${p ? flag(p) + " " + tname(p) : (reached ? '<span class="muted">no pick yet</span>' : '<span class="muted">n/a</span>')}</td><td>${res}</td></tr>`; });
  return `<h1 class="page">Pick History</h1><p class="sub">Your pick-by-pick journey.</p>
    <div class="panel"><div class="flexrow" style="margin-bottom:14px"><h2 style="margin:0">${you.display_name}</h2>
      <span class="badge ${you.alive ? "alive" : "out"}">${you.alive ? "● ALIVE" : "✕ Eliminated — " + roundDef(you.eliminated_round).name}</span></div>
      <div class="tablewrap"><table><tr><th>Round</th><th>Your Pick(s)</th><th>Result</th></tr>${rows}</table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Entry tracker (everyone × every round)
// ---------------------------------------------------------------------------
function pgTracker() {
  const list = [...ST.entries].sort((a, b) => { const ra = a.alive ? 99 : rIdx(a.eliminated_round), rb = b.alive ? 99 : rIdx(b.eliminated_round); return rb !== ra ? rb - ra : a.display_name.localeCompare(b.display_name); });
  const cell = (t, k) => { if (!t) return '<span class="muted">—</span>'; if (k && roundDef(k).status === "resolved" && ST.advancers[k]) { const ok = ST.advancers[k].has(t); return `<span style="color:${ok ? "var(--green)" : "var(--red)"};${ok ? "" : "text-decoration:line-through"}">${flag(t)}</span>`; } return flag(t); };
  const head = `<tr><th>Entry</th><th>Status</th><th>Group (4)</th>${KO.map((k) => `<th>${roundDef(k).name}</th>`).join("")}</tr>`;
  const rows = list.map((e) => { const mp = ST.picks[e.id] || {}, you = e.id === ST.myEntry.id;
    const gResolved = roundDef("GROUP").status === "resolved", gAdv = gResolved ? ST.advancers.GROUP : null;
    const gp = mp.GROUP || [];
    const gcell = gp.length ? gp.map((t) => `<span title="${tname(t)}" style="color:${gResolved ? (gAdv.has(t) ? "var(--green)" : "var(--red)") : "inherit"}">${flag(t)}</span>`).join(" ") : (roundDef("GROUP").status === "open" && !you ? '<span class="badge neutral">hidden</span>' : '<span class="muted">—</span>');
    const koCells = KO.map((k) => { const p = (mp[k] || [])[0]; return `<td title="${p ? tname(p) : ""}">${p ? cell(p, k) : '<span class="muted">·</span>'}</td>`; }).join("");
    return `<tr class="${you ? "you-row" : ""}"><td><b>${e.display_name}</b>${you ? ' <span class="tag">(you)</span>' : ""}</td>
      <td><span class="badge ${e.alive ? "alive" : "out"}">${e.alive ? "ALIVE" : roundDef(e.eliminated_round).name}</span></td>
      <td style="white-space:nowrap;font-size:1.05rem">${gcell}</td>${koCells}</tr>`; }).join("");
  return `<h1 class="page">Entry Tracker</h1><p class="sub">Every entry, every round. Flags turn <span style="color:var(--green)">green</span> when a pick advanced, <span style="color:var(--red)">red</span> when it busted. Others' picks are hidden until each round locks.</p>
    <div class="panel"><div class="tablewrap"><table>${head}${rows}</table></div></div>`;
}

// ---------------------------------------------------------------------------
// PAGE: Admin (commissioner)
// ---------------------------------------------------------------------------
function pgAdmin() {
  if (!ST.isAdmin) return `<h1 class="page">Admin</h1><div class="notice bad"><span>⛔</span><div>You are not a commissioner for this contest.${ST._noAdminYet ? ' <button class="btn sm" data-act="claim-admin">Claim commissioner role</button>' : ""}</div></div>`;
  const provider = ST.contest.provider;
  const rows = ORDER.map((k) => { const r = roundDef(k); const canOpen = k === "GROUP" || roundDef(ORDER[rIdx(k) - 1]).status === "resolved";
    const lockVal = r.lock_at ? new Date(new Date(r.lock_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    return `<tr><td><b>${r.name}</b></td><td><span class="badge ${r.status}">${r.status}</span></td>
      <td><input type="datetime-local" class="field" style="margin:0;width:210px" id="lock-${k}" value="${lockVal}">
        <button class="btn ghost sm" data-act="admin-setlock" data-round="${k}">Set</button></td>
      <td class="center">
        <button class="btn ghost sm" ${r.status !== "upcoming" || !canOpen ? "disabled" : ""} data-act="admin-open" data-round="${k}">Open</button>
        <button class="btn ghost sm" ${r.status !== "open" ? "disabled" : ""} data-act="admin-lock" data-round="${k}">Lock</button>
        ${r.status === "locked" ? `<button class="btn ghost sm" data-act="admin-reopen" data-round="${k}">Reopen</button>` : ""}
      </td></tr>`; }).join("");
  // manual resolve UI for the current actionable round
  const resolveBlocks = ORDER.filter((k) => roundDef(k).status === "locked" || roundDef(k).status === "open").map((k) => {
    const parts = participants(k); if (k !== "GROUP" && !parts.length) return "";
    ST.adminSel[k] ||= new Set();
    const need = roundDef(k).advance_count;
    const chips = parts.map((t) => { const sel = ST.adminSel[k].has(t);
      return `<button class="teamopt ${sel ? "sel" : ""}" style="margin:4px;display:inline-flex;width:auto" data-act="admin-advtoggle" data-round="${k}" data-team="${t}"><span class="flag">${flag(t)}</span><span class="nm">${tname(t)}</span><span class="check">${sel ? "✓" : ""}</span></button>`; }).join("");
    return `<div class="panel commish"><h2>Resolve ${roundDef(k).name} — pick the ${need} advancing team${need > 1 ? "s" : ""} <span class="tag">(${ST.adminSel[k].size} selected)</span></h2>
      <div>${chips || '<span class="muted">No participants.</span>'}</div>
      <div class="flexrow" style="margin-top:12px"><button class="btn" data-act="admin-resolve" data-round="${k}">Resolve ${roundDef(k).name} &amp; advance ${ST.adminSel[k].size}</button>
      <span class="muted">This marks the round resolved, eliminates wrong picks, and opens the next round.</span></div></div>`;
  }).join("");
  return `<h1 class="page">🛠️ Commissioner</h1><p class="sub">Manage deadlines, locks, and results. Live API sync + manual override.</p>
    <div class="panel"><h2>Live results sync</h2>
      <p class="muted" style="margin-bottom:12px">Provider: <b>${provider || "none configured"}</b>. ${provider ? "Pull the latest fixtures &amp; auto-resolve completed rounds." : "Set <code>provider</code>, <code>provider_comp_id</code>, and a PROVIDER_API_KEY to enable auto-sync (see README). You can still resolve manually below."}</p>
      <button class="btn" data-act="admin-sync" ${!provider ? "disabled" : ""}>⟳ Sync real results now</button></div>
    <div class="panel"><h2>Rounds</h2><div class="tablewrap"><table><tr><th>Round</th><th>Status</th><th>Lock deadline</th><th class="center">Lifecycle</th></tr>${rows}</table></div>
      <p class="muted" style="margin-top:10px;font-size:.82rem">Tip: deadlines auto-lock rounds even without you here (if the cron job is installed). Resolving a round opens the next automatically.</p></div>
    ${resolveBlocks}`;
}

// ===========================================================================
// boot
// ===========================================================================
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  ST.user = session?.user || null;
  if (ST.user) { await loadAll(); subscribe(); }
  render();
  sb.auth.onAuthStateChange(async (_e, sess) => {
    const was = ST.user?.id; ST.user = sess?.user || null;
    if (ST.user?.id !== was) { if (ST.user) { await loadAll(); subscribe(); } render(); }
  });
}
boot();
