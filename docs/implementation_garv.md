# Deep-Sight  Implementation: Garv

Everything server-side. Read `idea.md` first, and keep `apiendpoints.md` open  it is the contract you must
satisfy exactly.

**Your scope:** XTF parsing, sonar geometry, the error budget, dataset assembly, model training, detection,
false-alarm suppression, the report engine, and the API that feeds P's frontend.

**Not your scope:** anything in `/frontend`. Do not touch it. Do not "just fix" a component.

---

## 0 · Ground rules

1. **Ship the mock server on day one.** Before you can parse a single ping, P needs a running API. This is
   the single highest-leverage hour in the project  it unblocks half the team permanently.
2. **Write the geometry yourself.** `pyxtf` parses; `pyproj` projects on the ellipsoid. Everything between
    slant-range correction, layback, the error budget  is your code. If a library computed it, you can't
   claim it in Q&A, and Q&A is where this project wins.
3. **Display and analysis pipelines never cross.** One raw array, two branches. Despeckled pixels go to the
   screen; raw values go to the model.
4. **Never commit sonar data.** `/data` is gitignored. P should be able to clone this repo in ten seconds.
5. **Every number in the report traces to a measured value.** No placeholders that survive to demo day.

---

## 1 · Repo and environment

```
backend/
  main.py                 FastAPI app, routes only  thin
  mock/
    main.py               contract-identical fake server (BUILD THIS FIRST)
    fixtures/             canned waterfall strip, sample detections
  ingest/
    xtf.py                pyxtf wrapper → PingRecord stream
    models.py             PingRecord, SurveyMeta dataclasses
  geometry/
    slant.py              slant → ground range, nadir gap
    layback.py            fish position from ship position
    project.py            geodesic projection to WGS-84
    budget.py             the error budget
    blankzone.py          altitude estimation fallback
  imaging/
    display.py            gain normalise, contrast, resample → u8 rows
    analysis.py           log transform, wavelet → detector input
  detect/
    dataset.py            box derivation, dataset assembly, YOLO export
    train.py              training entry point (runs on Colab)
    infer.py              inference over a survey
    suppress.py           the three false-alarm rules
  report/
    engine.py             JSON + CSV generation
    stats.py              area, review fraction, headline string
  eval/
    baselines.py          naive threshold detector
    protocol.py           metrics, cross-dataset harness
scripts/
  fetch_data.sh           downloads everything; no data in git
  derive_boxes.py         masks → YOLO boxes
data/                     GITIGNORED
```

**Environment:** Python 3.11, `fastapi`, `uvicorn`, `pyxtf`, `pyproj`, `numpy`, `scipy`, `PyWavelets`,
`opencv-python`, `ultralytics`, `pydantic`.

**`.gitignore` must contain `data/` before your first commit.** Once a 400 MB XTF is in git history it is
painful to remove and P pays the price on every clone.

---

## 2 · The data

### 2.1 Track A  raw XTF for geometry and imagery

**Source:** MGDS, NBP1001, raw towed EdgeTech side-scan, XTF, unprocessed since acquisition.
DOI `10.1594/IEDA/316265`. Larsen Ice Shelf, Antarctica, 2010.

**Keep exactly these three files** (delete the rest  they're consecutive slices of the same line with
identical headers and buy you nothing):

| File | Size | Role |
|---|---|---|
| `SS01-snip-2145-to-end.XTF` | 105.8 MB | **Parser bring-up.** Smallest, fastest iteration loop. Start here. |
| `SS01-snip-2130-to-2145---close-approach.XTF` | 124.3 MB | Most relief and shadow structure  best visual validation target |
| `SS01-snip-2100-to-2115.XTF` | 136.4 MB | Plain mid-line segment for playback continuity and the demo |

Delete: `start-to-2030` (406 MB), `2030-to-2045`, `2045-to-2100`, `2115-to-2130`.

> ⚠️ **Seven files from one cruise is one bet made seven times, not seven bets.** They all came off the
> same 2010 EdgeTech/ISIS acquisition chain. If `pyxtf` chokes on this XTF variant, it chokes on all of
> them identically. **Download one USGS coastal cruise as a second, genuinely different format bet before
> you start parsing.** XTF is a loose spec; vintage and vendor both matter.

