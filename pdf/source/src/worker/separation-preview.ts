import * as mupdf from "mupdf"
import type { DocumentPreflight } from "./messages"
import { renderProcessPlates, renderSpotPlate } from "./coverage"

type SpotPlate = {
  mask: mupdf.Pixmap
  previewRgb: [number, number, number]
}

export type SeparationPreviewCache = {
  documentId: string
  pageIndex: number
  renderScale: number
  process: mupdf.Pixmap
  spots: Map<string, SpotPlate>
}

const PROCESS_CHANNELS = new Map([
  ["cyan", 0],
  ["magenta", 1],
  ["yellow", 2],
  ["black", 3],
])

function parsePreviewColor(value?: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value ?? "")
  if (!match) return [107, 82, 163]
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ]
}

function flattenOnWhite(transparentRgb: mupdf.Pixmap) {
  const rgb = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    transparentRgb.getBounds() as mupdf.Rect,
    false,
  )
  rgb.clear(255)

  try {
    const transparentPixels = transparentRgb.getPixels()
    const transparentComponents = transparentRgb.getNumberOfComponents()
    const transparentStride = transparentRgb.getStride()
    const alphaIndex = transparentComponents - 1
    const rgbPixels = rgb.getPixels()
    const rgbComponents = rgb.getNumberOfComponents()
    const rgbStride = rgb.getStride()

    for (let y = 0; y < rgb.getHeight(); y += 1) {
      let transparentOffset = y * transparentStride
      let rgbOffset = y * rgbStride
      for (let x = 0; x < rgb.getWidth(); x += 1) {
        const alpha = transparentPixels[transparentOffset + alphaIndex] / 255
        for (let channel = 0; channel < 3; channel += 1) {
          rgbPixels[rgbOffset + channel] = Math.round(
            transparentPixels[transparentOffset + channel] * alpha + 255 * (1 - alpha),
          )
        }
        transparentOffset += transparentComponents
        rgbOffset += rgbComponents
      }
    }
    return rgb
  } catch (error) {
    rgb.destroy()
    throw error
  }
}

export function destroySeparationPreviewCache(cache: SeparationPreviewCache | null) {
  if (!cache) return
  cache.process.destroy()
  for (const spot of cache.spots.values()) spot.mask.destroy()
}

export function createSeparationPreviewCache(
  documentId: string,
  page: mupdf.Page,
  pageIndex: number,
  renderScale: number,
  preflight: DocumentPreflight,
): SeparationPreviewCache {
  const matrix = mupdf.Matrix.scale(renderScale, renderScale)
  const process = renderProcessPlates(page, matrix, true)
  const spots = new Map<string, SpotPlate>()

  try {
    for (const spot of preflight.spotColors) {
      if (spot.status !== "used") continue
      spots.set(spot.name, {
        mask: renderSpotPlate(page, matrix, spot.name),
        previewRgb: parsePreviewColor(spot.previewColor),
      })
    }
  } catch (error) {
    process.destroy()
    for (const spot of spots.values()) spot.mask.destroy()
    throw error
  }

  return { documentId, pageIndex, renderScale, process, spots }
}

export function composeSeparationPreview(
  cache: SeparationPreviewCache,
  preflight: DocumentPreflight,
  hiddenSeparations: string[],
) {
  const hidden = new Set(hiddenSeparations)
  const filteredProcess = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceCMYK,
    cache.process.getBounds() as mupdf.Rect,
    true,
  )

  try {
    const source = cache.process.getPixels()
    const target = filteredProcess.getPixels()
    target.set(source)

    const hiddenProcessChannels = preflight.processColors
      .filter((name) => hidden.has(name))
      .map((name) => PROCESS_CHANNELS.get(name.toLowerCase()))
      .filter((index): index is number => index !== undefined)

    if (hiddenProcessChannels.length > 0) {
      const components = filteredProcess.getNumberOfComponents()
      const stride = filteredProcess.getStride()
      for (let y = 0; y < filteredProcess.getHeight(); y += 1) {
        let offset = y * stride
        for (let x = 0; x < filteredProcess.getWidth(); x += 1) {
          for (const channel of hiddenProcessChannels) target[offset + channel] = 0
          offset += components
        }
      }
    }

    const transparentRgb = filteredProcess.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true)
    let rgb: mupdf.Pixmap
    try {
      rgb = flattenOnWhite(transparentRgb)
    } finally {
      transparentRgb.destroy()
    }

    const rgbPixels = rgb.getPixels()
    const rgbComponents = rgb.getNumberOfComponents()
    const rgbStride = rgb.getStride()

    try {
      for (const [name, spot] of cache.spots) {
        if (hidden.has(name)) continue
        const maskPixels = spot.mask.getPixels()
        const maskComponents = spot.mask.getNumberOfComponents()
        const maskStride = spot.mask.getStride()

        for (let y = 0; y < rgb.getHeight(); y += 1) {
          let rgbOffset = y * rgbStride
          let maskOffset = y * maskStride
          for (let x = 0; x < rgb.getWidth(); x += 1) {
            const tint = (255 - maskPixels[maskOffset]) / 255
            if (tint > 0) {
              for (let channel = 0; channel < 3; channel += 1) {
                const ink = spot.previewRgb[channel] / 255
                rgbPixels[rgbOffset + channel] = Math.round(
                  rgbPixels[rgbOffset + channel] * (1 - tint * (1 - ink)),
                )
              }
            }
            rgbOffset += rgbComponents
            maskOffset += maskComponents
          }
        }
      }
      return rgb
    } catch (error) {
      rgb.destroy()
      throw error
    }
  } finally {
    filteredProcess.destroy()
  }
}
