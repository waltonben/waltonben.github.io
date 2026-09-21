import type { ColorSample, DocumentPreflight } from "../worker/messages"

type PreflightPanelProps = {
  status: "idle" | "running" | "ready" | "error"
  progress: { completedPages: number; totalPages: number } | null
  preflight: DocumentPreflight | null
  error: string | null
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
  const profileLabel =
    primaryIntent?.profileName ??
    primaryIntent?.info ??
    primaryIntent?.outputConditionIdentifier ??
    "No document OutputIntent"

  return (
    <>
      <div className="sidebar__section">
        <div className="section-heading">
          <span className="section-label">Color profile</span>
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
        <div className="color-space-list" aria-label="Observed color spaces">
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
      </div>

      <div className="sidebar__section">
        <span className="section-label">Separations</span>
        <div className="ink-list">
          {preflight.processColors.map((name) => (
            <div className="ink-row" key={name}>
              <span className={processClass(name)} aria-hidden="true" />
              <span>{name}</span>
              <small>Process</small>
            </div>
          ))}
          {preflight.spotColors.map((spot) => (
            <div className="ink-row" key={spot.name}>
              <span
                className="ink-swatch ink-swatch--spot"
                style={spot.role === "ink" ? spotSwatchStyle(spot.previewColor) : undefined}
                aria-hidden="true"
              >
                {spot.role === "ink" && spot.previewColor
                  ? ""
                  : spot.name.slice(0, 1).toUpperCase()}
              </span>
              <span title={spot.alternateSpace ? `Alternate: ${spot.alternateSpace}` : undefined}>
                {spot.name}
              </span>
              <small>{spot.status === "used" ? spot.role : "Declared"}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar__section">
        <span className="section-label">Pixel breakdown</span>
        {sampleStatus === "idle" && (
          <p className="helper-copy">Click the artwork to inspect its rendered channel values.</p>
        )}
        {sampleStatus === "loading" && (
          <div className="sample-loading">
            <span className="spinner" /> Calculating channels…
          </div>
        )}
        {sampleStatus === "error" && <p className="inline-error">{sampleError}</p>}
        {sample && sampleStatus !== "loading" && (
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
