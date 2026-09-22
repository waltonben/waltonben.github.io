import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DropZone } from "./components/DropZone"
import { PdfCanvas } from "./components/PdfCanvas"
import { PreflightPanel } from "./components/PreflightPanel"
import { usePdfWorker } from "./hooks/usePdfWorker"
import type { PageSize } from "./worker/messages"

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

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
  const [viewportHeight, setViewportHeight] = useState(0)
  const [sampleMarker, setSampleMarker] = useState<{ x: number; y: number } | null>(null)
  const [hiddenSeparations, setHiddenSeparations] = useState<string[]>([])
  const [overprintSimulation, setOverprintSimulation] = useState(false)
  const separationNames = useMemo(
    () => [
      ...(preflight?.processColors ?? []),
      ...(preflight?.spotColors.map((spot) => spot.name) ?? []),
    ],
    [preflight],
  )
  const separationPreviewActive = hiddenSeparations.length > 0
  const proofPreviewActive = separationPreviewActive || overprintSimulation

  useEffect(() => {
    const element = canvasViewportRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      setViewportHeight(Math.max(120, Math.floor(entry.contentRect.height)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [document])

  useEffect(() => {
    if (!document || viewportHeight === 0) return
    renderPage(
      0,
      viewportHeight,
      window.devicePixelRatio || 1,
      preflightStatus === "ready" ? hiddenSeparations : [],
      preflightStatus === "ready" && overprintSimulation,
    )
  }, [document, hiddenSeparations, overprintSimulation, preflightStatus, renderPage, viewportHeight])

  useEffect(() => {
    if (!document) return
    inspectDocument()
    setSampleMarker(null)
    setHiddenSeparations([])
    setOverprintSimulation(false)
  }, [document, inspectDocument])

  useEffect(() => {
    setSampleMarker(null)
  }, [hiddenSeparations, overprintSimulation])

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
        <a className="brand" href="/" aria-label="Pressproof home">
          <span className="brand__mark" aria-hidden="true">
            P
          </span>
          <span>
            <strong>Pressproof</strong>
            <small>Pre-press workspace</small>
          </span>
        </a>
        <div className="privacy-pill">
          <span className="privacy-pill__dot" />
          Local only · cleared on refresh
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
              <DropZone compact disabled={isBusy} onFile={loadFile} />
              <button className="text-button" type="button" onClick={closeDocument}>
                Close document
              </button>
            </div>
          </aside>

          <div className="workspace">
            <div className="workspace__toolbar">
              <span>Page 1 of {document.pageCount}</span>
              <div className="workspace__status-group">
                {proofPreviewActive && (
                  <span className="separation-preview-badge">
                    {separationPreviewActive ? "Filtered proof" : "Overprint proof"}
                  </span>
                )}
                <span className={`render-status render-status--${status}`}>{statusText}</span>
              </div>
            </div>
            <div className="canvas-viewport" ref={canvasViewportRef}>
              {renderedPage && (
                <div
                  className={`canvas-stack ${preflightStatus === "ready" && !proofPreviewActive ? "canvas-stack--inspectable" : ""}`}
                  onPointerDown={(event) => {
                    if (preflightStatus !== "ready" || proofPreviewActive) return
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
                    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
                    setSampleMarker({ x, y })
                    sampleColor(
                      renderedPage.pageIndex,
                      x * document.firstPage.widthPoints,
                      y * document.firstPage.heightPoints,
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
