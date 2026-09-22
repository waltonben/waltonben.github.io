/// <reference lib="webworker" />

import * as mupdf from "mupdf"
import {
  MAX_FILE_BYTES,
  type ColorSample,
  type DocumentPreflight,
  type DocumentSummary,
  type PageSize,
  type PageRenderedResponse,
  type WorkerErrorResponse,
  type WorkerRequest,
  type WorkerResponse,
} from "./messages"
import { preflightPdf } from "./preflight"
import { calculateInkCoverage } from "./coverage"
import { extractVectorPaths as extractVectorGeometry } from "./vector-paths"
import {
  composeSeparationPreview,
  createSeparationPreviewCache,
  destroySeparationPreviewCache,
  type SeparationPreviewCache,
} from "./separation-preview"

const MAX_RENDER_PIXELS = 30_000_000
const MAX_PAGE_POINTS = 50_000
const MIN_VIEWPORT_DIMENSION = 40
const MAX_VIEWPORT_DIMENSION = 4_000
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const MAX_PIXEL_RATIO = 2.5
const POINTS_PER_INCH = 72
const MILLIMETRES_PER_INCH = 25.4
const SAMPLE_DPI = 144

let activeDocument: mupdf.Document | null = null
let activeDocumentId: string | null = null
let activePreflight: DocumentPreflight | null = null
let separationPreviewCache: SeparationPreviewCache | null = null
let sampleCache:
  | {
      documentId: string
      pageIndex: number
      model: "CMYK" | "RGB"
      scale: number
      pixmap: mupdf.Pixmap
    }
  | null = null

function post(response: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(response, transfer)
}

function errorResponse(
  message: string,
  scope: WorkerErrorResponse["scope"],
  code: WorkerErrorResponse["code"] = "UNKNOWN",
  requestId?: number,
): WorkerErrorResponse {
  return { type: "WORKER_ERROR", requestId, scope, code, message }
}

function closeActiveDocument() {
  sampleCache?.pixmap.destroy()
  sampleCache = null
  destroySeparationPreviewCache(separationPreviewCache)
  separationPreviewCache = null
  activePreflight = null
  activeDocument?.destroy()
  activeDocument = null
  activeDocumentId = null
}

function toMillimetres(points: number) {
  return (points * MILLIMETRES_PER_INCH) / POINTS_PER_INCH
}

function boxSize([x0, y0, x1, y1]: mupdf.Rect) {
  return {
    widthPoints: Math.abs(x1 - x0),
    heightPoints: Math.abs(y1 - y0),
  }
}

function declaredPageBoxes(page: mupdf.Page) {
  if (!page.isPDF()) return { trim: false, bleed: false }

  const pageObject = (page as mupdf.PDFPage).getObject()
  const trimBox = pageObject.getInheritable("TrimBox")
  const bleedBox = pageObject.getInheritable("BleedBox")
  try {
    return {
      trim: trimBox.isArray() && trimBox.length === 4,
      bleed: bleedBox.isArray() && bleedBox.length === 4,
    }
  } finally {
    bleedBox.destroy()
    trimBox.destroy()
    pageObject.destroy()
  }
}

