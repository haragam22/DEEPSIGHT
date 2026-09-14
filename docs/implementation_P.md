# Deep-Sight  Implementation: P (Frontend)

Everything the operator sees. Read `idea.md` first for what the product is and why, then keep
`apiendpoints.md` open  it's the contract, and it's frozen.

**Your scope:** the entire React app. Waterfall renderer, map, worklist, detail panel, upload, report
download, all states and all errors.

**Not your scope:** anything in `/backend`. You never need to read Python.

**You are not blocked, ever.** A mock server serving the full contract with realistic fake data runs on day
one:

```bash
cd backend && uvicorn mock.main:app --reload --port 8000
```

Build the entire UI against it. When the real backend is ready, the base URL changes and nothing else does.

---

## 1 · What you're actually building

Not a dashboard. **A survey console.**

The difference matters. A dashboard summarises things that already happened. A console is what an operator
sits in front of, at sea, at 2am, watching data arrive from an instrument in real time. The waterfall is
the centre of gravity  it's the thing that's alive, and everything else arranges itself around it.

Reference point for the feel: real hydrographic survey software (Triton, SonarWiz, EdgeTech Discover) 
dense, instrument-like, dark, with the imagery dominant and the chrome deliberately quiet. Not Vercel. Not
a SaaS analytics product.

**Find one real screenshot of survey software and keep it open while you build.** Having a target to match
is worth more than any amount of description here.

---

## 2 · Stack

React 18 + Vite + TypeScript.

| Need | Use |
|---|---|
| Map | MapLibre GL (open, no token) or Leaflet. Must draw **circles in metres**, not pixels  check this before committing to one |
| Waterfall | `<canvas>` 2D. Not SVG, not DOM |
| State | Zustand or plain context. Not Redux  the app is too small |
| WebSocket | Native `WebSocket`. No socket.io  the backend is plain WS |
| Types | Generate from `apiendpoints.md` by hand into `src/types/api.ts`. One file, mirrors the contract exactly |

```
frontend/src/
  api/          fetch wrappers, one function per endpoint
  ws/           playback socket client + reconnect logic
  waterfall/    canvas renderer, colour ramp, scroll engine
  map/          map, track, detection circles
  panels/       worklist, detail panel, stats
  screens/      Upload, Console, Report
  types/api.ts  mirrors apiendpoints.md exactly
```

---

## 3 · Design direction

The brief pins some of this down; where it does, follow it exactly.

### 3.1 Palette

Dark, because that's what a night bridge is and because the sonar imagery has to be the brightest thing on
screen. But **not near-black with one neon accent**  that's a look, not a decision. Use a deep petrol
blue-green, which is what marine instrument housings and night-lit bridges actually are, and let the amber
sonar sit warm against the cool ground.

```
--hull-deep     #0E1A1E    app background
--hull          #16262C    panel surfaces
--hull-raised   #1E333B    cards, hover states
--rule          #2C4650    borders, dividers, grid lines
--text          #D6E2E5    primary text
--text-quiet    #7E9AA3    labels, secondary
--signal        #4FB3C9    interactive: links, active states, selection
--warn          #E8A33D    warnings, uncertainty notices
--alert         #E0674F    errors, high-priority targets
```

Sonar colour ramp (the waterfall only  nothing else on screen uses these):

```
#1A0E05 → #4A2408 → #8F5312 → #D18B2A → #F2BC61 → #FFE9C4
```

Warm amber/copper, because real survey software uses warm ramps and a NIOT operator's eye expects it.
Greyscale is an acceptable alternative and worth offering as a toggle. **Viridis makes it look like a
Matplotlib notebook**  don't.

### 3.2 Type

**IBM Plex Sans** for everything readable. **IBM Plex Mono** for numeric readouts only  coordinates, ping
counters, ranges, error radii. The reason is functional, not decorative: those values change constantly
during playback and they must not reflow. Tabular figures, `font-variant-numeric: tabular-nums`.

Do not put mono on labels, headings, or buttons. It's for numbers that have to line up.

Scale: 12 / 14 / 16 / 20 / 28. That's all you need. Sentence case throughout  no tracked-out all-caps
labels above every panel.

### 3.3 Layout

Full-viewport, no page scroll. Three zones, waterfall dominant:

```
┌──────────────────────────────────────────────────────────────────┐
│  Deep-Sight    SS01-snip-2145-to-end.XTF        [Export report]  │ 48px
├────────────┬─────────────────────────────────┬───────────────────┤
│            │                                 │                   │
│  TARGETS   │                                 │       MAP         │
│            │          WATERFALL              │   track + circles │
│  ▸ det_0a44│                                 │                   │
│    wreck   │      (scrolling, amber,         ├───────────────────┤
│    14.7 m  │       nadir band centre,        │                   │
│            │       boxes drawn on targets)   │   TARGET DETAIL   │
│  ▸ det_0b02│                                 │   coordinate      │
│    milco   │                                 │   error breakdown │
│    22.1 m  │                                 │   dimensions      │
│            │                                 │                   │
│  ░ det_0c19│                                 │                   │
│    natural │                                 │                   │
├────────────┴─────────────────────────────────┴───────────────────┤
│  ▶  ━━━━━━━━━●━━━━━━━━━━━━━  ping 12,844 / 41,208   4×   [raw|geo]│ 56px
└──────────────────────────────────────────────────────────────────┘
   280px                 flexible                      380px
```

