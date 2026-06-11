// ============================================================================
// sync-results — ingest real World Cup results and resolve rounds.
// ----------------------------------------------------------------------------
// Deno Edge Function. Invoked by pg_cron (every ~5 min) or the Admin "Sync now"
// button. Runs with the SERVICE ROLE key so it can write past RLS.
//
// Flow:
//   1. Load the contest's provider config (football-data | api-football).
//   2. Fetch fixtures (+ group standings) from that provider.
//   3. Map provider teams -> our team ids (by TLA code, then by name alias).
//   4. Upsert matches for display.
//   5. For each round whose matches are all FINISHED, write round_advancers
//      and mark the round 'resolved' + open the next round.
//
// Anything the provider can't resolve cleanly is left for the commissioner to
// fix in the Admin UI (resolve_round override). Set body {"dry":true} to preview.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ROUND_ORDER = ["GROUP", "R32", "R16", "QF", "SF", "FINAL"];

// provider stage label -> our round key
const STAGE_MAP: Record<string, string> = {
  GROUP_STAGE: "GROUP", GROUP: "GROUP",
  LAST_32: "R32", ROUND_OF_32: "R32", "ROUND_OF_32_FINALS": "R32",
  LAST_16: "R16", ROUND_OF_16: "R16",
  QUARTER_FINALS: "QF", QUARTERFINALS: "QF", QUARTER_FINAL: "QF",
  SEMI_FINALS: "SF", SEMIFINALS: "SF", SEMI_FINAL: "SF",
  FINAL: "FINAL",
};

