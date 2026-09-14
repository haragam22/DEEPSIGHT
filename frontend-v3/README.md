# Deep-Sight  Console (v3)

Third front end. Same backend contract as v1/v2. **No home page.** The instrument
console is the working screen; supporting pages (Surveys / Detections / Reports /
About) sit under a **top nav bar** instead of a sidebar. Fully offline (bundled
fonts, no basemap tiles).

> This diverges on purpose from `docs/implementation_P.md` §1/§3 (single-screen
> console, minimal motion): multipage, plus a first-run walkthrough. Chosen by the
> project owner. The **console screen itself still follows** implementation_P.md.

## First-run walkthrough  `src/pages/Onboarding.tsx`

Six chapters stepped with Previous / Next / Skip, a `Dock` step rail and keyboard
(← → Esc). Built from the same material the console runs on  **not** a set of
static diagrams:

| # | Chapter | Content |
|---|---|---|
| 01 | Welcome | `DotField` ground, headline, `Carousel` of value props |
| 02 | What makes ours different | four `BorderGlow` cards |
| 03 | Ingest the raw sonar | live `GET /api/surveys/{id}` header readout |
| 04 | Two pictures, then a detector | live waterfall strip + the real detection box |
| 05 | Geometry → a position | `Cuboid3D`, `WorldMap`, the real error budget |
| 06 | Ready | live stats + `OptionWheel` of surveys on this machine |

`src/lib/tourData.ts` picks a completed survey with detections, or stands up the A4 & SSS
survey and runs detection, and feeds it in. It is **non-blocking**: chapters render
straight away and swap real numbers in when they arrive; if nothing is available they
fall back to schematics. It deliberately has no abort flag  under StrictMode an abort
would kill the only run the `started` guard allows.

Routing (`src/main.tsx`):

- `/` **is** the walkthrough, every visit  it is the front door of the demo.
- `/welcome` is the same page (the `?` button in the nav).
- Skip / Open the console lands on `/surveys`, and the brand mark in the nav points
  there too, so it is one click out and never in the way.

## The world map  `src/components/tour/WorldMap.tsx`

Equirectangular SVG over a bundled 110m coastline (`src/assets/land-110m.geo.json`,
~230 KB)  no tiles, no network. Two views of one projection: the whole world with a
crop box, and a 30° × 20° regional inset cut out of it. The world view is banded
72°N–58°S to drop the empty polar oceans, and widens automatically when the target
sits outside that band (the SS01 lines are Antarctic). Committed `--map-*` tokens,
not inherited greys  that was why it read as blank before.

It and `Cuboid3D` also render in the **console detail panel**
(`DetectionDetail.tsx`): the target's measured dimensions as a to-scale wireframe, a
world locator, and a tight Leaflet map with the metre-accurate search circle.

## Deleting a survey

`DELETE /api/surveys/{id}` (contract §1, added post-freeze with the owner's
agreement  see `apiendpoints.md`, `implementation_garv.md`, `implementation_P.md`).
Exposed from the Surveys row menu and the console header, both behind a confirm
dialog. `api.deleteSurvey` treats `404` as success.

## Stack

- Vite + React 19 + TS, Tailwind v4 + shadcn/ui, react-router, Zustand, Recharts
- Leaflet (no tile layer  graticule + track + metre-accurate error circles) for the console map
- `framer-motion`, plus `gsap` (blob cursor) and `ogl` (specular button)
- `@fontsource` Inter + JetBrains Mono (bundled)

## Theme

Light is cool paper with a teal accent. **Dark is phosphor green on a green-black
ground** (neutrals at hue 165, accent `oklch(0.79 0.17 152)`)  the sonar displays this
console descends from. Detection-class colours stay semantic in both: a wreck is red, a
rigid man-made object amber, a rock grey. So do the error-budget chart segments, which
have to stay tellable apart from each other.

`index.css` carries the instrument chrome every screen is built from: `.grid-field`
(ruled ground), `.panel-marks` (corner registration marks), `.label-micro` (mono
small-caps field label), `.tick-rule`, `.glow-accent`.

## One design language

The walkthrough set the level; the rest of the app was brought up to it rather than the
other way round. Shared pieces, so it stays that way:

- **`PageContainer`**  the header rail every page opens with:
  `LIBRARY ┈┈┈┈┈┈ 4 files`, then title and description. Ruled ground behind it.
- **`Panel`** (`components/common/Panel.tsx`)  the box everything lives in: corner
  registration marks, a `label-micro` title, a ruled filler out to whatever sits on the
  right. Replaced every bare shadcn `Card` on the pages.
- **`TableHead`** renders column names as mono small-caps labels, so tables read as
  instrument readouts. Rows take an accent left-border on hover.
- **`MetricCard`** carries an accent rule under the figure; **`EmptyState`** gets the
  ruled ground.
- The console keeps the same vocabulary (header `Readout`s, `WORKLIST ┈┈┈ 3`) but none
  of the ground texture or cursor toys  `implementation_P.md` §3.4.

## React Bits components (`src/components/reactbits/`)

Ported to TS from the reference doc.

| Component | Where |
|---|---|
| `DotField` | walkthrough chapter 01 ground |
| `Carousel` | walkthrough chapter 01 value props |
| `BorderGlow` | walkthrough chapter 02 cards |
| `Dock` | walkthrough step rail |
| `OptionWheel` | walkthrough chapter 06 survey list |
| `SpecularButton` | walkthrough Next / Open the console |
| `BlobCursor` | global, non-console routes |
| `ClickSpark` | global, non-console routes |
| `ElasticSlider` | **console transport timeline** |

The console gets none of the cursor toys  it is an instrument, motion only where data
moves (`implementation_P.md` §3.4).

## Routes

| Route | Page |
|---|---|
| `/` | redirect to `/surveys` once onboarded, else the walkthrough |
| `/welcome` | the walkthrough, always |
| `/console/:id` | Survey console  waterfall, live playback, map, worklist, error-budget detail |
| `/surveys/:id` | alias of the console |
| `/surveys` `/detections` `/reports` `/about` | supporting pages (`/settings` redirects to `/about`) |

## Run

Backend on `:8000`. `npm install && npm run dev` → `http://localhost:5373`
(dev server proxies `/api` + `/ws`). `npm run build` → `dist/`.

## Deploying

The backend URL is fixed **at build time**, not in the UI  copy `.env.example` to `.env`
and set `VITE_API_BASE` before `npm run build`. Vite inlines `VITE_*`, so changing it
needs a rebuild.

- **Same origin** (simplest): leave `VITE_API_BASE` blank and have your host rewrite
  `/api` and `/ws` to the backend (nginx `proxy_pass`, a Vercel/Netlify rewrite, or the
  FastAPI app serving `dist/` itself).
- **Split hosts**: set an absolute URL, no trailing slash. The WebSocket URL is derived
  from it (`https` → `wss`), so serve the API over HTTPS if the page is HTTPS or the
  browser blocks the socket. `backend/main.py` currently sets `allow_origins=["*"]`,
  which is fine for a demo and worth tightening for anything longer-lived.

## Playback fallback

`src/lib/tileFallback.ts`  if the WebSocket exhausts its reconnects, the playback
store switches to polling `GET /api/surveys/{id}/waterfall` for PNG strips, decodes
them to greyscale, and feeds the same row queue. Seeking in tile mode fetches a strip
at the new position. The demo never shows an empty screen.

## v1 / v2

`../frontend` (teammate's original) and `../frontend-v2` are untouched and still
runnable on their own ports (5173, 5273).
