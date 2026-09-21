import { useEffect, useRef } from "react"

type PdfCanvasProps = {
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  pixels: Uint8ClampedArray<ArrayBuffer>
}

export function PdfCanvas({ width, height, cssWidth, cssHeight, pixels }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) return

    context.putImageData(new ImageData(pixels, width, height), 0, 0)
  }, [height, pixels, width])

  return (
    <canvas
      ref={canvasRef}
      className="pdf-canvas"
      style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
      aria-label="Rendered PDF page"
    />
  )
}
