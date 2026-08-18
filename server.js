 const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 10000;

const FOOTBALL_TOKEN =
  process.env.FOOTBALL_DATA_TOKEN || "";

const MILAN_ID = 98;

app.use(cors());
app.use(express.json());

/* =========================================================
   UTILITY
========================================================= */

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function footballAPI(url) {

  if (!FOOTBALL_TOKEN) {
    throw new Error("FOOTBALL_DATA_TOKEN non configurato");
  }

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": FOOTBALL_TOKEN
    }
  });

  if (!response.ok) {
    throw new Error(
      `Football API HTTP ${response.status}`
    );
  }

  return response.json();
}


/* =========================================================
   CONVERSIONE PARTITE
========================================================= */

function convertMatch(match) {

  const isHome =
    match.homeTeam &&
    Number(match.homeTeam.id) === MILAN_ID;

  const opponent =
    isHome
      ? match.awayTeam?.name
      : match.homeTeam?.name;

  const homeGoals =
    match.score?.fullTime?.home;

  const awayGoals =
    match.score?.fullTime?.away;

  let outcome = null;

  if (
    Number.isFinite(homeGoals) &&
    Number.isFinite(awayGoals)
  ) {

    const milanGoals =
      isHome
        ? homeGoals
        : awayGoals;

    const opponentGoals =
      isHome
        ? awayGoals
        : homeGoals;

    if (milanGoals > opponentGoals)
      outcome = "W";

    else if (milanGoals === opponentGoals)
      outcome = "D";

    else
      outcome = "L";
  }

  return {

    date: match.utcDate,

    opponent: opponent || "Avversario",

    gf:
      isHome
        ? safeNumber(homeGoals)
        : safeNumber(awayGoals),

    ga:
      isHome
        ? safeNumber(awayGoals)
        : safeNumber(homeGoals),

    outcome,

    isHome,

    competition:
      match.competition?.name ||
      "Serie A"

  };

}


/* =========================================================
   CALCOLO FORMA
========================================================= */

function calculateForm(matches) {

  const finished =
    matches
      .filter(m => m.outcome)
      .slice(-5);

  let wins = 0;
  let draws = 0;
  let losses = 0;

  let goalsFor = 0;
  let goalsAgainst = 0;

  finished.forEach(match => {

    if (match.outcome === "W")
      wins++;

    else if (match.outcome === "D")
      draws++;

    else
      losses++;

    goalsFor += safeNumber(match.gf);
    goalsAgainst += safeNumber(match.ga);

  });

  const games = finished.length;

  return {

    form:
      finished
        .map(m => m.outcome)
        .join(""),

    wins,

    draws,

    losses,

    gfPerGame:
      games
        ? goalsFor / games
        : 0,

    gaPerGame:
      games
        ? goalsAgainst / games
        : 0,

    matches: finished,

    arr: finished

  };

}


/* =========================================================
   DATI DI FALLBACK
========================================================= */

function fallbackData() {

  return {

    home: "AC Milan",

    away: "Avversario",

    opponent: "Avversario",

    date: null,

    competition: "Serie A",

    milanForm: {

      form: "—",

      wins: 0,

      draws: 0,

      losses: 0,

      gfPerGame: 0,

      gaPerGame: 0,

      matches: [],

      arr: []

    },

    opponentForm: {

      form: "—",

      wins: 0,

      draws: 0,

      losses: 0,

      gfPerGame: 0,

      gaPerGame: 0,

      matches: [],

      arr: []

    },

    prediction: {

      milanGoals: 1.5,

      opponentGoals: 1.0,

      winProbability: 45,

      drawProbability: 27,

      lossProbability: 28

    },

    provider:
      FOOTBALL_TOKEN
        ? "football-data.org"
        : "Demo / fallback",

    updatedAt:
      new Date().toISOString(),

    source:
      FOOTBALL_TOKEN
        ? "football-data.org"
        : "fallback"

  };

}


/* =========================================================
   COSTRUZIONE DASHBOARD
========================================================= */