function getPageSize(page: mupdf.Page): PageSize {
  const cropBox = page.getBounds("CropBox")
  const mediaBox = page.getBounds("MediaBox")
  const trimBox = page.getBounds("TrimBox")
  const bleedBox = page.getBounds("BleedBox")
  const declared = declaredPageBoxes(page)
  const { widthPoints, heightPoints } = boxSize(cropBox)
  const media = boxSize(mediaBox)
  const trim = boxSize(trimBox)
  const bleedReference = declared.bleed ? bleedBox : mediaBox

  if (
    !Number.isFinite(widthPoints) ||
    !Number.isFinite(heightPoints) ||
    widthPoints <= 0 ||
    heightPoints <= 0 ||
    widthPoints > MAX_PAGE_POINTS ||
    heightPoints > MAX_PAGE_POINTS
  ) {
    throw new Error("The page has invalid or unsupported dimensions.")
  }

  return {
    widthPoints,
    heightPoints,
    widthMillimetres: toMillimetres(widthPoints),
    heightMillimetres: toMillimetres(heightPoints),
    mediaWidthMillimetres: toMillimetres(media.widthPoints),
    mediaHeightMillimetres: toMillimetres(media.heightPoints),
    trimWidthMillimetres: toMillimetres(trim.widthPoints),
    trimHeightMillimetres: toMillimetres(trim.heightPoints),
    bleed: declared.trim
      ? {
          topMillimetres: toMillimetres(Math.max(0, bleedReference[3] - trimBox[3])),
          rightMillimetres: toMillimetres(Math.max(0, bleedReference[2] - trimBox[2])),
          bottomMillimetres: toMillimetres(Math.max(0, trimBox[1] - bleedReference[1])),
          leftMillimetres: toMillimetres(Math.max(0, trimBox[0] - bleedReference[0])),
          source: declared.bleed ? "BleedBox" : "MediaBox",
          declared: declared.bleed,
        }
      : null,
  }
}

function copyRgbPixmapToRgba(pixmap: mupdf.Pixmap): Uint8ClampedArray<ArrayBuffer> {
  const width = pixmap.getWidth()
  const height = pixmap.getHeight()
  const components = pixmap.getNumberOfComponents()
  const stride = pixmap.getStride()
  const source = pixmap.getPixels()

  if (components !== 3) {
    throw new Error(`Expected an RGB pixmap, received ${components} components.`)
  }

  const rgba = new Uint8ClampedArray(width * height * 4)
  let targetOffset = 0

  for (let y = 0; y < height; y += 1) {
    let sourceOffset = y * stride
    for (let x = 0; x < width; x += 1) {
      rgba[targetOffset] = source[sourceOffset]
      rgba[targetOffset + 1] = source[sourceOffset + 1]
      rgba[targetOffset + 2] = source[sourceOffset + 2]
      rgba[targetOffset + 3] = 255
      sourceOffset += components
      targetOffset += 4
    }
  }

  return rgba
}

function loadDocument(request: Extract<WorkerRequest, { type: "LOAD_DOCUMENT" }>) {
  if (request.fileSize <= 0 || request.fileSize > MAX_FILE_BYTES) {
    post(
      errorResponse(
        "The PDF is empty or exceeds the 250 MB Milestone 1 limit.",
        "document",
        "DOCUMENT_TOO_LARGE",
        request.requestId,
      ),
    )
    return
  }

  closeActiveDocument()

  let document: mupdf.Document | null = null
  let page: mupdf.Page | null = null

  try {
    document = mupdf.Document.openDocument(request.bytes, "application/pdf")

    if (document.needsPassword()) {
      document.destroy()
      post(
        errorResponse(
          "This PDF is password-protected. Password entry is planned for a later milestone.",
          "document",
          "PASSWORD_REQUIRED",
          request.requestId,
        ),
      )
      return
    }

    const pageCount = document.countPages()
    if (pageCount < 1) {
      throw new Error("The PDF does not contain any pages.")
    }

    page = document.loadPage(0)
    const firstPage = getPageSize(page)

    activeDocument = document
    activeDocumentId = request.documentId
    document = null

    const summary: DocumentSummary = {
      documentId: request.documentId,
      fileName: request.fileName,
      fileSize: request.fileSize,
      pageCount,
      firstPage,
    }

    post({ type: "DOCUMENT_LOADED", requestId: request.requestId, document: summary })
  } catch (error) {
    document?.destroy()
    post(
      errorResponse(
        error instanceof Error ? error.message : "MuPDF could not open this file.",
        "document",
        "INVALID_FILE",
        request.requestId,
      ),
    )
  } finally {
    page?.destroy()
  }
}

