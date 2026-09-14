// Estimated relief of a detection: the backend heightfield drawn as small columns on a
// 2D canvas (orthographic, painter's order). No WebGL, no 3D library. Drag to turn it;
// it slowly rotates on its own unless hovered or the viewer prefers reduced motion.

import { useEffect, useRef, useState } from 'react'

import { useResolvedColors } from '@/lib/colors'
import { metres } from '@/lib/format'
import type { Relief } from '@/lib/types'

const ELEV = 0.6 // camera elevation, rad
const TARGET_RELIEF = 0.3 // exaggerate so the tallest column is at least this share of the footprint

export function Relief3D({ relief, sceneHeight = 190 }: { relief: Relief; sceneHeight?: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const angle = useRef(0.7)
  const [hover, setHover] = useState(false)
  const c = useResolvedColors()

  const a = relief.cell_m_across
  const b = relief.cell_m_along ?? a
  const extent = Math.max(relief.cols * a, relief.rows * b)
  const ex = Math.max(1, (TARGET_RELIEF * extent) / Math.max(relief.max_height_m, 1e-3))

  useEffect(() => {
    const el = canvas.current
    const box = wrap.current
    if (!el || !box) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    // stack of cubes: each footprint cell is a pile of `lv` cubes, `step` metres tall each
    const { rows, cols, heights } = relief
    const step = (a + b) / 2
    const lv = heights.map((h) => (h > 0 ? Math.max(1, Math.round((h * ex) / step)) : 0))
    const level = (r: number, k: number) => (r < 0 || k < 0 || r >= rows || k >= cols ? 0 : lv[r * cols + k])
    const topLv = Math.max(...lv)
    const cells: { r: number; k: number; x: number; y: number; n: number; t: number }[] = []
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const n = level(r, k)
        if (n > 0)
          cells.push({
            r,
            k,
            x: (k - cols / 2 + 0.5) * a,
            y: (r - rows / 2 + 0.5) * b,
            n,
            t: n / topLv,
          })
      }

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const W = box.clientWidth
      const H = sceneHeight
      if (el.width !== W * dpr || el.height !== H * dpr) {
        el.width = W * dpr
        el.height = H * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const th = angle.current
      const cos = Math.cos(th)
      const sin = Math.sin(th)
      const diag = Math.hypot(cols * a, rows * b)
      const s = Math.min((W * 0.85) / diag, (H * 0.8) / (diag * Math.sin(ELEV) + relief.max_height_m * ex * Math.cos(ELEV)))
      const cx = W / 2
      const cy = H / 2 + (relief.max_height_m * ex * Math.cos(ELEV) * s) / 2
      const P = (x: number, y: number, z: number): [number, number] => [
        cx + (x * cos - y * sin) * s,
        cy + (x * sin + y * cos) * Math.sin(ELEV) * s - z * Math.cos(ELEV) * s,
      ]
      const quad = (pts: [number, number][], fill: string, shade: number) => {
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1])
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.fillStyle = `rgba(0,0,0,${shade})`
        ctx.fill()
        ctx.stroke()
      }
      ctx.lineWidth = 0.4
      ctx.lineJoin = 'round'

      // seabed: the whole grid at z = 0
      const hx = (cols * a) / 2
      const hy = (rows * b) / 2
      const g = [P(-hx, -hy, 0), P(hx, -hy, 0), P(hx, hy, 0), P(-hx, hy, 0)]
      ctx.beginPath()
      g.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.closePath()
      ctx.strokeStyle = c['--border']
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // far first: depth is the rotated along-screen axis
      const order = cells
        .map((p) => ({ p, d: p.x * sin + p.y * cos }))
        .sort((u, v) => u.d - v.d)
      const fill = c['--accent']
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'
      const ha = a / 2
      const hb = b / 2
      for (const { p } of order) {
        const { r, k, x, y, n, t } = p
        const low = 0.3 * (1 - t) // lower piles a little darker
        // side faces that point at the camera; cubes hidden behind a neighbour's pile are skipped,
        // so only the outer skin of the body is drawn
        const sx = sin > 0 ? 1 : -1
        const sy = cos > 0 ? 1 : -1
        const nx = level(r, k + sx)
        const ny = level(r + sy, k)
        for (let i = nx; i < n; i++) {
          const z0 = i * step
          const z1 = z0 + step
          const fx = x + sx * ha
          quad([P(fx, y - hb, z0), P(fx, y + hb, z0), P(fx, y + hb, z1), P(fx, y - hb, z1)], fill, 0.35 + low)
        }
        for (let i = ny; i < n; i++) {
          const z0 = i * step
          const z1 = z0 + step
          const fy = y + sy * hb
          quad([P(x - ha, fy, z0), P(x + ha, fy, z0), P(x + ha, fy, z1), P(x - ha, fy, z1)], fill, 0.5 + low)
        }
        const z = n * step
        quad([P(x - ha, y - hb, z), P(x + ha, y - hb, z), P(x + ha, y + hb, z), P(x - ha, y + hb, z)], fill, low)
      }
    }

    const still = hover || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      angle.current += ((now - last) / 1000) * 0.35
      last = now
      draw()
      raf = requestAnimationFrame(tick)
    }
    if (still) draw()
    else raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(draw)
    ro.observe(box)

    // drag to rotate
    let dragX: number | null = null
    const down = (e: PointerEvent) => {
      dragX = e.clientX
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (dragX == null) return
      angle.current += (e.clientX - dragX) * 0.01
      dragX = e.clientX
      draw()
    }
    const up = () => (dragX = null)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
  }, [relief, a, b, ex, sceneHeight, hover, c])

  return (
    <div>
      <div
        ref={wrap}
        className="relative"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <canvas
          ref={canvas}
          className="block w-full cursor-grab touch-none active:cursor-grabbing"
          style={{ height: sceneHeight }}
          aria-label={`Estimated relief, ${relief.rows} by ${relief.cols} cells, tallest ${metres(relief.max_height_m)}`}
          role="img"
        />
        {ex > 1.05 && (
          <span className="label-micro absolute right-1 top-1">vertical ×{ex.toFixed(1)}</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Footprint" value={`${metres(relief.cols * a)} × ${relief.cell_m_along == null ? '—' : metres(relief.rows * b)}`} sub="across × along" />
        <Stat label="Tallest" value={metres(relief.max_height_m)} sub="from shadow" />
        <Stat label="Measured" value={`${Math.round(relief.measured_fraction * 100)}%`} sub="rows with shadow" />
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Estimated from the highlight and shadow of one pass. The far side is hidden in the shadow, so this is
        relief, not a full 3D model.
      </p>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  )
}
