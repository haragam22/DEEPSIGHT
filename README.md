# Deep-Sight — Deploy & Restart Runbook

AI-powered detection and geotagging of underwater marine debris from side-scan sonar imagery.
**SIH 2026 · PS 26057 · Ministry of Earth Sciences / NIOT.**

---

## 1 · What this project is

A **sonar survey review console**. An operator loads a raw side-scan sonar survey
(`.XTF`). The app replays it the way it was recorded — the sonar waterfall scrolls,
the vessel track draws on a map — and flags man-made objects on the seabed live.

For every flagged target it outputs:

- a **latitude / longitude**
- an **error radius** (how big the search circle actually needs to be)
- the object's **real-world size in metres**
- a **class** and a confidence score

Output: a prioritised worklist plus a downloadable JSON / CSV report.

### Architecture

| Layer | Stack | Location |
|---|---|---|
| **Backend** | FastAPI + Uvicorn. XTF parsing (`pyxtf`), sonar geometry / error budget (own code), YOLO detection (`ultralytics`, weights `backend/detect/weights/best.pt`), report engine. In-memory survey store. | `backend/` |
| **Frontend** | React 19 + Vite, Leaflet map, WebSocket waterfall playback, Recharts. | `frontend-v3/` |
| **API contract** | Frozen. The only agreement between the two. | `docs/apiendpoints.md` |

- Backend serves REST on `:8000` and WebSocket playback at `/ws/surveys/{id}/playback`.
- Frontend reads `VITE_API_BASE` **at build time** (`src/lib/api.ts`); the `wss://` URL is
  derived from it automatically.
- CORS is `allow_origins=["*"]` — fine for a demo.

### Current deployment shape

```
Browser ──> Vercel (static frontend, project "deepsight")
                │  VITE_API_BASE
                ▼
        <name>.trycloudflare.com   (Cloudflare quick tunnel)
                │
                ▼
        localhost:8000  (Uvicorn on this laptop)
```

The backend runs **on this machine**. The laptop must stay on and online during any demo.

---

## 2 · Restart everything from scratch

Three terminals. Do them in order.

### Terminal 1 — backend

```powershell
cd C:\projects\deepsight
.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Verify (new window or browser): <http://localhost:8000/health> → `{"status":"ok"}`
Leave this window running.

### Terminal 2 — Cloudflare tunnel

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000
```

In the output, find the line:

```
https://<random-words>.trycloudflare.com
```

**Copy that URL.** It is different every time the tunnel restarts. Leave this window running.

### Terminal 3 — point the frontend at the new tunnel URL and redeploy

Replace the URL below with the one from Terminal 2 (no trailing slash):

```powershell
[IO.File]::WriteAllText('C:\projects\deepsight\frontend-v3\.env.production', 'VITE_API_BASE=https://<random-words>.trycloudflare.com')
cd C:\projects\deepsight\frontend-v3
vercel --prod
```

`vercel --prod` runs with no prompts — the project is already linked (`.vercel/`).
When it finishes it prints `Production: https://deepsight-<hash>.vercel.app`.

### Verify end to end

1. Open the Vercel production URL.
2. DevTools → Network: `GET /api/surveys` should hit the `trycloudflare.com` host and
   return `{"surveys":[]}`.
3. Upload a sonar image (`POST /api/surveys/image`) → survey reaches `status: complete`,
   the playback WebSocket streams, detections draw on the map.

---

## 3 · One-time setup (already done — for reference / a new machine)

```powershell
# backend deps
cd C:\projects\deepsight
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# tools
npm i -g vercel
winget install --id Cloudflare.cloudflared

# vercel auth + project link (run once, answer the prompts)
vercel login
cd C:\projects\deepsight\frontend-v3
vercel --prod
#   Which project? -> create new, name "deepsight"
#   Code directory? -> ./
#   Customize settings? -> N   (auto-detected: Vite, build "vite build", output "dist")

# frontend deploy config (committed once)
[IO.File]::WriteAllText('C:\projects\deepsight\frontend-v3\vercel.json', '{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }')
```

**Vercel dashboard, one time:** project **deepsight** → Settings → Deployment Protection →
Vercel Authentication → **Disabled** → Save. Otherwise visitors hit a sign-in wall.

---

## 4 · Run fully local (no tunnel, no Vercel)

```powershell
# terminal 1
cd C:\projects\deepsight
.venv\Scripts\Activate.ps1
python -m uvicorn backend.main:app --port 8000

# terminal 2
cd C:\projects\deepsight\frontend-v3
npm install
npm run dev
```

Open <http://localhost:5373>. The Vite dev server proxies `/api`, `/ws`, `/health` to
`:8000`, so `VITE_API_BASE` is not needed in dev.

---

## 5 · Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Unexpected token 'tunnel'` in PowerShell | quoted exe path needs the call operator | prefix with `& ` |
| `Couldn't parse JSON file vercel.json` | `Set-Content -Encoding utf8` on PS 5.1 writes a BOM | rewrite with `[IO.File]::WriteAllText(path, content)` |
| `.env.production` ignored by Vite | same BOM problem | same fix — `[IO.File]::WriteAllText` |
| `error while attempting to bind on address ('0.0.0.0', 8000)` | backend already running on `:8000` | reuse it, or `netstat -ano \| findstr :8000` then `taskkill /PID <pid> /F` |
| Vercel URL asks to sign in / request access | Deployment Protection on | dashboard → Settings → Deployment Protection → Vercel Authentication → Disabled |
| Frontend loads but every API call fails | tunnel URL changed since last build | redo Terminal 3 (rewrite `.env.production`, `vercel --prod`) |
| Frontend calls `http://` while page is `https://` → browser blocks | `VITE_API_BASE` missing the `https://` scheme | set the full `https://...` URL, rebuild |
| "A4 & SSS" button returns 500 | needs gitignored tiles under `data/detect/yolo/images/val/` | use image upload instead |
| Survey list empty after it worked | backend restarted — store is in-memory | re-upload; state does not persist across restarts |

---

## 6 · Notes

- **Quick tunnels are ephemeral.** Every `cloudflared` restart gives a new URL and forces
  a frontend rebuild. Start the tunnel once and keep it up for the whole session.
- **Backend state is in-memory** (`SURVEYS` dict). Restarting Uvicorn drops all surveys;
  uploaded files stay on disk under `data/uploads/`.
- `data/` is gitignored and large (~8 GB: training corpus + upload scratch). Not needed to
  run the serving path — only `backend/` code and `best.pt` are.
- First detection pays the YOLO model load (~3–5 s), then it is cached.
