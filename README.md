# TAC Stream — Setup Guide

This app now runs on its own, independent from AppDeploy. It has two parts:

- **Frontend** (`src/`) — the app itself, what people see and use. Built with Vite/React.
- **Backend** (`backend/`) — handles camera pairing, live-signal relaying, and AI Bible
  detection. Plain Node.js/Express, with its own SQLite database file.

Both need to be running for the full app to work.

## 1. One-time setup

You'll need [Node.js](https://nodejs.org) installed (get the "LTS" version).

```bash
npm install
```

Then copy the example environment file and fill in your real keys:

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `GEMINI_API_KEY` — your Gemini API key
- `API_BIBLE_KEY` — your API.Bible key
- `SESSION_SECRET` — any long random string (the `.env.example` file shows a command to generate one)

**Important — please double check this one thing:** the `API_BIBLE_ID_*` values in
`.env.example` are translation IDs for API.Bible, filled in from general knowledge and
**not independently verified against their live API** (this was built without internet
access). Before relying on verse lookups, confirm/replace them:

```bash
curl -H "api-key: YOUR_API_BIBLE_KEY" https://api.scripture.api.bible/v1/bibles
```

Find the `id` for the translation(s) you want (e.g. KJV) in the response, and put the
correct value in `.env`.

## 2. Running it locally (on your computer, for testing)

You need two terminals open at once:

**Terminal 1 — backend:**
```bash
npm run server
```
This starts the backend on `http://localhost:8787` (or whatever `PORT` you set in `.env`).

**Terminal 2 — frontend:**
```bash
npm run dev
```
This prints a local address like `http://localhost:5173` — open that in your browser.

By default the frontend talks to the backend at the same host. For local testing, add
this to your `.env` so the frontend knows where the backend is:
```
VITE_API_URL=http://localhost:8787
```

## 3. Testing with two phones on the same WiFi

Run the frontend with `--host` so other devices on your network can reach it:
```bash
npm run dev -- --host
```
It'll print a network address like `http://192.168.x.x:5173`. Set `VITE_API_URL` in
`.env` to `http://192.168.x.x:8787` (your computer's network IP, backend port) so phones
can reach the backend too. Then open the `192.168.x.x:5173` address on both phones —
one as Director, one as Camera.

## 4. Putting it online for a real trial (not just local WiFi)

For a real trial usable from anywhere (not just your home WiFi), deploy the backend to a
free/cheap host like [Render](https://render.com) or [Railway](https://railway.app):

1. Push this code to a GitHub repository.
2. On Render/Railway, create a new "Web Service" from that repo.
3. Set the build command: `npm install && npm run server:build`
4. Set the start command: `npm run server:start`
5. Add all the same environment variables from your `.env` file in their dashboard
   (never commit your real `.env` file to GitHub — it's already in `.gitignore`).
6. Once deployed, you'll get a URL like `https://tac-stream-backend.onrender.com`.

Then deploy the frontend (e.g. on [Vercel](https://vercel.com) or [Netlify](https://netlify.com),
both free for this scale):
1. Set `VITE_API_URL` to your deployed backend's URL in their environment variable settings.
2. Deploy — you'll get a link like `https://tac-stream.vercel.app`.

That link is what you'd share for testing — open it on Android or iPhone in the browser,
and "Add to Home Screen" for an app-like experience.

## 5. A note on the database

The backend stores data in a local SQLite file (`backend/data/tac-stream.sqlite`), created
automatically on first run. This is fine for testing and small trials. If usage grows
significantly (many concurrent productions, need for backups/replication), that file-based
database should be migrated to a hosted database — a task for later, not now.

## 6. Known honest caveats

- This was rewritten and reviewed carefully, but never actually run or built (no internet
  access in the environment it was written in). Please run through steps 1–3 above and
  report anything that breaks.
- The API.Bible translation IDs need your confirmation (see step 1).
- The AI Bible detection pipeline (Gemini → API.Bible) has never been tested end-to-end
  with real spoken input — this is the first real chance to do that once it's running.
