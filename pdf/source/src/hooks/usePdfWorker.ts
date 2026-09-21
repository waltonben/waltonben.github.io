import { useCallback, useEffect, useRef, useState } from "react"
import {
  MAX_FILE_BYTES,
  type ColorSample,
  type DocumentPreflight,
  type DocumentSummary,
  type InkCoverageReport,
  type WorkerRequest,
  type WorkerResponse,
} from "../worker/messages"

type ViewerStatus = "starting" | "idle" | "loading" | "rendering" | "ready" | "error"

type RenderedPage = {
  documentId: string
  pageIndex: number
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  pixels: Uint8ClampedArray<ArrayBuffer>
}

type PdfWorkerState = {
  status: ViewerStatus
  document: DocumentSummary | null
  renderedPage: RenderedPage | null
  error: string | null
  preflightStatus: "idle" | "running" | "ready" | "error"
  preflight: DocumentPreflight | null
  preflightProgress: { completedPages: number; totalPages: number } | null
  preflightError: string | null
  coverageStatus: "idle" | "loading" | "ready" | "error"
  coverage: InkCoverageReport | null
  coverageError: string | null
  sampleStatus: "idle" | "loading" | "ready" | "error"
  sample: ColorSample | null
  sampleError: string | null
}

const initialState: PdfWorkerState = {
  status: "starting",
  document: null,
  renderedPage: null,
  error: null,
  preflightStatus: "idle",
  preflight: null,
  preflightProgress: null,
  preflightError: null,
  coverageStatus: "idle",
  coverage: null,
  coverageError: null,
  sampleStatus: "idle",
  sample: null,
  sampleError: null,
}

function fileLooksLikePdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

