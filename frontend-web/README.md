# Debate Arena — Observer Mode Web App

A React (Vite) web client for Realtime Debate Arena's **Observer Mode**. Point it
at a debate livestream URL, pick one or more AI **moderators** (OpenAI, Anthropic,
Grok, Gemini), and watch them fact-check and score the debate **in parallel, in
real time** — so you can compare how their biases diverge. Each moderator's final
conclusion can be exported to **PDF**.

## How it works

```
Livestream URL ──▶ backend ingest + transcribe ──▶ live transcript (WebSocket)
                                              └──▶ N moderator models (parallel)
                                                     ├─ live fact-checks
                                                     ├─ rolling per-speaker scores
                                                     └─ final analysis + winner ──▶ PDF
```

The backend ships a **simulation mode** (default), so the full pipeline runs with
**zero API keys**: a synthetic two-speaker debate is transcribed and each model
analyzes it through a distinct, deterministic bias persona. Add provider keys and
set `MODERATOR_SIMULATION=true` in the backend to use the real model APIs.

## Run it

1. Start the backend (defaults to `http://localhost:5000`):

```bash
cd ../backend
npm install
npm start
```

2. Start this web app:

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`). The dev server proxies
`/api` (REST + WebSocket) to the backend; override the target with
`VITE_API_TARGET` if your backend runs elsewhere.

## Features

- **Simple mode** — one URL + model picker + "declare a winner" toggle.
- **Parallel moderators** — side-by-side columns, each with its own live
  fact-check feed, commentary, and weighted scoreboard.
- **Comparison bar** — flags when the models disagree on the winner.
- **PDF export** — per-model report with conclusion, winner, scorecard, and the
  full fact-check log (generated client-side with jsPDF).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
