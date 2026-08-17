# AC Milan Analytics — Secure Backend v1

Questo backend alimenta la dashboard senza esporre la API key nel browser.

## 1. Prerequisiti

- Node.js 18+
- una API key di football-data.org

## 2. Configurazione

Copia `.env.example` in `.env` e inserisci:

`FOOTBALL_DATA_TOKEN=LA_TUA_CHIAVE`

Per usare `.env` senza dipendenze esterne, puoi anche impostare la variabile direttamente nel terminale.

### Windows PowerShell

`$env:FOOTBALL_DATA_TOKEN="LA_TUA_CHIAVE"; node server.js`

### macOS / Linux

`FOOTBALL_DATA_TOKEN="LA_TUA_CHIAVE" node server.js`

## 3. Avvio

`node server.js`

Endpoint:

- `GET /health`
- `GET /api/milan/scouting`

## 4. Collegamento alla dashboard

Nella dashboard v6.3 inserisci l'URL pubblico del backend, per esempio:

`https://tuo-backend.example.com/api`

La dashboard chiamerà:

`GET https://tuo-backend.example.com/api/milan/scouting`

## 5. Payload

Il backend restituisce:

- prossimo avversario
- data
- stadio
- casa/trasferta
- competizione
- ultimi risultati del Milan
- ultimi risultati dell'avversario
- W-D-L
- gol fatti/subiti
- qualità del dataset

Il Match Engine della dashboard usa questi dati per ricalcolare il predictor.

## Sicurezza

NON inserire la API key nell'HTML e NON committarla su GitHub.

Per produzione:
- usa HTTPS;
- imposta `CORS_ORIGIN` al dominio reale della dashboard invece di `*`;
- conserva la chiave come secret del provider di hosting;
- aggiungi rate limiting e logging se il progetto diventa pubblico.

## Nota

Il backend è volutamente senza framework e senza dipendenze npm: usa solo le API native di Node.js, così è facile da testare e distribuire.
