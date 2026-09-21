import * as mupdf from "mupdf"
import type {
  ColorModel,
  ColorSpaceInfo,
  DocumentPreflight,
  OutputIntentInfo,
  SpotColorInfo,
} from "./messages"

const MAX_PREFLIGHT_PAGES = 250
const PROCESS_COLOR_NAMES = new Set(["cyan", "magenta", "yellow", "black", "all", "none"])
const TECHNICAL_INK_PATTERN = /(?:cut|crease|dieline|die[ -]?line|knife|uv|varnish|white|emboss|construct|guide)/i

type MutableColorSpace = Omit<ColorSpaceInfo, "pages" | "usages"> & {
  pages: Set<number>
  usages: Set<string>
}

type MutableSpot = Omit<SpotColorInfo, "pages" | "usages"> & {
  pages: Set<number>
  usages: Set<string>
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) return ""
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function uint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.length) return 0
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  )
}

function decodeUtf16Be(bytes: Uint8Array) {
  let value = ""
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    value += String.fromCharCode((bytes[index] << 8) | bytes[index + 1])
  }
  return value.replace(/\0+$/g, "").trim()
}

function readIccDescription(bytes: Uint8Array) {
  if (bytes.length < 132 || ascii(bytes, 36, 4) !== "acsp") return undefined
  const tagCount = Math.min(uint32(bytes, 128), 1_024)

  for (let index = 0; index < tagCount; index += 1) {
    const entryOffset = 132 + index * 12
    if (entryOffset + 12 > bytes.length) break
    const signature = ascii(bytes, entryOffset, 4)
    if (signature !== "desc" && signature !== "mluc") continue

    const tagOffset = uint32(bytes, entryOffset + 4)
    const tagSize = uint32(bytes, entryOffset + 8)
    if (tagOffset + tagSize > bytes.length || tagSize < 12) continue
    const tagType = ascii(bytes, tagOffset, 4)

    if (tagType === "desc") {
      const length = Math.min(uint32(bytes, tagOffset + 8), tagSize - 12)
      return ascii(bytes, tagOffset + 12, Math.max(0, length - 1)).replace(/\0+$/g, "").trim()
    }

    if (tagType === "mluc" && tagSize >= 28) {
      const recordCount = Math.min(uint32(bytes, tagOffset + 8), 256)
      const recordSize = uint32(bytes, tagOffset + 12)
      for (let record = 0; record < recordCount; record += 1) {
        const recordOffset = tagOffset + 16 + record * recordSize
        if (recordSize < 12 || recordOffset + 12 > tagOffset + tagSize) break
        const length = uint32(bytes, recordOffset + 4)
        const textOffset = tagOffset + uint32(bytes, recordOffset + 8)
        if (textOffset + length <= tagOffset + tagSize) {
          const value = decodeUtf16Be(bytes.subarray(textOffset, textOffset + length))
          if (value) return value
        }
      }
    }
  }

  return undefined
}

function colorModelFromSignature(signature: string): Exclude<ColorModel, "Mixed"> {
  const normalized = signature.trim().toUpperCase()
  if (normalized === "CMYK") return "CMYK"
  if (normalized === "RGB") return "RGB"
  if (normalized === "GRAY") return "Gray"
  if (normalized === "LAB") return "NChannel"
  return "Unknown"
}

function getOptionalString(object: mupdf.PDFObject, key: string) {
  const value = object.get(key)
  if (value.isString()) return value.asString()
  if (value.isName()) return value.asName()
  return undefined
}

function inspectOutputIntent(intent: mupdf.PDFObject): OutputIntentInfo {
  const profile = intent.get("DestOutputProfile")
  const componentsObject = profile.get("N")
  const components = componentsObject.isNumber() ? componentsObject.asNumber() : undefined
  let profileModel: Exclude<ColorModel, "Mixed"> =
    components === 4 ? "CMYK" : components === 3 ? "RGB" : components === 1 ? "Gray" : "Unknown"
  let profileName: string | undefined
  let iccVersion: string | undefined
  let profileClass: string | undefined

  if (profile.isStream()) {
    const buffer = profile.readStream()
    try {
      const bytes = buffer.asUint8Array()
      if (bytes.length >= 40 && ascii(bytes, 36, 4) === "acsp") {
        profileModel = colorModelFromSignature(ascii(bytes, 16, 4))
        profileClass = ascii(bytes, 12, 4).trim() || undefined
        const major = bytes[8]
        const minor = bytes[9] >> 4
        const patch = bytes[9] & 0x0f
        iccVersion = `${major}.${minor}.${patch}`
        profileName = readIccDescription(bytes)
      }
    } finally {
      buffer.destroy()
    }
  }

  return {
    subtype: getOptionalString(intent, "S"),
    outputCondition: getOptionalString(intent, "OutputCondition"),
    outputConditionIdentifier: getOptionalString(intent, "OutputConditionIdentifier"),
    registryName: getOptionalString(intent, "RegistryName"),
    info: getOptionalString(intent, "Info"),
    profileName,
    profileModel,
    components,
    iccVersion,
    profileClass,
  }
}

