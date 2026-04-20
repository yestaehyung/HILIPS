"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent } from "@/components/ui/card"
import { Bot, Loader2, CheckCircle, AlertCircle, XCircle, Sparkles, RefreshCw, Eye } from "lucide-react"
import { useRouter } from "next/navigation"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"

interface PostTrainingAutoLabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelId: string
  modelName: string
  onComplete: () => void
}

interface LabelingStatus {
  total: number
  labeled: number
  unlabeled: number
  needs_review: number
}

interface BatchResult {
  success: boolean
  model_id: string
  total_processed: number
  auto_labeled: number
  needs_review: number
  errors: number
}

type DialogState = "prompt" | "configure" | "processing" | "results"

export default function PostTrainingAutoLabelDialog({
  open,
  onOpenChange,
  modelId,
  modelName,
  onComplete,
}: PostTrainingAutoLabelDialogProps) {
  const [dialogState, setDialogState] = useState<DialogState>("prompt")
  const [labelingStatus, setLabelingStatus] = useState<LabelingStatus | null>(null)
  const [confidence, setConfidence] = useState(0.5)
  const [autoLabelThreshold, setAutoLabelThreshold] = useState(0.8)
  const [includeNeedsReview, setIncludeNeedsReview] = useState(true)
  const [imageCount, setImageCount] = useState(50)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const { toast } = useToast()
  const router = useRouter()

  useEffect(() => {
    if (open) {
      setDialogState("prompt")
      setBatchResult(null)
      setProgress(0)
      fetchLabelingStatus()
    }
  }, [open])

  useEffect(() => {
    if (labelingStatus) {
      const total = labelingStatus.unlabeled + (includeNeedsReview ? labelingStatus.needs_review : 0)
      setImageCount(Math.min(50, total))
    }
  }, [labelingStatus, includeNeedsReview])

  const fetchLabelingStatus = async () => {
    setIsLoadingStatus(true)
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.LABELING_STATUS || "/api/labeling-status")
      if (response.ok) {
        const data = await response.json()
        setLabelingStatus(data)
      }
    } catch (error) {
      console.error("Failed to fetch labeling status:", error)
    } finally {
      setIsLoadingStatus(false)
    }
  }

  const handleSkip = () => {
    onOpenChange(false)
    onComplete()
  }

  const handleProceed = () => {
    setDialogState("configure")
  }

  const handleStartAutoLabeling = async () => {
    setIsProcessing(true)
    setDialogState("processing")
    setProgress(10)

    try {
      const response = await apiCall(
        `${API_CONFIG.ENDPOINTS.BATCH_INFERENCE}/${modelId}/batch-inference`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            process_unlabeled: true,
            include_needs_review: includeNeedsReview,
            max_images: imageCount === totalToProcess ? null : imageCount,
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
        title: "Auto-labeling complete",
        description: `${result.auto_labeled} images auto-labeled, ${result.needs_review} need review.`,
      })

      onComplete()
    } catch (error: any) {
      console.error("Auto-labeling error:", error)
      toast({
        variant: "destructive",
        title: "Auto-labeling failed",
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

  const totalToProcess = labelingStatus 
    ? labelingStatus.unlabeled + (includeNeedsReview ? labelingStatus.needs_review : 0)
    : 0

  const renderPromptState = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg border border-green-200 dark:border-green-900">
        <div className="p-3 rounded-full bg-green-100 dark:bg-green-900">
          <Sparkles className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h3 className="font-semibold text-green-800 dark:text-green-200">
            Model Training Complete!
          </h3>
          <p className="text-sm text-green-700 dark:text-green-300">
            <strong>{modelName}</strong> is ready for auto-labeling
          </p>
        </div>
      </div>

      {isLoadingStatus ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm text-muted-foreground">Loading status...</span>
        </div>
      ) : labelingStatus && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{labelingStatus.unlabeled}</p>
              <p className="text-xs text-muted-foreground">Unlabeled Images</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{labelingStatus.needs_review}</p>
              <p className="text-xs text-muted-foreground">Needs Review</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          Would you like to auto-label images using this new model?
        </p>
        {labelingStatus && labelingStatus.unlabeled + labelingStatus.needs_review > 0 && (
          <p className="text-xs text-muted-foreground">
            Up to <strong>{labelingStatus.unlabeled + labelingStatus.needs_review}</strong> images can be processed
          </p>
        )}
      </div>

      <DialogFooter className="flex gap-3 sm:gap-3">
        <Button variant="outline" onClick={handleSkip} className="flex-1">
          Skip for Now
        </Button>
        <Button 
          onClick={handleProceed} 
          className="flex-1 gap-2"
          disabled={!labelingStatus || (labelingStatus.unlabeled + labelingStatus.needs_review === 0)}
        >
          <Bot className="h-4 w-4" />
          Yes, Auto-Label
        </Button>
      </DialogFooter>
    </div>
  )

  const renderConfigureState = () => (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Include Needs Review Images</Label>
            <p className="text-xs text-muted-foreground">
              Re-label {labelingStatus?.needs_review || 0} images with the new model
            </p>
          </div>
          <Switch
            checked={includeNeedsReview}
            onCheckedChange={setIncludeNeedsReview}
          />
        </div>

      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Images to Process</Label>
          <span className="text-sm font-mono text-muted-foreground">
            {imageCount === totalToProcess ? "All" : imageCount} / {totalToProcess}
          </span>
        </div>
        <Slider
          value={[imageCount]}
          onValueChange={([val]) => setImageCount(val)}
          min={Math.min(25, totalToProcess)}
          max={totalToProcess}
          step={25}
          className="w-full"
          disabled={totalToProcess === 0}
        />
        <div className="flex gap-2">
          {[25, 50, 100].filter(n => n <= totalToProcess).map((preset) => (
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
            variant={imageCount === totalToProcess ? "secondary" : "outline"}
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => setImageCount(totalToProcess)}
          >
            All
          </Button>
        </div>
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

      <DialogFooter className="flex gap-3 sm:gap-3">
        <Button variant="outline" onClick={() => setDialogState("prompt")}>
          Back
        </Button>
        <Button
          onClick={handleStartAutoLabeling}
          disabled={totalToProcess === 0}
          className="gap-2"
        >
          <Bot className="h-4 w-4" />
          Start Auto-Labeling
        </Button>
      </DialogFooter>
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
            Running {modelName} on {imageCount} images
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
        This may take a few minutes depending on the number of images.
      </p>
    </div>
  )

  const renderResultsState = () => {
    if (!batchResult) return null

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
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
                  High-confidence detections saved automatically.
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
                  Use the "Needs Review" filter in Gallery to review them.
                </p>
              </div>
            </div>
          </div>
        )}

        {batchResult.errors > 0 && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {batchResult.errors} images failed to process
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex gap-3 sm:gap-3">
          <Button variant="outline" onClick={handleClose} className="flex-1">
            Done
          </Button>
          {batchResult.needs_review > 0 && (
            <Button 
              onClick={() => {
                handleClose()
                router.push("/gallery?filter=needs-review")
              }} 
              className="flex-1 gap-2"
            >
              <Eye className="h-4 w-4" />
              Review Images
            </Button>
          )}
        </DialogFooter>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dialogState === "prompt" && <Sparkles className="h-5 w-5 text-green-600" />}
            {dialogState === "configure" && <Bot className="h-5 w-5" />}
            {dialogState === "processing" && <RefreshCw className="h-5 w-5 animate-spin" />}
            {dialogState === "results" && <CheckCircle className="h-5 w-5 text-green-600" />}
            {dialogState === "prompt" && "Training Complete!"}
            {dialogState === "configure" && "Configure Auto-Labeling"}
            {dialogState === "processing" && "Processing..."}
            {dialogState === "results" && "Auto-Labeling Complete"}
          </DialogTitle>
          {dialogState === "prompt" && (
            <DialogDescription>
              Your new model is ready. Would you like to use it for auto-labeling?
            </DialogDescription>
          )}
        </DialogHeader>

        {dialogState === "prompt" && renderPromptState()}
        {dialogState === "configure" && renderConfigureState()}
        {dialogState === "processing" && renderProcessingState()}
        {dialogState === "results" && renderResultsState()}
      </DialogContent>
    </Dialog>
  )
}
