"use client"

import { useEffect, useRef } from "react"

interface PolygonVisualizationProps {
  imageUrl: string
  polygonData: any[]
  imageWidth: number
  imageHeight: number
  uploadedClasses: any[] | null
  isDarkMode: boolean
}

export default function PolygonVisualization({
  imageUrl,
  polygonData,
  imageWidth,
  imageHeight,
  uploadedClasses,
  isDarkMode,
}: PolygonVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !polygonData) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas size to match container
    const containerRect = container.getBoundingClientRect()
    canvas.width = containerRect.width
    canvas.height = containerRect.height

    // Calculate scaling factors
    const scaleX = canvas.width / imageWidth
    const scaleY = canvas.height / imageHeight
    const scale = Math.min(scaleX, scaleY)

    // Calculate image position (centered)
    const scaledWidth = imageWidth * scale
    const scaledHeight = imageHeight * scale
    const offsetX = (canvas.width - scaledWidth) / 2
    const offsetY = (canvas.height - scaledHeight) / 2

    // Load and draw image
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw image
      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight)

      // Draw polygons
      polygonData.forEach((polygon, index) => {
        const colors = [
          "#0891b2", // primary
          "#ef4444", // red
          "#10b981", // green
          "#f59e0b", // yellow
          "#8b5cf6", // purple
          "#ec4899", // pink
        ]
        const color = colors[index % colors.length]

        // Enhanced polygon style for better visibility
        ctx.strokeStyle = color
        ctx.fillStyle = color + "60" // 40% opacity for better visibility
        ctx.lineWidth = 3
        
        // Add glow effect for better contrast
        ctx.shadowColor = color
        ctx.shadowBlur = 8

        // Draw polygon based on segmentation data
        if (polygon.segmentation && Array.isArray(polygon.segmentation)) {
          // Handle different segmentation formats
          if (typeof polygon.segmentation[0] === "number") {
            // Flat array format [x1, y1, x2, y2, ...]
            ctx.beginPath()
            for (let i = 0; i < polygon.segmentation.length; i += 2) {
              const x = offsetX + polygon.segmentation[i] * scale
              const y = offsetY + polygon.segmentation[i + 1] * scale
              if (i === 0) {
                ctx.moveTo(x, y)
              } else {
                ctx.lineTo(x, y)
              }
            }
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          } else if (Array.isArray(polygon.segmentation[0])) {
            // Array of coordinate pairs [[x1, y1], [x2, y2], ...]
            ctx.beginPath()
            polygon.segmentation.forEach((point: number[], i: number) => {
              const x = offsetX + point[0] * scale
              const y = offsetY + point[1] * scale
              if (i === 0) {
                ctx.moveTo(x, y)
              } else {
                ctx.lineTo(x, y)
              }
            })
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          }
        } else if (polygon.bbox) {
          // Fallback to bounding box
          const [x, y, width, height] = polygon.bbox
          const scaledX = offsetX + x * scale
          const scaledY = offsetY + y * scale
          const scaledWidth = width * scale
          const scaledHeight = height * scale

          // Enhanced bounding box rendering
          ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight)
          ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight)
          
          // Add white outline for better contrast
          const originalStroke = ctx.strokeStyle
          const originalWidth = ctx.lineWidth
          ctx.strokeStyle = 'white'
          ctx.lineWidth = originalWidth + 2
          ctx.strokeRect(scaledX - 1, scaledY - 1, scaledWidth + 2, scaledHeight + 2)
          
          // Restore original style
          ctx.strokeStyle = originalStroke
          ctx.lineWidth = originalWidth
        }

        // Enhanced label rendering
        if (polygon.bbox) {
          const [x, y] = polygon.bbox
          const labelX = offsetX + x * scale
          const labelY = offsetY + y * scale - 8
          const labelText = `Polygon ${index + 1}`

          // Label background for better readability
          ctx.font = "bold 13px sans-serif"
          const textMetrics = ctx.measureText(labelText)
          const padding = 6
          const labelWidth = textMetrics.width + padding * 2
          const labelHeight = 18
          
          // White border
          ctx.fillStyle = "white"
          ctx.fillRect(labelX - padding - 1, labelY - labelHeight + 2, labelWidth + 2, labelHeight + 2)
          
          // Colored background
          ctx.fillStyle = color
          ctx.fillRect(labelX - padding, labelY - labelHeight + 3, labelWidth, labelHeight)

          // White text with shadow
          ctx.shadowColor = "rgba(0, 0, 0, 0.5)"
          ctx.shadowBlur = 2
          ctx.shadowOffsetX = 1
          ctx.shadowOffsetY = 1
          ctx.fillStyle = "white"
          ctx.fillText(labelText, labelX, labelY)
        }
        
        // Reset shadow after drawing
        ctx.shadowColor = "transparent"
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
      })
    }

    img.src = imageUrl
  }, [imageUrl, polygonData, imageWidth, imageHeight, isDarkMode])

  return (
    <div ref={containerRef} className="relative w-full h-[600px] bg-muted rounded-lg overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ imageRendering: "pixelated" }} />
    </div>
  )
}
