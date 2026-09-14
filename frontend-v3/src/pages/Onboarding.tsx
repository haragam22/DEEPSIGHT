// The walkthrough. Six chapters stepped with Previous / Next / Skip, built from the same
// material the console runs on: real survey metadata, a real waterfall strip, a real
// detection and its real error budget. Falls back to diagrams when the backend has
// nothing to show, so it always renders.

import { motion } from 'framer-motion'
import {
    Activity,
    ArrowLeft,
    ArrowRight,
    Crosshair,
    FileStack,
    Flag,
    Globe2,
    MapPin,
    Radar,
    ScanSearch,
    Waves,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ClassBadge } from '@/components/common/ClassBadge'
import { ErrorBudgetBar } from '@/components/detections/ErrorBudgetBar'
import { BorderGlow } from '@/components/reactbits/BorderGlow'
import { Carousel, type CarouselItem } from '@/components/reactbits/Carousel'
import { Dock } from '@/components/reactbits/Dock'
import { DotField } from '@/components/reactbits/DotField'
import { OptionWheel } from '@/components/reactbits/OptionWheel'
import { SpecularButton } from '@/components/reactbits/SpecularButton'
import { Cuboid3D } from '@/components/tour/Cuboid3D'
import { WaterfallStrip } from '@/components/tour/WaterfallStrip'
import { WorldMap } from '@/components/tour/WorldMap'
import { Button } from '@/components/ui/button'
import { areaKm2, conf, coord, duration, metres, num } from '@/lib/format'
import { useTourData, type TourState } from '@/lib/tourData'
import { cn } from '@/lib/utils'
import { useSurveyStore } from '@/stores/surveyStore'

export const ONBOARDED_KEY = 'deepsight.onboarded'

const STRIP_COUNT = 260

const TAGLINES: CarouselItem[] = [
  {
    id: 1,
    title: 'A coordinate you can sail to',
    description:
      'Not a box on a JPEG. A latitude and longitude computed from real sonar geometry  slant range, layback, geodesic projection.',
    icon: <MapPin className="size-4" />,
  },
  {
    id: 2,
    title: 'An honest search radius',
    description:
      'Every target carries its own error budget. Far range on a straight line gives a tight circle; near nadir on a turn gives a wide one  and we can explain each.',
    icon: <Crosshair className="size-4" />,
  },
  {
    id: 3,
    title: 'The survey, replayed',
    description:
      'The waterfall scrolls the way the instrument recorded it, reconstructed from raw ping records. Detections appear as the sonar passes over them.',
    icon: <Waves className="size-4" />,
  },
  {
    id: 4,
    title: 'Rocks called rocks',
    description:
      'A natural-bottom-object class trained in on purpose. The model tells a boulder from a target, and says which it thinks it is.',
    icon: <Activity className="size-4" />,
  },
]

const DIFFERENTIATORS = [
  {
    n: '01',
    title: 'Position with an error radius',
    body: 'Computed from sonar geometry, not machine learning. It cannot fail to train. Teams working from JPEGs have no headers and cannot produce a defensible coordinate at all.',
  },
  {
    n: '02',
    title: 'Live waterfall playback',
    body: 'Reconstructed from raw ping records and streamed over a socket. Everyone else shows a static image with boxes drawn on it.',
  },
  {
    n: '03',
    title: 'A trained-in false-positive class',
    body: 'We train on labelled natural bottom objects, not just targets. Others filter false alarms after the fact, if at all.',
  },
  {
    n: '04',
    title: 'Honest evaluation',
    body: 'Cross-dataset drop reported, not hidden. An error-radius coverage check that validates the budget, not just the detector.',
  },
]

interface Chapter {
  key: string
  icon: ReactNode
  kicker: string
  title: string
  body?: string
  /** full-bleed chapters manage their own layout */
  wide?: boolean
  render: (t: TourState) => ReactNode
}

