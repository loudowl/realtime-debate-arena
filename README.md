# Realtime Debate Arena

> A platform for engaging in structured **voice debates** on trending topics, with **AI moderation**, **real-time fact-checking**, and **live audience voting**.

Realtime Debate Arena pairs debaters in real-time audio rooms, uses AI to moderate and fact-check arguments as they happen, and lets the audience score the debate live. Debates can be archived and turned into shareable highlights.

> [!NOTE]
> This repository is currently an early-stage **scaffold**. The backend exposes mock REST handlers, the React Native client ships placeholder screens, and the data layer has a starter migration. The architecture below reflects the intended design documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); see [Project Status](#project-status) for what is actually implemented today.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Backend setup](#2-backend-setup)
  - [3. Database setup](#3-database-setup)
  - [4. Frontend setup](#4-frontend-setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Available Scripts](#available-scripts)
- [Project Status](#project-status)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Real-time voice debates** — peer-to-peer audio between matched debaters via WebRTC.
- **AI moderation & fact-checking** — live speech analysis using the OpenAI Realtime API and Agents SDK.
- **Live audience voting** — low-latency vote tallying backed by Redis.
- **Debate archives** — debates and results persisted in PostgreSQL for replay and sharing.
- **Cross-platform client** — a single React Native codebase targeting iOS, Android, and web.

See the [Product Requirements Document](docs/PRD.md) for the full feature breakdown and prioritization.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React Native 0.71, React 18, React Navigation 6, Redux Toolkit |
| **Real-time audio** | WebRTC |
| **Backend** | Node.js 18, Express 4 |
| **Database** | PostgreSQL 15 |
| **Cache / real-time** | Redis 7 |
| **AI** | OpenAI Realtime API + Agents SDK |
| **Hosting** | AWS (Elastic Beanstalk, RDS, ElastiCache) |
| **CI/CD** | GitHub Actions |

---

## Architecture

```mermaid
flowchart TD
    subgraph Client["Mobile / Web Client (React Native)"]
        UI["Screens & Components"]
        Store["Redux Store"]
        RTC["WebRTC Audio"]
    end

    subgraph Backend["Backend API (Node.js + Express)"]
        Auth["Auth Routes\n/api/auth"]
        Debates["Debate Routes\n/api/debates"]
        AI["AI Moderation\n/api/ai"]
    end

    subgraph Data["Data & Real-time Layer"]
        PG[("PostgreSQL\nusers, debates, votes")]
        Redis[("Redis\nlive voting & sessions")]
    end

    subgraph External["External Services"]
        OpenAI["OpenAI Realtime API\n+ Agents SDK"]
    end

    UI --> Store
    UI <-->|"peer-to-peer audio"| RTC
    Store -->|"REST / JSON"| Auth
    Store -->|"REST / JSON"| Debates
    RTC -->|"speech stream"| AI

    Auth --> PG
    Debates --> PG
    Debates -->|"live tallies"| Redis
    AI -->|"moderation & fact-check"| OpenAI
    AI --> Redis
```

**Request flow at a glance:**

1. The client authenticates against `/api/auth` and receives a JWT.
2. Debaters are matched and connected over WebRTC for low-latency audio.
3. Speech is streamed to the AI moderation service, which calls OpenAI for fact-checking and moderation.
4. Audience votes are written to Redis for real-time tallies and persisted to PostgreSQL for archives.

For full details on data models, authentication flow, and deployment topology, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Project Structure

```
realtime-debate-arena/
├── backend/                 # Node.js + Express API
│   ├── src/
│   │   ├── models/          # Data models (e.g. user.js)
│   │   ├── routes/          # Express routes (auth.js, debates.js)
│   │   └── app.js           # App entrypoint & middleware
│   ├── .env.example         # Backend environment template
│   └── package.json
│
├── frontend/                # React Native client
│   ├── src/
│   │   ├── screens/         # HomeScreen, DebateScreen
│   │   ├── redux/           # store.js + reducers
│   │   └── App.js           # Navigation & providers
│   └── package.json
│
├── database/
│   └── migrations.js        # Table creation script
│
├── docs/                    # PRD, architecture, and design docs
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── DESIGN.md
│
└── README.md
```

---

## Prerequisites

Make sure the following are installed and available on your machine:

- **Node.js** v18.12.0 (an `.nvmrc`-friendly LTS; use `nvm install 18` if needed)
- **npm** v9+ (bundled with Node 18)
- **PostgreSQL** v15 — running locally or reachable via a connection string
- **Redis** v7.0 — for real-time voting and session state
- An **OpenAI API key** — for AI moderation and fact-checking
- **React Native tooling** (for running the mobile client):
  - **iOS:** macOS with Xcode + CocoaPods
  - **Android:** Android Studio with an SDK and emulator
  - See the official [React Native environment setup guide](https://reactnative.dev/docs/environment-setup)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/loudowl/realtime-debate-arena.git
cd realtime-debate-arena
```

### 2. Backend setup

```bash
cd backend
npm install

# Create your environment file from the template
cp .env.example .env
# then edit .env with your real values (see Environment Variables below)
```

Start the API server:

```bash
npm start
```

The server runs on `http://localhost:5000` by default (configurable via `PORT`). You should see:

```
Server is running on port 5000
```

Quick smoke test in another terminal:

```bash
curl http://localhost:5000/api/debates
# => {"debates":[{"id":"1","topic":"Climate Change","participants":["user1","user2"],"status":"ongoing"}]}
```

### 3. Database setup

Make sure PostgreSQL is running and that `DATABASE_URL` in `backend/.env` points to a database you have created, e.g.:

```bash
createdb debatearena
```

Then run the migration script to create the initial tables (`users`, `debates`):

```bash
cd backend
npm run migrate
# => Database setup complete.
```

### 4. Frontend setup

In a separate terminal:

```bash
cd frontend
npm install
```

For iOS, install native pods (macOS only):

```bash
cd ios && pod install && cd ..
```

Run the app:

```bash
# Start the Metro bundler
npm start

# In another terminal, launch a platform target:
npm run ios       # iOS simulator
npm run android   # Android emulator / device
```

> [!TIP]
> The client talks to the backend at `http://localhost:5000`. On Android emulators, `localhost` refers to the emulator itself — use `10.0.2.2` (or your machine's LAN IP) when configuring the API base URL.

---

## Environment Variables

Backend configuration lives in `backend/.env` (copy from `backend/.env.example`):

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Port the API server listens on | `5000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:password@localhost:5432/debatearena` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `OPENAI_API_KEY` | OpenAI API key for AI moderation | `sk-...` |

> [!WARNING]
> Never commit your real `.env` file or secrets to version control. Only `.env.example` (with placeholder values) belongs in the repo.

---

## API Reference

Base URL: `http://localhost:5000`

### Authentication

#### `POST /api/auth/register`

Register a new user.

```json
// Request
{ "username": "string", "email": "string", "password": "string" }

// Response
{ "message": "User registered successfully", "userId": "12345" }
```

#### `POST /api/auth/login`

Authenticate and receive a token.

```json
// Request
{ "email": "string", "password": "string" }

// Response
{ "token": "fake-jwt-token", "userId": "12345" }
```

### Debates

#### `GET /api/debates`

List debates.

```json
// Response
{
  "debates": [
    { "id": "1", "topic": "Climate Change", "participants": ["user1", "user2"], "status": "ongoing" }
  ]
}
```

#### `POST /api/debates`

Create a new debate.

```json
// Request
{ "topic": "string" }

// Response
{ "message": "Debate created successfully", "debateId": "1" }
```

> [!NOTE]
> Additional endpoints (`POST /api/debates/:debateId/vote`, `POST /api/ai/moderate`) are specified in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and are planned but not yet implemented.

---

## Available Scripts

### Backend (`backend/`)

| Script | Description |
|--------|-------------|
| `npm start` | Start the Express API server (`node src/app.js`) |
| `npm run migrate` | Create database tables (`node database/migrations.js`) |

### Frontend (`frontend/`)

| Script | Description |
|--------|-------------|
| `npm start` | Start the React Native Metro bundler |
| `npm run ios` | Build and run on the iOS simulator |
| `npm run android` | Build and run on an Android emulator/device |

---

## Project Status

This project is an early scaffold. Current state:

| Area | Status |
|------|--------|
| Backend Express app & routing | Implemented (mock handlers, no DB queries yet) |
| Auth (`/api/auth`) | Mocked responses — no real auth/JWT logic |
| Debates (`/api/debates`) | Mocked responses — no persistence |
| Database migration | Basic `users` + `debates` tables |
| Frontend navigation & screens | Placeholder Home and Debate screens |
| Redux store | Configured, no reducers/slices yet |
| WebRTC audio | Not yet implemented |
| AI moderation / fact-checking | Not yet implemented |
| Live voting (Redis) | Not yet implemented |

---

## Roadmap

Aligned with the [PRD](docs/PRD.md):

- **P0 (Must-have)**
  - [ ] Real-time voice debate matching
  - [ ] AI fact-checking during speech (OpenAI Realtime API)
  - [ ] Live audience voting & reactions (Redis)
  - [ ] Cross-platform voice processing (WebRTC)
- **P1 (Should-have)**
  - [ ] Auto-generated debate highlights for social sharing
  - [ ] Skill-based matchmaking
  - [ ] Tournament brackets and rankings
- **P2 (Nice-to-have)**
  - [ ] AI coaching with personalized feedback
  - [ ] Advanced analytics for debaters

---

## Documentation

- [Product Requirements Document](docs/PRD.md) — goals, personas, features, and scope
- [Architecture](docs/ARCHITECTURE.md) — tech stack, API design, data models, deployment
- [Design Brief](docs/DESIGN.md) — visual identity, components, and responsive strategy

---

## Contributing

Contributions are welcome! To propose a change:

1. Fork the repository and create a feature branch: `git checkout -b feature/my-feature`.
2. Make your changes, following the existing code style.
3. Commit using clear, conventional messages (e.g. `feat: add live voting endpoint`).
4. Push your branch and open a Pull Request describing the change and motivation.

For larger features, please open an issue first to discuss the approach.

---

## License

No license file is currently included in this repository. Until a license is added, the code is provided as-is and all rights are reserved by the author. If you intend to use or distribute this project, please add an appropriate license (e.g. MIT) or contact the maintainer.
