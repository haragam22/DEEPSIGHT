// Deep-Sight API client. One function per REST endpoint, matching docs/apiendpoints.md.
//
// Base URL: empty by default  requests go to the same origin and the Vite dev server
// proxies /api, /ws and /health to the backend (keeps the app single-origin and
// offline-friendly). Set VITE_API_BASE at build time to point at a remote backend.

import type {
    ApiErrorResponse,
    DetectionDetailResponse,
    DetectionQueryParams,
    DetectionsResponse,
    ProcessResponse,
    ReportResponse,
    SurveyDetail,
    SurveyListResponse,
    SurveyStats,
    SurveyStatusResponse,
    SurveyUploadResponse,
    TrackFeature,
} from './types'

// Fixed at build time  see .env.example. Blank means same origin: the deployment serves
// /api and /ws from whatever host serves the page (a reverse proxy or a platform rewrite).
// Set VITE_API_BASE to an absolute URL when the backend lives somewhere else.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')

export function getApiBase(): string {
  return API_BASE
}

export function wsUrl(path: string): string {
  const base = getApiBase()
  if (base) return base.replace(/^http/, 'ws') + path
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}${path}`
}

export class ApiError extends Error {
  code: string
  detail: string
  surveyId?: string
  httpStatus: number
  constructor(body: { code: string; message: string; detail: string; survey_id?: string }, status: number) {
    super(body.message)
    this.name = 'ApiError'
    this.code = body.code
    this.detail = body.detail
    this.surveyId = body.survey_id
    this.httpStatus = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${getApiBase()}${path}`, init)
  } catch {
    throw new ApiError(
      { code: 'NETWORK', message: 'Cannot reach the backend.', detail: `fetch failed for ${path}` },
      0,
    )
  }
  if (!res.ok) {
    let body: ApiErrorResponse | null = null
    try {
      body = (await res.json()) as ApiErrorResponse
    } catch {
      /* non-JSON error body */
    }
    if (body?.error) {
      // eslint-disable-next-line no-console
      console.error(`[API ${res.status}]`, body.error.detail)
      throw new ApiError(body.error, res.status)
    }
    throw new ApiError(
      { code: 'UNKNOWN', message: 'An unexpected error occurred.', detail: `HTTP ${res.status} ${res.statusText}` },
      res.status,
    )
  }
  return res.json() as Promise<T>
}

// --- health ---
export function getHealth(): Promise<{ status: string }> {
  return req('/health')
}

// --- surveys ---
export function listSurveys(): Promise<SurveyListResponse> {
  return req('/api/surveys')
}

export function getSurvey(id: string): Promise<SurveyDetail> {
  return req(`/api/surveys/${id}`)
}

/** Delete a survey and everything derived from it. 204 on success; 404 (already gone)
 *  is treated as success. Irreversible  the caller must confirm first. */
export async function deleteSurvey(id: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${getApiBase()}/api/surveys/${id}`, { method: 'DELETE' })
  } catch {
    throw new ApiError({ code: 'NETWORK', message: 'Cannot reach the backend.', detail: `DELETE ${id}` }, 0)
  }
  if (!res.ok && res.status !== 404) {
    throw new ApiError(
      { code: 'DELETE_FAILED', message: 'Could not delete that survey.', detail: `HTTP ${res.status}` },
      res.status,
    )
  }
}

export function getSurveyStatus(id: string): Promise<SurveyStatusResponse> {
  return req(`/api/surveys/${id}/status`)
}

export function processSurvey(id: string): Promise<ProcessResponse> {
  return req(`/api/surveys/${id}/process`, { method: 'POST' })
}

export function createA4SssSurvey(): Promise<{ survey_id: string; filename: string; status: string; ping_count: number }> {
  return req('/api/dev/demo-survey', { method: 'POST' })
}

/** XTF upload with progress (XHR  fetch has no upload progress). */
export function uploadSurvey(file: File, onProgress: (pct: number) => void): Promise<SurveyUploadResponse> {
  return xhrUpload('/api/surveys', [['file', file]], onProgress)
}

/** One or more side-scan image tiles → pseudo-survey. */
export function uploadImages(files: File[], onProgress: (pct: number) => void): Promise<SurveyUploadResponse> {
  return xhrUpload('/api/surveys/image', files.map((f) => ['files', f]), onProgress)
}

function xhrUpload(
  path: string,
  parts: [string, File][],
  onProgress: (pct: number) => void,
): Promise<SurveyUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fd = new FormData()
    for (const [k, f] of parts) fd.append(k, f)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded * 100) / e.total))
    })
    xhr.addEventListener('load', () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as SurveyUploadResponse)
        } catch {
          reject(new ApiError({ code: 'UNKNOWN', message: 'Invalid response from server.', detail: 'bad upload JSON' }, xhr.status))
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as ApiErrorResponse
          reject(new ApiError(body.error, xhr.status))
        } catch {
          reject(new ApiError({ code: 'UNKNOWN', message: 'Upload failed.', detail: `HTTP ${xhr.status}` }, xhr.status))
        }
      }
    })
    xhr.addEventListener('error', () =>
      reject(new ApiError({ code: 'NETWORK', message: 'Network error during upload.', detail: 'xhr error' }, 0)),
    )
    xhr.addEventListener('abort', () =>
      reject(new ApiError({ code: 'ABORTED', message: 'Upload cancelled.', detail: 'xhr abort' }, 0)),
    )
    xhr.open('POST', `${getApiBase()}${path}`)
    xhr.send(fd)
  })
}

// --- detections ---
export function getDetections(id: string, params?: DetectionQueryParams): Promise<DetectionsResponse> {
  const qs = new URLSearchParams()
  if (params?.class) qs.set('class', params.class)
  if (params?.min_confidence != null) qs.set('min_confidence', String(params.min_confidence))
  if (params?.sort) qs.set('sort', params.sort)
  const s = qs.toString()
  return req(`/api/surveys/${id}/detections${s ? `?${s}` : ''}`)
}

export function getDetection(detId: string): Promise<DetectionDetailResponse> {
  return req(`/api/detections/${detId}`)
}

// --- track / waterfall ---
export function getTrack(id: string): Promise<TrackFeature> {
  return req(`/api/surveys/${id}/track`)
}

export async function getWaterfallTile(
  id: string,
  startPing: number,
  count: number,
  corrected = false,
): Promise<Blob> {
  const qs = new URLSearchParams({ start_ping: String(startPing), count: String(count), corrected: String(corrected) })
  const res = await fetch(`${getApiBase()}/api/surveys/${id}/waterfall?${qs}`)
  if (!res.ok) throw new ApiError({ code: 'UNKNOWN', message: 'Failed to load waterfall tile.', detail: `HTTP ${res.status}` }, res.status)
  return res.blob()
}

// --- stats / report ---
export function getStats(id: string): Promise<SurveyStats> {
  return req(`/api/surveys/${id}/stats`)
}

export function getReportJson(id: string): Promise<ReportResponse> {
  return req(`/api/surveys/${id}/report.json`)
}

export function reportCsvUrl(id: string): string {
  return `${getApiBase()}/api/surveys/${id}/report.csv`
}
