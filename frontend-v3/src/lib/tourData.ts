// One real, finished example for the walkthrough. Non-blocking: the walkthrough renders
// immediately and swaps real numbers in when they arrive. If the backend has nothing and
// the A4 & SSS survey cannot be built, phase goes 'unavailable' and the slides fall back to diagrams 
// the walkthrough never blocks on the network.

import { useEffect, useRef, useState } from 'react'

import {
    createA4SssSurvey,
    getDetection,
    getDetections,
    getStats,
    getSurvey,
    getSurveyStatus,
    listSurveys,
    processSurvey,
} from '@/lib/api'
import type {
    Detection,
    DetectionDetailResponse,
    SurveyDetail,
    SurveyStats,
} from '@/lib/types'

export interface TourData {
  surveyId: string
  survey: SurveyDetail
  top: Detection
  detail: DetectionDetailResponse
  stats: SurveyStats | null
}

export type TourPhase = 'loading' | 'ready' | 'unavailable'

export interface TourState {
  phase: TourPhase
  data: TourData | null
  note: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The walkthrough teaches, so it wants the curated example, not whichever file happens
// to be first. The A4 & SSS survey is that example  clean seabed, well-formed boxes. Real
// uploads are only a fallback, because a bad box on real data (a wreck measured at 1.6 km
// along-track) makes a poor first picture of the pipeline.
async function pickSurvey(note: (s: string) => void): Promise<string> {
  const { surveys } = await listSurveys()
  const usable = surveys.filter((s) => s.status === 'complete' && s.detection_count > 0)

  const a4 = usable.find((s) => s.survey_id.startsWith('svy_a4sss'))
  if (a4) return a4.survey_id

  try {
    note('Building the A4 & SSS survey…')
    const made = await createA4SssSurvey()
    await processSurvey(made.survey_id)
    for (let i = 0; i < 120; i++) {
      const st = await getSurveyStatus(made.survey_id)
      if (st.status === 'complete') return made.survey_id
      if (st.status === 'failed') break
      note(`Running detection… ${Math.round(st.progress * 100)}%`)
      await sleep(1000)
    }
  } catch {
    /* fall through to a real survey */
  }

  if (usable.length) return usable[0].survey_id
  throw new Error('no completed survey with detections')
}

export function useTourData(): TourState {
  const [state, setState] = useState<TourState>({
    phase: 'loading',
    data: null,
    note: 'Looking for a finished survey…',
  })
  const started = useRef(false)

  // Runs once for the life of the component. Deliberately has no abort flag: under
  // StrictMode the effect is mounted, cleaned up and mounted again, and an abort would
  // kill the only run the `started` guard allows. setState on an unmounted component is
  // a no-op in React 18+, so letting it finish is safe.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const note = (s: string) => setState((p) => (p.phase === 'loading' ? { ...p, note: s } : p))

    void (async () => {
      try {
        const surveyId = await pickSurvey(note)
        const [survey, dets] = await Promise.all([
          getSurvey(surveyId),
          getDetections(surveyId, { sort: 'confidence' }),
        ])
        const top = dets.detections.find((d) => d.lat != null && d.lon != null) ?? dets.detections[0]
        if (!top) throw new Error('no detections')
        const [detail, stats] = await Promise.all([
          getDetection(top.detection_id),
          getStats(surveyId).catch(() => null),
        ])
        setState({ phase: 'ready', data: { surveyId, survey, top, detail, stats }, note: '' })
      } catch (e) {
        setState({
          phase: 'unavailable',
          data: null,
          note: e instanceof Error ? e.message : 'no example available',
        })
      }
    })()
  }, [])

  return state
}