function renderPage(request: Extract<WorkerRequest, { type: "RENDER_PAGE" }>) {
  if (!activeDocument || !activeDocumentId) {
    post(errorResponse("No PDF is loaded.", "render", "NO_DOCUMENT", request.requestId))
    return
  }

  if (request.documentId !== activeDocumentId) {
    post(
      errorResponse(
        "The render request belongs to an older document.",
        "render",
        "STALE_DOCUMENT",
        request.requestId,
      ),
    )
    return
  }

  if (request.pageIndex < 0 || request.pageIndex >= activeDocument.countPages()) {
    post(
      errorResponse(
        "The requested page is outside the document.",
        "render",
        "RENDER_FAILED",
        request.requestId,
      ),
    )
    return
  }

  let page: mupdf.Page | null = null
  let pixmap: mupdf.Pixmap | null = null

  try {
    page = activeDocument.loadPage(request.pageIndex)
    const pageSize = getPageSize(page)
    const targetCssWidth = Math.min(
      MAX_VIEWPORT_DIMENSION,
      Math.max(MIN_VIEWPORT_DIMENSION, request.targetCssWidth),
    )
    const targetCssHeight = Math.min(
      MAX_VIEWPORT_DIMENSION,
      Math.max(MIN_VIEWPORT_DIMENSION, request.targetCssHeight),
    )
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, request.zoom))
    const rotation = request.rotation
    const rotatedWidthPoints = rotation % 180 === 0
      ? pageSize.widthPoints
      : pageSize.heightPoints
    const rotatedHeightPoints = rotation % 180 === 0
      ? pageSize.heightPoints
      : pageSize.widthPoints
    const fitScale = Math.min(
      targetCssWidth / rotatedWidthPoints,
      targetCssHeight / rotatedHeightPoints,
    )
    const cssWidth = rotatedWidthPoints * fitScale * zoom
    const cssHeight = rotatedHeightPoints * fitScale * zoom
    const pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, request.pixelRatio))

    let pixelWidth = cssWidth * pixelRatio
    let pixelHeight = cssHeight * pixelRatio
    const requestedPixels = pixelWidth * pixelHeight

    if (requestedPixels > MAX_RENDER_PIXELS) {
      const reduction = Math.sqrt(MAX_RENDER_PIXELS / requestedPixels)
      pixelWidth *= reduction
      pixelHeight *= reduction
    }

    const renderScale = pixelWidth / rotatedWidthPoints
    const renderMatrix = mupdf.Matrix.concat(
      mupdf.Matrix.scale(renderScale, renderScale),
      mupdf.Matrix.rotate(rotation),
    )
    const separationPreview =
      request.hiddenSeparations.length > 0 || request.overprintSimulation
    if (separationPreview) {
      if (!activePreflight) {
        throw new Error("Separation controls are not ready until preflight completes.")
      }
      const cacheMatches =
        separationPreviewCache?.documentId === activeDocumentId &&
        separationPreviewCache.pageIndex === request.pageIndex &&
        separationPreviewCache.rotation === rotation &&
        Math.abs(separationPreviewCache.renderScale - renderScale) < 0.000001

      if (!cacheMatches) {
        destroySeparationPreviewCache(separationPreviewCache)
        separationPreviewCache = createSeparationPreviewCache(
          activeDocumentId,
          page,
          request.pageIndex,
          renderScale,
          rotation,
          activePreflight,
        )
      }
      pixmap = composeSeparationPreview(
        separationPreviewCache!,
        activePreflight,
        request.hiddenSeparations,
        request.overprintSimulation,
      )
    } else {
      pixmap = page.toPixmap(
        renderMatrix,
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      )
    }

    const rgba = copyRgbPixmapToRgba(pixmap)
    const response: PageRenderedResponse = {
      type: "PAGE_RENDERED",
      requestId: request.requestId,
      documentId: activeDocumentId,
      pageIndex: request.pageIndex,
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      cssWidth,
      cssHeight,
      zoom,
      rotation,
      renderScale,
      separationPreview,
      pixels: rgba.buffer,
    }

    post(response, [rgba.buffer])
  } catch (error) {
    post(
      errorResponse(
        error instanceof Error ? error.message : "MuPDF could not render this page.",
        "render",
        "RENDER_FAILED",
        request.requestId,
      ),
    )
  } finally {
    pixmap?.destroy()
    page?.destroy()
  }
}

