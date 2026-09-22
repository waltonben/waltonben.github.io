import * as mupdf from "mupdf"
import type {
  DocumentPreflight,
  InkCoverageChannel,
  InkCoverageReport,
} from "./messages"
import { parseSeparationName } from "./preflight"

const COVERAGE_DPI = 72
const POINTS_PER_INCH = 72
const SQUARE_MILLIMETRES_PER_SQUARE_INCH = 25.4 * 25.4

function rasterBounds(page: mupdf.Page, matrix: mupdf.Matrix): mupdf.Rect {
  const [x0, y0, x1, y1] = mupdf.Rect.transform(page.getBounds("CropBox"), matrix)
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)]
}

function isNamedSeparation(colorSpace: mupdf.ColorSpace | null) {
  return Boolean(colorSpace && (colorSpace.getType() === "Separation" || colorSpace.isDeviceN()))
}

type Disposable = { destroy(): void }

type BorrowedShade = mupdf.Shade & {
  constructor: {
    _finalizer?: FinalizationRegistry<number>
  }
  pointer: mupdf.Shade["pointer"]
}

function releaseAfter<T>(objects: Disposable[], work: () => T): T {
  try {
    return work()
  } finally {
    for (const object of objects) object.destroy()
  }
}

function releaseBorrowedShade(shade: mupdf.Shade) {
  // mupdf.js wraps fillShade's borrowed pointer without retaining it. Calling
  // destroy() (or allowing its FinalizationRegistry to run) frees page-owned
  // memory and crashes the worker on the next separation render.
  const borrowed = shade as BorrowedShade
  borrowed.constructor._finalizer?.unregister(borrowed)
  borrowed.pointer = 0 as mupdf.Shade["pointer"]
}

export function renderProcessPlates(
  page: mupdf.Page,
  matrix: mupdf.Matrix,
  withAlpha = false,
) {
  const pixmap = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceCMYK,
    rasterBounds(page, matrix),
    withAlpha,
  )
  // MuPDF's CMYK clear value is paper luminance, not raw channel bytes:
  // 255 produces 0/0/0/0 (white paper), while 0 produces a 100% Black backdrop.
  pixmap.clear(255)
  const draw = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)

  const paint = (
    method: "fillPath" | "strokePath" | "fillText" | "strokeText" | "fillImageMask",
    args: unknown[],
    colorSpace: mupdf.ColorSpace,
    color: number[],
    alpha: number,
  ) => {
    if (isNamedSeparation(colorSpace)) return
    const call = draw[method] as (...parameters: unknown[]) => void
    call.call(draw, ...args, colorSpace, color, alpha)
  }

  const device = new mupdf.Device({
    fillPath: (path, evenOdd, ctm, colorSpace, color, alpha) =>
      releaseAfter([path, colorSpace], () =>
        paint("fillPath", [path, evenOdd, ctm], colorSpace, color, alpha),
      ),
    strokePath: (path, stroke, ctm, colorSpace, color, alpha) =>
      releaseAfter([path, stroke, colorSpace], () =>
        paint("strokePath", [path, stroke, ctm], colorSpace, color, alpha),
      ),
    clipPath: (path, evenOdd, ctm) =>
      releaseAfter([path], () => draw.clipPath(path, evenOdd, ctm)),
    clipStrokePath: (path, stroke, ctm) =>
      releaseAfter([path, stroke], () => draw.clipStrokePath(path, stroke, ctm)),
    fillText: (text, ctm, colorSpace, color, alpha) =>
      releaseAfter([text, colorSpace], () =>
        paint("fillText", [text, ctm], colorSpace, color, alpha),
      ),
    strokeText: (text, stroke, ctm, colorSpace, color, alpha) =>
      releaseAfter([text, stroke, colorSpace], () =>
        paint("strokeText", [text, stroke, ctm], colorSpace, color, alpha),
      ),
    clipText: (text, ctm) => releaseAfter([text], () => draw.clipText(text, ctm)),
    clipStrokeText: (text, stroke, ctm) =>
      releaseAfter([text, stroke], () => draw.clipStrokeText(text, stroke, ctm)),
    ignoreText: (text, ctm) => releaseAfter([text], () => draw.ignoreText(text, ctm)),
    fillShade: (shade, ctm, alpha) => {
      try {
        draw.fillShade(shade, ctm, alpha)
      } finally {
        releaseBorrowedShade(shade)
      }
    },
    fillImage: (image, ctm, alpha) =>
      releaseAfter([image], () => {
        const colorSpace = image.getColorSpace()
        try {
          if (!isNamedSeparation(colorSpace)) draw.fillImage(image, ctm, alpha)
        } finally {
          colorSpace?.destroy()
        }
      }),
    fillImageMask: (image, ctm, colorSpace, color, alpha) =>
      releaseAfter([image, colorSpace], () =>
        paint("fillImageMask", [image, ctm], colorSpace, color, alpha),
      ),
    clipImageMask: (image, ctm) =>
      releaseAfter([image], () => draw.clipImageMask(image, ctm)),
    popClip: () => draw.popClip(),
    beginMask: (bounds, luminosity, colorSpace, color) =>
      releaseAfter([colorSpace], () =>
        draw.beginMask(bounds, luminosity, colorSpace, color as mupdf.Color),
      ),
    endMask: () => draw.endMask(),
    beginGroup: (bounds, colorSpace, isolated, knockout, blendMode, alpha) =>
      releaseAfter([colorSpace], () =>
        draw.beginGroup(
          bounds,
          mupdf.ColorSpace.DeviceCMYK,
          isolated,
          knockout,
          blendMode,
          alpha,
        ),
      ),
    endGroup: () => draw.endGroup(),
    beginTile: (area, view, xstep, ystep, ctm, id, documentId) =>
      draw.beginTile(area, view, xstep, ystep, ctm, id, documentId),
    endTile: () => draw.endTile(),
    beginLayer: (name) => draw.beginLayer(name),
    endLayer: () => draw.endLayer(),
  })

  try {
    page.run(device, matrix)
    device.close()
    draw.close()
    return pixmap
  } catch (error) {
    pixmap.destroy()
    throw error
  } finally {
    device.destroy()
    draw.destroy()
  }
}

