"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Moon, Sun, Zap, Target, Trash2, FileText, Play, Square, RotateCcw, Brain, PanelLeft, PanelRight, ZoomIn, ZoomOut, Hand, MousePointer2, Maximize, Minimize, Sparkles, Layers, Loader2, ChevronLeft, ChevronRight, CheckCircle, Bot } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import AdvancedPolygonVisualization from "./advanced-polygon-visualization"
import ClassManager, { type ClassDefinition } from "./class-manager"
import { useToast } from "@/hooks/use-toast"
import { apiCall, apiCallWithTimeout, API_CONFIG, GEMINI_SEGMENTATION_DEFAULTS } from "@/lib/api-config"

const getPolygonKey = (polygon: any, index: number) => polygon?.id ?? `polygon-${index}`

const createPolygonId = (prefix: string) => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface LabelingWorkspaceProps {
  selectedImage: string
  onBack: () => void
  uploadedClasses: any[] | null
  isDarkMode: boolean
  toggleDarkMode: () => void
  onNext?: () => void
  onPrevious?: () => void
  hasNext?: boolean
  hasPrevious?: boolean
  hasExistingAnnotations?: boolean
  initialAnnotations?: any[]
  currentPhase?: number
  onAnnotationsSave?: (imageId: string, annotations: any[]) => void
  experimentId?: string
  sessionId?: string
  currentIteration?: number
  isTestSetImage?: boolean
}