function preflightDocument(request: Extract<WorkerRequest, { type: "PREFLIGHT_DOCUMENT" }>) {
  if (!activeDocument || !activeDocumentId) {
    post(errorResponse("No PDF is loaded.", "preflight", "NO_DOCUMENT", request.requestId))
    return
  }
  if (request.documentId !== activeDocumentId) {
    post(
      errorResponse(
        "The preflight request belongs to an older document.",
        "preflight",
        "STALE_DOCUMENT",
        request.requestId,
      ),
    )
    return
  }

  const pdf = activeDocument.asPDF()
  if (!pdf) {
    post(errorResponse("The loaded file is not a PDF.", "preflight", "PREFLIGHT_FAILED", request.requestId))
    return
  }

  try {
    const preflight = preflightPdf(activeDocumentId, pdf, (completedPages, totalPages) => {
      post({
        type: "PREFLIGHT_PROGRESS",
        requestId: request.requestId,
        documentId: activeDocumentId!,
        completedPages,
        totalPages,
      })
    })
    activePreflight = preflight
    post({ type: "PREFLIGHT_COMPLETED", requestId: request.requestId, preflight })
    try {
      const coverage = calculateInkCoverage(activeDocumentId, activeDocument, preflight)
      post({ type: "INK_COVERAGE_COMPLETED", requestId: request.requestId, coverage })
    } catch (error) {
      post(
        errorResponse(
          error instanceof Error ? error.message : "MuPDF could not calculate ink coverage.",
          "coverage",
          "COVERAGE_FAILED",
          request.requestId,
        ),
      )
    }
  } catch (error) {
    post(
      errorResponse(
        error instanceof Error ? error.message : "MuPDF could not inspect this document.",
        "preflight",
        "PREFLIGHT_FAILED",
        request.requestId,
      ),
    )
  }
}

function getSamplePixmap(pageIndex: number, model: "CMYK" | "RGB") {
  if (
    sampleCache?.documentId === activeDocumentId &&
    sampleCache.pageIndex === pageIndex &&
    sampleCache.model === model
  ) {
    return sampleCache
  }

  sampleCache?.pixmap.destroy()
  sampleCache = null

  const page = activeDocument!.loadPage(pageIndex)
  const scale = SAMPLE_DPI / POINTS_PER_INCH
  try {
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      model === "CMYK" ? mupdf.ColorSpace.DeviceCMYK : mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    )
    sampleCache = { documentId: activeDocumentId!, pageIndex, model, scale, pixmap }
    return sampleCache
  } finally {
    page.destroy()
  }
}

