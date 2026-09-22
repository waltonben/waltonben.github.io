import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import harlequinLogo from "./assets/HQAutomationLogo.svg"
import { DropZone } from "./components/DropZone"
import { PdfCanvas } from "./components/PdfCanvas"
import { PreflightPanel } from "./components/PreflightPanel"
import { usePdfWorker } from "./hooks/usePdfWorker"
import type { PageRotation, PageSize } from "./worker/messages"

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const VIEWPORT_PADDING = 72
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${numberFormatter.format(bytes / 1024)} KB`
  return `${numberFormatter.format(bytes / (1024 * 1024))} MB`
}

function formatBleed(bleed: PageSize["bleed"]) {
  if (!bleed) return "Not declared"
  const values = [
    bleed.topMillimetres,
    bleed.rightMillimetres,
    bleed.bottomMillimetres,
    bleed.leftMillimetres,
  ]
  if (Math.max(...values) - Math.min(...values) < 0.05) {
    return `${numberFormatter.format(values[0])} mm all sides`
  }
  return `T ${numberFormatter.format(values[0])} · R ${numberFormatter.format(values[1])} · B ${numberFormatter.format(values[2])} · L ${numberFormatter.format(values[3])} mm`
}

function mapRotatedPointToPage(x: number, y: number, rotation: PageRotation) {
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - x }
    case 180:
      return { x: 1 - x, y: 1 - y }
    case 270:
      return { x: 1 - y, y: x }
    default:
      return { x, y }
  }
}

function App() {
  const {
    status,
    document,
    renderedPage,
    error,
    preflightStatus,
    preflightProgress,
    preflight,
    preflightError,
    coverageStatus,
    coverage,
    coverageError,
    sampleStatus,
    sample,
    sampleError,
    loadFile,
    renderPage,
    inspectDocument,
    sampleColor,
    closeDocument,
  } = usePdfWorker()
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<PageRotation>(0)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [sampleMarker, setSampleMarker] = useState<{ x: number; y: number } | null>(null)
  const [hiddenSeparations, setHiddenSeparations] = useState<string[]>([])
  const [overprintSimulation, setOverprintSimulation] = useState(false)
  const zeroCoverageNames = useMemo(
    () =>
      coverageStatus === "ready" && coverage
        ? new Set(
            coverage.channels
              .filter((channel) => channel.coveragePercent === 0)
              .map((channel) => channel.name),
          )
        : null,
    [coverage, coverageStatus],
  )
  const separationNames = useMemo(
    () => [
      ...(preflight?.processColors.filter((name) => !zeroCoverageNames?.has(name)) ?? []),
      ...(preflight?.spotColors
        .map((spot) => spot.name)
        .filter((name) => !zeroCoverageNames?.has(name)) ?? []),
    ],
    [preflight, zeroCoverageNames],
  )
  const separationPreviewActive = hiddenSeparations.length > 0
  const proofPreviewActive = separationPreviewActive || overprintSimulation
  const renderedCssWidth = renderedPage?.cssWidth
  const renderedCssHeight = renderedPage?.cssHeight
  const renderedZoom = renderedPage?.zoom
  const renderedRotation = renderedPage?.rotation

  useEffect(() => {
    const element = canvasViewportRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const nextSize = {
        width: Math.max(40, Math.floor(entry.contentRect.width - VIEWPORT_PADDING)),
        height: Math.max(40, Math.floor(entry.contentRect.height - VIEWPORT_PADDING)),
      }
      setViewportSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize,
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [document])

  useEffect(() => {
    if (!document || viewportSize.width === 0 || viewportSize.height === 0) return
    renderPage(
      0,
      viewportSize.width,
      viewportSize.height,
      zoom,
      rotation,
      window.devicePixelRatio || 1,
      preflightStatus === "ready" ? hiddenSeparations : [],
      preflightStatus === "ready" && overprintSimulation,
    )
  }, [
    document,
    hiddenSeparations,
    overprintSimulation,
    preflightStatus,
    renderPage,
    viewportSize,
    zoom,
    rotation,
  ])

  useEffect(() => {
    if (!document) return
    inspectDocument()
    setSampleMarker(null)
    setHiddenSeparations([])
    setOverprintSimulation(false)
    setZoom(1)
    setRotation(0)
  }, [document, inspectDocument])

  useEffect(() => {
    setSampleMarker(null)
  }, [hiddenSeparations, overprintSimulation, rotation])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (event.code !== "Space" || isEditable || !document || zoom <= 1) return
      event.preventDefault()
      setIsSpacePressed(true)
    }
    const releaseSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      setIsSpacePressed(false)
      setIsPanning(false)
      panRef.current = null
    }
    const handleBlur = () => {
      setIsSpacePressed(false)
      setIsPanning(false)
      panRef.current = null
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", releaseSpace)
    window.addEventListener("blur", handleBlur)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", releaseSpace)
      window.removeEventListener("blur", handleBlur)
    }
  }, [document, zoom])

  useEffect(() => {
    const viewport = canvasViewportRef.current
    if (
      !viewport ||
      renderedZoom === undefined ||
      renderedRotation !== rotation ||
      Math.abs(renderedZoom - zoom) > 0.001
    ) return
    viewport.scrollTo({
      left: Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2),
      top: Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2),
    })
  }, [renderedCssHeight, renderedCssWidth, renderedRotation, renderedZoom, rotation, zoom])

  useEffect(() => {
    if (zoom > 1) return
    setIsSpacePressed(false)
    setIsPanning(false)
    panRef.current = null
  }, [zoom])

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)))
  }, [])

  const rotatePage = useCallback((degrees: -90 | 90) => {
    setRotation((current) => ((current + degrees + 360) % 360) as PageRotation)
  }, [])

  const startPanning = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = canvasViewportRef.current
      if (!viewport || !isSpacePressed || zoom <= 1) return
      event.preventDefault()
      event.stopPropagation()
      viewport.setPointerCapture(event.pointerId)
      panRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      setIsPanning(true)
    },
    [isSpacePressed, zoom],
  )

  const movePanning = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = canvasViewportRef.current
    const pan = panRef.current
    if (!viewport || !pan || pan.pointerId !== event.pointerId) return
    event.preventDefault()
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.clientY)
  }, [])

  const stopPanning = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = canvasViewportRef.current
    const pan = panRef.current
    if (!viewport || !pan || pan.pointerId !== event.pointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    panRef.current = null
    setIsPanning(false)
  }, [])

  const toggleSeparation = useCallback((name: string) => {
    setHiddenSeparations((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    )
  }, [])

  const isolateSeparation = useCallback(
    (name: string) => {
      setHiddenSeparations(separationNames.filter((item) => item !== name))
    },
    [separationNames],
  )

  const showAllSeparations = useCallback(() => setHiddenSeparations([]), [])

  const isBusy = status === "starting" || status === "loading"
  const statusText =
    status === "starting"
      ? "Starting local rendering engine…"
      : status === "loading"
        ? "Opening PDF in the local worker…"
        : status === "rendering"
          ? proofPreviewActive
            ? "Updating proof preview…"
            : "Rendering page locally…"
          : "Processed locally in this browser"

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="HARLEQUIN PDF viewer home">
          <img className="brand__mark" src={harlequinLogo} alt="" />
          <span className="brand__name">HARLEQUIN</span>
          <span className="brand__separator" aria-hidden="true">/</span>
          <span className="brand__tool">PDF viewer</span>
        </a>
        <div className="topbar__action">
          <DropZone compact disabled={isBusy} onFile={loadFile} />
        </div>
      </header>

      {!document ? (
        <section className="welcome-panel">
          <div className="welcome-panel__eyebrow">Browser-native production inspection</div>
          <h1>Your artwork stays on your machine.</h1>
          <p>
            Open a production PDF to render it with MuPDF WebAssembly in a dedicated worker.
            Nothing is uploaded or retained.
          </p>
          <DropZone disabled={isBusy} onFile={loadFile} />
          {isBusy && <div className="status-line spinner-line">{statusText}</div>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          <div className="feature-row" aria-label="Milestone 1 capabilities">
            <span>WASM renderer</span>
            <span>Background worker</span>
            <span>Memory-only files</span>
          </div>
        </section>
      ) : (
        <section className="document-layout">
          <aside className="sidebar">
            <div className="sidebar__section">
              <span className="section-label">Document</span>
              <h2 title={document.fileName}>{document.fileName}</h2>
              <dl className="document-facts">
                <div>
                  <dt>Pages</dt>
                  <dd>{document.pageCount}</dd>
                </div>
                <div>
                  <dt>File size</dt>
                  <dd>{formatBytes(document.fileSize)}</dd>
                </div>
                <div>
                  <dt>Media</dt>
                  <dd>
                    {numberFormatter.format(document.firstPage.mediaWidthMillimetres)} ×{" "}
                    {numberFormatter.format(document.firstPage.mediaHeightMillimetres)} mm
                  </dd>
                </div>
                <div>
                  <dt>Trim</dt>
                  <dd>
                    {numberFormatter.format(document.firstPage.trimWidthMillimetres)} ×{" "}
                    {numberFormatter.format(document.firstPage.trimHeightMillimetres)} mm
                  </dd>
                </div>
                <div>
                  <dt>Bleed</dt>
                  <dd title={document.firstPage.bleed?.declared ? "Declared PDF BleedBox" : "Calculated from MediaBox and TrimBox"}>
                    {formatBleed(document.firstPage.bleed)}
                  </dd>
                </div>
              </dl>
            </div>

            <PreflightPanel
              status={preflightStatus}
              progress={preflightProgress}
              preflight={preflight}
              error={preflightError}
              coverageStatus={coverageStatus}
              coverage={coverage}
              coverageError={coverageError}
              hiddenSeparations={hiddenSeparations}
              separationPreviewActive={separationPreviewActive}
              overprintSimulation={overprintSimulation}
              onToggleOverprint={() => setOverprintSimulation((current) => !current)}
              onToggleSeparation={toggleSeparation}
              onIsolateSeparation={isolateSeparation}
              onShowAllSeparations={showAllSeparations}
              sampleStatus={sampleStatus}
              sample={sample}
              sampleError={sampleError}
            />

            <div className="sidebar__actions">
              <button className="text-button" type="button" onClick={closeDocument}>
                Close document
              </button>
            </div>
          </aside>

          <div className="workspace">
            <div className="workspace__toolbar">
              <div className="page-controls">
                <span>Page 1 of {document.pageCount}</span>
                <div className="zoom-controls" role="group" aria-label="PDF zoom controls">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    disabled={zoom <= MIN_ZOOM}
                    onClick={() => updateZoom(zoom - ZOOM_STEP)}
                  >
                    −
                  </button>
                  <span className="zoom-level" aria-live="polite">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    disabled={zoom >= MAX_ZOOM}
                    onClick={() => updateZoom(zoom + ZOOM_STEP)}
                  >
                    +
                  </button>
                  <button
                    className="zoom-fit"
                    type="button"
                    aria-label="Zoom to fit"
                    title="Reset zoom to fit"
                    disabled={zoom === 1}
                    onClick={() => updateZoom(1)}
                  >
                    Fit
                  </button>
                  <button
                    className="rotate-left"
                    type="button"
                    aria-label="Rotate 90 degrees left"
                    title="Rotate 90° left"
                    onClick={() => rotatePage(-90)}
                  >
                    ↶
                  </button>
                  <button
                    type="button"
                    aria-label="Rotate 90 degrees right"
                    title="Rotate 90° right"
                    onClick={() => rotatePage(90)}
                  >
                    ↷
                  </button>
                </div>
              </div>
              <div className="workspace__status-group">
                {proofPreviewActive && (
                  <span className="separation-preview-badge">
                    {separationPreviewActive ? "Filtered proof" : "Overprint proof"}
                  </span>
                )}
                <span className={`render-status render-status--${status}`}>{statusText}</span>
              </div>
            </div>
            <div
              className={`canvas-viewport ${isSpacePressed && zoom > 1 ? "canvas-viewport--pan-ready" : ""} ${isPanning ? "canvas-viewport--panning" : ""}`}
              ref={canvasViewportRef}
              title={zoom > 1 ? "Hold Space and drag to move around the artwork" : undefined}
              onPointerDownCapture={startPanning}
              onPointerMove={movePanning}
              onPointerUp={stopPanning}
              onPointerCancel={stopPanning}
            >
              <div className="canvas-stage">
                {renderedPage && (
                  <div
                    className={`canvas-stack ${preflightStatus === "ready" && !proofPreviewActive ? "canvas-stack--inspectable" : ""}`}
                    onPointerDown={(event) => {
                      if (
                        preflightStatus !== "ready" ||
                        proofPreviewActive ||
                        isSpacePressed ||
                        isPanning
                      ) return
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
                      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
                      setSampleMarker({ x, y })
                      const pagePoint = mapRotatedPointToPage(x, y, rotation)
                      sampleColor(
                        renderedPage.pageIndex,
                        pagePoint.x * document.firstPage.widthPoints,
                        pagePoint.y * document.firstPage.heightPoints,
                      )
                    }}
                  >
                    <PdfCanvas {...renderedPage} />
                    <div className="interaction-layer" aria-hidden="true">
                      {sampleMarker && (
                        <span
                          className="sample-marker"
                          style={{ left: `${sampleMarker.x * 100}%`, top: `${sampleMarker.y * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
              {(status === "loading" || status === "rendering") && (
                <div className="render-loader" role="status">
                  <span className="spinner" />
                  {statusText}
                </div>
              )}
              {error && <div className="error-banner" role="alert">{error}</div>}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export default App
