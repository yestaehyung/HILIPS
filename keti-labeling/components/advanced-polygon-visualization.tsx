"use client"

import type React from "react"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw, Download, Layers, Settings, ChevronUp, ChevronDown, Hand, Target, Tag } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ClassDefinition } from "./class-manager"

interface PolygonData {
  id?: string
  segmentation: number[] | number[][]
  area: number
  bbox: number[]
  predicted_iou: number
  stability_score: number
  point_coords: number[][]
  crop_box: number[]
  label?: string
  color?: string
  visible?: boolean
  classId?: string
  className?: string
  classColor?: string
  confidence?: number
  source?: string
}

interface AdvancedPolygonVisualizationProps {
  imageUrl: string
  polygonData: PolygonData[]
  imageWidth: number
  imageHeight: number
  uploadedClasses: any[] | null
  isDarkMode: boolean
  isProcessing?: boolean
  processingMessage?: string
  processingDescription?: string
  onImageLoad?: (naturalWidth: number, naturalHeight: number) => void
  onPointClick?: (x: number, y: number) => void
  onPolygonSelect?: (polygon: PolygonData) => void
  onPolygonUpdate?: (polygons: PolygonData[]) => void
  classes?: ClassDefinition[]
  selectedClassId?: string | null
  onClassAssign?: (polygonId: string, classId: string) => void
  selectedPolygonId: string | null
  onSelectPolygon: (id: string | null) => void
  // New props for controlled state
  zoom: number
  onZoomChange: (zoom: number) => void
  pan: { x: number; y: number }
  onPanChange: (pan: { x: number; y: number }) => void
  interactionMode: 'pan' | 'point' | 'select'
  onInteractionModeChange: (mode: 'pan' | 'point' | 'select') => void
  // Manual drawing props
  isManualDrawing?: boolean
  drawingPoints?: Array<{ x: number, y: number }>
  onDrawingPointAdd?: (point: { x: number, y: number }) => void
  className?: string
}