function sampleColor(request: Extract<WorkerRequest, { type: "SAMPLE_COLOR" }>) {
  if (!activeDocument || !activeDocumentId) {
    post(errorResponse("No PDF is loaded.", "sample", "NO_DOCUMENT", request.requestId))
    return
  }
  if (request.documentId !== activeDocumentId) {
    post(
      errorResponse(
        "The sample request belongs to an older document.",
        "sample",
        "STALE_DOCUMENT",
        request.requestId,
      ),
    )
    return
  }
  if (request.pageIndex < 0 || request.pageIndex >= activeDocument.countPages()) {
    post(errorResponse("The requested page is outside the document.", "sample", "SAMPLE_FAILED", request.requestId))
    return
  }

  try {
    const model: "CMYK" | "RGB" =
      activePreflight?.classification === "RGB" ? "RGB" : "CMYK"
    const cache = getSamplePixmap(request.pageIndex, model)
    const pixmap = cache.pixmap
    const x = Math.min(pixmap.getWidth() - 1, Math.max(0, Math.floor(request.xPoints * cache.scale)))
    const y = Math.min(pixmap.getHeight() - 1, Math.max(0, Math.floor(request.yPoints * cache.scale)))
    const components = pixmap.getNumberOfComponents()
    const offset = y * pixmap.getStride() + x * components
    const pixels = pixmap.getPixels()
    const channelNames = model === "CMYK" ? ["C", "M", "Y", "K"] : ["R", "G", "B"]

    const sample: ColorSample = {
      documentId: activeDocumentId,
      pageIndex: request.pageIndex,
      xPoints: request.xPoints,
      yPoints: request.yPoints,
      xMillimetres: toMillimetres(request.xPoints),
      yMillimetres: toMillimetres(request.yPoints),
      model,
      channels: channelNames.map((name, index) => ({
        name,
        value:
          model === "CMYK"
            ? Math.round((pixels[offset + index] / 255) * 1_000) / 10
            : pixels[offset + index],
        unit: model === "CMYK" ? "%" : "8-bit",
      })),
      note:
        activePreflight?.spotColors.some((spot) => spot.status === "used")
          ? "Process preview values include spot alternate-color conversion; native spot tints arrive with separation planes."
          : undefined,
    }
    post({ type: "COLOR_SAMPLED", requestId: request.requestId, sample })
  } catch (error) {
    post(
      errorResponse(
        error instanceof Error ? error.message : "MuPDF could not sample this point.",
        "sample",
        "SAMPLE_FAILED",
        request.requestId,
      ),
    )
  }
}

function extractVectorPaths(request: Extract<WorkerRequest, { type: "EXTRACT_VECTOR_PATHS" }>) {
  if (!activeDocument || !activeDocumentId) {
    post(errorResponse("No PDF is loaded.", "vector", "NO_DOCUMENT", request.requestId))
    return
  }
  if (request.documentId !== activeDocumentId) {
    post(
      errorResponse(
        "The vector request belongs to an older document.",
        "vector",
        "STALE_DOCUMENT",
        request.requestId,
      ),
    )
    return
  }
  if (request.pageIndex < 0 || request.pageIndex >= activeDocument.countPages()) {
    post(
      errorResponse(
        "The requested page is outside the document.",
        "vector",
        "VECTOR_EXTRACTION_FAILED",
        request.requestId,
      ),
    )
    return
  }

  let page: mupdf.Page | null = null
  try {
    page = activeDocument.loadPage(request.pageIndex)
    const geometry = extractVectorGeometry(
      activeDocumentId,
      page,
      request.pageIndex,
      request.separationNames,
    )
    post({ type: "VECTOR_PATHS_EXTRACTED", requestId: request.requestId, geometry })
  } catch (error) {
    post(
      errorResponse(
        error instanceof Error ? error.message : "MuPDF could not extract vector paths.",
        "vector",
        "VECTOR_EXTRACTION_FAILED",
        request.requestId,
      ),
    )
  } finally {
    page?.destroy()
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  switch (request.type) {
    case "LOAD_DOCUMENT":
      loadDocument(request)
      break
    case "RENDER_PAGE":
      renderPage(request)
      break
    case "PREFLIGHT_DOCUMENT":
      preflightDocument(request)
      break
    case "SAMPLE_COLOR":
      sampleColor(request)
      break
    case "EXTRACT_VECTOR_PATHS":
      extractVectorPaths(request)
      break
    case "CLOSE_DOCUMENT":
      closeActiveDocument()
      post({ type: "DOCUMENT_CLOSED", requestId: request.requestId })
      break
  }
})

self.addEventListener("error", () => {
  closeActiveDocument()
})

post({ type: "WORKER_READY" })