Left rail is the worklist. Centre is the waterfall, and it gets every pixel it can. Right column splits:
map on top, selected-target detail beneath. Bottom bar is transport controls.

Content is left-aligned throughout. Numbers right-aligned in their columns.

### 3.4 Principles

- **One bold thing: the waterfall.** Everything else is quiet, dense, and gets out of its way. No gradient
  washes, no decorative cards, no drop shadows under every panel. Panels are separated by a 1px `--rule`,
  which is how instrument software does it and it costs nothing.
- **Motion only where data moves.** The waterfall scrolls because pings are arriving  that's real motion
  showing real change. Do not add fade-and-slide entrances to panels, hover lifts on list items, or any
  ambient animation. One thing on screen moves, and it's the thing that's actually moving.
- **Every structural device carries information.** A border means a boundary. A colour means a state. If
  it's there to look designed, remove it.
- **Density is correct here.** This is a professional tool for someone reviewing thousands of targets. Do
  not pad it out into a consumer app.

---

## 4 · The waterfall  your hardest and most important component

This is the demo hook. It's the first ten seconds, it's what every judge sees before they hear a word, and
it's the thing no other team will have. Give it the most time.

### 4.1 How it works

The backend sends `ping_batch` messages (`apiendpoints.md` §2), each containing `count × width` 8-bit
greyscale values, base64-encoded. Every row is one sonar ping. You render rows in arrival order, scrolling
the older ones away.

```
decode base64 → Uint8Array
  → map each value through the amber ramp into RGBA
  → write into an ImageData
  → putImageData onto an offscreen canvas at the write cursor
  → drawImage the visible window onto the display canvas each frame
```

**Use a ring buffer, not an ever-growing canvas.** Allocate an offscreen canvas of, say, 4096 rows. Write
new rows at a moving cursor, wrap at the end. Draw the visible window from it. A survey is 40,000+ pings 
you cannot keep them all in one canvas.

**Decouple network from animation.** Batches arrive in bursts of 32. If you draw on message arrival, the
scroll is chunky and it looks broken. Push arriving rows into a queue, and drain the queue at a steady rate
inside a `requestAnimationFrame` loop. Smooth scrolling is what sells "real-time"  chunky redraws
undo everything the backend did to make the image look professional.

### 4.2 Non-negotiables

1. **Never filter the image.** No blur, no sharpen, no smoothing, no CSS filters, no generative anything.
   Colour mapping and scaling only. A judge will ask "is this AI-generated?" and the answer must be a flat
   no  and it has to actually be true of the pixels you drew.
2. **Don't rescale the width.** The backend already resampled to square ground pixels. If you stretch it to
   fit a container, the aspect ratio is wrong and experienced eyes catch it instantly in a way they can't
   articulate. Letterbox instead.
3. **`imageSmoothingEnabled = false`** when blitting. You want the measured samples, not interpolation.
4. **Nadir is at `width / 2`.** A faint centre line is legitimate instrument chrome and helps orient the
   viewer.

### 4.3 Instrument chrome

The furniture sells the illusion as much as the image does:

- Range scale in metres down both edges, ticked
- Ping counter and current lat/lon, mono, tabular
- Port / starboard labels
- Detection boxes drawn over the waterfall as thin `--signal` rectangles, with the class label small and
  outside the box so it never obscures the target

Detection boxes come in `bbox_px` with `y` as an absolute ping index  you convert that to a screen row via
your scroll offset. Boxes must scroll with their pings, not float.

### 4.4 Fallback path  build this too

If the WebSocket fails, fall back to polling `GET /api/surveys/{id}/waterfall?start_ping=&count=` for PNG
strips on a timer. Slower and less impressive, but **the demo never shows an empty screen**, and a venue
with hostile networking is a real risk. The same tile endpoint powers timeline scrubbing, so you need it
regardless  the fallback is nearly free once scrubbing works.

---

## 5 · Map

- Detection markers are **circles sized by `error_radius_m`**, in real metres, that resize correctly when
  the map zooms. Not pins. This is the product's whole argument  a pin claims a precision we don't have.
- Circle fill by class, opacity by confidence. `nombo` muted and thin-stroked.
- Vessel track from `GET /api/surveys/{id}/track` as a thin `--signal` line. Remember GeoJSON coordinates
  are `[lon, lat]`.
- During playback, a marker moves along the track in sync with the waterfall position. The two views are
  the same survey at the same instant  that link is the point.
- Selecting a target anywhere (map, worklist, waterfall) selects it everywhere.
- Basemap: something dark and quiet. The circles are the content.

---

## 6 · Worklist and detail panel

**Worklist**  sorted by priority (confidence, then error radius ascending  a tight circle is more
actionable than a wide one). Each row: class, confidence, error radius, ping. `nombo` rows visually
de-emphasised but present.