**Check these three things in the first hour of parsing**  each one changes the plan:

- **Is `SensorPrimaryAltitude` actually populated?** ISIS-era recordings sometimes leave it zero or
  garbage. If it's empty you're on the blank-zone estimator from day one, and `altitude_source` becomes
  `blank_zone_estimate` for the whole demo.
- **Is cable-out or fish depth in the headers?** This decides whether your error budget is real. Layback is
  the largest term in it. If neither is recorded, bound layback from tow speed and depth instead of
  computing it  still honest, but a wider number, and you want to know in week 1.
- **Does the range setting change mid-file?** They were cut at time boundaries, so an operator range change
  is plausible. Your parser must handle a mid-file change in samples-per-ping without silently corrupting
  the array  surface it in `warnings`.

**Two domain caveats to be ready for.** The seabed here is glacial  iceberg scour, dropstones, till. That
makes it a genuinely good false-positive stress test (a dropstone is exactly the "rock that looks like
debris" case), but it looks nothing like Indian coastal shelf *or* like your training imagery. Expect the
detector to fire on nothing the first time you run it there; that's §5, not a bug. And it's a single line,
so the two-crossing-lines error-model validation isn't available  check whether the cruise published SS02
or SS03 and grab one more line if so.

### 2.2 Track B  labelled data for detection

**No public dataset gives you both raw XTF and labelled targets.** Raw XTF has navigation but no labels;
labelled datasets are PNG exports with the navigation thrown away. You do not solve this. You split it into
two tracks and say so out loud (`idea.md` §11).

**You will not hand-annotate anything.** Every box is derived or already exists:

| Dataset | Ships as | How you get boxes | Class | Role |
|---|---|---|---|---|
| **AI4Shipwrecks** (286) | binary pixel masks | `scripts/derive_boxes.py`  connected components on each mask | `wreck` | Train + benchmark |
| **SSS Mine Detection** (1,170) | `.jpg` + `.txt`, already YOLO format | use directly | `milco`, `nombo` | Train |
| **SubPipe** (~10,030) | annotated | use directly | `pipeline` | **Held out  cross-dataset test only** |
| **KLSG** (1,190) | image-level class labels only |  |  | Classification sanity check only. **Not detection training.** |

That's ~1,450 boxed training images for zero hours of manual work.

**Sources:** AI4Shipwrecks  Deep Blue Data (U. Michigan). SSS Mine Detection  Figshare
(`10.6084/m9.figshare.24574879`). SubPipe  public. KLSG  Kaggle
(`enochkwatehdongbo/seabedobjects-klsg-dataset`).

**Dropped: SWDD.** It is a harbour-*wall* inspection dataset, two classes Wall/NoWall, from Porto de
Leixões. It shares zero classes with our taxonomy; using it as a "robustness suite" tests nothing about
our detector. SubPipe carries the cross-dataset test alone.

**Also dropped: the "Kaggle SSS Object Detection Challenge."** It was in an earlier draft as the cheapest
way to buy back a week. I could find no evidence it exists. Don't spend time hunting for it.

**Never touch:** NKSID, the Kaggle "Forward-Looking Sonar Marine Debris" set, or anything else
forward-looking. Wrong modality. They will surface in searches because they say "marine debris" and
"fishing nets." The answer is no  mixing FLS into a side-scan training set silently corrupts the model.

### 2.3 Two honest notes to carry into Q&A

- **There is domain shift inside your training set.** SSS Mine Detection is 900–1800 kHz Marine Sonic;
  AI4Shipwrecks is EdgeTech. Frame that as deliberate  it's free augmentation against exactly the domain
  shift problem  not as an accident you didn't notice.
- **You did not hand-annotate.** You assembled from pre-labelled public sources. That is a defensible
  engineering choice under a two-person constraint. Say it plainly if asked; don't let it look discovered.

### 2.4 Licensing

These are academic releases used for a research prototype. You have not audited redistribution rights for
a production government deliverable. Have one line ready: *"Research and prototype use; a production
deployment would need a licensing review per dataset."* Costs nothing to say, and it's the kind of question
a government-facing jury asks.

---

## 3 · The geometry  your core differentiator

This is the part that cannot fail to train, because there is nothing to train. Protect it. It is also the
part that answers the single best question you'll get: *"how did you get that coordinate?"*

### 3.1 What a ping gives you

Each ping record = header + two sample arrays (port, starboard). The header carries GPS position, heading,
pitch/roll/heave, altitude above seabed, sound velocity, sample rate, range setting, ping number.

Sample `i` sits at slant range:
```
r_i = i × c / (2 × f_s)
```
Sound speed over twice the sample rate  the pulse travels out *and* back.

### 3.2 Slant range → ground range

```
ground_range = sqrt(slant_range² − altitude²)
```

Three consequences you must handle:

- Where `slant_range < altitude` there is **no seabed return**  the nadir gap, water column under the
  fish. **Detecting anything there is a bug.** Mask it explicitly before the detector ever sees the array.
- The mapping is strongly nonlinear near nadir and near-linear far out. A box drawn on the *uncorrected*
  waterfall therefore has the wrong width in metres depending on where it sits across-track. That's the
  raw-vs-corrected toggle in the demo, and it's a real correction, not a visual effect.
- It assumes a flat seabed. You are not relaxing that. Say so in `method_notes`.

### 3.3 Ground range → position on Earth

Sonar looks perpendicular to track. Bearing to target is `heading + 90°` (starboard) or `heading − 90°`
(port). Offset `ground_range` metres along that bearing from the **fish** position  not the ship's 
using `pyproj.Geod.fwd()`. Not flat-earth trig. At these latitudes and ranges flat-earth is survivable,
but you cannot defend it, and defending it is the point.

### 3.4 Layback  where the fish actually is

The largest single error source in towed surveys, and the sentence that makes the whole feature land with a
non-technical judge: *GPS is on the ship, the sonar is eighty metres behind it on a cable.*

```
horizontal_layback ≈ sqrt(cable_out² − fish_depth²)
fish_position = ship_position projected backwards along heading by horizontal_layback
```

> ⚠️ **Get this formula right.** An earlier draft used cable length projected along heading, ignoring
> depth. With 100 m of cable and the fish 60 m down, that gives 100 m of offset when the truth is ~80 m 
> **a 20 m error injected into every coordinate**, larger than most objects you're detecting.

This ignores cable catenary sag, so true layback is slightly shorter still. That residual goes into the
budget, not into a pretence of precision.

### 3.5 The error budget  the thing nobody else builds

| Source | Rough magnitude | Kind | Notes |
|---|---|---|---|
| GNSS fix | 2–5 m standalone; sub-metre RTK/DGPS | independent | from header quality flags |
| Layback estimate | 5–15% of layback distance | independent | catenary sag unknown |
| Heading error × layback | `layback × sin(Δθ)`  2° at 50 m ≈ 1.7 m | independent | worst on turns |
| Altitude error → ground range | grows sharply as slant range → altitude | independent | **dominant with blank-zone estimate (±20–30%)** |
| Sound speed assumption | 0.1–0.3% of range | systematic | `c` varies with temperature and salinity |
| Pixel quantisation | half a sample bin | independent | usually small |
| Target extent | half the object's own size | systematic | you locate a thing, not a point |

Root-sum-square the independent terms; add systematic terms linearly. Emit the full breakdown through
`GET /api/detections/{id}`  P builds the detail panel on it.

**The credibility move: the radius varies per target.** Far range, straight line, good GPS → tight circle.
Near nadir, on a turn, long layback → big circle. When the map shows visibly different circle sizes and you
can explain each one, you win that conversation outright. Make sure `dominant_term` and the plain-English
`explanation` string are always populated  that sentence is what P renders and what you say out loud.

### 3.6 Dimensions and height

Both box edges through the same chain → real-world width and height in metres (the PS's "bounding
dimensions"). Object **height** comes from the shadow, not the box: shadow length + altitude + range →
height by similar triangles. That height is also the input to suppression Rule 3.

> **Contract addition (post-freeze, agreed with the owner).** `GET /api/detections/{id}` also returns
> `relief` (`geometry/relief.py`): a heightfield of at most 40 × 40 cells. Footprint = box pixels above
> 1.25 × the ping's seabed median (cell kept if ≥ 25 % highlight), then closed into one solid body
> (morphological close, kernel 3 or 5 scaled to the grid, interior holes filled, largest connected piece kept); height per ping row = the same shadow
> formula, shadow measured outboard of that row's outermost highlight pixel, median over ± 2 pings, then a 3 × 3 or 5 × 5 median (5 on grids of 24+ cells)
> across the grid. Rows without a readable shadow copy the nearest measured row (`measured_fraction` reports the share
> measured). `null` when there is no highlight or no shadow at all.

### 3.7 Blank-zone altitude fallback

If the XTF header has no usable altitude: in a standard waterfall the first `~(altitude / range_resolution)`
samples per ping are near-zero  the water column before the first bottom return. Threshold-detect that
width, multiply by range resolution, get an altitude estimate. Typical error ±20–30%.

**Why this is acceptable:** you still get playback, slant-range correction and coordinates. The altitude is
approximate, so **the error radius is larger**  which is exactly what the error radius is *for*. A bigger
circle with an honest reason beats a false-precision pin. Set `altitude_source` accordingly and let it
propagate all the way to the UI and the report.

---

## 4 · Imaging

### 4.1 Display chain (`imaging/display.py`)  what P receives

**Signal processing, not a model. No neural network anywhere.** The image *is* the data  every pixel is a
measured acoustic return. **Order matters; do not reorder.**

1. **Parse**  header + N samples per channel. Sample count and range setting can change mid-file.
2. **Stack**  one ping per row, port reversed on the left, starboard right, nadir centre. *It will look
   terrible at this stage. That's expected.*
3. **Gain normalisation (TVG)**  mean intensity per across-track sample position over a few hundred pings,
   divide each ping by that curve. **Highest-impact single operation in the whole chain.** Also absorbs
   most beam-pattern variation.
4. **Contrast**  percentile clip (1st–99th) or log/gamma, then optionally CLAHE. **Never min-max**  one
   bright specular return crushes everything to grey.
5. **Square ground pixels**  along-track spacing is ping rate × tow speed; across-track is sample rate ×
   sound speed. Almost never equal. **Resample before sending**, or experienced eyes catch it instantly.
6. **Quantise to u8**, base64, ship over the socket.

P does colour mapping and scrolling. Everything above is yours. P must never be in a position where they
have to "fix" the image  if it looks wrong on screen, it's wrong here.

### 4.2 Analysis chain (`imaging/analysis.py`)  what the detector receives

Separate function, separate array, from the **same raw source**:

- Log transform: `I' = log10(I + 1e-6)`, then normalise to [0,1]
- Blank-zone / nadir-gap removal
- 2D discrete wavelet decomposition for speckle reduction (`PyWavelets`)  low-frequency sub-bands carry
  seabed structure, high-frequency carry speckle. Reconstruct from denoised sub-bands: reduces speckle
  without blurring object boundaries. No GAN, no training required.

**Not FunieGAN.** FunieGAN targets optical degradation  colour shift, haze, white balance. Sonar has none
of those; it's acoustic backscatter intensity, not photons. Applying it would "correct" artifacts that
don't exist. GANs belong in offline data augmentation, never in the preprocessing path.

### 4.3 Week-1 validation

Render one file and put it next to a published side-scan image at similar frequency. Same nadir band,
shadow behaviour, texture → parser and geometry are correct. Garbage → the parser is silently wrong (header
offset, endianness, sample width).

**A broken parser that produces a plausible-looking array is far worse than one producing obvious noise.**
Use the visual check as the parser test. This is the whole test  "does it parse without an exception" is
not a test.

---

## 5 · ⚠️ The distribution-mismatch test  do this early, not at the end

**The risk nobody has checked.** You train YOLOv8 on AI4Shipwrecks and SSS Mine Detection PNGs  processed
by *someone else's* software with *their* TVG and contrast choices. You then run it on imagery **you render
yourself** from raw XTF with **your own** gain normalisation and contrast mapping.

There is a real chance the detector fires on nothing, because your processing chain doesn't look enough
like the training distribution.

**Action:** the moment one XTF file renders and one YOLO baseline trains  before the pipeline is
finished, before the UI is wired  **run them against each other and look at the output.**

If detections don't fire, the fixes exist but they all cost time:
- Histogram-match your contrast mapping to the training data's apparent statistics
- Include your own rendered tiles in training augmentation
- Re-normalise training tiles through your own display chain before training

**Finding this at the end means the demo shows an empty map.** Put it in a calendar, not a wish list.

---

## 6 · Detection

### 6.1 Model

**YOLOv8s.** Three reasons, all defensible:
- DFSE-YOLO, current SOTA on AI4Shipwrecks at 75.51% mAP50, is YOLOv8-based. Starting from YOLOv8s and
  adding CBAM attention + Shape_IoU is a supported path to competitive numbers.
- YOLOv8n/s are the standard edge variants  satisfies the PS's stated edge preference.
- You already have YOLO experience.

**Classes (final, from `apiendpoints.md` §3):** `wreck`, `milco`, `nombo`, `pipeline`.

Keep the source dataset's own class names rather than renaming `milco` to "debris". Provenance is traceable
to a published dataset a judge can look up  and if you relabel "mine-like contact" as "marine debris",
someone will eventually notice you trained on a mine dataset and called it something else. Friendly display
strings live in the UI layer only.

**`nombo` is the sleeper differentiator.** It's a labelled class of natural bottom objects that look like
targets and aren't  your rock-vs-debris problem with ground truth attached. Every other team treats false
positives as something to filter afterwards. You get to train the detector to discriminate them directly
*and* keep the suppression rules as a second line of defence.

### 6.2 Training on Colab

Free Colab is fine for ~1,450 images on YOLOv8s. Two things will bite you:

- **Sessions die at 12 hours, and free tier disconnects earlier under load.** Checkpoint to Google Drive
  **every epoch**, and make `train.py` resume from the latest checkpoint automatically. Losing a run to a
  disconnect is the single most likely way you lose a day.
- **Don't develop on Colab.** Write and test `train.py` locally on 20 images, then run the full job on
  Colab. Debugging in a notebook that keeps dying is a special kind of misery.

Keep the trained weights in the repo (they're small) so inference doesn't depend on Colab being up.

### 6.3 False-alarm suppression  three deterministic rules

No second model, no compounding error.

**Rule 1  shadow direction.** Shadows must fall consistently *away* from nadir, with the highlight on the
nadir-facing side. Filters artifacts and processing noise. *(Note: this does not filter rocks  a rock's
shadow is correctly oriented too.)*

**Rule 2  minimum ground area.** Remove connected components below ~1 m² of ground area. **Caution:** this
also deletes small cylinders. Tune the threshold against labelled data; don't assume 1 m².

**Rule 3  height-to-footprint ratio.** Shadow length + altitude + range gives object height; highlight
extent gives footprint. Manufactured objects violate the natural ratio: a pipe is long and low, a drum is
tall relative to its footprint, a plate is nearly flat.

> **Explaining Rule 3 to a judge:** *"We measure how tall the object is from its shadow. A rock is about as
> tall as it is wide. A pipe is long and flat. That one number kills most rock false positives."*

> ⚠️ **Hedge Rule 3 when you say it.** "Boulders are roughly as tall as they are wide" is a geological
> heuristic, not a law  flat slabs, glacial erratics and angular rockfall all violate it, and this survey
> is over glacial terrain. Have the fallback line ready: *"It's a heuristic tuned against our labelled
> data, not a universal claim  Rules 1 and 2 catch what it misses, and `nombo` training catches more."*
> Every other physical claim in these docs is hedged in proportion to its certainty. This one should be too.

---

## 7 · Evaluation

Build the harness **before** you train anything. It is what keeps the project honest.

### 7.1 Not accuracy

Wrecks occupy ~0.8% of pixels in AI4Shipwrecks. A model predicting all-seafloor scores 99.2% accuracy and
finds nothing. Report instead:

- **mAP@0.5** and **mAP@0.5:0.95** (the stricter one matters for geotagging)
- **F1 per class**
- **False positive rate on seafloor-only tiles**  the operational number
- **Geotag error in metres**, and **coverage**  does the stated error radius actually contain the target
  the claimed fraction of the time? This validates the error budget, not just the detector
- **Cross-dataset delta**  the in-domain to cross-domain drop, and what augmentation recovers

### 7.2 Three baselines, reported prominently

1. **Naive detector**  threshold the log-intensity image at a fixed percentile, count blobs
2. **YOLOv8n, no preprocessing**  raw PNG, no wavelet. Justifies every stage you added
3. **Published SOTA**  DFSE-YOLO, 75.51% mAP50 on AI4Shipwrecks

> "We beat threshold detection by X%, raw YOLO by Y%, and we sit Z% from published SOTA" is verifiable.
> "98% accuracy" says nothing a jury can interrogate.

### 7.3 Cross-dataset protocol

- **Train:** AI4Shipwrecks + SSS Mine Detection
- **Test:** **SubPipe**  different manufacturer, frequency band, geography and target type. The hardest
  credible split, and well-known enough that a jury can look it up
- **Expected:** mAP drops 15–30%. **The drop IS the finding.** Present it as honest characterisation of
  real-world generalisation, then show what physics-informed augmentation (speckle injection, rotation,
  shadow simulation) recovers

### 7.4 Respect the AI4Shipwrecks split

It splits by wreck *site*, not randomly. Random splitting inflates your numbers and voids the benchmark
comparison  which is the one comparison a judge can independently check.

---

## 8 · Build order

Not weeks  dependency order. Each step unblocks the next.

**Step 1  Mock server.** `backend/mock/main.py` serving every endpoint in `apiendpoints.md` with fixtures,
streaming a canned waterfall over the socket. **P is blocked until this exists.** Do it first, in an hour,
before anything else.

**Step 2  Parser bring-up.** `pyxtf` on `SS01-snip-2145-to-end.XTF`. Answer the three header questions
(§2.1). Render a waterfall and eyeball it against a published side-scan image. Do not proceed until it
looks like sonar.

**Step 3  Display chain.** Gain normalisation, contrast, square-pixel resample, u8 quantisation. This is
what makes the demo look professional; it deserves real attention.

**Step 4  Real ingest + WebSocket.** Swap the mock's canned rows for real ones. P's UI should light up
with real sonar without a single frontend change. That moment is the proof the contract worked.

**Step 5  Geometry.** Slant-range, layback, geodesic projection, error budget, blank-zone fallback.
Validate positions against the survey's own navigation.

**Step 6  Dataset assembly.** `derive_boxes.py`, download and convert everything, build the YOLO dataset.

**Step 7  Baseline + the distribution-mismatch test.** Naive threshold baseline. First YOLO run. **Then
immediately §5.** Do not skip ahead.

**Step 8  Detection pipeline.** Full training, suppression rules, wire detections into the socket and the
detections endpoints.

**Step 9  Report engine + stats.** JSON, CSV, `method_notes`, the headline string.

> **Contract addition (post-freeze, agreed with the owner).** `DELETE /api/surveys/{survey_id}`
> removes a survey from the in-memory store  `204` on success, `404` if already gone. Added so the
> console can clear a bad upload without a restart. Documented in `apiendpoints.md` §1 and
> `implementation_P.md` §6.

**Step 10  Evaluation.** Full protocol, cross-dataset, all three baselines, coverage check on the error
radius.

**Step 11  Rehearsal.** Demo run-throughs. Q&A cold. Every claim in `idea.md` §11 said out loud.

---

## 9 · Your open items

- [ ] `.gitignore` `data/` **before the first commit**
- [ ] Ship the mock server
- [ ] Delete the four unused XTF files; keep three
- [ ] Download one USGS coastal cruise as a second format bet
- [ ] Check `SensorPrimaryAltitude`, cable-out/fish-depth, mid-file range changes
- [ ] Check whether NBP1001 published SS02/SS03 for crossing-line error validation
- [ ] `derive_boxes.py` on AI4Shipwrecks masks
- [ ] Colab checkpoint-and-resume working before the first long run
- [ ] Run the distribution-mismatch test the day both halves first exist
- [ ] Tune Rule 2's area threshold against labelled data instead of assuming 1 m²
- [ ] Write the one-line dataset licensing answer
- [ ] Verify every quantitative claim inherited from Jaldrishti before it enters the pitch  the "~100 m
      underwater IR range" figure in that documentation is not physically achievable (IR is absorbed within
      centimetres to a couple of metres). Treat it as a signal about the source, not an isolated typo
- [ ] Audit the older research doc for cross-project contamination  it contained an unedited sentence from
      an unrelated project ("a logistic regression baseline is the world-models PS requirement"). Deleting
      that line is not the fix; the question is what else bled across the same way. Look for sentences that
      don't quite fit the surrounding argument