export function renderSpotPlate(page: mupdf.Page, matrix: mupdf.Matrix, targetName: string) {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, rasterBounds(page, matrix), false)
  pixmap.clear(255)
  const draw = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)

  const paint = (
    method: "fillPath" | "strokePath" | "fillText" | "strokeText" | "fillImageMask",
    args: unknown[],
    colorSpace: mupdf.ColorSpace,
    color: number[],
    alpha: number,
  ) => {
    const componentIndex = parseSeparationName(colorSpace.getName()).names.indexOf(targetName)
    if (componentIndex < 0) return
    const tint = Math.min(1, Math.max(0, color[componentIndex] ?? 0))
    const call = draw[method] as (...parameters: unknown[]) => void
    call.call(draw, ...args, mupdf.ColorSpace.DeviceGray, [1 - tint], alpha)
  }

  const device = new mupdf.Device({
    fillPath: (path, evenOdd, ctm, colorSpace, color, alpha) =>
      releaseAfter([path, colorSpace], () =>
        paint("fillPath", [path, evenOdd, ctm], colorSpace, color, alpha),
      ),
    strokePath: (path, stroke, ctm, colorSpace, color, alpha) =>
      releaseAfter([path, stroke, colorSpace], () =>
        paint("strokePath", [path, stroke, ctm], colorSpace, color, alpha),
      ),
    clipPath: (path, evenOdd, ctm) =>
      releaseAfter([path], () => draw.clipPath(path, evenOdd, ctm)),
    clipStrokePath: (path, stroke, ctm) =>
      releaseAfter([path, stroke], () => draw.clipStrokePath(path, stroke, ctm)),
    fillText: (text, ctm, colorSpace, color, alpha) =>
      releaseAfter([text, colorSpace], () =>
        paint("fillText", [text, ctm], colorSpace, color, alpha),
      ),
    strokeText: (text, stroke, ctm, colorSpace, color, alpha) =>
      releaseAfter([text, stroke, colorSpace], () =>
        paint("strokeText", [text, stroke, ctm], colorSpace, color, alpha),
      ),
    clipText: (text, ctm) => releaseAfter([text], () => draw.clipText(text, ctm)),
    clipStrokeText: (text, stroke, ctm) =>
      releaseAfter([text, stroke], () => draw.clipStrokeText(text, stroke, ctm)),
    ignoreText: (text, ctm) => releaseAfter([text], () => draw.ignoreText(text, ctm)),
    fillImageMask: (image, ctm, colorSpace, color, alpha) =>
      releaseAfter([image, colorSpace], () =>
        paint("fillImageMask", [image, ctm], colorSpace, color, alpha),
      ),
    clipImageMask: (image, ctm) =>
      releaseAfter([image], () => draw.clipImageMask(image, ctm)),
    popClip: () => draw.popClip(),
    beginMask: (bounds, luminosity, colorSpace, color) =>
      releaseAfter([colorSpace], () =>
        draw.beginMask(bounds, luminosity, mupdf.ColorSpace.DeviceGray, color as mupdf.Color),
      ),
    endMask: () => draw.endMask(),
    beginGroup: (bounds, colorSpace, isolated, knockout, blendMode, alpha) =>
      releaseAfter([colorSpace], () =>
        draw.beginGroup(
          bounds,
          mupdf.ColorSpace.DeviceGray,
          isolated,
          knockout,
          blendMode,
          alpha,
        ),
      ),
    endGroup: () => draw.endGroup(),
    beginTile: (area, view, xstep, ystep, ctm, id, documentId) =>
      draw.beginTile(area, view, xstep, ystep, ctm, id, documentId),
    endTile: () => draw.endTile(),
    beginLayer: (name) => draw.beginLayer(name),
    endLayer: () => draw.endLayer(),
  })

  try {
    page.run(device, matrix)
    device.close()
    draw.close()
    return pixmap
  } catch (error) {
    pixmap.destroy()
    throw error
  } finally {
    device.destroy()
    draw.destroy()
  }
}

