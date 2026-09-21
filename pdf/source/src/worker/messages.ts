export const MAX_FILE_BYTES = 250 * 1024 * 1024

export type DocumentSummary = {
  documentId: string
  fileName: string
  fileSize: number
  pageCount: number
  firstPage: PageSize
}

export type PageSize = {
  widthPoints: number
  heightPoints: number
  widthMillimetres: number
  heightMillimetres: number
}

export type ColorModel = "CMYK" | "RGB" | "Gray" | "Mixed" | "NChannel" | "Unknown"

export type OutputIntentInfo = {
  subtype?: string
  outputCondition?: string
  outputConditionIdentifier?: string
  registryName?: string
  info?: string
  profileName?: string
  profileModel: Exclude<ColorModel, "Mixed">
  components?: number
  iccVersion?: string
  profileClass?: string
}

export type ColorSpaceInfo = {
  name: string
  type: string
  components: number
  occurrences: number
  pages: number[]
  usages: string[]
}

export type SpotColorInfo = {
  name: string
  alternateSpace?: string
  previewColor?: string
  occurrences: number
  pages: number[]
  usages: string[]
  status: "used" | "declared"
  role: "ink" | "technical"
}

export type DocumentPreflight = {
  documentId: string
  classification: ColorModel
  pdfStandard?: string
  outputIntents: OutputIntentInfo[]
  embeddedObjectProfiles: string[]
  colorSpaces: ColorSpaceInfo[]
  spotColors: SpotColorInfo[]
  processColors: string[]
  scannedPages: number
  totalPages: number
  warnings: string[]
}

export type ColorSample = {
  documentId: string
  pageIndex: number
  xPoints: number
  yPoints: number
  xMillimetres: number
  yMillimetres: number
  model: "CMYK" | "RGB"
  channels: Array<{ name: string; value: number; unit: "%" | "8-bit" }>
  note?: string
}

export type LoadDocumentRequest = {
  type: "LOAD_DOCUMENT"
  requestId: number
  documentId: string
  fileName: string
  fileSize: number
  bytes: ArrayBuffer
}

export type RenderPageRequest = {
  type: "RENDER_PAGE"
  requestId: number
  documentId: string
  pageIndex: number
  targetCssWidth: number
  pixelRatio: number
}

export type CloseDocumentRequest = {
  type: "CLOSE_DOCUMENT"
  requestId: number
  documentId?: string
}

export type PreflightDocumentRequest = {
  type: "PREFLIGHT_DOCUMENT"
  requestId: number
  documentId: string
}

export type SampleColorRequest = {
  type: "SAMPLE_COLOR"
  requestId: number
  documentId: string
  pageIndex: number
  xPoints: number
  yPoints: number
}

export type WorkerRequest =
  | LoadDocumentRequest
  | RenderPageRequest
  | PreflightDocumentRequest
  | SampleColorRequest
  | CloseDocumentRequest

export type WorkerReadyResponse = {
  type: "WORKER_READY"
}

export type DocumentLoadedResponse = {
  type: "DOCUMENT_LOADED"
  requestId: number
  document: DocumentSummary
}

export type PageRenderedResponse = {
  type: "PAGE_RENDERED"
  requestId: number
  documentId: string
  pageIndex: number
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  renderScale: number
  pixels: ArrayBuffer
}

export type DocumentClosedResponse = {
  type: "DOCUMENT_CLOSED"
  requestId: number
}

export type PreflightProgressResponse = {
  type: "PREFLIGHT_PROGRESS"
  requestId: number
  documentId: string
  completedPages: number
  totalPages: number
}

export type PreflightCompletedResponse = {
  type: "PREFLIGHT_COMPLETED"
  requestId: number
  preflight: DocumentPreflight
}

export type ColorSampledResponse = {
  type: "COLOR_SAMPLED"
  requestId: number
  sample: ColorSample
}

export type WorkerErrorResponse = {
  type: "WORKER_ERROR"
  requestId?: number
  scope: "worker" | "document" | "render" | "preflight" | "sample"
  code:
    | "INVALID_FILE"
    | "PASSWORD_REQUIRED"
    | "DOCUMENT_TOO_LARGE"
    | "NO_DOCUMENT"
    | "STALE_DOCUMENT"
    | "RENDER_FAILED"
    | "PREFLIGHT_FAILED"
    | "SAMPLE_FAILED"
    | "UNKNOWN"
  message: string
}

export type WorkerResponse =
  | WorkerReadyResponse
  | DocumentLoadedResponse
  | PageRenderedResponse
  | PreflightProgressResponse
  | PreflightCompletedResponse
  | ColorSampledResponse
  | DocumentClosedResponse
  | WorkerErrorResponse