> `nombo` means "natural bottom object"  a rock the model correctly identified as *not* debris. **Never
> filter these out by default.** Being able to say "we detected the rock and correctly called it a rock" is
> a differentiator, not noise.

**Detail panel**  built on `GET /api/detections/{id}`. This panel is the answer to *"how did you get that
coordinate?"*, so it deserves real design attention:

- Coordinate, mono, with the error radius stated in metres beside it
- **Error budget as a horizontal stacked bar**, largest term first, each segment labelled. The backend
  sends terms pre-sorted with a `dominant_term` and a plain-English `explanation`  render that sentence
  verbatim, don't write your own
- Real-world dimensions and object height
- **Estimated relief** from `relief` (contract §3, added post-freeze with the owner's agreement): the
  heightfield drawn as small columns, labelled "estimated from shadow" with `measured_fraction` shown. A
  toggle switches back to the plain dimension box; the box is also the fallback when `relief` is `null`
- `flags` as small labels (`near_nadir`, `on_turn`, `long_layback`, `estimated_altitude`)
- Class shown as `class_display`, with the raw `class` code visible underneath  provenance is part of the
  pitch

Confidence is labelled **"detector score"**. Never "probability", never "certainty", never "% sure". We
have not calibrated it and we do not imply that we have.

**Deleting a survey.** `DELETE /api/surveys/{id}` (contract §1, added post-freeze with the owner's
agreement) removes a survey from the store. Expose it from the Surveys list row menu and the console
header. `204` = gone; `404` = already gone (treat as success). Always confirm first  it is
irreversible.

---

## 7 · Honesty requirements

These are correctness issues, not preferences. Each one exists because a judge could catch it.

1. **`null` renders as "unavailable", never as `0`.** A fabricated coordinate is the worst possible bug in
   this product.
2. **Surface `altitude_source`.** When it's `blank_zone_estimate`, show a persistent notice on the survey:
   *"Altitude estimated from water column  positions carry higher uncertainty."* Not a dismissible toast;
   it's true for the whole survey.
3. **Render `warnings` from the survey metadata.** They're plain English and meant to be read.
4. **Render `method_notes` in any report preview.** That's where our honesty lives. It is not boilerplate
   to collapse behind a "show more".
5. **Display `stats.headline` verbatim.** The backend pre-formats it so the number on screen and the number
   in the report can never disagree.

---

## 8 · States

Design these properly  half the demo risk lives in states nobody built.

| State | What it shows |
|---|---|
| **Empty** (no survey) | An invitation to act. Drop zone, one sentence on what an XTF file is, sample file offered |
| **Uploading** | Real progress. Files are ~100 MB |
| **Parsing** | Poll `/status`. Show ping count climbing  it's honest and it's more reassuring than a spinner |
| **Ready, not playing** | First frame of the waterfall visible, transport controls armed |
| **Playing** | The main state. Everything live |
| **Paused** | Frozen, scrubbing enabled |
| **Complete** | Full worklist, export enabled, stats headline shown |
| **Socket dropped** | Silent reconnect with the last ping index. Only if reconnect fails twice, show a quiet inline notice and switch to the tile fallback. Do not throw a modal mid-demo |
| **Failed** | The `message` from the error object, plus what to do next |

Errors explain what happened and how to fix it. They don't apologise and they're never vague. Empty screens
are invitations, not decoration.

---

## 9 · Quality floor

Build to it without announcing it: visible keyboard focus, `prefers-reduced-motion` respected (pause the
waterfall auto-scroll, keep manual scrubbing), sufficient contrast on `--text-quiet` against `--hull`,
no layout shift when numbers change. Colour never carries meaning alone  class is always also a label.

Mobile is not a target. This is an operator console on a desk. Make it work down to about 1280px and stop.

---

## 10 · Build order

1. **Types + API client** from `apiendpoints.md`. Every endpoint, typed, against the mock.
2. **App shell**  the three-zone layout, palette, type. Static, no data.
3. **Waterfall renderer** against the mock's canned stream. This is the hard part; do it while you're fresh.
   Get smooth scrolling right before adding anything else.
4. **Transport controls**  play, pause, seek, speed. Wire to the socket control messages.
5. **Map**  track, then circles.
6. **Worklist + selection** linking all three views.
7. **Detail panel** with the error budget bar.
8. **Upload flow and all states** from §8.
9. **Report preview and download.**
10. **Tile fallback and reconnect.**
11. **Polish**  instrument chrome, range scales, the raw/corrected toggle, transitions on selection.

Steps 1–3 are the ones that matter most. If the waterfall is beautiful and smooth, the demo works even if
something else is rough.

---

## 11 · Your open items

- [ ] Confirm the map library can draw circles with a **radius in metres** that rescales with zoom
- [ ] Find and keep open a real survey-software screenshot as a visual target
- [ ] Confirm the ring-buffer approach holds up at 40,000+ pings without frame drops
- [ ] Confirm `prefers-reduced-motion` behaviour with Garv  pausing auto-scroll is a real accessibility
      need but it interacts with the demo
- [ ] Agree with Garv on the demo's playback `speed` value (likely 4×–8×) so the pacing is rehearsed, not
      discovered on stage