type NMatch = {
  stage: string; status: string;           // status: SCHEDULED | LIVE | FINISHED
  homeId: string | null; awayId: string | null;
  homeScore: number | null; awayScore: number | null;
  winnerId: string | null; sourceId: string; kickoff: string | null;
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");

function buildResolver(teams: { id: string; name: string }[]) {
  const byName = new Map<string, string>();
  for (const t of teams) byName.set(norm(t.name), t.id);
  // common provider-name aliases -> our team id
  const alias: Record<string, string> = {
    unitedstates: "USA", usa: "USA", southkorea: "KOR", korearepublic: "KOR",
    ivorycoast: "CIV", cotedivoire: "CIV", netherlands: "NED", holland: "NED",
    saudiarabia: "KSA", southafrica: "RSA", capeverde: "CPV", capeverdeislands: "CPV",
    curacao: "CUW", iran: "IRN", iranislamicrepublic: "IRN", czechia: "CZE",
  };
  return (providerName: string, tla?: string): string | null => {
    if (tla && teams.find((t) => t.id === tla)) return tla;       // TLA == our id
    const n = norm(providerName);
    return byName.get(n) ?? alias[n] ?? null;
  };
}

// --------------------------- provider adapters -----------------------------
// Each returns { matches, groupQualifiers? }. groupQualifiers (32 team ids) is
// supplied when the provider exposes final group standings.

async function fetchFootballData(comp: string, season: string, key: string, resolve: (n: string, t?: string) => string | null) {
  const H = { "X-Auth-Token": key };
  const base = "https://api.football-data.org/v4";
  const mRes = await fetch(`${base}/competitions/${comp}/matches?season=${season}`, { headers: H });
  if (!mRes.ok) throw new Error(`football-data matches ${mRes.status}: ${await mRes.text()}`);
  const mJson = await mRes.json();
  const matches: NMatch[] = (mJson.matches ?? []).map((m: any) => {
    const stage = STAGE_MAP[m.stage] ?? m.stage;
    const homeId = m.homeTeam ? resolve(m.homeTeam.name ?? "", m.homeTeam.tla) : null;
    const awayId = m.awayTeam ? resolve(m.awayTeam.name ?? "", m.awayTeam.tla) : null;
    let winnerId: string | null = null;
    if (m.status === "FINISHED" && m.score?.winner) {
      winnerId = m.score.winner === "HOME_TEAM" ? homeId : m.score.winner === "AWAY_TEAM" ? awayId : null;
    }
    return {
      stage, status: m.status, homeId, awayId,
      homeScore: m.score?.fullTime?.home ?? null, awayScore: m.score?.fullTime?.away ?? null,
      winnerId, sourceId: String(m.id), kickoff: m.utcDate ?? null,
    };
  });

  // group qualifiers from standings (top 2 per group + best 8 thirds)
  let groupQualifiers: string[] | undefined;
  try {
    const sRes = await fetch(`${base}/competitions/${comp}/standings?season=${season}`, { headers: H });
    if (sRes.ok) {
      const sJson = await sRes.json();
      const groups = (sJson.standings ?? []).filter((s: any) => s.type === "TOTAL" && s.group);
      const top: string[] = []; const thirds: any[] = [];
      for (const g of groups) {
        const table = g.table ?? [];
        for (let i = 0; i < table.length; i++) {
          const id = resolve(table[i].team?.name ?? "", table[i].team?.tla);
          if (!id) continue;
          if (i < 2) top.push(id);
          else if (i === 2) thirds.push({ id, pts: table[i].points, gd: table[i].goalDifference, gf: table[i].goalsFor });
        }
      }
      if (top.length === 24 && thirds.length >= 8) {
        thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        groupQualifiers = [...top, ...thirds.slice(0, 8).map((t) => t.id)];
      }
    }
  } catch (_) { /* standings optional */ }

  return { matches, groupQualifiers };
}

async function fetchApiFootball(comp: string, season: string, key: string, resolve: (n: string, t?: string) => string | null) {
  // api-football (api-sports.io). comp = league id, season = year.
  const H = { "x-apisports-key": key };
  const base = "https://v3.football.api-sports.io";
  const res = await fetch(`${base}/fixtures?league=${comp}&season=${season}`, { headers: H });
  if (!res.ok) throw new Error(`api-football fixtures ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const matches: NMatch[] = (json.response ?? []).map((f: any) => {
    const roundStr = (f.league?.round ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const stage = STAGE_MAP[roundStr] ??
      (roundStr.includes("32") ? "R32" : roundStr.includes("16") ? "R16" :
       roundStr.includes("QUARTER") ? "QF" : roundStr.includes("SEMI") ? "SF" :
       roundStr.includes("FINAL") ? "FINAL" : "GROUP");
    const homeId = resolve(f.teams?.home?.name ?? "");
    const awayId = resolve(f.teams?.away?.name ?? "");
    const finished = f.fixture?.status?.short === "FT" || f.fixture?.status?.short === "AET" || f.fixture?.status?.short === "PEN";
    let winnerId: string | null = null;
    if (finished) {
      if (f.teams?.home?.winner) winnerId = homeId;
      else if (f.teams?.away?.winner) winnerId = awayId;
    }
    return {
      stage, status: finished ? "FINISHED" : (f.fixture?.status?.short === "NS" ? "SCHEDULED" : "LIVE"),
      homeId, awayId, homeScore: f.goals?.home ?? null, awayScore: f.goals?.away ?? null,
      winnerId, sourceId: String(f.fixture?.id), kickoff: f.fixture?.date ?? null,
    };
  });
  return { matches, groupQualifiers: undefined as string[] | undefined };
}

// ------------------------------- handler -----------------------------------
Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PROVIDER_KEY = Deno.env.get("PROVIDER_API_KEY") ?? "";
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const contestId: string = body.contest_id ?? "00000000-0000-0000-0000-0000000000c1";
    const dry: boolean = !!body.dry;

    const { data: contest, error: cErr } = await db.from("contests").select("*").eq("id", contestId).single();
    if (cErr || !contest) throw new Error("Contest not found");
    if (!contest.provider) return json({ skipped: "no provider configured" }, cors);
    if (!PROVIDER_KEY) throw new Error("PROVIDER_API_KEY env not set");

    const { data: teams } = await db.from("teams").select("id,name");
    const resolve = buildResolver(teams ?? []);

    const fetcher = contest.provider === "api-football" ? fetchApiFootball : fetchFootballData;
    const { matches, groupQualifiers } = await fetcher(
      contest.provider_comp_id, contest.provider_season ?? "2026", PROVIDER_KEY, resolve);

    // upsert matches for display
    if (!dry) {
      const rows = matches.filter((m) => m.sourceId).map((m) => ({
        contest_id: contestId, round_key: m.stage, source_id: m.sourceId,
        home_team: m.homeId, away_team: m.awayId, kickoff_at: m.kickoff,
        status: m.status, home_score: m.homeScore, away_score: m.awayScore,
        winner_team: m.winnerId, updated_at: new Date().toISOString(),
      }));
      if (rows.length) await db.from("matches").upsert(rows, { onConflict: "contest_id,source_id" });
    }

    const { data: rounds } = await db.from("rounds").select("*").eq("contest_id", contestId);
    const roundByKey = Object.fromEntries((rounds ?? []).map((r: any) => [r.key, r]));
    const actions: any[] = [];

    // --- GROUP: resolve from standings-derived qualifiers (the 32 advancers) ---
    if (groupQualifiers && roundByKey.GROUP && roundByKey.GROUP.status !== "resolved") {
      actions.push({ round: "GROUP", advancers: groupQualifiers.length });
      if (!dry) await resolveRound(db, contestId, "GROUP", groupQualifiers, rounds);
    }

    // --- knockout rounds: resolve when every match in the round is FINISHED ---
    for (const rk of ["R32", "R16", "QF", "SF", "FINAL"]) {
      const round = roundByKey[rk];
      if (!round || round.status === "resolved") continue;
      const rm = matches.filter((m) => m.stage === rk);
      if (rm.length === 0) continue;
      const allDone = rm.every((m) => m.status === "FINISHED");
      if (!allDone) continue;
      const winners = rm.map((m) => m.winnerId).filter((x): x is string => !!x);
      const expected = round.advance_count;
      // only auto-resolve if we got a clean, complete winner set
      if (winners.length === expected && new Set(winners).size === expected) {
        actions.push({ round: rk, advancers: winners.length });
        if (!dry) await resolveRound(db, contestId, rk, winners, rounds);
      } else {
        actions.push({ round: rk, needsReview: true, got: winners.length, expected });
      }
    }

    return json({ ok: true, dry, provider: contest.provider, matches: matches.length, actions }, cors);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, cors, 500);
  }
});

// resolve a round: write advancers, mark resolved, open the next round
async function resolveRound(db: any, contestId: string, roundKey: string, advancers: string[], rounds: any[]) {
  await db.from("round_advancers").delete().eq("contest_id", contestId).eq("round_key", roundKey);
  if (advancers.length) {
    await db.from("round_advancers").insert(
      advancers.map((t) => ({ contest_id: contestId, round_key: roundKey, team_id: t })));
  }
  await db.from("rounds").update({ status: "resolved" }).eq("contest_id", contestId).eq("key", roundKey);
  const me = rounds.find((r) => r.key === roundKey);
  const next = rounds.find((r) => r.sort === (me?.sort ?? -1) + 1);
  if (next && next.status === "upcoming") {
    await db.from("rounds").update({ status: "open" }).eq("contest_id", contestId).eq("key", next.key);
  }
}

function json(obj: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
