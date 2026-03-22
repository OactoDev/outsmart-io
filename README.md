# Outsmart.io

A real-time multiplayer pixel-art drawing party game. One player hosts on a big screen and draws; everyone else joins from their phone and tries to guess the word before the AI does.

---

## How it works

| Role | URL | Description |
|------|-----|-------------|
| **Host** | `/host` | Full drawing board + clock. Controls the room and draws the word. |
| **Players** | `/` | Mobile-friendly join screen. Enter the room code and a nickname to get in. |

1. The **host** opens `/host` on a TV/laptop, clicks **Create Room**, and shares the 4-letter room code (or QR code) with everyone.
2. **Players** open the game URL on their phones, type the room code and a nickname, then hit **Join**.
3. Once everyone is in, the host clicks **Start Game**.
4. A 3-2-1 countdown reveals the word only to the host, then the 60-second drawing clock starts.
5. Players type guesses; the AI also guesses every 15 seconds using Gemini.
6. First to guess correctly wins the round.

---

## Local development

### Prerequisites

- Node.js 18+
- A Gemini API key → [get one free at Google AI Studio](https://aistudio.google.com/app/apikey)

### Setup

```bash
git clone https://github.com/oactodev/outsmart-io.git
cd outsmart-io
npm install
```

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_key_here
```

### Run

```bash
npm run dev
# or
node server.js
```

Then open:
- Host screen → http://localhost:3000/host
- Player screen → http://localhost:3000

The server hot-reloads HTML/JS/CSS changes automatically in dev mode (no restart needed).

---

## Deployment

### Render (recommended)

1. Push the repo to GitHub.
2. In [Render](https://render.com), create a new **Web Service** and connect the repo.
3. Render will detect `render.yaml` automatically and configure everything.
4. Set the `GEMINI_API_KEY` environment variable in the Render dashboard under **Environment**.
5. Deploy — the health-check endpoint `/api/health` confirms the service is up.

### Vercel

`vercel.json` is included. Run `vercel deploy` from the project root. Set `GEMINI_API_KEY` in the Vercel project's environment variables.

> ⚠️ Vercel runs serverless functions which reset on every cold start — room state (in-memory) will not persist across invocations. For production scale on Vercel, swap `api/_lib/rooms.js` to use Vercel KV or another Redis-compatible store.

---

## Project structure

```
server.js            # HTTP server (static files + API routing)
api/
  index.js           # API request handler (all routes)
  _lib/
    events.js        # SSE event bus (real-time player updates)
    rooms.js         # In-memory room store
    words.js         # Word list
public/
  host.html          # Host drawing board
  index.html         # Player join / guess screen
  assets/            # Sprites and layer images
  js/
    drawing-engine.js
render.yaml          # Render.com deploy config
vercel.json          # Vercel deploy config
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key used for AI guessing |
| `PORT` | No | Port to listen on (default `3000`) |
| `NODE_ENV` | No | Set to `production` to disable live-reload |