export function parseSeparationName(colorSpaceName: string) {
  const opening = colorSpaceName.indexOf("(")
  if (opening < 0 || !colorSpaceName.endsWith(")")) return { names: [] as string[] }
  const kind = colorSpaceName.slice(0, opening)
  if (kind !== "Separation" && kind !== "DeviceN" && kind !== "NChannel") {
    return { names: [] as string[] }
  }

  const body = colorSpaceName.slice(opening + 1, -1)
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    else if (character === "," && depth === 0) {
      parts.push(body.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(body.slice(start).trim())
  if (parts.length < 2) return { names: [] as string[] }

  if (kind === "Separation") {
    return { alternateSpace: parts[0], names: [parts.slice(1).join(",")] }
  }

  if (kind === "DeviceN" || kind === "NChannel") {
    return {
      alternateSpace: parts[0],
      names: parts.slice(1).filter(Boolean),
    }
  }

  return { names: [] as string[] }
}

function separationPreviewColor(colorSpace: mupdf.ColorSpace, componentIndex: number) {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1, 1], false)
  const path = new mupdf.Path()
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)

  try {
    pixmap.clear(255)
    path.rect(0, 0, 1, 1)
    const color = Array.from({ length: colorSpace.getNumberOfComponents() }, () => 0)
    color[componentIndex] = 1
    device.fillPath(path, false, mupdf.Matrix.identity, colorSpace, color as mupdf.Color, 1)
    device.close()

    const [red, green, blue] = pixmap.getPixels()
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`
  } catch {
    return undefined
  } finally {
    device.destroy()
    path.destroy()
    pixmap.destroy()
  }
}

function classifyDocument(
  colorSpaces: Iterable<MutableColorSpace>,
  outputIntents: OutputIntentInfo[],
): ColorModel {
  let hasCmyk = false
  let hasRgb = false
  let hasGray = false

  for (const colorSpace of colorSpaces) {
    hasCmyk ||= colorSpace.type === "CMYK"
    hasRgb ||= colorSpace.type === "RGB" || colorSpace.type === "BGR"
    hasGray ||= colorSpace.type === "Gray"
  }

  if (hasCmyk && hasRgb) return "Mixed"
  if (hasCmyk) return "CMYK"
  if (hasRgb) return "RGB"

  const intentModels = new Set(outputIntents.map((intent) => intent.profileModel))
  if (intentModels.has("CMYK") && intentModels.has("RGB")) return "Mixed"
  if (intentModels.has("CMYK")) return "CMYK"
  if (intentModels.has("RGB")) return "RGB"
  if (hasGray || intentModels.has("Gray")) return "Gray"
  return "Unknown"
}

function readDeclaredInks(
  intent: mupdf.PDFObject,
  spots: Map<string, MutableSpot>,
  declaredOrder: string[],
) {
  const printingOrder = intent.get("MixingHints", "PrintingOrder")
  if (printingOrder.isArray()) {
    for (let index = 0; index < printingOrder.length; index += 1) {
      const ink = printingOrder.get(index)
      if (ink.isName()) declaredOrder.push(ink.asName())
    }
  }

  const solidities = intent.get("MixingHints", "Solidities")
  if (!solidities.isDictionary()) return

  solidities.forEach((_value, key) => {
    const name = String(key)
    if (PROCESS_COLOR_NAMES.has(name.toLowerCase())) return
    if (!spots.has(name)) {
      spots.set(name, {
        name,
        alternateSpace: undefined,
        occurrences: 0,
        pages: new Set(),
        usages: new Set(["OutputIntent"]),
        status: "declared",
        role: TECHNICAL_INK_PATTERN.test(name) ? "technical" : "ink",
      })
    }
  })
}

export function preflightPdf(
  documentId: string,
  document: mupdf.PDFDocument,
  onProgress: (completedPages: number, totalPages: number) => void,
): DocumentPreflight {
  const colorSpaces = new Map<string, MutableColorSpace>()
  const spots = new Map<string, MutableSpot>()
  const outputIntents: OutputIntentInfo[] = []
  const declaredOrder: string[] = []
  const totalPages = document.countPages()
  const scannedPages = Math.min(totalPages, MAX_PREFLIGHT_PAGES)

  const trailer = document.getTrailer()
  const info = trailer.get("Info")
  const pdfStandard = getOptionalString(info, "GTS_PDFXVersion")
  const outputIntentObjects = trailer.get("Root", "OutputIntents")
  if (outputIntentObjects.isArray()) {
    for (let index = 0; index < outputIntentObjects.length; index += 1) {
      const intent = outputIntentObjects.get(index)
      outputIntents.push(inspectOutputIntent(intent))
      readDeclaredInks(intent, spots, declaredOrder)
    }
  }

  const recordColorSpace = (colorSpace: mupdf.ColorSpace | null, pageIndex: number, usage: string) => {
    if (!colorSpace) return
    const name = colorSpace.getName()
    const type = colorSpace.getType()
    const components = colorSpace.getNumberOfComponents()
    const key = `${name}|${type}|${components}`
    const entry = colorSpaces.get(key) ?? {
      name,
      type,
      components,
      occurrences: 0,
      pages: new Set<number>(),
      usages: new Set<string>(),
    }
    entry.occurrences += 1
    entry.pages.add(pageIndex + 1)
    entry.usages.add(usage)
    colorSpaces.set(key, entry)

    if (type !== "Separation" && !colorSpace.isDeviceN()) return
    const parsed = parseSeparationName(name)
    for (const [componentIndex, spotName] of parsed.names.entries()) {
      if (PROCESS_COLOR_NAMES.has(spotName.toLowerCase())) continue
      const existingSpot = spots.get(spotName)
      const previewColor =
        existingSpot?.previewColor ?? separationPreviewColor(colorSpace, componentIndex)
      const spot = existingSpot ?? {
        name: spotName,
        alternateSpace: parsed.alternateSpace,
        previewColor,
        occurrences: 0,
        pages: new Set<number>(),
        usages: new Set<string>(),
        status: "used" as const,
        role: TECHNICAL_INK_PATTERN.test(spotName) ? ("technical" as const) : ("ink" as const),
      }
      spot.alternateSpace ||= parsed.alternateSpace
      spot.previewColor ||= previewColor
      spot.occurrences += 1
      spot.pages.add(pageIndex + 1)
      spot.usages.add(usage)
      spot.status = "used"
      spots.set(spotName, spot)
    }
  }

  for (let pageIndex = 0; pageIndex < scannedPages; pageIndex += 1) {
    const page = document.loadPage(pageIndex)
    const device = new mupdf.Device({
      fillPath: (_path, _evenOdd, _ctm, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Vector fill"),
      strokePath: (_path, _stroke, _ctm, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Vector stroke"),
      fillText: (_text, _ctm, colorSpace) => recordColorSpace(colorSpace, pageIndex, "Text fill"),
      strokeText: (_text, _stroke, _ctm, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Text stroke"),
      fillImage: (image) => recordColorSpace(image.getColorSpace(), pageIndex, "Image"),
      fillImageMask: (_image, _ctm, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Image mask"),
      beginMask: (_bounds, _luminosity, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Transparency mask"),
      beginGroup: (_bounds, colorSpace) =>
        recordColorSpace(colorSpace, pageIndex, "Transparency group"),
    })

    try {
      page.run(device, mupdf.Matrix.identity)
      device.close()
    } finally {
      device.destroy()
      page.destroy()
    }
    onProgress(pageIndex + 1, scannedPages)
  }

  const classification = classifyDocument(colorSpaces.values(), outputIntents)
  const embeddedObjectProfiles = [
    ...new Set(
      [...colorSpaces.values()]
        .map((colorSpace) => /^ICCBased\([^,]+,(.+)\)$/.exec(colorSpace.name)?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort()
  const warnings: string[] = []
  if (outputIntents.length === 0) {
    warnings.push(
      pdfStandard
        ? `${pdfStandard} is declared, but no document OutputIntent profile is embedded.`
        : "No PDF OutputIntent profile is embedded.",
    )
  }
  if (classification === "Mixed") warnings.push("Both RGB and CMYK content were detected.")
  if (classification === "RGB") {
    warnings.push("RGB-only process artwork was detected; no CMYK process plates are available.")
  }
  if (scannedPages < totalPages) {
    warnings.push(`Preflight was limited to the first ${scannedPages} pages.`)
  }
  if (
    outputIntents.some((intent) => intent.profileModel === "CMYK") &&
    [...colorSpaces.values()].some((colorSpace) => colorSpace.type === "RGB")
  ) {
    warnings.push("RGB content will be converted through the CMYK output intent.")
  }
  const rgbAlternateSpots = [...spots.values()].filter((spot) =>
    spot.alternateSpace?.toUpperCase().includes("RGB"),
  ).length
  if (rgbAlternateSpots > 0) {
    warnings.push(
      `${rgbAlternateSpots} named separation${rgbAlternateSpots === 1 ? " uses" : "s use"} an RGB alternate color space.`,
    )
  }

  const order = new Map(declaredOrder.map((name, index) => [name, index]))
  const serializedSpots = [...spots.values()]
    .map<SpotColorInfo>((spot) => ({
      ...spot,
      pages: [...spot.pages].sort((a, b) => a - b),
      usages: [...spot.usages].sort(),
    }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "used" ? -1 : 1
      if (a.role !== b.role) return a.role === "ink" ? -1 : 1
      return (order.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.name) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
    })

  const hasCmyk = classification === "CMYK" || classification === "Mixed"

  return {
    documentId,
    classification,
    pdfStandard,
    outputIntents,
    embeddedObjectProfiles,
    colorSpaces: [...colorSpaces.values()]
      .map<ColorSpaceInfo>((colorSpace) => ({
        ...colorSpace,
        pages: [...colorSpace.pages].sort((a, b) => a - b),
        usages: [...colorSpace.usages].sort(),
      }))
      .sort((a, b) => b.occurrences - a.occurrences),
    spotColors: serializedSpots,
    processColors: hasCmyk ? ["Cyan", "Magenta", "Yellow", "Black"] : [],
    scannedPages,
    totalPages,
    warnings,
  }
}
