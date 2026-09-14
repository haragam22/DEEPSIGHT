// WebSocket-free playback: poll GET /api/surveys/{id}/waterfall for PNG strips and feed
// them into the same row queue the socket uses. Slower and quieter, but the console never
// shows an empty screen (implementation_P.md section 4.4).

import { getWaterfallTile } from './api';
import type { PingBatch } from './playbackSocket';

/** Decode a greyscale PNG blob to (rows x width) 8-bit values, row-major. */
async function decodePngToGray(blob: Blob): Promise<{ data: Uint8Array; width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const gray = new Uint8Array(bmp.width * bmp.height)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] // R channel (grey => R=G=B)
  return { data: gray, width: bmp.width, height: bmp.height }
}

export interface TilePoller {
  stop: () => void
}

/** Start polling tiles from `startPing` to `totalPings`. `onBatch` gets the same shape
 *  the socket emits (nav is empty  the tile endpoint carries no navigation). */
export function startTilePolling(opts: {
  surveyId: string
  startPing: number
  totalPings: number
  batch: number
  corrected: boolean
  onBatch: (b: PingBatch) => void
  onDone: () => void
  intervalMs?: number
}): TilePoller {
  let cursor = opts.startPing
  let alive = true
  let inFlight = false

  const tick = async () => {
    if (!alive || inFlight) return
    if (cursor >= opts.totalPings) {
      alive = false
      opts.onDone()
      return
    }
    inFlight = true
    const count = Math.min(opts.batch, opts.totalPings - cursor)
    try {
      const blob = await getWaterfallTile(opts.surveyId, cursor, count, opts.corrected)
      const { data, width } = await decodePngToGray(blob)
      if (alive) {
        opts.onBatch({ data, count, width, startPing: cursor, nav: [] })
        cursor += count
      }
    } catch {
      /* transient  try again next tick */
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(tick, opts.intervalMs ?? 700)
  void tick()
  return {
    stop: () => {
      alive = false
      clearInterval(timer)
    },
  }
}

/** One-shot tile fetch for scrubbing while paused. */
export async function fetchScrubTile(
  surveyId: string,
  startPing: number,
  count: number,
  corrected: boolean,
): Promise<PingBatch> {
  const blob = await getWaterfallTile(surveyId, startPing, count, corrected)
  const { data, width } = await decodePngToGray(blob)
  return { data, count, width, startPing, nav: [] }
}
