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
    const value = s
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!process.env[key]) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const CORS = process.env.CORS_ORIGIN || "*";
const BASE = "https://api.football-data.org/v4";

function send(res, status, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CORS,
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function get(url) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) {
      return reject(
        new Error("FOOTBALL_DATA_TOKEN non configurato.")
      );
    }

    const req = https.request(
      BASE + url,
      {
        headers: {
          "X-Auth-Token": TOKEN
        }
      },
      response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          let json;

          try {
            json = JSON.parse(data);
          } catch {
            json = { raw: data };
          }

          if (
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {
            resolve(json);
          } else {
            reject(
              new Error(
                `Provider HTTP ${response.statusCode}: ${
                  json.message || data
                }`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function isMilan(team) {
  const name = (team?.name || "").toLowerCase().trim();
  const shortName = (team?.shortName || "").toLowerCase().trim();

  return (
    [
      "ac milan",
      "milan",
      "a.c. milan",
      "associazione calcio milan"
    ].includes(name) ||
    ["ac milan", "milan"].includes(shortName)
  );
}

function rows(matches, teamId) {
  return (matches || [])
    .filter(match => match.status === "FINISHED")
    .sort(
      (a, b) =>
        new Date(b.utcDate) - new Date(a.utcDate)
    )
    .map(match => {
      const home = match.homeTeam?.id === teamId;

      const gf = home
        ? match.score?.fullTime?.home
        : match.score?.fullTime?.away;

      const ga = home
        ? match.score?.fullTime?.away
        : match.score?.fullTime?.home;

      if (gf == null || ga == null) return null;

      return {
        date: match.utcDate,
        gf,
        ga,
        isHome: home,
        opponent: home
          ? match.awayTeam.name
          : match.homeTeam.name,
        outcome:
          gf > ga ? "W" :
          gf === ga ? "D" :
          "L"
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function summary(matches) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;

  matches.forEach(match => {
    if (match.outcome === "W") wins++;
    else if (match.outcome === "D") draws++;
    else losses++;

    gf += match.gf;
    ga += match.ga;
  });

  return {
    form: `${wins}-${draws}-${losses}`,
    wins,
    draws,
    losses,
    gf,
    ga,
    gfPerGame: matches.length
      ? +(gf / matches.length).toFixed(2)
      : 0,
    gaPerGame: matches.length
      ? +(ga / matches.length).toFixed(2)
      : 0,
    arr: matches
  };
}

function weightedAverage(matches, key) {
  if (!matches.length) return 0;

  let numerator = 0;
  let denominator = 0;

  matches.forEach((match, index) => {
    const weight = Math.pow(0.82, index);

    numerator += match[key] * weight;
    denominator += weight;
  });

  return numerator / denominator;
}

/* ================================
   DISTRIBUZIONE DI POISSON
================================ */

function poisson(k, lambda) {
  let probability = Math.exp(-lambda);

  for (let i = 1; i <= k; i++) {
    probability *= lambda / i;
  }

  return probability;
}

/* ================================
   MODELLO PREDITTIVO
================================ */

function model(home, away, league) {

  const leagueMatches = league
    .filter(match => match.status === "FINISHED")
    .map(match => [
      match.score?.fullTime?.home,
      match.score?.fullTime?.away
    ])
    .filter(score =>
      score[0] != null &&
      score[1] != null
    );

  const leagueHomeAverage =
    leagueMatches.length
      ? leagueMatches.reduce(
          (sum, score) => sum + score[0],
          0
        ) / leagueMatches.length
      : 1.55;

  const leagueAwayAverage =
    leagueMatches.length
      ? leagueMatches.reduce(
          (sum, score) => sum + score[1],
          0
        ) / leagueMatches.length
      : 1.25;

  const homeMatches =
    home.filter(match => match.isHome);

  const awayMatches =
    away.filter(match => !match.isHome);

  const homeAttack =
    weightedAverage(
      homeMatches.length ? homeMatches : home,
      "gf"
    ) || leagueHomeAverage;

  const homeDefense =
    weightedAverage(
      homeMatches.length ? homeMatches : home,
      "ga"
    ) || leagueAwayAverage;

  const awayAttack =
    weightedAverage(
      awayMatches.length ? awayMatches : away,
      "gf"
    ) || leagueAwayAverage;

  const awayDefense =
    weightedAverage(
      awayMatches.length ? awayMatches : away,
      "ga"
    ) || leagueHomeAverage;

  /*
    Gol attesi.

    Combiniamo:
    - attacco squadra
    - difesa avversaria
    - media campionato
    - fattore casa
  */

  let lambdaHome =
    0.58 *
      Math.sqrt(
        Math.max(0.15, homeAttack) *
        Math.max(0.15, awayDefense)
      ) +
    0.42 * leagueHomeAverage;

  let lambdaAway =
    0.58 *
      Math.sqrt(
        Math.max(0.15, awayAttack) *
        Math.max(0.15, homeDefense)
      ) +
    0.42 * leagueAwayAverage;

  lambdaHome *= 1.06;
  lambdaAway *= 0.97;

  lambdaHome = Math.min(
    3.8,
    Math.max(0.2, lambdaHome)
  );

  lambdaAway = Math.min(
    3.4,
    Math.max(0.2, lambdaAway)
  );

  /* ================================
     CALCOLO DI TUTTI I RISULTATI
  ================================= */

  const scores = [];

  let probabilityHome = 0;
  let probabilityDraw = 0;
  let probabilityAway = 0;

  let probabilityOver25 = 0;
  let probabilityBTTS = 0;

  for (let homeGoals = 0; homeGoals <= 6; homeGoals++) {

    for (
      let awayGoals = 0;
      awayGoals <= 6;
      awayGoals++
    ) {

      const homeProbability =
        poisson(homeGoals, lambdaHome);

      const awayProbability =
        poisson(awayGoals, lambdaAway);

      const probability =
        homeProbability * awayProbability;

      scores.push({
        home: homeGoals,
        away: awayGoals,
        probability
      });

      if (homeGoals > awayGoals) {
        probabilityHome += probability;
      } else if (homeGoals === awayGoals) {
        probabilityDraw += probability;
      } else {
        probabilityAway += probability;
      }

      if (homeGoals + awayGoals >= 3) {
        probabilityOver25 += probability;
      }

      if (homeGoals > 0 && awayGoals > 0) {
        probabilityBTTS += probability;
      }
    }
  }

  /* ================================
     ORDINA RISULTATI
  ================================= */

  scores.sort(
    (a, b) =>
      b.probability - a.probability
  );

  const topScores = scores
    .slice(0, 5)
    .map(score => ({
      score: `${score.home}-${score.away}`,
      probability:
        +(score.probability * 100).toFixed(2)
    }));

  const total =
    probabilityHome +
    probabilityDraw +
    probabilityAway;

  const exactScore = topScores[0];

  /* ================================
     CONFIDENCE
  ================================= */

  const confidence = Math.round(
    Math.min(
      92,
      Math.max(
        45,
        52 +
          Math.min(
            20,
            Math.abs(
              probabilityHome -
              probabilityAway
            ) * 35
          ) +
          (home.length + away.length) / 3
      )
    )
  );

  return {

    /* Gol attesi */

    lambdaHome:
      +lambdaHome.toFixed(2),

    lambdaAway:
      +lambdaAway.toFixed(2),

    /* 1X2 */

    oneXtwo: {
      home:
        +(probabilityHome / total * 100)
          .toFixed(1),

      draw:
        +(probabilityDraw / total * 100)
          .toFixed(1),

      away:
        +(probabilityAway / total * 100)
          .toFixed(1)
    },

    /* Over / Under */

    over25:
      +(probabilityOver25 * 100)
        .toFixed(1),

    under25:
      +((1 - probabilityOver25) * 100)
        .toFixed(1),

    /* Both Teams To Score */

    bttsYes:
      +(probabilityBTTS * 100)
        .toFixed(1),

    bttsNo:
      +((1 - probabilityBTTS) * 100)
        .toFixed(1),

    /* RISULTATO ESATTO AUTOMATICO */

    exactScore,

    /* TOP 5 */

    topExactScores: topScores,

    /* Confidence */

    confidence,

    model:
      "Poisson · forma recente + casa/trasferta + media Serie A",

    sampleSize: {
      milan: home.length,
      opponent: away.length,
      league: leagueMatches.length
    }
  };
}

/* ================================
   SCOUTING AC MILAN
================================ */

async function scouting() {

  const current =
    await get(
      "/competitions/SA/matches?season=2026"
    );

  const matches =
    current.matches || [];

  const next =
    matches
      .filter(match =>
        new Date(match.utcDate) >= new Date() &&
        (
          isMilan(match.homeTeam) ||
          isMilan(match.awayTeam)
        )
      )
      .sort(
        (a, b) =>
          new Date(a.utcDate) -
          new Date(b.utcDate)
      )[0];

  if (!next) {
    throw new Error(
      "Nessuna prossima partita dell'AC Milan trovata."
    );
  }

  const milanTeam =
    isMilan(next.homeTeam)
      ? next.homeTeam
      : next.awayTeam;

  const opponent =
    isMilan(next.homeTeam)
      ? next.awayTeam
      : next.homeTeam;

  const [
    milanMatches,
    opponentMatches,
    previousSeason
  ] = await Promise.all([

    get(
      `/teams/${milanTeam.id}/matches?status=FINISHED&limit=20`
    ),

    get(
      `/teams/${opponent.id}/matches?status=FINISHED&limit=20`
    ),

    get(
      "/competitions/SA/matches?season=2025"
    )

  ]);

  let milanRows =
    rows(
      milanMatches.matches,
      milanTeam.id
    );

  let opponentRows =
    rows(
      opponentMatches.matches,
      opponent.id
    );

  const previousMatches =
    previousSeason.matches || [];

  if (milanRows.length < 5) {

    milanRows = [
      ...milanRows,

      ...rows(
        previousMatches.filter(
          match =>
            match.homeTeam?.id === milanTeam.id ||
            match.awayTeam?.id === milanTeam.id
        ),
        milanTeam.id
      )

    ].slice(0, 10);
  }

  if (opponentRows.length < 5) {

    opponentRows = [
      ...opponentRows,

      ...rows(
        previousMatches.filter(
          match =>
            match.homeTeam?.id === opponent.id ||
            match.awayTeam?.id === opponent.id
        ),
        opponent.id
      )

    ].slice(0, 10);
  }

  const milanIsHome =
    next.homeTeam.id === milanTeam.id;

  const prediction =
    model(
      milanIsHome
        ? milanRows
        : opponentRows,

      milanIsHome
        ? opponentRows
        : milanRows,

      previousMatches
    );

  return {

    provider:
      "football-data.org",

    updatedAt:
      new Date().toISOString(),

    team:
      "AC Milan",

    teamId:
      milanTeam.id,

    opponent:
      opponent.name,

    opponentId:
      opponent.id,

    date:
      next.utcDate,

    venue:
      next.venue || "—",

    home:
      next.homeTeam.name,

    away:
      next.awayTeam.name,

    competition:
      next.competition?.name ||
      "Serie A",

    milanForm:
      summary(milanRows),

    opponentForm:
      summary(opponentRows),

    prediction
  };
}

/* ================================
   SERVER
================================ */

http
  .createServer(async (req, res) => {

    const url =
      new URL(
        req.url,
        `http://${req.headers.host}`
      );

    if (req.method === "OPTIONS") {

      res.writeHead(204, {
        "Access-Control-Allow-Origin": CORS,
        "Access-Control-Allow-Headers":
          "Content-Type"
      });

      return res.end();
    }

    try {

      if (url.pathname === "/health") {

        return send(
          res,
          200,
          {
            ok: true,
            provider:
              "football-data.org",
            apiKeyConfigured:
              !!TOKEN,
            timestamp:
              new Date().toISOString()
          }
        );
      }

      if (
        url.pathname ===
          "/api/milan/scouting" ||
        url.pathname ===
          "/milan/scouting"
      ) {

        return send(
          res,
          200,
          await scouting()
        );
      }

      return send(
        res,
        404,
        {
          error: "Not found"
        }
      );

    } catch (error) {

      console.error(error);

      return send(
        res,
        502,
        {
          error:
            "Live data unavailable",
          message:
            error.message
        }
      );
    }

  })
  .listen(
    PORT,
    "0.0.0.0",
    () =>
      console.log(
        `AC Milan Analytics backend listening on port ${PORT}`
      )
  );
