import type Konva from "konva"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Circle, Label, Layer, Line, Stage, Tag, Text } from "react-konva"
import type { PageRotation, VectorNode, VectorPathGroup } from "../worker/messages"

const SNAP_RADIUS_PIXELS = 14
const GRID_CELL_PIXELS = 28
const MAX_VISIBLE_NODES = 1_500

type ScreenNode = VectorNode & {
  screenX: number
  screenY: number
}

export type MeasurementSelection = {
  start: VectorNode
  end: VectorNode | null
}

type MeasureOverlayProps = {
  width: number
  height: number
  pageWidthPoints: number
  pageHeightPoints: number
  rotation: PageRotation
  group: VectorPathGroup
  resetToken: number
  onChange: (selection: MeasurementSelection | null) => void
}

function toScreenNode(
  node: VectorNode,
  pageWidthPoints: number,
  pageHeightPoints: number,
  width: number,
  height: number,
  rotation: PageRotation,
): ScreenNode {
  const pageX = node.xPoints / pageWidthPoints
  const pageY = node.yPoints / pageHeightPoints
  let x = pageX
  let y = pageY

  if (rotation === 90) {
    x = 1 - pageY
    y = pageX
  } else if (rotation === 180) {
    x = 1 - pageX
    y = 1 - pageY
  } else if (rotation === 270) {
    x = pageY
    y = 1 - pageX
  }

  return { ...node, screenX: x * width, screenY: y * height }
}

function gridKey(x: number, y: number) {
  return `${x}:${y}`
}

export function MeasureOverlay({
  width,
  height,
  pageWidthPoints,
  pageHeightPoints,
  rotation,
  group,
  resetToken,
  onChange,
}: MeasureOverlayProps) {
  const [startId, setStartId] = useState<number | null>(null)
  const [endId, setEndId] = useState<number | null>(null)
  const [hover, setHover] = useState<ScreenNode | null>(null)

  const { nodes, grid, nodeById } = useMemo(() => {
    const nextNodes = group.nodes.map((node) =>
      toScreenNode(
        node,
        pageWidthPoints,
        pageHeightPoints,
        width,
        height,
        rotation,
      ),
    )
    const nextGrid = new Map<string, ScreenNode[]>()
    const nextNodeById = new Map<number, ScreenNode>()
    for (const node of nextNodes) {
      nextNodeById.set(node.id, node)
      const cellX = Math.floor(node.screenX / GRID_CELL_PIXELS)
      const cellY = Math.floor(node.screenY / GRID_CELL_PIXELS)
      const key = gridKey(cellX, cellY)
      const cell = nextGrid.get(key)
      if (cell) cell.push(node)
      else nextGrid.set(key, [node])
    }
    return { nodes: nextNodes, grid: nextGrid, nodeById: nextNodeById }
  }, [group.nodes, height, pageHeightPoints, pageWidthPoints, rotation, width])
  const start = startId === null ? null : (nodeById.get(startId) ?? null)
  const end = endId === null ? null : (nodeById.get(endId) ?? null)
  const visibleNodes = useMemo(() => {
    if (nodes.length <= MAX_VISIBLE_NODES) return nodes
    const stride = Math.ceil(nodes.length / MAX_VISIBLE_NODES)
    return nodes.filter((_node, index) => index % stride === 0)
  }, [nodes])

  useEffect(() => {
    setStartId(null)
    setEndId(null)
    setHover(null)
    onChange(null)
  }, [group.name, onChange, resetToken])

  const nearestNode = useCallback(
    (x: number, y: number) => {
      const cellX = Math.floor(x / GRID_CELL_PIXELS)
      const cellY = Math.floor(y / GRID_CELL_PIXELS)
      let nearest: ScreenNode | null = null
      let nearestDistanceSquared = SNAP_RADIUS_PIXELS * SNAP_RADIUS_PIXELS

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const candidates = grid.get(gridKey(cellX + offsetX, cellY + offsetY)) ?? []
          for (const node of candidates) {
            const deltaX = node.screenX - x
            const deltaY = node.screenY - y
            const distanceSquared = deltaX * deltaX + deltaY * deltaY
            if (distanceSquared <= nearestDistanceSquared) {
              nearest = node
              nearestDistanceSquared = distanceSquared
            }
          }
        }
      }
      return nearest
    },
    [grid],
  )

  const pointerNode = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      const pointer = event.target.getStage()?.getPointerPosition()
      return pointer ? nearestNode(pointer.x, pointer.y) : null
    },
    [nearestNode],
  )

  const selectNode = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      const node = pointerNode(event)
      if (!node) return

      if (!start || end) {
        setStartId(node.id)
        setEndId(null)
        onChange({ start: node, end: null })
        return
      }

      setEndId(node.id)
      onChange({ start, end: node })
    },
    [end, onChange, pointerNode, start],
  )

  const measurementLength =
    start && end
      ? Math.hypot(end.xPoints - start.xPoints, end.yPoints - start.yPoints) * (25.4 / 72)
      : null
  const labelX = start && end ? Math.min(width - 72, Math.max(8, (start.screenX + end.screenX) / 2)) : 0
  const labelY = start && end ? Math.min(height - 28, Math.max(8, (start.screenY + end.screenY) / 2)) : 0

  return (
    <div
      className="measurement-overlay"
      role="application"
      aria-label={`Measure between ${group.name} vector nodes`}
    >
      <Stage
        width={width}
        height={height}
        onPointerMove={(event) => {
          const nextHover = pointerNode(event)
          setHover((current) => (current?.id === nextHover?.id ? current : nextHover))
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={selectNode}
      >
        <Layer>
          {visibleNodes.map((node) => (
            <Circle
              key={node.id}
              x={node.screenX}
              y={node.screenY}
              radius={3}
              fill="white"
              stroke="#e29b2e"
              strokeWidth={1.25}
              listening={false}
            />
          ))}
          {start && (
            <Circle
              x={start.screenX}
              y={start.screenY}
              radius={5}
              fill="#e29b2e"
              stroke="white"
              strokeWidth={1.5}
              listening={false}
            />
          )}
          {start && end && (
            <>
              <Line
                points={[start.screenX, start.screenY, end.screenX, end.screenY]}
                stroke="#e29b2e"
                strokeWidth={2.5}
                dash={[7, 4]}
                shadowColor="#142c36"
                shadowBlur={2}
                shadowOpacity={0.7}
                listening={false}
              />
              <Circle
                x={end.screenX}
                y={end.screenY}
                radius={5}
                fill="#e29b2e"
                stroke="white"
                strokeWidth={1.5}
                listening={false}
              />
              <Label x={labelX} y={labelY} listening={false}>
                <Tag fill="#142c36" cornerRadius={4} pointerDirection="down" pointerWidth={7} pointerHeight={5} />
                <Text
                  text={`${measurementLength?.toFixed(2)} mm`}
                  padding={6}
                  fill="white"
                  fontFamily="Inter"
                  fontSize={11}
                />
              </Label>
            </>
          )}
          {hover && hover.id !== start?.id && hover.id !== end?.id && (
            <Circle
              x={hover.screenX}
              y={hover.screenY}
              radius={6}
              fill="#f2f5f6"
              stroke="#142c36"
              strokeWidth={2}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}