export function usePdfWorker() {
  const [state, setState] = useState<PdfWorkerState>(initialState)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const newestRenderRequestRef = useRef(0)
  const newestLoadRequestRef = useRef(0)
  const newestPreflightRequestRef = useRef(0)
  const newestSampleRequestRef = useRef(0)
  const loadTokenRef = useRef(0)

  const nextRequestId = useCallback(() => {
    requestIdRef.current += 1
    return requestIdRef.current
  }, [])

  const post = useCallback((request: WorkerRequest, transfer: Transferable[] = []) => {
    workerRef.current?.postMessage(request, transfer)
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL("../worker/pdf.worker.ts", import.meta.url), {
      type: "module",
      name: "pressproof-pdf-engine",
    })
    workerRef.current = worker

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const response = event.data

      switch (response.type) {
        case "WORKER_READY":
          setState((current) =>
            current.status === "starting" ? { ...current, status: "idle" } : current,
          )
          break
        case "DOCUMENT_LOADED":
          if (response.requestId !== newestLoadRequestRef.current) return
          setState({ ...initialState, status: "rendering", document: response.document })
          break
        case "PAGE_RENDERED":
          if (response.requestId < newestRenderRequestRef.current) return
          setState((current) => {
            if (current.document?.documentId !== response.documentId) return current
            return {
              ...current,
              status: "ready",
              error: null,
              renderedPage: {
                documentId: response.documentId,
                pageIndex: response.pageIndex,
                width: response.width,
                height: response.height,
                cssWidth: response.cssWidth,
                cssHeight: response.cssHeight,
                pixels: new Uint8ClampedArray(response.pixels),
              },
            }
          })
          break
        case "PREFLIGHT_PROGRESS":
          if (response.requestId !== newestPreflightRequestRef.current) return
          setState((current) => {
            if (current.document?.documentId !== response.documentId) return current
            return {
              ...current,
              preflightStatus: "running",
              preflightProgress: {
                completedPages: response.completedPages,
                totalPages: response.totalPages,
              },
            }
          })
          break
        case "PREFLIGHT_COMPLETED":
          if (response.requestId !== newestPreflightRequestRef.current) return
          setState((current) => {
            if (current.document?.documentId !== response.preflight.documentId) return current
            return {
              ...current,
              preflightStatus: "ready",
              preflight: response.preflight,
              preflightProgress: null,
              preflightError: null,
              coverageStatus: "loading",
              coverage: null,
              coverageError: null,
            }
          })
          break
        case "INK_COVERAGE_COMPLETED":
          if (response.requestId !== newestPreflightRequestRef.current) return
          setState((current) => {
            if (current.document?.documentId !== response.coverage.documentId) return current
            return {
              ...current,
              coverageStatus: "ready",
              coverage: response.coverage,
              coverageError: null,
            }
          })
          break
        case "COLOR_SAMPLED":
          if (response.requestId !== newestSampleRequestRef.current) return
          setState((current) => {
            if (current.document?.documentId !== response.sample.documentId) return current
            return {
              ...current,
              sampleStatus: "ready",
              sample: response.sample,
              sampleError: null,
            }
          })
          break
        case "WORKER_ERROR":
          if (response.scope === "preflight") {
            if (response.requestId !== newestPreflightRequestRef.current) return
            setState((current) => ({
              ...current,
              preflightStatus: "error",
              preflightProgress: null,
              preflightError: response.message,
            }))
            return
          }
          if (response.scope === "sample") {
            if (response.requestId !== newestSampleRequestRef.current) return
            setState((current) => ({
              ...current,
              sampleStatus: "error",
              sampleError: response.message,
            }))
            return
          }
          if (response.scope === "coverage") {
            if (response.requestId !== newestPreflightRequestRef.current) return
            setState((current) => ({
              ...current,
              coverageStatus: "error",
              coverageError: response.message,
            }))
            return
          }
          if (response.scope === "render" && response.requestId !== newestRenderRequestRef.current) return
          if (response.scope === "document" && response.requestId !== newestLoadRequestRef.current) return
          setState((current) => ({ ...current, status: "error", error: response.message }))
          break
        case "DOCUMENT_CLOSED":
          break
      }
    })

    worker.addEventListener("error", (event) => {
      console.error("PDF worker error", {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error,
      })
      setState((current) => ({
        ...current,
        status: "error",
        error: event.message || "The PDF rendering worker stopped unexpectedly.",
      }))
    })

    return () => {
      loadTokenRef.current += 1
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const loadFile = useCallback(
    async (file: File) => {
      if (!fileLooksLikePdf(file)) {
        setState((current) => ({
          ...current,
          status: "error",
          error: "Choose a PDF file.",
        }))
        return
      }

      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        setState((current) => ({
          ...current,
          status: "error",
          error: "The PDF must be between 1 byte and 250 MB.",
        }))
        return
      }

      const loadToken = loadTokenRef.current + 1
      loadTokenRef.current = loadToken
      setState({ ...initialState, status: "loading" })

      try {
        const bytes = await file.arrayBuffer()
        if (loadToken !== loadTokenRef.current) return

        const requestId = nextRequestId()
        newestLoadRequestRef.current = requestId
        const documentId = crypto.randomUUID()
        post(
          {
            type: "LOAD_DOCUMENT",
            requestId,
            documentId,
            fileName: file.name,
            fileSize: file.size,
            bytes,
          },
          [bytes],
        )
      } catch (error) {
        setState({
          ...initialState,
          status: "error",
          error: error instanceof Error ? error.message : "The browser could not read this file.",
        })
      }
    },
    [nextRequestId, post],
  )

  const inspectDocument = useCallback(() => {
    const document = state.document
    if (!document) return

    const requestId = nextRequestId()
    newestPreflightRequestRef.current = requestId
    setState((current) => ({
      ...current,
      preflightStatus: "running",
      preflightProgress: { completedPages: 0, totalPages: document.pageCount },
      preflightError: null,
    }))
    post({
      type: "PREFLIGHT_DOCUMENT",
      requestId,
      documentId: document.documentId,
    })
  }, [nextRequestId, post, state.document])

  const sampleColor = useCallback(
    (pageIndex: number, xPoints: number, yPoints: number) => {
      const document = state.document
      if (!document) return

      const requestId = nextRequestId()
      newestSampleRequestRef.current = requestId
      setState((current) => ({
        ...current,
        sampleStatus: "loading",
        sampleError: null,
      }))
      post({
        type: "SAMPLE_COLOR",
        requestId,
        documentId: document.documentId,
        pageIndex,
        xPoints,
        yPoints,
      })
    },
    [nextRequestId, post, state.document],
  )

  const renderPage = useCallback(
    (pageIndex: number, targetCssHeight: number, pixelRatio: number) => {
      const document = state.document
      if (!document) return

      const requestId = nextRequestId()
      newestRenderRequestRef.current = requestId
      setState((current) => ({ ...current, status: "rendering", error: null }))
      post({
        type: "RENDER_PAGE",
        requestId,
        documentId: document.documentId,
        pageIndex,
        targetCssHeight,
        pixelRatio,
      })
    },
    [nextRequestId, post, state.document],
  )

  const closeDocument = useCallback(() => {
    loadTokenRef.current += 1
    const requestId = nextRequestId()
    const documentId = state.document?.documentId
    newestRenderRequestRef.current = requestId
    post({ type: "CLOSE_DOCUMENT", requestId, documentId })
    setState((current) => ({
      ...initialState,
      status: current.status === "starting" ? "starting" : "idle",
    }))
  }, [nextRequestId, post, state.document?.documentId])

  return { ...state, loadFile, renderPage, inspectDocument, sampleColor, closeDocument }
}
