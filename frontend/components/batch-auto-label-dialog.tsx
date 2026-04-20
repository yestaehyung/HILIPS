"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Bot, Loader2, CheckCircle, AlertCircle, XCircle } from "lucide-react"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"

interface BatchAutoLabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unlabeledCount: number
  unlabeledImages: string[]
  onComplete: () => void
}

interface BatchResult {
  success: boolean
  model_id: string
  total_processed: number
  auto_labeled: number
  needs_review: number
  errors: number
  results: Array<{
    image: string
    success: boolean
    detections?: number
    auto_labeled?: boolean
    needs_review?: boolean
    error?: string
  }>
}

interface ModelInfo {
  model_id: string
  metrics?: {
    map50?: number
    map50_95?: number
  }
}

type DialogState = "configure" | "processing" | "results"

export default function BatchAutoLabelDialog({
  open,
  onOpenChange,
  unlabeledCount,
  unlabeledImages,
  onComplete,
}: BatchAutoLabelDialogProps) {
  const [dialogState, setDialogState] = useState<DialogState>("configure")
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [confidence, setConfidence] = useState(0.5)
  const [autoLabelThreshold, setAutoLabelThreshold] = useState(0.8)
  const [imageCount, setImageCount] = useState(50)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      fetchAvailableModels()
      setDialogState("configure")
      setBatchResult(null)
      setProgress(0)
      setImageCount(Math.min(50, unlabeledCount))
    }
  }, [open, unlabeledCount])

  const fetchAvailableModels = async () => {
    setIsLoadingModels(true)
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.MODELS_LIST + '/registry')
      if (response.ok) {
        const data = await response.json()
        const models = (data.success ? data.models : []) || []
        
        const uniqueModels = models.filter(
          (model: ModelInfo, index: number, self: ModelInfo[]) =>
            index === self.findIndex((m) => m.model_id === model.model_id)
        )
        
        const sortedModels = [...uniqueModels].sort((a: ModelInfo, b: ModelInfo) => {
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
      toast({
        variant: "destructive",
        title: "Failed to load models",
        description: "Could not fetch available models.",
      })
    } finally {
      setIsLoadingModels(false)
    }
  }

  const handleStartBatchLabeling = async () => {
    if (!selectedModelId) {
      toast({
        variant: "destructive",
        title: "No model selected",
        description: "Please select a trained model first.",
      })
      return
    }

    setIsProcessing(true)
    setDialogState("processing")
    setProgress(10)

    try {
      const imagesToProcess = unlabeledImages.slice(0, imageCount)
      
      const response = await apiCall(
        `${API_CONFIG.ENDPOINTS.BATCH_INFERENCE}/${selectedModelId}/batch-inference`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_paths: imagesToProcess,
            process_unlabeled: false,
            confidence: confidence,
            auto_label_threshold: autoLabelThreshold,
            save_annotations: true,
          }),
        }
      )

      setProgress(50)

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.detail || `Server error: ${response.status}`)
      }

      const result: BatchResult = await response.json()
      setProgress(100)
      setBatchResult(result)
      setDialogState("results")

      toast({
        title: "Batch labeling complete",
        description: `Processed ${result.total_processed} images. ${result.auto_labeled} auto-labeled, ${result.needs_review} need review.`,
      })

      onComplete()
    } catch (error: any) {
      console.error("Batch labeling error:", error)
      toast({
        variant: "destructive",
        title: "Batch labeling failed",
        description: error?.message || "An unexpected error occurred.",
      })
      setDialogState("configure")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      onOpenChange(false)
    }
  }

  const renderConfigureState = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Select Trained Model</Label>
        {isLoadingModels ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">Loading models...</span>
          </div>
        ) : availableModels.length === 0 ? (
          <div className="text-sm text-muted-foreground bg-muted/30 p-4 rounded-md border border-dashed">
            No trained models available. Please train a model first in the Training page.
          </div>
        ) : (
          <Select value={selectedModelId || ""} onValueChange={setSelectedModelId}>
            <SelectTrigger className="w-full">
              {selectedModelId ? (
                <div className="flex items-center gap-2">
                  <span>{selectedModelId}</span>
                  {availableModels.findIndex((m) => m.model_id === selectedModelId) === 0 && (
                    <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0">Best</Badge>
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
                      <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0">Best</Badge>
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Detection Confidence</Label>
          <span className="text-sm font-mono text-muted-foreground">{(confidence * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[confidence]}
          onValueChange={([val]) => setConfidence(val)}
          min={0.1}
          max={0.9}
          step={0.05}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Minimum confidence for object detection
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Auto-Label Threshold</Label>
          <span className="text-sm font-mono text-muted-foreground">{(autoLabelThreshold * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[autoLabelThreshold]}
          onValueChange={([val]) => setAutoLabelThreshold(val)}
          min={0.5}
          max={0.95}
          step={0.05}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Detections above this threshold are auto-labeled. Below are marked for review.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Images to Process</Label>
          <span className="text-sm font-mono text-muted-foreground">
            {imageCount === unlabeledCount ? "All" : imageCount} / {unlabeledCount}
          </span>
        </div>
        <Slider
          value={[imageCount]}
          onValueChange={([val]) => setImageCount(val)}
          min={Math.min(25, unlabeledCount)}
          max={unlabeledCount}
          step={25}
          className="w-full"
        />
        <div className="flex gap-2">
          {[25, 50, 100].filter(n => n <= unlabeledCount).map((preset) => (
            <Button
              key={preset}
              variant={imageCount === preset ? "secondary" : "outline"}
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={() => setImageCount(preset)}
            >
              {preset}
            </Button>
          ))}
          <Button
            variant={imageCount === unlabeledCount ? "secondary" : "outline"}
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => setImageCount(unlabeledCount)}
          >
            All
          </Button>
        </div>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Ready to process {imageCount === unlabeledCount ? "all " : ""}{imageCount} image{imageCount !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                This will run YOLO inference and save annotations automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          onClick={handleStartBatchLabeling}
          disabled={!selectedModelId || unlabeledCount === 0 || isLoadingModels}
          className="gap-2"
        >
          <Bot className="h-4 w-4" />
          Start Auto-Labeling
        </Button>
      </div>
    </div>
  )

  const renderProcessingState = () => (
    <div className="space-y-6 py-4">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="relative">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Processing Images...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Running YOLO inference on {imageCount} images
          </p>
        </div>
      </div>
      
      <div className="space-y-2">
        <Progress value={progress} className="h-2" />
        <p className="text-xs text-center text-muted-foreground">
          {progress < 50 ? "Initializing model..." : "Processing images..."}
        </p>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Please wait, this may take a few minutes depending on the number of images.
      </p>
    </div>
  )

  const renderResultsState = () => {
    if (!batchResult) return null

    const successResults = batchResult.results.filter((r) => r.success)
    const errorResults = batchResult.results.filter((r) => !r.success)

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{batchResult.total_processed}</p>
              <p className="text-xs text-muted-foreground">Processed</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{batchResult.auto_labeled}</p>
              <p className="text-xs text-muted-foreground">Auto-Labeled</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{batchResult.needs_review}</p>
              <p className="text-xs text-muted-foreground">Needs Review</p>
            </CardContent>
          </Card>
          <Card className={batchResult.errors > 0 ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900" : ""}>
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${batchResult.errors > 0 ? "text-red-600" : ""}`}>
                {batchResult.errors}
              </p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </CardContent>
          </Card>
        </div>

        {batchResult.auto_labeled > 0 && (
          <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {batchResult.auto_labeled} images auto-labeled successfully
                </p>
                <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                  High-confidence detections have been automatically saved.
                </p>
              </div>
            </div>
          </div>
        )}

        {batchResult.needs_review > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {batchResult.needs_review} images need manual review
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Use the "Needs Review" filter to find these images.
                </p>
              </div>
            </div>
          </div>
        )}

        {errorResults.length > 0 && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {errorResults.length} images failed to process
                </p>
                <ul className="text-xs text-red-700 dark:text-red-300 mt-1 list-disc list-inside max-h-20 overflow-y-auto">
                  {errorResults.slice(0, 5).map((r, i) => (
                    <li key={i}>{r.image}: {r.error}</li>
                  ))}
                  {errorResults.length > 5 && <li>...and {errorResults.length - 5} more</li>}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {dialogState === "configure" && "Auto-Label Unlabeled Images"}
            {dialogState === "processing" && "Processing..."}
            {dialogState === "results" && "Batch Labeling Results"}
          </DialogTitle>
          {dialogState === "configure" && (
            <DialogDescription>
              Automatically label unlabeled images using a trained YOLO model.
            </DialogDescription>
          )}
        </DialogHeader>

        {dialogState === "configure" && renderConfigureState()}
        {dialogState === "processing" && renderProcessingState()}
        {dialogState === "results" && renderResultsState()}
      </DialogContent>
    </Dialog>
  )
}
