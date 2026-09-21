import { useEffect, useRef, useState } from "react"
import { DropZone } from "./components/DropZone"
import { PdfCanvas } from "./components/PdfCanvas"
import { PreflightPanel } from "./components/PreflightPanel"
import { usePdfWorker } from "./hooks/usePdfWorker"

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${numberFormatter.format(bytes / 1024)} KB`
  return `${numberFormatter.format(bytes / (1024 * 1024))} MB`
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
    sampleStatus,
    sample,
    sampleError,
    loadFile,
    renderPage,
    inspectDocument,
    sampleColor,
    closeDocument,
  } = usePdfWorker()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [sampleMarker, setSampleMarker] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      setViewportWidth(Math.max(320, entry.contentRect.width - 72))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [document])

  useEffect(() => {
    if (!document || viewportWidth === 0) return
    renderPage(0, Math.min(1_400, viewportWidth), window.devicePixelRatio || 1)
  }, [document, renderPage, viewportWidth])

  useEffect(() => {
    if (!document) return
    inspectDocument()
    setSampleMarker(null)
  }, [document, inspectDocument])

  const isBusy = status === "starting" || status === "loading"
  const statusText =
    status === "starting"
      ? "Starting local rendering engine…"
      : status === "loading"
        ? "Opening PDF in the local worker…"
        : status === "rendering"
          ? "Rendering page locally…"
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
                  <dt>Page 1</dt>
                  <dd>
                    {numberFormatter.format(document.firstPage.widthMillimetres)} ×{" "}
                    {numberFormatter.format(document.firstPage.heightMillimetres)} mm
                  </dd>
                </div>
              </dl>
            </div>

            <PreflightPanel
              status={preflightStatus}
              progress={preflightProgress}
              preflight={preflight}
              error={preflightError}
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

          <div className="workspace" ref={workspaceRef}>
            <div className="workspace__toolbar">
              <span>Page 1 of {document.pageCount}</span>
              <span className={`render-status render-status--${status}`}>{statusText}</span>
            </div>
            <div className="canvas-viewport">
              {renderedPage && (
                <div
                  className={`canvas-stack ${preflightStatus === "ready" ? "canvas-stack--inspectable" : ""}`}
                  onPointerDown={(event) => {
                    if (preflightStatus !== "ready") return
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
