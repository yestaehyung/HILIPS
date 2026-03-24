"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FlaskConical, Loader2, AlertTriangle, Shuffle } from "lucide-react"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"

interface CreateTestSetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalImages: number
  existingTestSetCount: number
  onComplete: () => void
}

export default function CreateTestSetDialog({
  open,
  onOpenChange,
  totalImages,
  existingTestSetCount,
  onComplete,
}: CreateTestSetDialogProps) {
  const [count, setCount] = useState(40)
  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const { toast } = useToast()

  const availableImages = totalImages - existingTestSetCount
  const maxCount = Math.min(availableImages, 100)

  const handleCreate = async () => {
    if (count > availableImages) {
      toast({
        variant: "destructive",
        title: "Not enough images",
        description: `Only ${availableImages} images available for test set.`,
      })
      return
    }

    setIsCreating(true)
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.TEST_SETS_RANDOM, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count,
          name: name || `Test Set (${count} images)`,
          exclude_unlabeled: false,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || "Failed to create test set")
      }

      const data = await response.json()
      toast({
        title: "Test Set Created",
        description: `${data.test_set.statistics.total_images} images randomly selected for evaluation.`,
      })
      onComplete()
      onOpenChange(false)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to create test set",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-purple-600" />
            Create Test Set
          </DialogTitle>
          <DialogDescription>
            Randomly select images for model evaluation. Test set images will not be used for training.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {existingTestSetCount > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {existingTestSetCount} images are already in a test set. Creating a new test set will replace it.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Test Set Name (optional)</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Experiment 1 Test Set"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="count">Number of Images</Label>
            <div className="flex items-center gap-3">
              <Input
                id="count"
                type="number"
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(maxCount, parseInt(e.target.value) || 0)))}
                min={1}
                max={maxCount}
                className="w-24"
              />
              <div className="flex gap-2">
                {[20, 40, 60].filter(n => n <= maxCount).map((preset) => (
                  <Button
                    key={preset}
                    variant={count === preset ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setCount(preset)}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Available: {availableImages} images (Total: {totalImages})
            </p>
          </div>

          <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded-md">
            <div className="flex items-start gap-2 text-xs text-purple-900 dark:text-purple-100">
              <Shuffle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block mb-1">Random Selection</strong>
                <p className="opacity-90">
                  {count} images will be randomly selected. These images should be manually labeled (no LLM auto-labeling) to serve as ground truth for mAP evaluation.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-3 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || availableImages === 0} className="gap-2">
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            Create Test Set
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