export function Onboarding() {
  const navigate = useNavigate()
  const tour = useTourData()
  const { surveys, refresh } = useSurveyStore()
  const [i, setI] = useState(0)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const chapters = useMemo(() => buildChapters(surveys.map((s) => s.filename)), [surveys])
  const last = i === chapters.length - 1

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      /* private mode  they just see it again */
    }
    navigate('/surveys')
  }, [navigate])

  const next = useCallback(() => (last ? finish() : setI((n) => n + 1)), [last, finish])
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'Escape') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, finish])

  const ch = chapters[i]

  return (
    // no overflow-hidden on this element: it would trap the sticky footer inside it
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col">
      {/* ground texture  measured, not decorative */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden grid-field" aria-hidden />
      {i === 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60" aria-hidden>
          <DotField dotSpacing={26} dotRadius={1.1} />
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)' }}
        aria-hidden
      />

      {/* header rail */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center gap-4 px-6 pt-6">
        <span className="label-micro">Walkthrough</span>
        <div className="tick-rule hidden flex-1 sm:block" aria-hidden />
        <span className="tnum text-xs text-muted-foreground">
          {String(i + 1).padStart(2, '0')} / {String(chapters.length).padStart(2, '0')}
        </span>
        <Button variant="ghost" size="sm" onClick={finish}>
          Skip
        </Button>
      </div>

      {/* chapter */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-6 py-8">
        <motion.div
          key={ch.key}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="w-full"
        >
          {ch.wide ? (
            <>
              <Head ch={ch} />
              <div className="mt-8">{ch.render(tour)}</div>
            </>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
              <Head ch={ch} />
              <div>{ch.render(tour)}</div>
            </div>
          )}
        </motion.div>
      </div>

      {/* footer rail  sticky so Next is reachable however tall a chapter runs */}
      <div className="sticky bottom-0 z-20 border-t bg-background/85 backdrop-blur-md">
        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Button variant="ghost" onClick={prev} disabled={i === 0}>
          <ArrowLeft className="size-4" /> Previous
        </Button>

        <div className="hidden sm:block">
          <Dock
            items={chapters.map((c, n) => ({
              icon: c.icon,
              label: c.title,
              onClick: () => setI(n),
              className: n === i ? 'ring-1 ring-[var(--accent)]' : undefined,
            }))}
            panelHeight={54}
            magnification={62}
            distance={130}
          />
        </div>

        <div className="flex items-center gap-2 sm:hidden">
          {chapters.map((c, n) => (
            <button
              key={c.key}
              aria-label={c.title}
              onClick={() => setI(n)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                n === i ? 'w-6 bg-accent' : 'w-1.5 bg-muted-foreground/30',
              )}
            />
          ))}
        </div>

          <SpecularButton onClick={next}>
            {last ? 'Open the console' : 'Next'} <ArrowRight className="size-4" />
          </SpecularButton>
        </div>
      </div>
    </div>
  )
}

function Head({ ch }: { ch: Chapter }) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-lg border bg-card text-accent">
          {ch.icon}
        </span>
        <span className="label-micro">{ch.kicker}</span>
      </div>
      <h1 className="mt-4 text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl">
        {ch.title}
      </h1>
      {ch.body && (
        <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
          {ch.body}
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ chapters

function buildChapters(recentNames: string[]): Chapter[] {
  return [
    {
      key: 'welcome',
      icon: <Radar className="size-4" />,
      kicker: 'SIH 2026 · PS 26057 · MoES / NIOT',
      title: 'From a sonar ping to a coordinate you can sail to.',
      body: 'Deep-Sight parses raw side-scan sonar, replays the waterfall, finds man-made objects on the seabed and geotags each one with a search radius a cleanup vessel can act on. Six screens, then you are in the console.',
      render: () => (
        <div className="flex justify-center lg:justify-end">
          <Carousel items={TAGLINES} baseWidth={380} />
        </div>
      ),
    },

    {
      key: 'different',
      icon: <Flag className="size-4" />,
      kicker: 'Why this one',
      title: 'What makes ours different',
      body: 'Ranked. Number one is geometry, not a model  it is the strongest claim and the safest.',
      wide: true,
      render: () => (
        <div className="grid gap-4 sm:grid-cols-2">
          {DIFFERENTIATORS.map((d) => (
            <BorderGlow key={d.n} className="p-5" borderRadius={14}>
              <div className="tnum text-xs font-semibold text-accent">{d.n}</div>
              <div className="mt-1 text-base font-semibold">{d.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d.body}</p>
            </BorderGlow>
          ))}
        </div>
      ),
    },

    {
      key: 'ingest',
      icon: <FileStack className="size-4" />,
      kicker: 'Stage 01',
      title: 'Ingest the raw sonar',
      body: 'An XTF file is not an image. It is a stream of ping records  navigation, altitude, range, frequency, and one intensity array per channel. Deep-Sight reads those directly.',
      render: (t) => {
        const s = t.data?.survey
        return (
          <div className="panel-marks rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-micro">Header readout</span>
              <span className="label-micro">{s ? s.filename : t.note || 'no survey loaded'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Fact label="Range" value={s ? metres(s.range_m) : ''} />
              <Fact label="Frequency" value={s ? `${num(s.frequency_khz)} kHz` : ''} />
              <Fact
                label="Mean altitude"
                value={s ? metres(s.altitude_mean_m) : ''}
                sub={s ? (s.altitude_source === 'xtf_header' ? 'from header' : 'blank-zone estimate') : undefined}
              />
              <Fact label="Duration" value={s ? duration(s.duration_s) : ''} />
              <Fact label="Pings" value={s ? num(s.ping_count) : ''} />
              <Fact label="Samples / channel" value={s ? num(s.samples_per_channel) : ''} />
              <Fact label="Sound speed" value={s ? `${num(s.sound_speed_ms)} m/s` : ''} />
              <Fact
                label="SW corner"
                value={s ? `${coord(s.bounds.south)}` : ''}
                sub={s ? coord(s.bounds.west) : undefined}
              />
            </div>
          </div>
        )
      },
    },

    {
      key: 'chains',
      icon: <ScanSearch className="size-4" />,
      kicker: 'Stage 02 · 03',
      title: 'Two pictures from one array, then a detector',
      body: 'The samples branch into chains that never cross: a display chain (log, TVG, percentile stretch) for the amber waterfall a human scrolls, and an analysis chain (nadir mask, wavelet despeckle) for the detector. Every hit carries a class and a detector score.',
      wide: true,
      render: (t) => {
        const d = t.data?.top
        if (!t.data || !d) return <ChainDiagram note={t.note} />
        // Frame the window on the box instead of a fixed slice: a tall box on real data
        // would otherwise run off both edges and there would be nothing to look at.
        const bh = Math.max(d.bbox_px.h, 30)
        const count = Math.min(420, Math.max(STRIP_COUNT, Math.round(bh * 4)))
        const start = Math.max(0, Math.round(d.bbox_px.y + bh / 2 - count / 2))
        return (
          <div className="space-y-3">
            <WaterfallStrip
              surveyId={t.data.surveyId}
              startPing={start}
              count={count}
              box={{
                x: d.bbox_px.x,
                y: d.bbox_px.y,
                w: d.bbox_px.w,
                h: d.bbox_px.h,
                cls: d.class,
                label: `${d.class_display} · ${conf(d.confidence)}`,
              }}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ClassBadge cls={d.class} showCode />
              <span className="text-muted-foreground">
                score <span className="tnum font-medium text-foreground">{conf(d.confidence)}</span>
              </span>
              <span className="text-muted-foreground">
                channel <span className="font-medium text-foreground">{d.channel}</span>
              </span>
              <span className="text-muted-foreground">
                ping <span className="tnum font-medium text-foreground">{num(d.ping)}</span>
              </span>
            </div>
          </div>
        )
      },
    },

    {
      key: 'geometry',
      icon: <Globe2 className="size-4" />,
      kicker: 'Stage 04',
      title: 'Geometry turns the box into a position',
      body: 'Slant range becomes ground range. Layback puts the towfish behind the ship. The acoustic shadow gives object height. A geodesic step projects the target onto the earth  with an error budget, not a false-precision dot.',
      wide: true,
      render: (t) => {
        const d = t.data?.top
        const g = t.data?.detail.geometry
        const eb = t.data?.detail.error_budget
        return (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="panel-marks rounded-xl border bg-card p-4">
              <div className="label-micro mb-1">Object · measured</div>
              <Cuboid3D
                widthM={d?.bbox_m_width ?? 6}
                lengthM={d?.bbox_m_height ?? 3.4}
                heightM={d?.object_height_m ?? 1.5}
                sceneHeight={180}
              />
              <dl className="mt-3 space-y-1 text-xs">
                <Geo label="Slant range" value={g ? metres(g.slant_range_m) : ''} />
                <Geo label="Ground range" value={g ? metres(g.ground_range_m) : ''} />
                <Geo label="Altitude" value={g ? metres(g.altitude_m) : ''} />
                <Geo label="Layback" value={g ? metres(g.layback_m) : ''} />
              </dl>
            </div>

            <WorldMap lat={d?.lat ?? 13.05} lon={d?.lon ?? 80.3} />

            <div className="panel-marks flex flex-col rounded-xl border bg-card p-4">
              <div className="label-micro">Position</div>
              <div className="tnum mt-1 text-lg font-semibold">
                {d?.lat != null && d.lon != null ? `${coord(d.lat)}, ${coord(d.lon)}` : ''}
              </div>
              <div className="tnum text-sm text-accent">± {metres(d?.error_radius_m ?? 24)}</div>
              <div className="mt-4">
                {eb ? (
                  <ErrorBudgetBar budget={eb} />
                ) : (
                  <div className="h-3 rounded-full bg-muted" />
                )}
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                {eb?.explanation ??
                  'Each term is measured or bounded, then combined  independent terms in quadrature, systematic terms linearly.'}
              </p>
            </div>
          </div>
        )
      },
    },

    {
      key: 'ready',
      icon: <Crosshair className="size-4" />,
      kicker: 'Ready',
      title: 'That was one target from a real run.',
      body: 'The console replays the whole survey  the waterfall scrolling as the instrument recorded it, every detection appearing as the sonar passes over it, each with this same geometry behind it.',
      render: (t) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="panel-marks rounded-xl border bg-card p-4">
            <div className="label-micro mb-3">This console, so far</div>
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Targets" value={t.data?.stats ? num(t.data.stats.targets_flagged) : ''} />
              <Fact
                label="Area surveyed"
                value={t.data?.stats ? areaKm2(t.data.stats.area_surveyed_m2) : ''}
              />
              <Fact
                label="Mean radius"
                value={t.data?.stats ? metres(t.data.stats.mean_error_radius_m) : ''}
              />
              <Fact
                label="Review area"
                value={
                  t.data?.stats ? `${(t.data.stats.review_area_fraction * 100).toFixed(2)} %` : ''
                }
              />
            </div>
          </div>
          <div className="panel-marks rounded-xl border bg-card p-4">
            <div className="label-micro mb-1">Surveys on this machine</div>
            {recentNames.length === 0 ? (
              <p className="py-8 text-sm text-muted-foreground">
                None yet. Upload an XTF, add side-scan images, or spin up A4 & SSS from the Surveys
                page.
              </p>
            ) : (
              <div className="h-[190px]">
                <OptionWheel items={recentNames.slice(0, 8)} fontSize={1.05} inset={10} />
              </div>
            )}
          </div>
        </div>
      ),
    },
  ]
}

// ------------------------------------------------------------------ bits

function ChainDiagram({ note }: { note: string }) {
  const Chip = ({ children, accent }: { children: ReactNode; accent?: boolean }) => (
    <span
      className={cn(
        'rounded-md border px-2.5 py-1.5 font-mono text-xs',
        accent ? 'border-accent/45 text-foreground' : 'bg-secondary',
      )}
    >
      {children}
    </span>
  )
  return (
    <div className="panel-marks rounded-xl border bg-card p-5">
      <div className="label-micro mb-4">{note || 'no survey loaded  schematic'}</div>
      <div className="flex flex-wrap items-center gap-3">
        <Chip>raw samples</Chip>
        <ArrowRight className="size-4 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <Chip accent>display chain · log · TVG · stretch</Chip>
          <Chip accent>analysis chain · nadir mask · wavelet despeckle</Chip>
        </div>
        <ArrowRight className="size-4 text-muted-foreground" />
        <Chip accent>YOLO · class + score</Chip>
      </div>
    </div>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background/40 p-2.5">
      <div className="label-micro">{label}</div>
      <div className="tnum mt-1 text-sm font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Geo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum font-medium">{value}</span>
    </div>
  )
}
