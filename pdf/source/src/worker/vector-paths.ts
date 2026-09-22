import * as mupdf from "mupdf"
import type { VectorGeometryReport, VectorNode, VectorPathGroup } from "./messages"
import { parseSeparationName } from "./preflight"

const MAX_VECTOR_NODES = 50_000
const MAX_VECTOR_PATHS = 20_000
const MIN_TINT = 0.001
const NODE_DEDUPE_POINTS = 0.02

type MutableGroup = {
  name: string
  pathCount: number
  nodes: VectorNode[]
  nodeKeys: Set<string>
}

function transformPoint(x: number, y: number, matrix: mupdf.Matrix): mupdf.Point {
  const [a, b, c, d, e, f] = matrix
  return [a * x + c * y + e, b * x + d * y + f]
}

function collectAnchorPoints(
  path: mupdf.Path,
  matrix: mupdf.Matrix,
  cropBox: mupdf.Rect,
): mupdf.Point[] {
  const points: mupdf.Point[] = []
  const append = (x: number, y: number) => {
    const [pageX, pageY] = transformPoint(x, y, matrix)
    const normalizedX = pageX - cropBox[0]
    const normalizedY = pageY - cropBox[1]
    const width = cropBox[2] - cropBox[0]
    const height = cropBox[3] - cropBox[1]
    const tolerance = 1

    if (
      !Number.isFinite(normalizedX) ||
      !Number.isFinite(normalizedY) ||
      normalizedX < -tolerance ||
      normalizedY < -tolerance ||
      normalizedX > width + tolerance ||
      normalizedY > height + tolerance
    ) {
      return
    }

    points.push([
      Math.min(width, Math.max(0, normalizedX)),
      Math.min(height, Math.max(0, normalizedY)),
    ])
  }

  path.walk({
    moveTo: append,
    lineTo: append,
    curveTo: (_x1, _y1, _x2, _y2, x3, y3) => append(x3, y3),
  })
  return points
}

function nodeKey([x, y]: mupdf.Point) {
  return `${Math.round(x / NODE_DEDUPE_POINTS)}:${Math.round(y / NODE_DEDUPE_POINTS)}`
}

export function extractVectorPaths(
  documentId: string,
  page: mupdf.Page,
  pageIndex: number,
  requestedNames: string[],
): VectorGeometryReport {
  const separationNames = [...new Set(requestedNames.map((name) => name.trim()).filter(Boolean))]
    .slice(0, 64)
  const requested = new Set(separationNames)
  const groups = new Map<string, MutableGroup>(
    separationNames.map((name) => [
      name,
      { name, pathCount: 0, nodes: [], nodeKeys: new Set<string>() },
    ]),
  )
  const cropBox = page.getBounds("CropBox")
  let totalNodes = 0
  let totalPaths = 0
  let truncated = false

  const recordPath = (
    path: mupdf.Path,
    matrix: mupdf.Matrix,
    colorSpace: mupdf.ColorSpace,
    color: number[],
    alpha: number,
  ) => {
    if (alpha <= 0 || truncated) return
    const parsed = parseSeparationName(colorSpace.getName())
    const activeNames = parsed.names.filter(
      (name, componentIndex) =>
        requested.has(name) && Math.abs(color[componentIndex] ?? 0) >= MIN_TINT,
    )
    if (activeNames.length === 0) return

    const anchors = collectAnchorPoints(path, matrix, cropBox)
    if (anchors.length === 0) return

    for (const name of activeNames) {
      const group = groups.get(name)
      if (!group) continue
      if (totalPaths >= MAX_VECTOR_PATHS) {
        truncated = true
        break
      }

      group.pathCount += 1
      totalPaths += 1
      for (const point of anchors) {
        const key = nodeKey(point)
        if (group.nodeKeys.has(key)) continue
        if (totalNodes >= MAX_VECTOR_NODES) {
          truncated = true
          break
        }
        group.nodeKeys.add(key)
        group.nodes.push({
          id: group.nodes.length,
          xPoints: point[0],
          yPoints: point[1],
        })
        totalNodes += 1
      }
    }
  }

  const device = new mupdf.Device({
    fillPath: (path, _evenOdd, matrix, colorSpace, color, alpha) => {
      try {
        recordPath(path, matrix, colorSpace, color, alpha)
      } finally {
        colorSpace.destroy()
        path.destroy()
      }
    },
    strokePath: (path, stroke, matrix, colorSpace, color, alpha) => {
      try {
        recordPath(path, matrix, colorSpace, color, alpha)
      } finally {
        colorSpace.destroy()
        stroke.destroy()
        path.destroy()
      }
    },
  })

  try {
    page.run(device, mupdf.Matrix.identity)
    device.close()
  } finally {
    device.destroy()
  }

  const serializedGroups = [...groups.values()]
    .filter((group) => group.nodes.length > 0)
    .map<VectorPathGroup>(({ name, pathCount, nodes }) => ({ name, pathCount, nodes }))

  return {
    documentId,
    pageIndex,
    groups: serializedGroups,
    truncated,
    notes: [
      "Snap anchors include move, line, and Bézier end points; Bézier control handles are excluded.",
      ...(truncated
        ? [`Geometry was limited to ${MAX_VECTOR_NODES.toLocaleString()} unique nodes.`]
        : []),
    ],
  }
}
