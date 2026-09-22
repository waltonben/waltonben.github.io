import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react"

type DropZoneProps = {
  disabled?: boolean
  compact?: boolean
  onFile: (file: File) => void
}

export function DropZone({ disabled = false, compact = false, onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const chooseFile = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    if (file) onFile(file)
    event.target.value = ""
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const [file] = Array.from(event.dataTransfer.files)
    if (file) onFile(file)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      chooseFile()
    }
  }

  return (
    <div
      className={`drop-zone ${compact ? "drop-zone--compact" : ""} ${isDragging ? "drop-zone--active" : ""}`}
      onClick={chooseFile}
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false)
      }}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={compact ? "Open another PDF" : undefined}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        onChange={handleChange}
      />
      <span className="drop-zone__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
        </svg>
      </span>
      <span className="drop-zone__copy">
        <strong>{compact ? "Open another PDF" : "Drop production artwork here"}</strong>
        {!compact && <small>or click to choose a local PDF · up to 250 MB</small>}
      </span>
    </div>
  )
}
