const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

(function loadDotEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const key = s.slice(0, i).trim();
    let value = s.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const API_BASE = "https://api.football-data.org/v4";

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(API_BASE + pathname, {
      method: "GET",
      headers: {"X-Auth-Token": TOKEN, "Accept": "application/json"}
    }, r => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", c => data += c);
      r.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = {raw: data}; }
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(json);
        else reject(new Error(`Provider HTTP ${r.statusCode}: ${json.message || data}`));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function isMilan(team) {
  const n = String(team?.name || "").toLowerCase();
  const s = String(team?.shortName || "").toLowerCase();
  return n.includes("milan") || s === "milan";
}

function resultForTeam(match, teamId) {
  const home = match.homeTeam?.id === teamId;
  const gf = home ? match.score?.fullTime?.home : match.score?.fullTime?.away;
  const ga = home ? match.score?.fullTime?.away : match.score?.fullTime?.home;
  if (gf == null || ga == null) return null;
  return {gf, ga, outcome: gf > ga ? "W" : gf === ga ? "D" : "L"};
}

function summarize(matches, teamId) {
  const rows = [];
  let w=0,d=0,l=0,gf=0,ga=0;
  for (const m of matches) {
    const r = resultForTeam(m, teamId);
    if (!r) continue;
    rows.push({
      date:m.utcDate,
      opponent:m.homeTeam?.id===teamId ? m.awayTeam?.name : m.homeTeam?.name,
      gf:r.gf, ga:r.ga, outcome:r.outcome,
      competition:m.competition?.name || null
    });
    if(r.outcome==="W") w++; else if(r.outcome==="D") d++; else l++;
    gf+=r.gf; ga+=r.ga;
    if(rows.length===5) break;
  }
  return {
    form:`${w}-${d}-${l}`, wins:w, draws:d, losses:l, gf, ga,
    gfPerGame:rows.length ? +(gf/rows.length).toFixed(3) : null,
    gaPerGame:rows.length ? +(ga/rows.length).toFixed(3) : null,
    arr:rows
  };
}

async function scouting() {
  if(!TOKEN) throw new Error("FOOTBALL_DATA_TOKEN non configurato.");

  const data = await apiGet("/competitions/SA/matches?season=2026");
  const matches = data.matches || [];

  const upcoming = matches
    .filter(m => new Date(m.utcDate).getTime() >= Date.now() &&
      (isMilan(m.homeTeam) || isMilan(m.awayTeam)))
    .sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate))[0];

  if(!upcoming) throw new Error("Nessuna prossima partita del Milan trovata.");

  const milan = isMilan(upcoming.homeTeam) ? upcoming.homeTeam : upcoming.awayTeam;
  const opponent = isMilan(upcoming.homeTeam) ? upcoming.awayTeam : upcoming.homeTeam;

  const [milanData, opponentData] = await Promise.all([
    apiGet(`/teams/${milan.id}/matches?status=FINISHED&limit=10`),
    apiGet(`/teams/${opponent.id}/matches?status=FINISHED&limit=10`)
  ]);

  const sortRecent = x => (x.matches || []).sort((a,b)=>new Date(b.utcDate)-new Date(a.utcDate));
  const milanForm = summarize(sortRecent(milanData), milan.id);
  const opponentForm = summarize(sortRecent(opponentData), opponent.id);

  return {
    provider:"football-data.org",
    updatedAt:new Date().toISOString(),
    opponent:opponent.name,
    opponentId:opponent.id,
    date:upcoming.utcDate,
    venue:upcoming.venue || "—",
    home:upcoming.homeTeam.name,
    away:upcoming.awayTeam.name,
    competition:upcoming.competition?.name || "Serie A",
    milanForm,
    opponentForm,
    quality:(milanForm.arr.length>=5 && opponentForm.arr.length>=5)
      ? "Alta · fixture + ultimi 5 risultati"
      : "Media · dataset parziale"
  };
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if(req.method==="OPTIONS"){
    res.writeHead(204,{
      "Access-Control-Allow-Origin":CORS_ORIGIN,
      "Access-Control-Allow-Headers":"Content-Type"
    });
    return res.end();
  }

  if(req.method!=="GET") return send(res,405,{error:"Method not allowed"});

  try{
    if(url.pathname==="/health"){
      return send(res,200,{
        ok:true,
        provider:"football-data.org",
        apiKeyConfigured:Boolean(TOKEN),
        timestamp:new Date().toISOString()
      });
    }

    if(url.pathname==="/api/milan/scouting" || url.pathname==="/milan/scouting"){
      return send(res,200,await scouting());
    }

    return send(res,404,{error:"Not found"});
  }catch(err){
    console.error(err);
    return send(res,502,{
      error:"Live data unavailable",
      message:err.message,
      fallback:"Use the last verified local dataset in the dashboard."
    });
  }
});

server.listen(PORT,()=>console.log(`AC Milan Analytics backend listening on port ${PORT}`));