async function getDashboardData() {

  const finishedData =
    await footballAPI(
      `https://api.football-data.org/v4/teams/${MILAN_ID}/matches?status=FINISHED&limit=10`
    );

  const scheduledData =
    await footballAPI(
      `https://api.football-data.org/v4/teams/${MILAN_ID}/matches?status=SCHEDULED&limit=10`
    );

  const finished =
    (finishedData.matches || [])
      .map(convertMatch)
      .filter(m => m.outcome);

  const scheduled =
    (scheduledData.matches || [])
      .sort(
        (a, b) =>
          new Date(a.date) -
          new Date(b.date)
      );

  const next =
    scheduled[0] || null;

  const milanForm =
    calculateForm(finished);

  let opponentForm = {

    form: "—",

    wins: 0,

    draws: 0,

    losses: 0,

    gfPerGame: 0,

    gaPerGame: 0,

    matches: [],

    arr: []

  };


  /* =====================================================
     DATI AVVERSARIO
  ===================================================== */

  if (next) {

    const isHome =
      Number(next.homeTeam?.id) === MILAN_ID;

    const opponentId =
      isHome
        ? next.awayTeam?.id
        : next.homeTeam?.id;

    if (opponentId) {

      try {

        const opponentData =
          await footballAPI(
            `https://api.football-data.org/v4/teams/${opponentId}/matches?status=FINISHED&limit=5`
          );

        const opponentMatches =
          (opponentData.matches || [])
            .map(match => {

              const converted =
                convertOpponentMatch(
                  match,
                  opponentId
                );

              return converted;

            })
            .filter(m => m.outcome);

        opponentForm =
          calculateForm(
            opponentMatches
          );

      } catch (error) {

        console.log(
          "Errore dati avversario:",
          error.message
        );

      }

    }

  }


  /* =====================================================
     PREVISIONE
  ===================================================== */

  const milanGF =
    milanForm.gfPerGame || 1.4;

  const milanGA =
    milanForm.gaPerGame || 1.2;

  const opponentGF =
    opponentForm.gfPerGame || 1.2;

  const opponentGA =
    opponentForm.gaPerGame || 1.2;


  const milanGoals =
    Math.max(
      0.1,
      (milanGF + opponentGA) / 2
    );

  const opponentGoals =
    Math.max(
      0.1,
      (opponentGF + milanGA) / 2
    );


  let winProbability =
    milanGoals /
    (
      milanGoals +
      opponentGoals +
      1
    );

  winProbability =
    Math.max(
      0.15,
      Math.min(
        0.70,
        winProbability
      )
    );


  let win =
    Math.round(
      winProbability * 100
    );

  let draw = 27;

  let loss =
    100 - win - draw;

  if (loss < 10) {

    loss = 10;

    win =
      100 -
      draw -
      loss;

  }


  return {

    home:
      next?.homeTeam?.name ||
      "AC Milan",

    away:
      next?.awayTeam?.name ||
      "Avversario",

    opponent:
      next?.homeTeam?.id === MILAN_ID
        ? next?.awayTeam?.name
        : next?.homeTeam?.name,

    date:
      next?.utcDate ||
      null,

    competition:
      next?.competition?.name ||
      "Serie A",

    milanForm,

    opponentForm,

    prediction: {

      milanGoals,

      opponentGoals,

      winProbability: win,

      drawProbability: draw,

      lossProbability: loss

    },

    provider:
      "football-data.org",

    updatedAt:
      new Date().toISOString()

  };

}


/* =========================================================
   CONVERSIONE AVVERSARIO
========================================================= */

function convertOpponentMatch(
  match,
  opponentId
) {

  const isHome =
    Number(match.homeTeam?.id) ===
    Number(opponentId);

  const homeGoals =
    match.score?.fullTime?.home;

  const awayGoals =
    match.score?.fullTime?.away;

  const gf =
    isHome
      ? safeNumber(homeGoals)
      : safeNumber(awayGoals);

  const ga =
    isHome
      ? safeNumber(awayGoals)
      : safeNumber(homeGoals);

  let outcome;

  if (gf > ga)
    outcome = "W";

  else if (gf === ga)
    outcome = "D";

  else
    outcome = "L";

  return {

    date: match.utcDate,

    opponent:
      isHome
        ? match.awayTeam?.name
        : match.homeTeam?.name,

    gf,

    ga,

    outcome,

    isHome

  };

}


/* =========================================================
   ROUTE PRINCIPALE
========================================================= */

app.get("/", async (req, res) => {

  try {

    const data =
      await getDashboardData();

    res.json(data);

  } catch (error) {

    console.error(
      "Dashboard error:",
      error.message
    );

    /*
      IMPORTANTE:
      Anche se l'API esterna non risponde,
      il backend resta ONLINE.
    */

    res.json(
      fallbackData()
    );

  }

});


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: "online",

    service:
      "AC Milan Analytics Backend",

    timestamp:
      new Date().toISOString(),

    footballApi:
      FOOTBALL_TOKEN
        ? "configured"
        : "missing"

  });

});


/* =========================================================
   NEWS
========================================================= */

app.get(
  "/api/milan/news",
  async (req, res) => {

    try {

      const rss =
        await fetch(
          "https://feeds.bbci.co.uk/sport/football/teams/ac-milan/rss.xml"
        );

      if (!rss.ok)
        throw new Error(
          "RSS non disponibile"
        );

      const xml =
        await rss.text();

      const items = [];

      const matches =
        xml.match(
          /<item>([\s\S]*?)<\/item>/g
        ) || [];

      matches
        .slice(0, 8)
        .forEach(item => {

          const title =
            item.match(
              /<title>([\s\S]*?)<\/title>/
            );

          const link =
            item.match(
              /<link>([\s\S]*?)<\/link>/
            );

          const description =
            item.match(
              /<description>([\s\S]*?)<\/description>/
            );

          items.push({

            title:
              cleanXML(
                title?.[1] || ""
              ),

            description:
              cleanXML(
                description?.[1] || ""
              ),

            link:
              cleanXML(
                link?.[1] || ""
              )

          });

        });

      res.json({

        news: items,

        updatedAt:
          new Date().toISOString()

      });

    } catch (error) {

      console.error(
        "News error:",
        error.message
      );

      res.json({

        news: [

          {

            title:
              "News Milan",

            description:
              "Il servizio news non è temporaneamente disponibile."

          }

        ]

      });

    }

  }
);


/* =========================================================
   CLEAN XML
========================================================= */

function cleanXML(value) {

  return String(value)

    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      "$1"
    )

    .replace(
      /<[^>]*>/g,
      ""
    )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      '"'
    )

    .replace(
      /&#39;/g,
      "'"
    )

    .trim();

}


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (req, res) => {

    res.status(404).json({

      error:
        "Endpoint non trovato",

      path:
        req.originalUrl

    });

  }
);


/* =========================================================
   AVVIO SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `AC Milan Analytics Backend online sulla porta ${PORT}`
    );

    console.log(
      `Football API: ${
        FOOTBALL_TOKEN
          ? "CONFIGURATA"
          : "NON CONFIGURATA"
      }`
    );

  }
);
