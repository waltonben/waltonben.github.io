import type { ColorSample, DocumentPreflight, InkCoverageReport } from "../worker/messages"

type PreflightPanelProps = {
  status: "idle" | "running" | "ready" | "error"
  progress: { completedPages: number; totalPages: number } | null
  preflight: DocumentPreflight | null
  error: string | null
  coverageStatus: "idle" | "loading" | "ready" | "error"
  coverage: InkCoverageReport | null
  coverageError: string | null
  hiddenSeparations: string[]
  separationPreviewActive: boolean
  onToggleSeparation: (name: string) => void
  onIsolateSeparation: (name: string) => void
  onShowAllSeparations: () => void
  sampleStatus: "idle" | "loading" | "ready" | "error"
  sample: ColorSample | null
  sampleError: string | null
}

const valueFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

function processClass(name: string) {
  return `ink-swatch ink-swatch--${name.toLowerCase()}`
}

function spotSwatchStyle(previewColor?: string) {
  if (!previewColor) return undefined
  const channels = previewColor.match(/[0-9a-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16))
  const luminance = channels
    ? channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    : 0
  return { backgroundColor: previewColor, color: luminance > 155 ? "#263229" : "#fff" }
}

export function PreflightPanel({
  status,
  progress,
  preflight,
  error,
  coverageStatus,
  coverage,
  coverageError,
  hiddenSeparations,
  separationPreviewActive,
  onToggleSeparation,
  onIsolateSeparation,
  onShowAllSeparations,
  sampleStatus,
  sample,
  sampleError,
}: PreflightPanelProps) {
  if (status === "idle" || status === "running") {
    return (
      <div className="sidebar__section preflight-loading" aria-live="polite">
        <span className="section-label">Color preflight</span>
        <div className="preflight-loading__row">
          <span className="spinner" />
          <span>
            Inspecting profiles and inks
            {progress && progress.totalPages > 1
              ? ` · ${progress.completedPages}/${progress.totalPages}`
              : "…"}
          </span>
        </div>
      </div>
    )
  }

  if (status === "error" || !preflight) {
    return (
      <div className="sidebar__section">
        <span className="section-label">Color preflight</span>
        <p className="inline-error">{error ?? "Preflight results are unavailable."}</p>
      </div>
    )
  }

  const primaryIntent = preflight.outputIntents[0]
  const hiddenSeparationNames = new Set(hiddenSeparations)
  const coverageByName = new Map(coverage?.channels.map((channel) => [channel.name, channel]))
  const coverageMeta = (name: string, type: string) => {
    const channel = coverageByName.get(name)
    const value = channel ? `${valueFormatter.format(channel.coveragePercent)}%` : "—"
    return (
      <small
        className="ink-row__meta"
        title={
          channel
            ? `${valueFormatter.format(channel.solidAreaSquareMillimetres)} mm² equivalent solid area`
            : undefined
        }
      >
        <strong>{value}</strong>
        <span>{type}</span>
      </small>
    )
  }
  const profileLabel =
    primaryIntent?.profileName ??
    primaryIntent?.info ??
    primaryIntent?.outputConditionIdentifier ??
    "No document OutputIntent"

  return (
    <>
      <div className="sidebar__section">
        <div className="section-heading">
          <span className="section-label">Colour profile</span>
          <span className={`model-badge model-badge--${preflight.classification.toLowerCase()}`}>
            {preflight.classification}
          </span>
        </div>
        <strong className="profile-name">{profileLabel}</strong>
        {primaryIntent && (
          <div className="profile-meta">
            <span>{primaryIntent.profileModel}</span>
            {primaryIntent.iccVersion && <span>ICC {primaryIntent.iccVersion}</span>}
            {primaryIntent.subtype && <span>{primaryIntent.subtype}</span>}
          </div>
        )}
        {!primaryIntent && preflight.embeddedObjectProfiles.length > 0 && (
          <p className="object-profile-note">
            Object profile{preflight.embeddedObjectProfiles.length > 1 ? "s" : ""}: {" "}
            {preflight.embeddedObjectProfiles.join(", ")}
          </p>
        )}
        {preflight.pdfStandard && (
          <div className="pdf-standard-badge">Declared {preflight.pdfStandard}</div>
        )}
        {preflight.colorSpaces.length > 0 && (
          <details className="profile-more-info">
            <summary>More info</summary>
            <div className="color-space-list" aria-label="Observed colour spaces">
              {preflight.colorSpaces.map((colorSpace) => (
                <span
                  className="color-space-pill"
                  key={`${colorSpace.name}-${colorSpace.type}-${colorSpace.components}`}
                  title={`${colorSpace.occurrences} interpreted drawing operations`}
                >
                  {colorSpace.name}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="sidebar__section">
        <div className="section-heading">
          <span className="section-label">Separations</span>
          <span className="coverage-heading">
            {coverageStatus === "loading" ? "Calculating…" : "Coverage"}
          </span>
        </div>
        <div className="separation-toolbar">
          <span>
            {separationPreviewActive
              ? `${hiddenSeparations.length} hidden`
              : "All inks visible"}
          </span>
          <button
            type="button"
            disabled={!separationPreviewActive}
            onClick={onShowAllSeparations}
          >
            Show all
          </button>
        </div>
        <div className="ink-list">
          {preflight.processColors.map((name) => {
            const isVisible = !hiddenSeparationNames.has(name)
            return (
              <div className={`ink-row ${isVisible ? "" : "ink-row--hidden"}`} key={name}>
                <button
                  className={processClass(name)}
                  type="button"
                  aria-label={`${isVisible ? "Hide" : "Show"} ${name} separation`}
                  aria-pressed={isVisible}
                  onClick={() => onToggleSeparation(name)}
                />
                <span>{name}</span>
                <button
                  className="ink-row__solo"
                  type="button"
                  aria-label={`Isolate ${name} separation`}
                  onClick={() => onIsolateSeparation(name)}
                >
                  Solo
                </button>
                {coverageMeta(name, "Process")}
              </div>
            )
          })}
          {preflight.spotColors.map((spot) => {
            const isVisible = !hiddenSeparationNames.has(spot.name)
            return (
              <div
                className={`ink-row ${isVisible ? "" : "ink-row--hidden"}`}
                key={spot.name}
              >
                <button
                  className="ink-swatch ink-swatch--spot"
                  style={spot.role === "ink" ? spotSwatchStyle(spot.previewColor) : undefined}
                  type="button"
                  aria-label={`${isVisible ? "Hide" : "Show"} ${spot.name} separation`}
                  aria-pressed={isVisible}
                  onClick={() => onToggleSeparation(spot.name)}
                >
                  {spot.role === "ink" && spot.previewColor
                    ? ""
                    : spot.name.slice(0, 1).toUpperCase()}
                </button>
                <span title={spot.alternateSpace ? `Alternate: ${spot.alternateSpace}` : undefined}>
                  {spot.name}
                </span>
                <button
                  className="ink-row__solo"
                  type="button"
                  aria-label={`Isolate ${spot.name} separation`}
                  onClick={() => onIsolateSeparation(spot.name)}
                >
                  Solo
                </button>
                {coverageMeta(
                  spot.name,
                  spot.status === "used" ? spot.role : "Declared",
                )}
              </div>
            )
          })}
        </div>
        {coverageStatus === "ready" && coverage && (
          <p className="coverage-note">
            Page {coverage.pageIndex + 1} mean tint at {coverage.dpi} dpi. Hover a value for
            equivalent solid area.
          </p>
        )}
        {coverageStatus === "error" && coverageError && (
          <p className="inline-error coverage-error">{coverageError}</p>
        )}
        {separationPreviewActive && (
          <p className="separation-preview-note">
            Filtered plate preview. Production overprint simulation is the next stage.
          </p>
        )}
      </div>

      <div className="sidebar__section">
        <span className="section-label">Pixel breakdown</span>
        {separationPreviewActive ? (
          <p className="helper-copy">Show all inks to sample the composite artwork.</p>
        ) : sampleStatus === "idle" ? (
          <p className="helper-copy">Click the artwork to inspect its rendered channel values.</p>
        ) : null}
        {!separationPreviewActive && sampleStatus === "loading" && (
          <div className="sample-loading">
            <span className="spinner" /> Calculating channels…
          </div>
        )}
        {!separationPreviewActive && sampleStatus === "error" && (
          <p className="inline-error">{sampleError}</p>
        )}
        {!separationPreviewActive && sample && sampleStatus !== "loading" && (
          <div className="sample-result">
            <div className="sample-coordinates">
              X {valueFormatter.format(sample.xMillimetres)} mm · Y{" "}
              {valueFormatter.format(sample.yMillimetres)} mm
            </div>
            <div className={`channel-grid channel-grid--${sample.model.toLowerCase()}`}>
              {sample.channels.map((channel) => (
                <div key={channel.name}>
                  <span>{channel.name}</span>
                  <strong>
                    {valueFormatter.format(channel.value)}
                    {channel.unit === "%" ? "%" : ""}
                  </strong>
                </div>
              ))}
            </div>
            {sample.note && <p className="sample-note">{sample.note}</p>}
          </div>
        )}
      </div>

      {preflight.warnings.length > 0 && (
        <div className="sidebar__section warnings-panel">
          <span className="section-label">Warnings</span>
          <ul>
            {preflight.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