export default function AdvancedPolygonVisualization({
  imageUrl,
  polygonData,
  imageWidth,
  imageHeight,
  uploadedClasses,
  isDarkMode,
  isProcessing = false,
  processingMessage = "Processing...",
  processingDescription = "Please wait...",
  onImageLoad,
  onPointClick,
  onPolygonSelect,
  onPolygonUpdate,
  classes = [],
  selectedClassId,
  onClassAssign,
  selectedPolygonId,
  onSelectPolygon,
  zoom,
  onZoomChange,
  pan,
  onPanChange,
  interactionMode,
  onInteractionModeChange,
  isManualDrawing = false,
  drawingPoints = [],
  onDrawingPointAdd,
  className,
}: AdvancedPolygonVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Removed internal state for zoom, pan, interactionMode
  // selectedPolygon state lifted to props
  const [polygons, setPolygons] = useState<PolygonData[]>([])
  const [showLabels, setShowLabels] = useState(true)
  const [opacity, setOpacity] = useState([0.3])
  const [polygonDisplayMode, setPolygonDisplayMode] = useState<'all' | 'selected'>('all')
  const [segmentationVisible, setSegmentationVisible] = useState(true)
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 })
  const { toast } = useToast()

  // Initialize polygons with enhanced properties
  useEffect(() => {
    if (polygonData.length === 0) {
      setPolygons([])
      return
    }

    const enhancedPolygons = polygonData.map((polygon, index) => {
      // YOLO source polygons: green for auto-approved (confidence >= 0.8), amber for needs-review (< 0.8)
      const assignedClass = classes.find(cls => cls.id === polygon.classId)
      const confidence = polygon.confidence ?? polygon.stability_score ?? 0
      const isYoloSource = polygon.source === 'yolo'
      const yoloColor = isYoloSource
        ? (confidence >= 0.8 ? "#10b981" : "#f59e0b")  // green : amber/yellow
        : null
      const polygonColor = yoloColor ?? (assignedClass ? assignedClass.color : (polygon.color || getPolygonColor(index)))

      return {
        ...polygon,
        id: polygon.id || `polygon-${index}`,
        visible: polygon.visible !== undefined ? polygon.visible : true,
        color: polygonColor,
        classColor: assignedClass?.color,
        className: assignedClass?.name || polygon.className,
        label: polygon.label || `Object ${index + 1}`,
      }
    })

    // Only update polygons if they actually changed
    setPolygons(prev => {
      if (prev.length !== enhancedPolygons.length) return enhancedPolygons

      const hasChanged = enhancedPolygons.some((newPoly, idx) => {
        const oldPoly = prev[idx]
        return !oldPoly ||
          newPoly.color !== oldPoly.color ||
          newPoly.classId !== oldPoly.classId ||
          newPoly.className !== oldPoly.className ||
          newPoly.visible !== oldPoly.visible
      })

      return hasChanged ? enhancedPolygons : prev
    })
  }, [polygonData, classes])

  // Handle polygon selection separately to avoid unnecessary re-renders
  useEffect(() => {
    if (polygons.length > 0 && !selectedPolygonId) {
      onSelectPolygon(polygons[0].id!)
    }
  }, [polygons.length, selectedPolygonId, onSelectPolygon])


  // Handle wheel event for zooming
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? 0.9 : 1.1
    onZoomChange(Math.max(0.1, Math.min(5, zoom * delta)))
  }, [zoom, onZoomChange])

  // Handle keyboard shortcuts for class assignment
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Ignore shortcuts while typing in form fields to avoid stealing keystrokes
    const target = event.target as HTMLElement | null
    if (target) {
      const tagName = target.tagName
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        target.getAttribute("contenteditable") === "true" ||
        target.isContentEditable
      ) {
        return
      }
    }

    // Only handle shortcuts when in the labeling workspace and a polygon is selected
    if (!selectedPolygonId || !onClassAssign) return

    const key = event.key

    // Handle number keys for class assignment
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].includes(key)) {
      if (!selectedPolygonId) {
        toast({
          title: "No polygon selected",
          description: "Please select a polygon to assign a class.",
          variant: "destructive"
        })
        return
      }

      if (key === '0') {
        event.preventDefault()
        const targetClass = classes[9] // button_10 is at index 9

        if (targetClass) {
          onClassAssign?.(selectedPolygonId, targetClass.id)
          toast({
            title: "Class assigned",
            description: `Assigned "${targetClass.name}" to selected polygon using shortcut ${key}.`,
          })
        }
      } else {
        // 1-9
        event.preventDefault()
        const index = parseInt(key) - 1
        const targetClass = classes[index]

        if (targetClass) {
          onClassAssign?.(selectedPolygonId, targetClass.id)
          toast({
            title: "Class assigned",
            description: `Assigned "${targetClass.name}" to selected polygon using shortcut ${key}.`,
          })
        }
      }
    }

    // Handle Backspace to remove class assignment
    if (key === 'Backspace') {
      if (selectedPolygonId) {
        event.preventDefault()
        onClassAssign?.(selectedPolygonId, '')
        toast({
          title: "Class removed",
          description: "Removed class assignment from selected polygon.",
        })
      }
    }
  }, [selectedPolygonId, onClassAssign, classes, toast])

  // Add wheel event listener to canvas with passive: false
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleWheel, handleKeyDown])

  const getPolygonColor = (index: number) => {
    const colors = [
      "#0891b2", // primary cyan
      "#ef4444", // red
      "#10b981", // green
      "#f59e0b", // yellow
      "#8b5cf6", // purple
      "#ec4899", // pink
      "#06b6d4", // cyan
      "#84cc16", // lime
    ]
    return colors[index % colors.length]
  }

  const drawVisualization = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas size
    const containerRect = container.getBoundingClientRect()
    canvas.width = containerRect.width
    canvas.height = containerRect.height

    // Calculate base scaling
    const baseScaleX = canvas.width / imageWidth
    const baseScaleY = canvas.height / imageHeight
    const baseScale = Math.min(baseScaleX, baseScaleY)
    const scale = baseScale * zoom

    // Calculate image position with pan
    const scaledImageWidth = imageWidth * scale
    const scaledImageHeight = imageHeight * scale
    const offsetX = (canvas.width - scaledImageWidth) / 2 + pan.x
    const offsetY = (canvas.height - scaledImageHeight) / 2 + pan.y

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Load and draw image
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      onImageLoad?.(img.naturalWidth, img.naturalHeight)

      // Draw image
      ctx.drawImage(img, offsetX, offsetY, scaledImageWidth, scaledImageHeight)

      // Draw polygons
      console.log('🔍 DEBUG: Drawing polygons', {
        polygonsCount: polygons.length,
        segmentationVisible,
        polygonDisplayMode
      })
      
      polygons.forEach((polygon, idx) => {
        if (!ctx) return
        
        console.log(`🔍 DEBUG polygon[${idx}]:`, {
          id: polygon.id,
          visible: polygon.visible,
          hasSegmentation: !!polygon.segmentation,
          segmentationType: polygon.segmentation ? typeof polygon.segmentation : 'none',
          segmentationLength: Array.isArray(polygon.segmentation) ? polygon.segmentation.length : 0,
          bbox: polygon.bbox,
          source: (polygon as any).source
        })
        
        if (!polygon.visible) {
          console.log(`🔍 DEBUG polygon[${idx}]: SKIPPED - not visible`)
          return
        }

        const isSelected = selectedPolygonId === polygon.id
        const color = polygon.color || "#0891b2"

        // Set polygon segmentation style
        const segmentationOpacity = opacity[0]
        ctx.strokeStyle = color
        ctx.fillStyle =
          color +
          Math.floor(segmentationOpacity * 255)
            .toString(16)
            .padStart(2, "0")
        ctx.lineWidth = isSelected ? 3 : 2

        // Add subtle glow for segmentation
        ctx.shadowColor = color
        ctx.shadowBlur = isSelected ? 8 : 4

        ctx.setLineDash([])
        ctx.globalCompositeOperation = 'source-over'

        // Draw polygon segmentation based on display mode
        const shouldShowSegmentation = segmentationVisible &&
          (polygonDisplayMode === 'all' ||
            (polygonDisplayMode === 'selected' && isSelected))

        console.log(`🔍 DEBUG polygon[${idx}] shouldShowSegmentation:`, shouldShowSegmentation)

        const hasValidSegmentation = polygon.segmentation && 
          Array.isArray(polygon.segmentation) && 
          polygon.segmentation.length > 0

        if (shouldShowSegmentation && hasValidSegmentation) {
          console.log('=== SEGMENTATION RENDER START ===', {
            id: polygon.id,
            segmentation: polygon.segmentation,
            bbox: polygon.bbox,
            shouldShowSegmentation,
            color,
            opacity: opacity[0]
          })

          ctx.save()

          // Handle different segmentation data formats
          if (Array.isArray(polygon.segmentation)) {
            // Check if it's 2D mask format (mock data)
            if (polygon.segmentation.length > 0 &&
              Array.isArray(polygon.segmentation[0]) &&
              typeof polygon.segmentation[0][0] === 'boolean') {
              // 2D boolean mask - draw filled pixels
              const mask = polygon.segmentation as unknown as boolean[][]
              const [bboxX, bboxY, bboxWidth, bboxHeight] = polygon.bbox

              for (let y = 0; y < mask.length; y++) {
                for (let x = 0; x < mask[y].length; x++) {
                  if (mask[y][x]) {
                    const pixelX = offsetX + (bboxX + (x / mask[0].length) * bboxWidth) * scale
                    const pixelY = offsetY + (bboxY + (y / mask.length) * bboxHeight) * scale
                    const pixelSize = Math.max(2, (scale * bboxWidth) / mask[0].length)

                    ctx.fillRect(pixelX, pixelY, pixelSize, pixelSize)
                  }
                }
              }

            } else {
              // Standard polygon coordinates
              ctx.beginPath()
              let hasValidPath = false

              if (typeof polygon.segmentation[0] === 'number') {
                console.log('🎨 RENDER COORDS:', {
                  rawSegmentation: polygon.segmentation.slice(0, 8),
                  scale,
                  offsetX,
                  offsetY,
                  imageWidth,
                  imageHeight,
                  canvasWidth: canvas.width,
                  canvasHeight: canvas.height
                })
                for (let i = 0; i < polygon.segmentation.length; i += 2) {
                  if (i + 1 < polygon.segmentation.length) {
                    const rawX = polygon.segmentation[i] as number
                    const rawY = polygon.segmentation[i + 1] as number
                    const x = offsetX + rawX * scale
                    const y = offsetY + rawY * scale
                    if (i === 0) {
                      console.log(`🎨 First point: raw(${rawX}, ${rawY}) → canvas(${x.toFixed(1)}, ${y.toFixed(1)})`)
                      ctx.moveTo(x, y)
                    } else {
                      ctx.lineTo(x, y)
                    }
                    hasValidPath = true
                  }
                }
              } else if (Array.isArray(polygon.segmentation[0])) {
                const firstElement = polygon.segmentation[0] as any[]
                const isPointPairs = firstElement.length === 2 && typeof firstElement[0] === 'number' && typeof firstElement[1] === 'number'
                
                if (isPointPairs) {
                  (polygon.segmentation as Array<[number, number]>).forEach((point, i) => {
                    if (Array.isArray(point) && point.length >= 2) {
                      const x = offsetX + point[0] * scale
                      const y = offsetY + point[1] * scale
                      if (i === 0) {
                        ctx.moveTo(x, y)
                      } else {
                        ctx.lineTo(x, y)
                      }
                      hasValidPath = true
                    }
                  })
                } else if (typeof firstElement[0] === 'number') {
                  (polygon.segmentation as number[][]).forEach((ring) => {
                    for (let i = 0; i < ring.length; i += 2) {
                      if (i + 1 < ring.length) {
                        const x = offsetX + ring[i] * scale
                        const y = offsetY + ring[i + 1] * scale
                        if (i === 0) ctx.moveTo(x, y)
                        else ctx.lineTo(x, y)
                        hasValidPath = true
                      }
                    }
                    ctx.closePath()
                  })
                }
              }

              if (hasValidPath) {
                console.log('Closing path and filling/stroking')
                ctx.closePath()
                ctx.fill()
                ctx.stroke()

                // Add outline for selected
                if (isSelected) {
                  ctx.strokeStyle = 'white'
                  ctx.lineWidth = 1
                  ctx.shadowBlur = 0
                  ctx.stroke()
                }
                console.log('=== SEGMENTATION RENDER COMPLETE ===')
              } else {
                console.log('No valid path found!')
              }
            }
          }

          ctx.restore()
        } else if (shouldShowSegmentation && polygon.bbox) {
          // Fallback: fill entire bbox if no segmentation data
          const [x, y, width, height] = polygon.bbox
          const scaledX = offsetX + x * scale
          const scaledY = offsetY + y * scale
          const scaledWidth = width * scale
          const scaledHeight = height * scale

          ctx.save()
          ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight)
          ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight)
          ctx.restore()
        }



        // Bounding box drawing removed per user request
        const shouldDrawBbox = false

        if (polygon.bbox && shouldDrawBbox) {
          const [x, y, width, height] = polygon.bbox
          const scaledX = offsetX + x * scale
          const scaledY = offsetY + y * scale
          const scaledBboxWidth = width * scale
          const scaledBboxHeight = height * scale

          // Save current context state
          ctx.save()

          // Set bbox-specific styles
          ctx.strokeStyle = color
          ctx.lineWidth = isSelected ? 4 : 3
          ctx.fillStyle = 'transparent'
          ctx.shadowColor = color
          ctx.shadowBlur = isSelected ? 12 : 6

          // Draw white outline first for better contrast
          ctx.strokeStyle = 'white'
          ctx.lineWidth = (isSelected ? 4 : 3) + 2
          ctx.shadowBlur = 0
          ctx.strokeRect(scaledX - 1, scaledY - 1, scaledBboxWidth + 2, scaledBboxHeight + 2)

          // Draw main bbox rectangle
          ctx.strokeStyle = color
          ctx.lineWidth = isSelected ? 4 : 3
          ctx.shadowColor = color
          ctx.shadowBlur = isSelected ? 12 : 6
          ctx.strokeRect(scaledX, scaledY, scaledBboxWidth, scaledBboxHeight)

          // Draw corner indicators for better visibility
          const cornerSize = Math.min(20, Math.min(scaledBboxWidth, scaledBboxHeight) / 4)
          ctx.lineWidth = 2
          ctx.shadowBlur = 0

          // Top-left corner
          ctx.beginPath()
          ctx.moveTo(scaledX, scaledY + cornerSize)
          ctx.lineTo(scaledX, scaledY)
          ctx.lineTo(scaledX + cornerSize, scaledY)
          ctx.stroke()

          // Top-right corner
          ctx.beginPath()
          ctx.moveTo(scaledX + scaledBboxWidth - cornerSize, scaledY)
          ctx.lineTo(scaledX + scaledBboxWidth, scaledY)
          ctx.lineTo(scaledX + scaledBboxWidth, scaledY + cornerSize)
          ctx.stroke()

          // Bottom-left corner
          ctx.beginPath()
          ctx.moveTo(scaledX, scaledY + scaledBboxHeight - cornerSize)
          ctx.lineTo(scaledX, scaledY + scaledBboxHeight)
          ctx.lineTo(scaledX + cornerSize, scaledY + scaledBboxHeight)
          ctx.stroke()

          // Bottom-right corner
          ctx.beginPath()
          ctx.moveTo(scaledX + scaledBboxWidth - cornerSize, scaledY + scaledBboxHeight)
          ctx.lineTo(scaledX + scaledBboxWidth, scaledY + scaledBboxHeight)
          ctx.lineTo(scaledX + scaledBboxWidth, scaledY + scaledBboxHeight - cornerSize)
          ctx.stroke()

          // Restore context
          ctx.restore()
        }

        // Draw label based on display mode  
        const shouldShowLabel = showLabels &&
          (polygonDisplayMode === 'all' ||
            (polygonDisplayMode === 'selected' && isSelected))

        if (shouldShowLabel && polygon.bbox) {
          const [x, y] = polygon.bbox
          const labelX = offsetX + x * scale
          const labelY = offsetY + y * scale - 8

          // Subtle label styling
          ctx.font = "11px sans-serif"  // smaller default font
          const conf = polygon.confidence ?? polygon.stability_score ?? 0
          const labelText = polygon.source === 'yolo'
            ? `${polygon.label || ""} ${(conf * 100).toFixed(0)}%`
            : (polygon.label || "")
          const textMetrics = ctx.measureText(labelText)
          const padding = 3  // smaller padding
          const labelWidth = textMetrics.width + padding * 2
          const labelHeight = 13  // shorter height

          // Semi-transparent dark background for subtlety
          ctx.fillStyle = "rgba(0, 0, 0, 0.6)"  // semi-transparent black background
          ctx.fillRect(labelX - padding, labelY - labelHeight + 3, labelWidth, labelHeight)

          // Subtle white text with minimal shadow
          ctx.fillStyle = "white"
          ctx.shadowColor = "rgba(0, 0, 0, 0.8)"
          ctx.shadowBlur = 1  // lighter shadow
          ctx.shadowOffsetX = 0.5
          ctx.shadowOffsetY = 0.5
          ctx.fillText(labelText, labelX, labelY)

          // Reset shadow
          ctx.shadowColor = "transparent"
          ctx.shadowBlur = 0
          ctx.shadowOffsetX = 0
          ctx.shadowOffsetY = 0
        }

        // IoU info box removed
      })

      // Reset shadow and context
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      ctx.globalCompositeOperation = 'source-over'

      // Draw manual drawing points and lines
      if (isManualDrawing && drawingPoints.length > 0) {
        ctx.save()

        // Draw lines connecting points
        if (drawingPoints.length > 1) {
          ctx.beginPath()
          drawingPoints.forEach((point, index) => {
            const x = offsetX + point.x * scale
            const y = offsetY + point.y * scale
            if (index === 0) {
              ctx.moveTo(x, y)
            } else {
              ctx.lineTo(x, y)
            }
          })
          ctx.strokeStyle = '#0891b2'
          ctx.lineWidth = 2
          ctx.stroke()

          // Draw preview line to close polygon
          if (drawingPoints.length >= 2) {
            ctx.setLineDash([5, 5])
            ctx.beginPath()
            const lastPoint = drawingPoints[drawingPoints.length - 1]
            const firstPoint = drawingPoints[0]
            ctx.moveTo(offsetX + lastPoint.x * scale, offsetY + lastPoint.y * scale)
            ctx.lineTo(offsetX + firstPoint.x * scale, offsetY + firstPoint.y * scale)
            ctx.strokeStyle = '#0891b2'
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        // Draw points
        drawingPoints.forEach((point, index) => {
          const x = offsetX + point.x * scale
          const y = offsetY + point.y * scale

          // Outer circle
          ctx.beginPath()
          ctx.arc(x, y, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#0891b2'
          ctx.fill()

          // Inner circle
          ctx.beginPath()
          ctx.arc(x, y, 3, 0, Math.PI * 2)
          ctx.fillStyle = 'white'
          ctx.fill()

          // Point number
          ctx.fillStyle = 'white'
          ctx.font = 'bold 10px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText((index + 1).toString(), x, y)
        })

        ctx.restore()
      }
    }

    img.src = imageUrl
  }, [imageUrl, polygons, imageWidth, imageHeight, zoom, pan, selectedPolygonId, showLabels, opacity, segmentationVisible, polygonDisplayMode, isManualDrawing, drawingPoints])

  // Trigger drawing when dependencies change, but with debouncing
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      drawVisualization()
    }, 16) // ~60fps

    return () => clearTimeout(timeoutId)
  }, [imageUrl, polygons, zoom, pan, selectedPolygonId, showLabels, opacity, segmentationVisible, polygonDisplayMode, isManualDrawing, drawingPoints, drawVisualization])

  // Helper to check if a point is inside a polygon
  const isPointInPolygon = (x: number, y: number, polygon: PolygonData): boolean => {
    // 1. Quick BBox check
    if (polygon.bbox) {
      const [bx, by, bw, bh] = polygon.bbox
      if (x < bx || x > bx + bw || y < by || y > by + bh) {
        return false
      }
    }

    // 2. Detailed Segmentation check
    if (!polygon.segmentation) return true // If no segmentation, fallback to bbox match (which passed)

    if (Array.isArray(polygon.segmentation)) {
      // Case A: 2D Boolean Mask
      if (polygon.segmentation.length > 0 &&
        Array.isArray(polygon.segmentation[0]) &&
        typeof polygon.segmentation[0][0] === 'boolean') {

        const mask = polygon.segmentation as unknown as boolean[][]
        const [bx, by, bw, bh] = polygon.bbox

        // Map global x,y to mask coordinates
        // Mask covers the bbox area
        const maskWidth = mask[0].length
        const maskHeight = mask.length

        const relativeX = x - bx
        const relativeY = y - by

        const maskX = Math.floor((relativeX / bw) * maskWidth)
        const maskY = Math.floor((relativeY / bh) * maskHeight)

        if (maskY >= 0 && maskY < maskHeight && maskX >= 0 && maskX < maskWidth) {
          return mask[maskY][maskX]
        }
        return false
      }

      // Case B: Flat Coordinate Array [x1, y1, x2, y2, ...]
      if (typeof polygon.segmentation[0] === 'number') {
        const points = polygon.segmentation as number[]
        let inside = false
        for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
          const xi = points[i], yi = points[i + 1]
          const xj = points[j], yj = points[j + 1]

          const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
          if (intersect) inside = !inside
        }
        return inside
      }

      // Case C: Array of Coordinate Pairs [[x1, y1], [x2, y2], ...]
      if (Array.isArray(polygon.segmentation[0])) {
        const points = polygon.segmentation as number[][]
        let inside = false
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const xi = points[i][0], yi = points[i][1]
          const xj = points[j][0], yj = points[j][1]

          const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
          if (intersect) inside = !inside
        }
        return inside
      }
    }

    return false
  }

  // Handle canvas interactions - mode-based
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top

    // Calculate real coordinates in image space
    const baseScaleX = canvas.width / imageWidth
    const baseScaleY = canvas.height / imageHeight
    const baseScale = Math.min(baseScaleX, baseScaleY)
    const scale = baseScale * zoom

    const scaledImageWidth = imageWidth * scale
    // const scaledImageHeight = imageHeight * scale // Unused
    const offsetX = (canvas.width - scaledImageWidth) / 2 + pan.x
    const offsetY = (canvas.height - (imageHeight * scale)) / 2 + pan.y

    // Convert click coordinates to image coordinates
    const imageX = (clickX - offsetX) / scale
    const imageY = (clickY - offsetY) / scale

    // Check if click is within image bounds
    if (imageX >= 0 && imageX <= imageWidth && imageY >= 0 && imageY <= imageHeight) {
      const realX = Math.round(imageX)
      const realY = Math.round(imageY)

      // Manual drawing mode
      if (isManualDrawing && onDrawingPointAdd) {
        console.log("✏️ Adding drawing point:", { realX, realY })
        onDrawingPointAdd({ x: realX, y: realY })
        return
      }

      if (interactionMode === 'point') {
        if (isProcessing || !onPointClick) return
        console.log("🖱️ Canvas clicked for point segmentation:", { realX, realY })
        onPointClick(realX, realY)
      } else if (interactionMode === 'select') {
        // Find clicked polygon
        // Iterate in reverse to select the top-most polygon (last rendered)
        const clickedPolygon = [...polygons].reverse().find(polygon => {
          if (!polygon.visible) return false
          return isPointInPolygon(realX, realY, polygon)
        })

        if (clickedPolygon) {
          console.log("🎯 Polygon selected:", clickedPolygon.id)
          onSelectPolygon(clickedPolygon.id!)
        } else {
          console.log("❌ No polygon found at click")
          onSelectPolygon(null)
        }
      }
    }
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'pan' && event.button === 0) {
      // Left click for panning in pan mode
      setIsPanning(true)
      setLastPanPoint({ x: event.clientX, y: event.clientY })
      event.preventDefault()
    } else if (event.button === 1 || event.ctrlKey) {
      // Middle mouse or Ctrl+click for panning (fallback)
      setIsPanning(true)
      setLastPanPoint({ x: event.clientX, y: event.clientY })
      event.preventDefault()
    }
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const deltaX = event.clientX - lastPanPoint.x
      const deltaY = event.clientY - lastPanPoint.y
      onPanChange({ x: pan.x + deltaX, y: pan.y + deltaY })
      setLastPanPoint({ x: event.clientX, y: event.clientY })
    }
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }





  return (
    <>
      <div ref={containerRef} className={`relative w-full bg-muted/10 rounded-lg overflow-hidden cursor-crosshair touch-none ${className || 'h-[600px]'}`}>
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 w-full h-full ${isPanning
            ? 'cursor-grabbing'
            : interactionMode === 'pan'
              ? 'cursor-grab'
              : 'cursor-crosshair'
            }`}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ imageRendering: "pixelated" }}
        />



        {/* Processing Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
            <div className="text-center p-8">
              <div className="inline-flex items-center justify-center w-16 h-16 mb-4 bg-primary/10 rounded-full">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{processingMessage}</h3>
              <p className="text-sm text-muted-foreground mb-4">{processingDescription}</p>
              <div className="flex items-center justify-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                <div
                  className="w-2 h-2 bg-primary rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                />
                <div
                  className="w-2 h-2 bg-primary rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