export default function LabelingWorkspace({
  selectedImage,
  onBack,
  uploadedClasses,
  isDarkMode,
  toggleDarkMode,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  hasExistingAnnotations,
  initialAnnotations = [],
  currentPhase = 1,
  onAnnotationsSave,
  experimentId,
  sessionId,
  currentIteration,
  isTestSetImage = false,
}: LabelingWorkspaceProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStatus, setProcessingStatus] = useState<string | null>(null)
  const [polygonData, setPolygonData] = useState<any[] | null>(initialAnnotations)
  const [imageSize, setImageSize] = useState({ width: 800, height: 600 })
  const [rawServerLog, setRawServerLog] = useState<any>(null)
  const [showRawLog, setShowRawLog] = useState(false)
  const [pointsMode, setPointsMode] = useState(false)
  const [selectedPoints, setSelectedPoints] = useState<any[]>([])
  const [pointProcessing, setPointProcessing] = useState<Record<string, string>>({})
  const [clickProcessing, setClickProcessing] = useState(false)
  const [processingContext, setProcessingContext] = useState<"sam" | "gemini" | "point" | "hilips" | "manual" | null>(null)
  const [geminiPrompt, setGeminiPrompt] = useState("")
  const [isManualDrawing, setIsManualDrawing] = useState(false)
  const [drawingPoints, setDrawingPoints] = useState<Array<{ x: number, y: number }>>([])
  const [classes, setClasses] = useState<ClassDefinition[]>([])
  const [isSavingAnnotations, setIsSavingAnnotations] = useState(false)

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null)

  const [availableModels, setAvailableModels] = useState<Array<{ model_id: string; model_name?: string; metrics?: any }>>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [modelConfidence, setModelConfidence] = useState(0.5)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [isModelInferencing, setIsModelInferencing] = useState(false)

  // Immersive Mode State
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [interactionMode, setInteractionMode] = useState<'pan' | 'point' | 'select'>('point')
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true)
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true)

  const imageRef = useRef<HTMLImageElement>(null)
  const startTimeRef = useRef<number | null>(null)
  const { toast } = useToast()

  const persistAnnotations = (updatedPolygons: any[] | null) => {
    try {
      const annotations = localStorage.getItem("ketilabel_annotations")
      const allAnnotations = annotations ? JSON.parse(annotations) : {}
      allAnnotations[selectedImage] = updatedPolygons ?? []
      localStorage.setItem("ketilabel_annotations", JSON.stringify(allAnnotations))
    } catch (error) {
      console.error("Failed to persist annotations:", error)
    }
  }

  // Ensure polygons always have stable IDs (handles legacy data without ids)
  useEffect(() => {
    if (!polygonData || polygonData.length === 0) return
    const needsId = polygonData.some((polygon) => !polygon?.id)
    if (!needsId) return

    setPolygonData((prev) => {
      if (!prev) return prev
      let mutated = false
      const patched = prev.map((polygon) => {
        if (!polygon || polygon.id) {
          return polygon
        }
        mutated = true
        return {
          ...polygon,
          id: createPolygonId("poly"),
        }
      })
      return mutated ? patched : prev
    })
  }, [polygonData])

  // Load classes from localStorage on mount
  useEffect(() => {
    const savedClasses = localStorage.getItem("ketilabel_classes")
    if (savedClasses) {
      try {
        setClasses(JSON.parse(savedClasses))
      } catch (error) {
        console.error("Failed to load classes:", error)
      }
    }
  }, [])

  // Handle uploaded classes from parent
  useEffect(() => {
    if (uploadedClasses && uploadedClasses.length > 0) {
      setClasses(uploadedClasses)
      toast({
        title: "Classes Updated",
        description: `Applied ${uploadedClasses.length} classes from upload.`,
      })
    }
  }, [uploadedClasses])

  // Save classes to localStorage when they change
  useEffect(() => {
    const storageKey = "ketilabel_classes"
    if (classes.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(classes))
    } else {
      localStorage.removeItem(storageKey)
    }
  }, [classes])

  const prevImageRef = useRef<string | null>(null)
  const hasLocalChangesRef = useRef(false)
  const prevInitialAnnotationsRef = useRef<any[] | null>(null)

  const enrichAnnotationsWithClasses = (annotations: any[]) => {
    if (!annotations || annotations.length === 0) return []
    return annotations.map(ann => {
      if (ann.classId) return ann
      
      const label = ann.label || ann.className
      if (!label) return ann
      
      const matchingClass = classes.find(
        cls => cls.name.toLowerCase() === label.toLowerCase()
      )
      
      if (matchingClass) {
        return {
          ...ann,
          classId: matchingClass.id,
          className: matchingClass.name,
          classColor: matchingClass.color,
          color: ann.color || matchingClass.color,
        }
      }
      return ann
    })
  }

  useEffect(() => {
    const imageChanged = selectedImage !== prevImageRef.current

    if (imageChanged) {
      console.log("🔄 Image changed, resetting workspace state for:", selectedImage)
      prevImageRef.current = selectedImage
      hasLocalChangesRef.current = false
      startTimeRef.current = Date.now()

      setProcessingStatus(null)
      setRawServerLog(null)
      setShowRawLog(false)
      setSelectedPoints([])
      setPointProcessing({})
      setPointsMode(false)
      setSelectedPolygonId(null)
      setClickProcessing(false)
      setProcessingContext(null)
      setGeminiPrompt("")
      setIsSavingAnnotations(false)

      const enriched = enrichAnnotationsWithClasses(initialAnnotations ? JSON.parse(JSON.stringify(initialAnnotations)) : [])
      setPolygonData(enriched)
      prevInitialAnnotationsRef.current = initialAnnotations
    } else {
      const initialAnnotationsChanged = 
        JSON.stringify(initialAnnotations) !== JSON.stringify(prevInitialAnnotationsRef.current)
      
      if (initialAnnotationsChanged && !hasLocalChangesRef.current) {
        console.log("🔄 initialAnnotations changed, syncing...")
        const enriched = enrichAnnotationsWithClasses(initialAnnotations ? JSON.parse(JSON.stringify(initialAnnotations)) : [])
        setPolygonData(enriched)
        prevInitialAnnotationsRef.current = initialAnnotations
      }
    }
  }, [selectedImage, initialAnnotations, classes])

  const fetchAvailableModels = async () => {
    setIsLoadingModels(true)
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.MODELS_LIST + '/registry')
      if (response.ok) {
        const data = await response.json()
        const models = (data.success ? data.models : []) || []
        
        const uniqueModels = models.filter((model: { model_id: string }, index: number, self: Array<{ model_id: string }>) => 
          index === self.findIndex(m => m.model_id === model.model_id)
        )
        
        const sortedModels = [...uniqueModels].sort((a, b) => {
          const aScore = a.metrics?.map50 || a.metrics?.map50_95 || 0
          const bScore = b.metrics?.map50 || b.metrics?.map50_95 || 0
          return bScore - aScore
        })
        
        setAvailableModels(sortedModels)
        
        if (sortedModels.length > 0 && !selectedModelId) {
          setSelectedModelId(sortedModels[0].model_id)
        }
      }
    } catch (error) {
      console.error("Failed to fetch models:", error)
    } finally {
      setIsLoadingModels(false)
    }
  }

  useEffect(() => {
    fetchAvailableModels()
  }, [])

  const handleModelInference = async () => {
    if (!selectedModelId) {
      toast({
        variant: "destructive",
        title: "No model selected",
        description: "Please select a trained model first.",
      })
      return
    }

    setIsModelInferencing(true)
    setProcessingStatus("processing")
    setProcessingContext("hilips")

    toast({
      title: "Model Inference Started",
      description: `Running ${selectedModelId} on this image...`,
    })

    try {
      const response = await apiCall(
        `${API_CONFIG.ENDPOINTS.MODEL_INFERENCE}/${selectedModelId}/inference`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_id: selectedModelId,
            image_path: selectedImage,
            confidence: modelConfidence,
            save_labels: false,
          }),
        }
      )

      let responseData: any
      try {
        responseData = await response.json()
      } catch (parseError) {
        throw new Error(`Failed to parse response: ${response.status} ${response.statusText}`)
      }

      if (!response.ok) {
        let errorDetail = `Server error: ${response.status}`
        if (responseData) {
          if (typeof responseData.detail === 'string') {
            errorDetail = responseData.detail
          } else if (responseData.detail?.msg) {
            errorDetail = responseData.detail.msg
          } else if (responseData.message) {
            errorDetail = responseData.message
          } else if (responseData.detail) {
            errorDetail = JSON.stringify(responseData.detail)
          }
        }
        throw new Error(errorDetail)
      }

      const inferenceData = responseData.inference_data
      if (!inferenceData || !inferenceData.polygons) {
        toast({
          title: "No detections",
          description: "Model did not detect any objects in this image.",
        })
        setProcessingStatus("completed")
        return
      }

      const backendWidth = inferenceData.image?.width || imageSize.width
      const backendHeight = inferenceData.image?.height || imageSize.height

      if (backendWidth !== imageSize.width || backendHeight !== imageSize.height) {
        setImageSize({ width: backendWidth, height: backendHeight })
      }

      const convertedPolygons = inferenceData.polygons
        .map((detection: any, index: number) => {
          const points = detection.points || []
          
          if (points.length < 4) {
            return null
          }
          
          const xs: number[] = []
          const ys: number[] = []
          for (let i = 0; i < points.length; i += 2) {
            xs.push(points[i])
            ys.push(points[i + 1])
          }
          
          if (xs.length === 0 || ys.length === 0) {
            return null
          }
          
          const minX = Math.min(...xs)
          const minY = Math.min(...ys)
          const maxX = Math.max(...xs)
          const maxY = Math.max(...ys)
          const bbox = [minX, minY, maxX - minX, maxY - minY]

          let area = 0
          for (let i = 0; i < xs.length; i++) {
            const j = (i + 1) % xs.length
            area += xs[i] * ys[j] - xs[j] * ys[i]
          }
          area = Math.abs(area / 2)

          const matchingClass = classes.find(
            cls => cls.name.toLowerCase() === detection.label?.toLowerCase()
          )

          return {
            id: createPolygonId("yolo"),
            segmentation: points,
            area: area,
            bbox: bbox,
            predicted_iou: detection.confidence || 0,
            stability_score: detection.confidence || 0,
            confidence: detection.confidence || 0,
            point_coords: [],
            crop_box: [0, 0, backendWidth, backendHeight],
            label: detection.label || `Detection ${index + 1}`,
            source: "yolo",
            classId: matchingClass?.id,
            className: matchingClass?.name,
            classColor: matchingClass?.color,
            metadata: {
              model_id: selectedModelId,
              detection_id: detection.detection_id,
            },
          }
        })
        .filter(Boolean)

      hasLocalChangesRef.current = true
      setPolygonData(prev => prev ? [...prev, ...convertedPolygons] : convertedPolygons)
      setProcessingStatus("completed")

      const highConfCount = convertedPolygons.filter((p: any) => p.confidence >= 0.8).length
      const lowConfCount = convertedPolygons.length - highConfCount

      toast({
        title: "Model Inference Complete",
        description: `Detected ${convertedPolygons.length} objects (${highConfCount} high conf, ${lowConfCount} needs review)`,
      })
    } catch (error: any) {
      console.error("Model inference error:", error)
      setProcessingStatus("error")
      const errorMessage = error?.message || error?.detail || (typeof error === 'string' ? error : 'Unknown error occurred')
      toast({
        variant: "destructive",
        title: "Model Inference Failed",
        description: errorMessage,
      })
    } finally {
      setIsModelInferencing(false)
    }
  }

  const handleImageLoad = (naturalWidth?: number, naturalHeight?: number) => {
    if (naturalWidth && naturalHeight) {
      setImageSize({ width: naturalWidth, height: naturalHeight })
    } else if (imageRef.current) {
      setImageSize({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      })
    }
  }

  // Generate mock polygon data for testing
  const generateMockPolygonData = () => {
    const mockPolygons = []
    const numPolygons = Math.floor(Math.random() * 5) + 2
    for (let i = 0; i < numPolygons; i++) {
      const maskWidth = 100
      const maskHeight = 100
      const mask = Array(maskHeight)
        .fill(null)
        .map(() => Array(maskWidth).fill(false))
      const centerX = Math.floor(Math.random() * (maskWidth - 20)) + 10
      const centerY = Math.floor(Math.random() * (maskHeight - 20)) + 10
      const radius = Math.floor(Math.random() * 15) + 5
      for (let y = 0; y < maskHeight; y++) {
        for (let x = 0; x < maskWidth; x++) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
          if (distance < radius) {
            mask[y][x] = true
          }
        }
      }
      const area = mask.flat().filter(Boolean).length
      const bbox = [centerX - radius, centerY - radius, radius * 2, radius * 2]
      mockPolygons.push({
        id: createPolygonId("mock"),
        segmentation: mask,
        area: area,
        bbox: bbox,
        predicted_iou: Math.random() * 0.3 + 0.7,
        point_coords: [[centerX, centerY]],
        stability_score: Math.random() * 0.2 + 0.8,
        crop_box: [0, 0, imageSize.width, imageSize.height],
      })
    }
    return mockPolygons
  }

  // Persist image dimensions to localStorage for export usage
  useEffect(() => {
    if (!selectedImage || !imageSize.width || !imageSize.height) return
    try {
      const key = "ketilabel_image_meta"
      const raw = localStorage.getItem(key)
      const meta = raw ? JSON.parse(raw) : {}
      meta[selectedImage] = { width: imageSize.width, height: imageSize.height }
      localStorage.setItem(key, JSON.stringify(meta))
    } catch (e) {
      console.error("Failed to persist image meta:", e)
    }
  }, [selectedImage, imageSize.width, imageSize.height])

  const handleSamProcessing = async () => { // Renamed from handleSamV2Processing
    setIsProcessing(true)
    setProcessingStatus("processing")
    setRawServerLog(null)
    setProcessingContext("sam")

    toast({
      title: "Processing Started",
      description: "SAM2 AI is analyzing your image...",
    })

    try {
      const response = await apiCall(`${API_CONFIG.ENDPOINTS.GENERATE_POLYGONS}/${selectedImage}`, {
        method: "GET",
      })

      const responseData = await response.json()

      setRawServerLog({
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
        timestamp: new Date().toISOString(),
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`)
      }

      if (responseData && responseData.masks) {
        if (responseData.image_dimensions) {
          setImageSize({
            width: responseData.image_dimensions.width,
            height: responseData.image_dimensions.height,
          })
        }

        const convertedPolygons = responseData.masks.map((mask: any) => ({
          segmentation: mask.polygons && mask.polygons.length > 0 ? mask.polygons[0] : null, // use the first polygon
          area: mask.area,
          bbox: mask.bbox,
          predicted_iou: mask.predicted_iou,
          stability_score: mask.stability_score,
          point_coords: [],
          crop_box: [
            0,
            0,
            responseData.image_dimensions?.width || imageSize.width,
            responseData.image_dimensions?.height || imageSize.height,
          ],
          id: mask.id ?? createPolygonId("sam"),
        }))
        hasLocalChangesRef.current = true
        setPolygonData(convertedPolygons)

        toast({
          title: "Processing Complete",
          description: `Successfully detected ${convertedPolygons.length} objects`,
        })
      } else {
        const mockPolygonResults = generateMockPolygonData()
        hasLocalChangesRef.current = true
        setPolygonData(mockPolygonResults)

        toast({
          title: "Processing Complete",
          description: `Generated ${mockPolygonResults.length} mock polygons for demo`,
        })
      }

      setProcessingStatus("completed")
    } catch (error) {
      setProcessingStatus("error")
      console.error("Processing failed:", error)

      setRawServerLog({
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      })

      toast({
        variant: "destructive",
        title: "Processing Failed",
        description: (error as Error).message,
      })
    } finally {
      setIsProcessing(false)
      setProcessingContext((ctx) => (ctx === "sam" ? null : ctx))
    }
  }

  const handleClearResults = () => {
    setPolygonData(null)
    setProcessingStatus(null)
    setRawServerLog(null)
    setShowRawLog(false)
    setSelectedPoints([])
    setPointProcessing({})
    setPointsMode(false)
    setSelectedPolygonId(null) // Clear selected polygon
    persistAnnotations(null)
    onAnnotationsSave?.(selectedImage, [])

    toast({
      title: "Results Cleared",
      description: "All detection results have been cleared.",
    })
  }

  // Handle class assignment to polygons
  const handleClassAssign = (polygonId: string, classId: string) => {
    if (!polygonData || !polygonId) return

    const selectedClass = classes.find(cls => cls.id === classId)

    const updatedPolygons = polygonData.map((polygon, index) => {
      const polygonKey = getPolygonKey(polygon, index)
      if (polygonKey !== polygonId) {
        return polygon
      }

      return {
        ...polygon,
        id: polygon.id ?? polygonKey,
        classId: classId || undefined,
        className: selectedClass?.name || undefined,
        classColor: selectedClass?.color || undefined,
        color: selectedClass?.color || polygon.color, // Update polygon color to match class
      }
    })

    hasLocalChangesRef.current = true
    setPolygonData(updatedPolygons)

    persistAnnotations(updatedPolygons)

    if (selectedClass) {
      toast({
        title: "Class assigned",
        description: `Polygon assigned to class "${selectedClass.name}".`,
      })
    } else {
      toast({
        title: "Class removed",
        description: "Class assignment removed from polygon.",
      })
    }
  }

  const handleClassDelete = (classId: string) => {
    if (!classId) return

    setSelectedClassId((current) => (current === classId ? null : current))

    if (!polygonData || polygonData.length === 0) return

    let mutated = false
    const updatedPolygons = polygonData.map((polygon) => {
      if (polygon.classId !== classId) {
        return polygon
      }
      mutated = true
      const { classColor, className, ...rest } = polygon
      return {
        ...rest,
        classId: undefined,
        className: undefined,
        classColor: undefined,
      }
    })

    if (mutated) {
      hasLocalChangesRef.current = true
      setPolygonData(updatedPolygons)
      persistAnnotations(updatedPolygons)
    }
  }

  // Calculate polygon counts by class
  const getPolygonCounts = () => {
    const counts: Record<string, number> = {}
    if (polygonData) {
      polygonData.forEach(polygon => {
        if (polygon.classId) {
          counts[polygon.classId] = (counts[polygon.classId] || 0) + 1
        }
      })
    }
    return counts
  }

  const handlePolygonDelete = (polygonId: string) => {
    if (!polygonData || !polygonId) return

    let nextSelection: string | null | undefined = undefined

    const updatedPolygons = polygonData.filter((polygon, index) => {
      const key = getPolygonKey(polygon, index)
      if (key === polygonId) {
        return false
      }
      return true
    })

    if (updatedPolygons.length === polygonData.length) {
      return
    }

    if (updatedPolygons.length > 0) {
      nextSelection = getPolygonKey(updatedPolygons[0], 0)
    } else {
      nextSelection = null
    }

    hasLocalChangesRef.current = true
    setPolygonData(updatedPolygons)
    persistAnnotations(updatedPolygons)

    setSelectedPolygonId((current) => {
      if (current !== polygonId) return current
      return nextSelection ?? null
    })
  }

  const detectUserActions = (initial: any[], current: any[]) => {
    const actions: Array<{
      id: string
      user_action: "approved" | "modified" | "added" | "deleted"
      source: string
      class?: string
      confidence?: number
    }> = []

    const initialMap = new Map<string, any>()
    initial.forEach((p, i) => {
      const id = p.id || `polygon-${i}`
      initialMap.set(id, p)
    })

    const currentMap = new Map<string, any>()
    current.forEach((p, i) => {
      const id = p.id || `polygon-${i}`
      currentMap.set(id, p)
    })

    const mapSourceToMethod = (source?: string): string => {
      switch (source) {
        case "manual": return "manual"
        case "sam": return "sam_point"
        case "gemini": return "sam_llm"
        case "yolo": return "auto_model"
        default: return "manual"
      }
    }

    currentMap.forEach((polygon, polygonId) => {
      const initialPolygon = initialMap.get(polygonId)
      
      if (!initialPolygon) {
        actions.push({
          id: polygonId,
          user_action: "added",
          source: mapSourceToMethod(polygon.source),
          class: polygon.className,
          confidence: polygon.confidence || polygon.stability_score,
        })
      } else {
        const classChanged = initialPolygon.classId !== polygon.classId
        const segmentationChanged = JSON.stringify(initialPolygon.segmentation) !== JSON.stringify(polygon.segmentation)
        
        if (classChanged || segmentationChanged) {
          actions.push({
            id: polygonId,
            user_action: "modified",
            source: mapSourceToMethod(polygon.source),
            class: polygon.className,
            confidence: polygon.confidence || polygon.stability_score,
          })
        } else {
          actions.push({
            id: polygonId,
            user_action: "approved",
            source: mapSourceToMethod(polygon.source),
            class: polygon.className,
            confidence: polygon.confidence || polygon.stability_score,
          })
        }
      }
    })

    initialMap.forEach((polygon, polygonId) => {
      if (!currentMap.has(polygonId)) {
        actions.push({
          id: polygonId,
          user_action: "deleted",
          source: mapSourceToMethod(polygon.source),
          class: polygon.className,
          confidence: polygon.confidence || polygon.stability_score,
        })
      }
    })

    return actions
  }

  const formatSegmentation = (segmentation: any, bbox: number[] = []) => {
    if (!segmentation) return []

    if (
      Array.isArray(segmentation) &&
      segmentation.length > 0 &&
      Array.isArray(segmentation[0]) &&
      typeof segmentation[0][0] === "boolean"
    ) {
      const [x = 0, y = 0, width = bbox[2] ?? 0, height = bbox[3] ?? 0] = bbox.length === 4 ? bbox : [0, 0, 0, 0]
      if (width === 0 || height === 0) {
        return []
      }
      return [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ]
    }

    if (Array.isArray(segmentation) && typeof segmentation[0] === "number") {
      const pairs: number[][] = []
      for (let i = 0; i < segmentation.length; i += 2) {
        if (typeof segmentation[i] === "number" && typeof segmentation[i + 1] === "number") {
          pairs.push([segmentation[i], segmentation[i + 1]])
        }
      }
      return pairs
    }

    if (Array.isArray(segmentation) && Array.isArray(segmentation[0])) {
      return segmentation
    }

    return []
  }

  const handleSaveAnnotations = async () => {
    if (!polygonData || polygonData.length === 0) {
      toast({
        title: "No polygons to save",
        description: "Please create labeled polygons first.",
        variant: "destructive",
      })
      return
    }

    const formattedPolygons = polygonData.map((polygon, index) => {
      const polygonKey = getPolygonKey(polygon, index)
      const label = polygon.className || polygon.label || `polygon_${index + 1}`

      return {
        id: polygonKey,
        label,
        classId: polygon.classId,
        bbox: polygon.bbox ?? [],
        area: polygon.area ?? 0,
        predicted_iou: polygon.predicted_iou ?? null,
        stability_score: polygon.stability_score ?? null,
        confidence: polygon.confidence ?? null,
        segmentation: formatSegmentation(polygon.segmentation, polygon.bbox),
        color: polygon.color,
        source: polygon.source,
        metadata: polygon.metadata,
      }
    })

    const payload = {
      image: {
        file_name: selectedImage,
        width: imageSize.width,
        height: imageSize.height,
        url: selectedImage,
        path: `/images/${selectedImage}`,
      },
      polygons: formattedPolygons,
      metadata: {
        needs_review: false,
        reviewed_at: new Date().toISOString(),
      },
    }

    setIsSavingAnnotations(true)
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.CONVERT_TO_COCO, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const responseBody = await response.json().catch(() => null)

      if (!response.ok) {
        const errorMessage =
          responseBody?.message || responseBody?.detail || "Failed to save annotations."
        throw new Error(errorMessage)
      }

      const snapshot = polygonData ? polygonData.map((polygon) => ({ ...polygon })) : []
      onAnnotationsSave?.(selectedImage, snapshot)

      if (experimentId && currentIteration !== undefined) {
        const timeSeconds = startTimeRef.current 
          ? (Date.now() - startTimeRef.current) / 1000 
          : 0
        
        const userActions = detectUserActions(initialAnnotations, polygonData)
        
        const dominantMethod = (() => {
          const methods = userActions.map(a => a.source)
          const counts: Record<string, number> = {}
          methods.forEach(m => { counts[m] = (counts[m] || 0) + 1 })
          return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "manual"
        })()

        const experimentLogPayload = {
          session_id: sessionId,
          iteration: currentIteration,
          image_id: selectedImage,
          labeling_method: dominantMethod,
          time_seconds: timeSeconds,
          objects: userActions,
        }

        try {
          await apiCall(`${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${experimentId}/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(experimentLogPayload),
          })
        } catch (logError) {
          console.error("Experiment logging failed (non-blocking):", logError)
        }

        startTimeRef.current = Date.now()
      }

      toast({
        title: "Annotations saved",
        description: "Saved to server in COCO format.",
        duration: 3000,
      })
    } catch (error) {
      console.error("Save annotations error:", error)
      toast({
        title: "Save failed",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setIsSavingAnnotations(false)
    }
  }

  const generatePolygonFromPoint = async (x: number, y: number) => {
    console.log("🔄 Starting polygon generation from point:", { x, y })
    setClickProcessing(true)
    setProcessingContext("point")

    try {
      const pointData = {
        filename: selectedImage,
        points: [[x, y]],
        labels: [1],
        image_size: [imageSize.width, imageSize.height]
      }

      const apiUrl = API_CONFIG.ENDPOINTS.GENERATE_POLYGONS_WITH_POINTS
      console.log("🌐 API call:", { apiUrl, pointData })

      const response = await apiCallWithTimeout(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pointData),
      }, 90000)

      console.log("📡 API response status:", response.status, response.statusText)

      const responseData = await response.json()
      console.log("📄 API response data:", responseData)

      if (!response.ok) {
        console.error("❌ API error:", responseData)
        throw new Error(`Server error: ${response.status} ${response.statusText}`)
      }

      if (responseData && responseData.masks) {
        console.log("✅ Masks found:", responseData.masks.length)
        if (responseData.image_dimensions) {
          setImageSize({
            width: responseData.image_dimensions.width,
            height: responseData.image_dimensions.height,
          })
        }

        if (responseData.masks.length === 0) {
          console.log("⚠️ No masks returned from SAM2")
          setProcessingStatus("completed")
          toast({
            variant: "destructive",
            title: "No object detected",
            description: "SAM2 couldn't detect an object at that point. Try clicking directly on an object.",
          })
          return
        }

        const MIN_POLYGON_POINTS = 3
        const MIN_FLAT_COORDS = MIN_POLYGON_POINTS * 2

        const convertedPolygons = responseData.masks
          .map((mask: any) => {
            const firstPolygon = mask.polygons?.[0]
            
            if (!firstPolygon || firstPolygon.length < MIN_POLYGON_POINTS) {
              console.log("⚠️ Skipping mask with invalid segmentation:", mask.id)
              return null
            }

            const flatSegmentation: number[] = []
            for (const point of firstPolygon) {
              if (Array.isArray(point) && point.length >= 2) {
                flatSegmentation.push(point[0], point[1])
              }
            }

            if (flatSegmentation.length < MIN_FLAT_COORDS) {
              return null
            }

            return {
              segmentation: flatSegmentation,
              area: mask.area,
              bbox: mask.bbox,
              predicted_iou: mask.predicted_iou,
              stability_score: mask.stability_score,
              point_coords: [[x, y]],
              crop_box: [0, 0, imageSize.width, imageSize.height],
              id: mask.id ?? createPolygonId("point"),
              source: "sam",
            }
          })
          .filter(Boolean)

        if (convertedPolygons.length === 0) {
          console.log("⚠️ No valid polygons after conversion")
          setProcessingStatus("completed")
          toast({
            variant: "destructive",
            title: "No valid polygon",
            description: "SAM2 detected a region but couldn't create a valid polygon boundary.",
          })
          return
        }

        console.log("🔴 SAM2 convertedPolygons:", JSON.stringify(convertedPolygons, null, 2))
        hasLocalChangesRef.current = true
        setPolygonData((prev) => {
          const newData = prev ? [...prev, ...convertedPolygons] : convertedPolygons
          console.log("🔴 SAM2 polygonData after update:", newData.length, "polygons")
          return newData
        })
        setProcessingStatus("completed")

        toast({
          title: "Polygon Created",
          description: `Created ${convertedPolygons.length} polygon(s) from click`,
        })
      } else {
        console.log("⚠️ No masks in response")
        setProcessingStatus("completed")
        toast({
          variant: "destructive",
          title: "No result",
          description: "SAM2 returned no segmentation results. Try clicking on a different area.",
        })
      }
    } catch (error) {
      console.error("Point polygon generation error:", error)
      const errorMessage = error instanceof Error && error.name === 'AbortError' 
        ? "SAM processing timed out. The server may be busy. Please try again."
        : (error as Error).message
      toast({
        variant: "destructive",
        title: "Processing Failed",
        description: errorMessage,
      })
    } finally {
      setClickProcessing(false)
      setProcessingContext((ctx) => (ctx === "point" ? null : ctx))
    }
  }

  const handleImageClick = async (event: React.MouseEvent<HTMLImageElement>) => {
    console.log("🖱️ Image clicked!")

    if (clickProcessing || isProcessing) {
      console.log("⏳ Already processing, ignoring click")
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    // Calculate real coordinates based on image scaling
    const scaleX = imageSize.width / rect.width
    const scaleY = imageSize.height / rect.height
    const realX = Math.round(x * scaleX)
    const realY = Math.round(y * scaleY)

    console.log("📍 Click coordinates:", {
      clientX: event.clientX,
      clientY: event.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      imageSize,
      scaleX,
      scaleY,
      clickX: x,
      clickY: y,
      realX,
      realY
    })

    await generatePolygonFromPoint(realX, realY)
  }

  const handleGeminiProcessing = async () => { // Renamed from handleGeminiSegmentation
    const prompt = geminiPrompt.trim()

    if (!prompt) {
      toast({
        variant: "destructive",
        title: "Prompt required",
        description: "Describe what you want Gemini to segment before running it.",
      })
      return
    }

    setIsProcessing(true)
    setProcessingStatus("processing")
    setProcessingContext("gemini")
    setRawServerLog(null)

    toast({
      title: "Gemini segmentation started",
      description: "Gemini is analyzing the image with your prompt.",
    })

    try {
      const { model, temperature, resizeWidth } = GEMINI_SEGMENTATION_DEFAULTS

      const payload = {
        filename: selectedImage,
        target: prompt,
        model,
        temperature,
        resize_width: resizeWidth,
        image_size: [imageSize.width, imageSize.height],
      }

      const response = await apiCall(API_CONFIG.ENDPOINTS.GEMINI_SEGMENTATION, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      let responseData: any = null
      try {
        responseData = await response.json()
      } catch (parseError) {
        throw new Error("Unable to parse response from Gemini segmentation API.")
      }

      setRawServerLog({
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
        timestamp: new Date().toISOString(),
      })

      if (!response.ok) {
        const errorMessage =
          responseData?.message ||
          responseData?.detail ||
          responseData?.error ||
          `Server error: ${response.status} ${response.statusText}`
        throw new Error(errorMessage)
      }

      const masks = Array.isArray(responseData?.masks)
        ? responseData.masks
        : Array.isArray(responseData?.data?.masks)
          ? responseData.data.masks
          : Array.isArray(responseData?.polygons)
            ? responseData.polygons
            : Array.isArray(responseData?.data?.polygons)
              ? responseData.data.polygons
              : []

      if (masks.length === 0) {
        throw new Error("No segmentation results returned from Gemini.")
      }

      const imageDimensions =
        responseData?.image_dimensions || responseData?.data?.image_dimensions || null

      if (imageDimensions) {
        setImageSize({
          width: imageDimensions.width,
          height: imageDimensions.height,
        })
      }

      const baseWidth = imageDimensions?.width ?? imageSize.width
      const baseHeight = imageDimensions?.height ?? imageSize.height
      const timestamp = Date.now()

      const convertedPolygons = masks
        .map((mask: any, index: number) => {
          const segmentation =
            (mask.polygons && mask.polygons.length > 0 && mask.polygons[0]) ||
            mask.polygon ||
            mask.segmentation ||
            mask.coordinates ||
            mask.points ||
            null

          if (!segmentation) {
            return null
          }

          return {
            id: mask.id ?? createPolygonId("gemini"),
            segmentation,
            area: mask.area ?? mask.pixel_count ?? 0,
            bbox: mask.bbox ?? mask.bounding_box ?? [],
            predicted_iou: mask.predicted_iou ?? mask.score ?? 0,
            stability_score: mask.stability_score ?? mask.confidence ?? 0,
            point_coords: mask.point_coords ?? [],
            crop_box: [0, 0, baseWidth, baseHeight],
            label: mask.label ?? mask.caption ?? mask.target ?? undefined,
            source: "gemini",
            color: mask.color,
            metadata: mask.metadata ?? undefined,
          }
        })
        .filter(Boolean)

      if (convertedPolygons.length === 0) {
        throw new Error("Gemini did not return polygon coordinates that can be rendered.")
      }

      hasLocalChangesRef.current = true
      setPolygonData((prev) => {
        const existing = prev ?? []
        const merged = [...existing, ...(convertedPolygons as any[])]

        try {
          const annotationsRaw = localStorage.getItem("ketilabel_annotations")
          const allAnnotations = annotationsRaw ? JSON.parse(annotationsRaw) : {}
          allAnnotations[selectedImage] = merged
          localStorage.setItem("ketilabel_annotations", JSON.stringify(allAnnotations))
        } catch (storageError) {
          console.error("Failed to persist Gemini annotations:", storageError)
        }

        return merged
      })

      setProcessingStatus("completed")

      toast({
        title: "Gemini segmentation complete",
        description: `Added ${convertedPolygons.length} polygon(s) using "${prompt}".`,
      })
    } catch (error) {
      console.error("Gemini segmentation error:", error)
      setProcessingStatus("error")
      toast({
        variant: "destructive",
        title: "Gemini segmentation failed",
        description: (error as Error).message,
      })
    } finally {
      setIsProcessing(false)
      setProcessingContext((ctx) => (ctx === "gemini" ? null : ctx))
    }
  }

  const handlePointsModeToggle = () => {
    if (pointsMode && selectedPoints.length > 0) {
      const shouldClear = window.confirm(
        `You have ${selectedPoints.length} selected points. Do you want to clear them when exiting Points Mode?`,
      )
      if (shouldClear) {
        setSelectedPoints([])
        setPointProcessing({})
      }
    }
    setPointsMode(!pointsMode)
  }

  const getStatusBadge = () => {
    switch (processingStatus) {
      case "processing": {
        const processingLabel = processingContext === "gemini"
          ? "Processing with Gemini..."
          : processingContext === "point"
            ? "Processing selected points..."
            : processingContext === "hilips"
              ? "Running YOLO inference..."
              : "Processing with SAM v2..."
        return (
          <Badge variant="secondary" className="animate-pulse">
            <div className="mr-2 h-2 w-2 rounded-full bg-yellow-500" />
            {processingLabel}
          </Badge>
        )
      }
      case "completed":
        return (
          <Badge variant="default">
            <div className="mr-2 h-2 w-2 rounded-full bg-green-500" />
            Processing completed! {polygonData ? polygonData.length : 0} polygons detected
          </Badge>
        )
      case "error":
        return (
          <Badge variant="destructive">
            <div className="mr-2 h-2 w-2 rounded-full bg-red-500" />
            Processing failed
          </Badge>
        )
      default:
        return null
    }
  }

  // Keyboard shortcuts removed

  const activeProcessingContext = clickProcessing ? "point" : processingContext
  const visualizationProcessingMessage = activeProcessingContext === "point"
    ? "Creating polygon from point"
    : activeProcessingContext === "gemini"
      ? "Processing with Gemini"
      : activeProcessingContext === "hilips"
        ? "Running YOLO Model"
        : "Processing with SAM v2"
  const visualizationProcessingDescription = activeProcessingContext === "point"
    ? "AI is creating polygon from your clicked point..."
    : activeProcessingContext === "gemini"
      ? "Gemini is applying your prompt to segment the image..."
      : activeProcessingContext === "hilips"
        ? "Trained YOLO model is detecting objects..."
        : "AI is analyzing your image to detect objects..."
  const isGeminiProcessing = processingContext === "gemini" && isProcessing
  const isGeminiDisabled = isProcessing || clickProcessing || geminiPrompt.trim().length === 0
  const resolvedSelectedPolygon = useMemo(() => {
    if (!selectedPolygonId || !polygonData) return null
    return polygonData.find((polygon, index) => getPolygonKey(polygon, index) === selectedPolygonId) ?? null
  }, [selectedPolygonId, polygonData])

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 flex-none z-50">
        <div className="h-full px-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-semibold">Image Labeling</h1>
              <span className="text-muted-foreground">/</span>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{selectedImage}</p>
              {hasExistingAnnotations && (
                <Badge variant="secondary" className="ml-2 bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Saved
                </Badge>
              )}
              <div className="flex items-center ml-4 space-x-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  title="Previous Image"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onNext}
                  disabled={!hasNext}
                  title="Next Image"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {getStatusBadge()}
            <Button
              size="sm"
              variant="default"
              onClick={handleSaveAnnotations}
              disabled={!polygonData || polygonData.length === 0 || isSavingAnnotations}
              className="gap-1"
            >
              {isSavingAnnotations ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleDarkMode}>
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar (Classes) */}
        <aside
          className={`
            bg-card border-r transition-all duration-300 ease-in-out flex flex-col
            ${isLeftSidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full opacity-0 overflow-hidden'}
          `}
        >
          <div className="p-4 font-medium text-sm border-b flex items-center justify-between">
            <span>Classes</span>
            <Badge variant="secondary" className="text-xs">{classes.length}</Badge>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <ClassManager
              classes={classes}
              onClassesChange={setClasses}
              selectedClassId={selectedClassId}
              onClassSelect={(classId) => {
                setSelectedClassId(classId)
                // If a polygon is selected, assign this class to it immediately
                if (selectedPolygonId && classId) {
                  handleClassAssign(selectedPolygonId, classId)
                }
              }}
              onClassDelete={handleClassDelete}
              polygonCounts={getPolygonCounts()}
            />
          </div>
        </aside>

        {/* Center Canvas Area */}
        <main className="flex-1 relative bg-accent/5 overflow-hidden flex flex-col">
          <div className="flex-1 relative">
            <AdvancedPolygonVisualization
              imageUrl={`/images/${selectedImage}`}
              polygonData={polygonData || []}
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
              uploadedClasses={uploadedClasses}
              isDarkMode={isDarkMode}
              isProcessing={isProcessing || clickProcessing}
              processingMessage={visualizationProcessingMessage}
              processingDescription={visualizationProcessingDescription}
              onImageLoad={handleImageLoad}
              onPointClick={isManualDrawing ? undefined : generatePolygonFromPoint}
              selectedPolygonId={selectedPolygonId}
              onSelectPolygon={setSelectedPolygonId}
              onPolygonUpdate={(updatedPolygons) => {
                hasLocalChangesRef.current = true
                setPolygonData(updatedPolygons)
              }}
              classes={classes}
              selectedClassId={selectedClassId}
              onClassAssign={handleClassAssign}
              // Controlled State
              zoom={zoom}
              onZoomChange={setZoom}
              pan={pan}
              onPanChange={setPan}
              interactionMode={interactionMode}
              onInteractionModeChange={setInteractionMode}
              // Manual Drawing
              isManualDrawing={isManualDrawing}
              drawingPoints={drawingPoints}
              onDrawingPointAdd={(point) => {
                setDrawingPoints(prev => [...prev, point])
              }}
              className="h-full"
            />
          </div>

          {/* Floating Toolbar */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-background/80 backdrop-blur-md border shadow-lg rounded-full px-4 py-2 flex items-center space-x-2 z-40">
            {/* Left Sidebar Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)}
              title={isLeftSidebarOpen ? "Close Left Sidebar" : "Open Left Sidebar"}
            >
              <PanelLeft className={`h-4 w-4 ${isLeftSidebarOpen ? 'text-primary' : 'text-muted-foreground'}`} />
            </Button>

            <div className="w-px h-4 bg-border mx-2" />

            {/* Tools */}
            <Button
              variant={interactionMode === 'select' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setInteractionMode('select')}
              title="Select Tool (V)"
            >
              <MousePointer2 className="h-4 w-4" />
            </Button>
            <Button
              variant={interactionMode === 'pan' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setInteractionMode('pan')}
              title="Pan Tool (H)"
            >
              <Hand className="h-4 w-4" />
            </Button>
            <Button
              variant={interactionMode === 'point' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setInteractionMode('point')}
              title="Point Tool (P)"
            >
              <Target className="h-4 w-4" />
            </Button>

            <div className="w-px h-4 bg-border mx-2" />

            {/* Zoom */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setZoom(z => Math.min(5, z * 1.2))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => {
                setZoom(1)
                setPan({ x: 0, y: 0 })
              }}
              title="Reset View"
            >
              <RotateCcw className="h-3 w-3" />
            </Button>

            <div className="w-px h-4 bg-border mx-2" />

            {/* Right Sidebar Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
              title={isRightSidebarOpen ? "Close Right Sidebar" : "Open Right Sidebar"}
            >
              <PanelRight className={`h-4 w-4 ${isRightSidebarOpen ? 'text-primary' : 'text-muted-foreground'}`} />
            </Button>
          </div>
        </main>

        {/* Right Sidebar (AI Tools & Results & Polygon List) */}
        <aside
          className={`
            bg-card border-l transition-all duration-300 ease-in-out flex flex-col
            ${isRightSidebarOpen ? 'w-80 translate-x-0' : 'w-0 translate-x-full opacity-0 overflow-hidden'}
          `}
        >
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* AI Tools Section */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center">
                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                AI Tools
              </h3>

              {isTestSetImage && (
                <div className="p-2 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md">
                  <div className="flex items-start gap-2 text-xs text-purple-900 dark:text-purple-100">
                    <span className="text-purple-600 font-bold">GT</span>
                    <p>Ground Truth image. Use Manual or SAM Point only.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Card
                  className={`cursor-pointer transition-all hover:border-primary ${processingContext === 'manual' ? 'border-primary bg-primary/5' : ''}`}
                  onClick={() => {
                    setProcessingContext('manual')
                    setIsManualDrawing(false)
                    setDrawingPoints([])
                  }}
                >
                  <CardContent className="p-3 flex flex-col items-center text-center space-y-2">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Target className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-xs">Manual</div>
                      <div className="text-[10px] text-muted-foreground">Draw Polygon</div>
                    </div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer transition-all hover:border-primary ${processingContext === 'sam' ? 'border-primary bg-primary/5' : ''}`}
                  onClick={() => {
                    setProcessingContext('sam')
                    setInteractionMode('point')
                  }}
                >
                  <CardContent className="p-3 flex flex-col items-center text-center space-y-2">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <MousePointer2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-xs">SAM v2</div>
                      <div className="text-[10px] text-muted-foreground">Click & Segment</div>
                    </div>
                  </CardContent>
                </Card>

                <Card
                  className={`transition-all ${isTestSetImage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'} ${processingContext === 'gemini' ? 'border-primary bg-primary/5' : ''}`}
                  onClick={() => !isTestSetImage && setProcessingContext('gemini')}
                >
                  <CardContent className="p-3 flex flex-col items-center text-center space-y-2">
                    <div className={`p-2 rounded-full ${isTestSetImage ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-xs">SAM + LLM</div>
                      <div className="text-[10px] text-muted-foreground">{isTestSetImage ? 'Disabled for GT' : 'Text to Mask'}</div>
                    </div>
                  </CardContent>
                </Card>

                {currentPhase >= 2 && availableModels.length > 0 && (
                  <Card
                    className={`cursor-pointer transition-all hover:border-primary ${processingContext === 'hilips' ? 'border-primary bg-primary/5' : ''}`}
                    onClick={() => setProcessingContext('hilips')}
                  >
                    <CardContent className="p-3 flex flex-col items-center text-center space-y-2">
                      <div className="p-2 rounded-full bg-primary/10 text-primary">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-medium text-xs">YOLO Model</div>
                        <div className="text-[10px] text-muted-foreground">Auto-label</div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {processingContext === 'manual' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs">Manual Polygon Drawing</Label>
                  {!isManualDrawing ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setIsManualDrawing(true)
                        setDrawingPoints([])
                        setInteractionMode('point')
                        toast({
                          title: "Drawing mode activated",
                          description: "Click on the image to add points. Double-click or press Enter to complete.",
                        })
                      }}
                      className="w-full h-8"
                    >
                      Start Drawing
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Points: {drawingPoints.length} {drawingPoints.length >= 3 ? '(min 3 required)' : ''}
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (drawingPoints.length < 3) {
                              toast({
                                variant: "destructive",
                                title: "Need more points",
                                description: "Please add at least 3 points to create a polygon.",
                              })
                              return
                            }
                            // Create polygon from points
                            const flatCoords: number[] = []
                            drawingPoints.forEach(p => {
                              flatCoords.push(p.x, p.y)
                            })

                            // Calculate bounding box
                            const xs = drawingPoints.map(p => p.x)
                            const ys = drawingPoints.map(p => p.y)
                            const minX = Math.min(...xs)
                            const minY = Math.min(...ys)
                            const maxX = Math.max(...xs)
                            const maxY = Math.max(...ys)
                            const bbox = [minX, minY, maxX - minX, maxY - minY]

                            // Calculate area (simple polygon area formula)
                            let area = 0
                            for (let i = 0; i < drawingPoints.length; i++) {
                              const j = (i + 1) % drawingPoints.length
                              area += drawingPoints[i].x * drawingPoints[j].y
                              area -= drawingPoints[j].x * drawingPoints[i].y
                            }
                            area = Math.abs(area / 2)

                            const newPolygon = {
                              id: createPolygonId('manual'),
                              segmentation: flatCoords,
                              area: area,
                              bbox: bbox,
                              predicted_iou: 1.0,
                              stability_score: 1.0,
                              point_coords: [],
                              crop_box: [0, 0, imageSize.width, imageSize.height],
                              label: `Manual ${(polygonData?.length || 0) + 1}`,
                              source: 'manual',
                            }

                            hasLocalChangesRef.current = true
                            setPolygonData(prev => prev ? [...prev, newPolygon] : [newPolygon])
                            setIsManualDrawing(false)
                            setDrawingPoints([])

                            toast({
                              title: "Polygon created",
                              description: `Created manual polygon with ${drawingPoints.length} points.`,
                            })
                          }}
                          disabled={drawingPoints.length < 3}
                          className="flex-1 h-8"
                        >
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIsManualDrawing(false)
                            setDrawingPoints([])
                            toast({
                              title: "Drawing cancelled",
                              description: "Manual drawing has been cancelled.",
                            })
                          }}
                          className="flex-1 h-8"
                        >
                          Cancel
                        </Button>
                      </div>
                      {drawingPoints.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDrawingPoints(prev => prev.slice(0, -1))
                          }}
                          className="w-full h-7 text-xs"
                        >
                          Undo Last Point
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {processingContext === 'gemini' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label htmlFor="gemini-prompt" className="text-xs">Describe object to segment</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="gemini-prompt"
                      placeholder="e.g., 'red car', 'person in blue'"
                      value={geminiPrompt}
                      onChange={(e) => setGeminiPrompt(e.target.value)}
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isGeminiDisabled) {
                          handleGeminiProcessing()
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={handleGeminiProcessing}
                      disabled={isGeminiDisabled}
                      className="h-8 px-3"
                    >
                      Go
                    </Button>
                  </div>
                </div>
              )}

              {processingContext === 'hilips' && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Select Trained Model</Label>
                    {isLoadingModels ? (
                      <div className="flex items-center justify-center py-2">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        <span className="text-xs text-muted-foreground">Loading models...</span>
                      </div>
                    ) : availableModels.length === 0 ? (
                      <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded border border-dashed">
                        No trained models available. Train a model first in the Training page.
                      </div>
                    ) : (
                      <Select
                        value={selectedModelId || ""}
                        onValueChange={setSelectedModelId}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          {selectedModelId ? (
                            <div className="flex items-center gap-2">
                              <span>{selectedModelId}</span>
                              {availableModels.findIndex(m => m.model_id === selectedModelId) === 0 && (
                                <Badge className="bg-green-500 text-white text-[9px] px-1 py-0">
                                  Best
                                </Badge>
                              )}
                              {availableModels.find(m => m.model_id === selectedModelId)?.metrics?.map50 && (
                                <Badge variant="outline" className="text-[10px]">
                                  {(availableModels.find(m => m.model_id === selectedModelId)!.metrics!.map50 * 100).toFixed(1)}%
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <SelectValue placeholder="Select a model" />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map((model, idx) => (
                            <SelectItem key={model.model_id} value={model.model_id} className="py-2">
                              <div className="flex items-center gap-2">
                                <span>{model.model_id}</span>
                                {idx === 0 && (
                                  <Badge className="bg-green-500 text-white text-[9px] px-1 py-0">
                                    Best
                                  </Badge>
                                )}
                                {model.metrics?.map50 && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {(model.metrics.map50 * 100).toFixed(1)}%
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Confidence Threshold</Label>
                      <span className="text-xs font-mono text-muted-foreground">{(modelConfidence * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[modelConfidence]}
                      onValueChange={([val]) => setModelConfidence(val)}
                      min={0.1}
                      max={0.95}
                      step={0.05}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>More detections</span>
                      <span>Higher precision</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    onClick={handleModelInference}
                    disabled={!selectedModelId || isModelInferencing || isProcessing}
                    className="w-full h-8 gap-2"
                  >
                    {isModelInferencing ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Running Inference...
                      </>
                    ) : (
                      <>
                        <Bot className="h-3 w-3" />
                        Auto-Label with Model
                      </>
                    )}
                  </Button>

                  {selectedModelId && (
                    <div className="text-[10px] text-muted-foreground bg-muted/20 p-2 rounded">
                      <strong>Tip:</strong> Objects with confidence ≥80% will be auto-labeled. 
                      Lower confidence detections can be reviewed and corrected.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Selected Polygon Details */}
            {selectedPolygonId && (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm flex items-center text-primary">
                  <Target className="mr-2 h-4 w-4" />
                  Selected Polygon
                </h3>

                {resolvedSelectedPolygon ? (
                  <div className="bg-accent/30 p-3 rounded-md space-y-3 border">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Assigned Class</Label>
                      <Select
                        value={resolvedSelectedPolygon.classId || "unlabeled"}
                        onValueChange={(value) => {
                          if (!selectedPolygonId) return
                          if (value === "unlabeled") {
                            handleClassAssign(selectedPolygonId, "")
                          } else {
                            handleClassAssign(selectedPolygonId, value)
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-background">
                          <SelectValue placeholder="Select class" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unlabeled">
                            <span className="text-muted-foreground">Unlabeled</span>
                          </SelectItem>
                          {classes.map(cls => (
                            <SelectItem key={cls.id} value={cls.id}>
                              <div className="flex items-center">
                                <div
                                  className="w-2 h-2 rounded-full mr-2"
                                  style={{ backgroundColor: cls.color }}
                                />
                                {cls.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                      <div className="bg-background/50 p-1.5 rounded border">
                        <span className="block opacity-70">Confidence</span>
                        <span className="font-mono font-medium text-foreground">
                          {Math.round((resolvedSelectedPolygon.stability_score || 0) * 100)}%
                        </span>
                      </div>
                      <div className="bg-background/50 p-1.5 rounded border">
                        <span className="block opacity-70">Area</span>
                        <span className="font-mono font-medium text-foreground">
                          {Math.round(resolvedSelectedPolygon.area || 0).toLocaleString()} px²
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        if (!selectedPolygonId) return
                        const confirmed = window.confirm("Delete the selected polygon?")
                        if (confirmed) {
                          handlePolygonDelete(selectedPolygonId)
                        }
                      }}
                    >
                      <Trash2 className="mr-2 h-3 w-3" />
                      Delete Polygon
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-md border border-dashed">
                    Selected polygon information not found. Please reselect from the list or refresh.
                  </div>
                )}
              </div>
            )}

            <div className="h-px bg-border" />

            {/* Polygon List Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center">
                  <Layers className="mr-2 h-4 w-4 text-primary" />
                  Polygons ({polygonData ? polygonData.length : 0})
                </h3>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {polygonData && polygonData.length > 0 ? (
                  polygonData.map((polygon, index) => {
                    const polygonKey = getPolygonKey(polygon, index)
                    const isSelected = selectedPolygonId === polygonKey
                    const confidence = polygon.confidence || polygon.stability_score || 0
                    const needsReview = polygon.source === 'yolo' && confidence < 0.8 && !polygon.classId

                    return (
                      <div
                        key={polygonKey}
                        className={`
                          flex items-center justify-between p-2 rounded-md border text-xs cursor-pointer transition-colors
                          ${isSelected ? 'bg-primary/10 border-primary' : needsReview ? 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-700' : 'bg-card hover:bg-accent/50'}
                        `}
                        onClick={() => setSelectedPolygonId(polygonKey)}
                      >
                        <div className="flex items-center space-x-2 overflow-hidden">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: polygon.color || '#ccc' }}
                          />
                          <span className="truncate font-medium">
                            {polygon.label || `Polygon ${index + 1}`}
                          </span>
                          {needsReview && (
                            <Badge className="bg-amber-500 text-white text-[9px] px-1 py-0 flex-shrink-0">
                              Review
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                          {polygon.source === 'yolo' && (
                            <span className="text-[9px] text-muted-foreground">
                              {(confidence * 100).toFixed(0)}%
                            </span>
                          )}
                          {polygon.className && (
                            <Badge variant="outline" className="text-[10px] h-5 px-1 flex-shrink-0">
                              {polygon.className}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation()
                              const confirmed = window.confirm("Delete this polygon?")
                              if (confirmed) {
                                handlePolygonDelete(polygonKey)
                              }
                            }}
                            title="Delete polygon"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-8 border rounded-md border-dashed">
                    No polygons detected yet.
                    <br />
                    Use AI tools to start labeling.
                  </div>
                )}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Results Summary */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Summary</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-muted/30 p-2 rounded-md text-center">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-bold">{polygonData ? polygonData.length : 0}</div>
                </div>
                <div className="bg-green-100 dark:bg-green-950/30 p-2 rounded-md text-center">
                  <div className="text-xs text-muted-foreground">Labeled</div>
                  <div className="text-lg font-bold text-green-600">
                    {polygonData ? polygonData.filter(p => p.classId).length : 0}
                  </div>
                </div>
                <div className="bg-amber-100 dark:bg-amber-950/30 p-2 rounded-md text-center">
                  <div className="text-xs text-muted-foreground">Review</div>
                  <div className="text-lg font-bold text-amber-600">
                    {polygonData ? polygonData.filter(p => p.source === 'yolo' && (p.confidence || p.stability_score || 0) < 0.8 && !p.classId).length : 0}
                  </div>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleClearResults}
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Clear All Results
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