function roundedPercent(value: number) {
  return Math.round(value * 100) / 100
}

function channelCoverage(
  name: string,
  kind: InkCoverageChannel["kind"],
  sum: number,
  denominator: number,
  pageAreaSquareMillimetres: number,
): InkCoverageChannel {
  const coveragePercent = roundedPercent((sum / denominator) * 100)
  return {
    name,
    kind,
    coveragePercent,
    solidAreaSquareMillimetres:
      Math.round(pageAreaSquareMillimetres * (coveragePercent / 100) * 10) / 10,
  }
}

export function calculateInkCoverage(
  documentId: string,
  document: mupdf.Document,
  preflight: DocumentPreflight,
  pageIndex = 0,
): InkCoverageReport {
  const page = document.loadPage(pageIndex)
  const matrix = mupdf.Matrix.scale(COVERAGE_DPI / POINTS_PER_INCH, COVERAGE_DPI / POINTS_PER_INCH)
  const [x0, y0, x1, y1] = page.getBounds("CropBox")
  const pageAreaSquareMillimetres =
    ((Math.abs(x1 - x0) * Math.abs(y1 - y0)) / (POINTS_PER_INCH * POINTS_PER_INCH)) *
    SQUARE_MILLIMETRES_PER_SQUARE_INCH
  const channels: InkCoverageChannel[] = []

  try {
    if (preflight.processColors.length > 0) {
      const process = renderProcessPlates(page, matrix)
      try {
        const pixels = process.getPixels()
        const components = process.getNumberOfComponents()
        const sums = [0, 0, 0, 0]
        for (let y = 0; y < process.getHeight(); y += 1) {
          let offset = y * process.getStride()
          for (let x = 0; x < process.getWidth(); x += 1) {
            for (let channel = 0; channel < 4; channel += 1) {
              sums[channel] += pixels[offset + channel]
            }
            offset += components
          }
        }
        const denominator = 255 * process.getWidth() * process.getHeight()
        preflight.processColors.forEach((name, index) => {
          channels.push(
            channelCoverage(name, "process", sums[index], denominator, pageAreaSquareMillimetres),
          )
        })
      } finally {
        process.destroy()
      }
    }

    for (const spot of preflight.spotColors) {
      const kind: InkCoverageChannel["kind"] = spot.role === "technical" ? "technical" : "spot"
      if (spot.status !== "used") {
        channels.push(channelCoverage(spot.name, kind, 0, 1, pageAreaSquareMillimetres))
        continue
      }
      const plate = renderSpotPlate(page, matrix, spot.name)
      try {
        const pixels = plate.getPixels()
        let sum = 0
        for (let y = 0; y < plate.getHeight(); y += 1) {
          let offset = y * plate.getStride()
          for (let x = 0; x < plate.getWidth(); x += 1) {
            sum += 255 - pixels[offset]
            offset += plate.getNumberOfComponents()
          }
        }
        channels.push(
          channelCoverage(
            spot.name,
            kind,
            sum,
            255 * plate.getWidth() * plate.getHeight(),
            pageAreaSquareMillimetres,
          ),
        )
      } finally {
        plate.destroy()
      }
    }
  } finally {
    page.destroy()
  }

  return {
    documentId,
    pageIndex,
    dpi: COVERAGE_DPI,
    channels,
    notes: [
      "Coverage is the mean tint across the CropBox; solid-area values are equivalent 100% ink area.",
      "Gradient/shading spot plates and multichannel spot images require a future lower-level MuPDF separation API.",
    ],
  }
}
