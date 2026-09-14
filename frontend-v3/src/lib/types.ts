// Deep-Sight API types  hand-typed from docs/apiendpoints.md (the frozen contract).
// Mirrors the contract EXACTLY. Do not add fields that aren't in the contract.

export type SurveyStatus =
  | 'uploaded'
  | 'parsing'
  | 'ready'
  | 'processing'
  | 'complete'
  | 'failed'

export type DetectionClass = 'wreck' | 'milco' | 'nombo' | 'pipeline'

export type DetectionFlag =
  | 'near_nadir'
  | 'on_turn'
  | 'long_layback'
  | 'estimated_altitude'
  | 'range_change_nearby'

export type AltitudeSource = 'xtf_header' | 'blank_zone_estimate'

export type DetectionSort = 'confidence' | 'ping' | 'error_radius'

export interface SurveyUploadResponse {
  survey_id: string
  filename: string
  size_bytes: number
  status: SurveyStatus
  created_at: string
}

export interface SurveyListItem {
  survey_id: string
  filename: string
  status: SurveyStatus
  ping_count: number
  detection_count: number
  created_at: string
}

export interface SurveyListResponse {
  surveys: SurveyListItem[]
}

export interface SurveyBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface SurveyDetail {
  survey_id: string
  filename: string
  status: SurveyStatus
  ping_count: number
  samples_per_channel: number
  range_m: number
  frequency_khz: number
  duration_s: number
  altitude_source: AltitudeSource
  altitude_mean_m: number
  sound_speed_ms: number
  bounds: SurveyBounds
  start_time: string
  warnings: string[]
}

export interface SurveyStatusResponse {
  survey_id: string
  status: SurveyStatus
  progress: number
  pings_processed: number
  detections_so_far: number
  message: string | null
}

export interface ProcessResponse {
  survey_id: string
  status: SurveyStatus
  job_id: string
}

export interface BboxPx {
  x: number
  y: number
  w: number
  h: number
}

export interface Detection {
  detection_id: string
  survey_id: string
  ping: number
  timestamp: string
  lat: number | null
  lon: number | null
  error_radius_m: number
  class: DetectionClass
  class_display: string
  confidence: number
  bbox_m_width: number
  bbox_m_height: number
  object_height_m: number
  channel: 'port' | 'starboard'
  ground_range_m: number
  bbox_px: BboxPx
  altitude_source: AltitudeSource
  flags: DetectionFlag[]
}

export interface DetectionsResponse {
  survey_id: string
  count: number
  detections: Detection[]
}

export interface DetectionQueryParams {
  class?: DetectionClass
  min_confidence?: number
  sort?: DetectionSort
}

export interface ErrorBudgetTerm {
  source: string
  label: string
  value_m: number
  kind: 'independent' | 'systematic'
}

export interface ErrorBudget {
  total_m: number
  method: string
  terms: ErrorBudgetTerm[]
  dominant_term: string
  explanation: string
}

export interface DetectionGeometry {
  slant_range_m: number
  ground_range_m: number
  altitude_m: number
  layback_m: number
  heading_deg: number
  fish_lat: number | null
  fish_lon: number | null
}

export interface Relief {
  rows: number
  cols: number
  cell_m_across: number
  cell_m_along: number | null
  /** rows × cols metres, row-major; 0 = seabed */
  heights: number[]
  max_height_m: number
  measured_fraction: number
}

export interface DetectionDetailResponse {
  detection: Detection
  error_budget: ErrorBudget
  geometry: DetectionGeometry
  relief: Relief | null
}

export interface SurveyStats {
  area_surveyed_m2: number
  line_length_km: number
  targets_flagged: number
  targets_by_class: Partial<Record<DetectionClass, number>>
  review_area_fraction: number
  mean_error_radius_m: number
  headline: string
}

export interface ReportResponse {
  survey: SurveyDetail
  generated_at: string
  stats: SurveyStats
  detections: Detection[]
  method_notes: string[]
}

// --- track (GeoJSON) ---
export interface TrackFeature {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  properties: { survey_id: string; point_count: number; decimated_from: number }
}

// --- WebSocket ---
export type WsClientMessage =
  | { type: 'start'; start_ping: number; speed: number; batch_size: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'seek'; ping: number }
  | { type: 'speed'; speed: number }
  | { type: 'stop' }

export interface NavPoint {
  ping: number
  lat: number | null
  lon: number | null
  heading: number | null
  altitude_m: number | null
  speed_kn: number | null
}

export interface WsPingBatch {
  type: 'ping_batch'
  start_ping: number
  count: number
  width: number
  encoding: 'u8_base64'
  rows: string
  nav: NavPoint[]
}

export interface WsDetection {
  type: 'detection'
  detection: Detection
}

export interface WsStatus {
  type: 'status'
  ping: number
  progress: number
  message: string | null
}

export interface WsDone {
  type: 'done'
  total_pings: number
  total_detections: number
}

export interface WsError {
  type: 'error'
  code: string
  message: string
}

export type WsServerMessage = WsPingBatch | WsDetection | WsStatus | WsDone | WsError

export interface ApiErrorBody {
  code: string
  message: string
  detail: string
  survey_id?: string
}

export interface ApiErrorResponse {
  error: ApiErrorBody
}

export const CLASS_LABEL: Record<DetectionClass, string> = {
  wreck: 'Wreck',
  milco: 'Rigid man-made object',
  nombo: 'Natural bottom object',
  pipeline: 'Pipeline',
}

export const ALL_CLASSES: DetectionClass[] = ['wreck', 'milco', 'nombo', 'pipeline']

export const FLAG_LABEL: Record<DetectionFlag, string> = {
  near_nadir: 'Near nadir',
  on_turn: 'On turn',
  long_layback: 'Long layback',
  estimated_altitude: 'Estimated altitude',
  range_change_nearby: 'Range change nearby',
}
