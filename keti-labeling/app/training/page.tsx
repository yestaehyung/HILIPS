"use client"

import type React from "react"
import { useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Brain,
  ArrowLeft,
  CheckCircle,
  Play,
  HardDrive,
  Settings2,
  Info,
  Beaker
} from "lucide-react"
import Link from "next/link"

import { useToast } from "@/hooks/use-toast"
import { apiCall, API_CONFIG } from "@/lib/api-config"

interface TrainingConfig {
  modelType: string
  epochs: number
  learningRate: number
  batchSize: number
}

interface ServerAnnotationFile {
  filename: string
  size?: number
  modified_time?: number
  needs_review?: boolean
  annotations_count?: number
}

export default function TrainingPage() {
  const [serverAnnotationFiles, setServerAnnotationFiles] = useState<ServerAnnotationFile[]>([])
  const [selectedServerAnnotations, setSelectedServerAnnotations] = useState<string[]>([])
  const [loadingServerAnnotations, setLoadingServerAnnotations] = useState(false)
  const [trainingConfig, setTrainingConfig] = useState<TrainingConfig>({
    modelType: "yolo-v8",
    epochs: 100,
    learningRate: 0.001,
    batchSize: 32
  })
  const [imgSize, setImgSize] = useState<number>(640)
  const [modelName, setModelName] = useState<string>("my_button_detector")
  const [excludedTestSetCount, setExcludedTestSetCount] = useState<number>(0)
  const [trainingTasks, setTrainingTasks] = useState<string[]>(["detection", "segmentation"])
  const { toast } = useToast()
  const totalServerAnnotationFiles = serverAnnotationFiles.length
  const allServerAnnotationsSelected =
    totalServerAnnotationFiles > 0 && selectedServerAnnotations.length === totalServerAnnotationFiles
  const hasPartialServerAnnotationSelection =
    selectedServerAnnotations.length > 0 && !allServerAnnotationsSelected

  const handleSelectAllServerAnnotations = useCallback((shouldSelectAll: boolean) => {
    if (shouldSelectAll) {
      setSelectedServerAnnotations(serverAnnotationFiles.map((file) => file.filename))
      return
    }
    setSelectedServerAnnotations([])
  }, [serverAnnotationFiles])

  const extractImageNameFromAnnotationFilename = useCallback((annotationFilename: string): string => {
    return annotationFilename.replace(/_coco\.json$/, '')
  }, [])

  const extractBaseNameWithoutExtension = useCallback((filename: string): string => {
    return filename.replace(/\.[^/.]+$/, '')
  }, [])

  useEffect(() => {
    const loadAnnotations = async () => {
      setLoadingServerAnnotations(true)
      try {
        let testSetImageMap: Record<string, string> = {}
        try {
          const testSetRes = await apiCall(API_CONFIG.ENDPOINTS.TEST_SETS_IMAGES)
          if (testSetRes.ok) {
            const testSetData = await testSetRes.json()
            testSetImageMap = testSetData.images || {}
          }
        } catch (e) {
          console.warn("Could not fetch test set images:", e)
        }

        const testSetBaseNames = new Set(
          Object.keys(testSetImageMap).map(filename => extractBaseNameWithoutExtension(filename))
        )

        const res = await apiCall(API_CONFIG.ENDPOINTS.ANNOTATIONS)
        if (!res.ok) throw new Error(`Failed to load annotations: ${res.status}`)
        const data = await res.json()

        const excludedFiles = ['review_history.json', 'auto_label_queue.json']
        
        const isNotTestSetAnnotation = (annotationFilename: string): boolean => {
          const imageName = extractImageNameFromAnnotationFilename(annotationFilename)
          return !testSetBaseNames.has(imageName)
        }
        
        let totalExcluded = 0
        
        if (Array.isArray(data)) {
          const allFiles = data.filter((item: any): item is string => 
            typeof item === "string" && !excludedFiles.includes(item)
          )
          const filtered = allFiles.filter(isNotTestSetAnnotation)
          totalExcluded = allFiles.length - filtered.length
          setServerAnnotationFiles(filtered.map((filename: string) => ({ filename })))
        } else if (Array.isArray(data?.files)) {
          const allFiles = data.files.filter((item: any): item is ServerAnnotationFile =>
            item && typeof item.filename === "string" && 
            !excludedFiles.includes(item.filename) &&
            !item.needs_review
          )
          const filtered = allFiles.filter(item => isNotTestSetAnnotation(item.filename))
          totalExcluded = allFiles.length - filtered.length
          setServerAnnotationFiles(filtered.map((item) => ({
            filename: item.filename,
            size: typeof item.size === "number" ? item.size : undefined,
            modified_time: typeof item.modified_time === "number" ? item.modified_time : undefined,
            needs_review: item.needs_review,
            annotations_count: item.annotations_count,
          })))
        } else {
          setServerAnnotationFiles([])
        }
        
        setExcludedTestSetCount(totalExcluded)
      } catch (e) {
        console.error(e)
      } finally {
        setLoadingServerAnnotations(false)
      }
    }
    loadAnnotations()
  }, [extractBaseNameWithoutExtension, extractImageNameFromAnnotationFilename])

  const toggleSelectServerAnnotation = (name: string, checked: boolean) => {
    setSelectedServerAnnotations((prev) =>
      checked ? Array.from(new Set([...prev, name])) : prev.filter((n) => n !== name),
    )
  }

  const toggleTrainingTask = (task: string, checked: boolean) => {
    setTrainingTasks((prev) =>
      checked ? [...prev, task] : prev.filter((t) => t !== task)
    )
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-'
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatModifiedTime = (epochSeconds?: number): string => {
    if (!epochSeconds) return '-'
    try {
      return new Date(epochSeconds * 1000).toLocaleDateString()
    } catch {
      return '-'
    }
  }

  const canStartTraining = selectedServerAnnotations.length > 0 && trainingTasks.length > 0

  const handleStartTraining = async () => {
    if (selectedServerAnnotations.length === 0) {
      toast({
        variant: "destructive",
        title: "No data selected",
        description: "Please select annotation files from server storage.",
      })
      return
    }

    try {
      const payload = {
        annotation_filenames: selectedServerAnnotations,
        epochs: trainingConfig.epochs,
        batch_size: trainingConfig.batchSize,
        img_size: imgSize,
        model_name: (modelName && modelName.trim().length > 0) ? modelName.trim() : `hilips_${Date.now()}`,
        training_tasks: trainingTasks,
      }

      const res = await apiCall(API_CONFIG.ENDPOINTS.TRAIN_START, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error(`Training start failed (${res.status})`)
      const data = await res.json()

      const annotationFilenames = Array.isArray(data.annotation_filenames) && data.annotation_filenames.length > 0
        ? data.annotation_filenames
        : selectedServerAnnotations

      toast({ title: "Training started", description: data.message || "Job created" })

      // Persist job and config
      localStorage.setItem('ketilabel_training_job_id', data.job_id)
      localStorage.setItem('ketilabel_training_data', JSON.stringify({
        config: { ...trainingConfig, imgSize, modelName: payload.model_name },
        startTime: new Date().toISOString(),
        annotationFilenames: annotationFilenames,
        filesCount: data.files_count,
        trainingParameters: data.training_parameters,
      }))
      window.location.href = '/training/monitor'
    } catch (e) {
      toast({ variant: "destructive", title: "Failed to start training", description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 p-1.5 rounded-md">
                <Brain className="h-5 w-5 text-primary" />
              </div>
              <span className="text-lg font-bold tracking-tight">HILIPS Training</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Model Training</h1>
            <p className="text-muted-foreground text-lg">
              Configure your YOLO model parameters.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Data Selection */}
            <div className="lg:col-span-7 space-y-6">
              <Card className="border-muted/40 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5 text-primary" />
                    Data Selection
                  </CardTitle>
                  <CardDescription>
                    Choose where your training data comes from.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {loadingServerAnnotations ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                          <div className="animate-spin mr-2 h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                          Loading files...
                        </div>
                      ) : serverAnnotationFiles.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground border rounded-lg bg-muted/20">
                          No annotation files found on server.
                        </div>
                      ) : (
                        <>
                          {excludedTestSetCount > 0 && (
                            <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-900 mb-4">
                              <Beaker className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <strong>Test Set Excluded:</strong> {excludedTestSetCount} annotation{excludedTestSetCount !== 1 ? 's' : ''} from the Test Set {excludedTestSetCount !== 1 ? 'are' : 'is'} automatically excluded from training to preserve evaluation integrity.
                              </div>
                            </div>
                          )}
                          <div className="flex flex-col gap-2 mb-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                Select files to include in training
                              </span>
                              <Badge variant="secondary">
                                {selectedServerAnnotations.length} selected
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <Label
                                htmlFor="select-all-server-annotations"
                                className="flex items-center gap-2 text-muted-foreground cursor-pointer select-none font-normal"
                              >
                                <Checkbox
                                  id="select-all-server-annotations"
                                  checked={
                                    allServerAnnotationsSelected
                                      ? true
                                      : hasPartialServerAnnotationSelection
                                        ? "indeterminate"
                                        : false
                                  }
                                  onCheckedChange={(checked) => handleSelectAllServerAnnotations(checked === true)}
                                  className="h-4 w-4"
                                />
                                <span>Select all</span>
                              </Label>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => handleSelectAllServerAnnotations(false)}
                                disabled={selectedServerAnnotations.length === 0}
                              >
                                Clear selection
                              </Button>
                            </div>
                          </div>
                          <ScrollArea className="h-[400px] rounded-md border">
                            <div className="p-2 space-y-1">
                              {serverAnnotationFiles.map((file) => {
                                const checked = selectedServerAnnotations.includes(file.filename)
                                return (
                                  <div
                                    key={file.filename}
                                    className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${checked
                                      ? 'bg-primary/5 border-primary/50'
                                      : 'bg-card border-transparent hover:bg-muted/50'
                                      }`}
                                    onClick={() => toggleSelectServerAnnotation(file.filename, !checked)}
                                  >
                                    <div className="flex items-center space-x-3 overflow-hidden">
                                      <div className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
                                        }`}>
                                        {checked && <CheckCircle className="h-3.5 w-3.5" />}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-medium text-sm truncate">{file.filename}</p>
                                        <div className="flex items-center text-xs text-muted-foreground space-x-2">
                                          <span>{formatFileSize(file.size)}</span>
                                          <span>•</span>
                                          <span>{formatModifiedTime(file.modified_time)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </ScrollArea>
                        </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Configuration */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="border-muted/40 shadow-sm h-fit sticky top-24">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5 text-primary" />
                    Training Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Model Settings */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="model-name">Model Name</Label>
                      <Input
                        id="model-name"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        placeholder="e.g., button_detector_v1"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="model-type">Architecture</Label>
                      <Select
                        value={trainingConfig.modelType}
                        onValueChange={(value) =>
                          setTrainingConfig(prev => ({ ...prev, modelType: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yolo-v8">YOLO v8</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-3">
                      <Label>Training Tasks</Label>
                      <div className="flex flex-col gap-3 p-3 border rounded-md bg-muted/20">
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id="task-detection" 
                            checked={trainingTasks.includes("detection")}
                            onCheckedChange={(checked) => toggleTrainingTask("detection", checked === true)}
                          />
                          <Label htmlFor="task-detection" className="font-normal cursor-pointer text-sm">
                            Object Detection
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox 
                            id="task-segmentation" 
                            checked={trainingTasks.includes("segmentation")}
                            onCheckedChange={(checked) => toggleTrainingTask("segmentation", checked === true)}
                          />
                          <Label htmlFor="task-segmentation" className="font-normal cursor-pointer text-sm">
                            Instance Segmentation
                          </Label>
                        </div>
                      </div>
                      {trainingTasks.length === 0 && (
                        <p className="text-xs text-destructive font-medium">Please select at least one task.</p>
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* Hyperparameters */}
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <Label htmlFor="epochs">Epochs</Label>
                        <span className="text-sm text-muted-foreground font-mono">{trainingConfig.epochs}</span>
                      </div>
                      <Slider
                        id="epochs"
                        min={1}
                        max={500}
                        step={1}
                        value={[trainingConfig.epochs]}
                        onValueChange={(vals) => setTrainingConfig(prev => ({ ...prev, epochs: vals[0] }))}
                        className="py-2"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <Label htmlFor="batch-size">Batch Size</Label>
                        <span className="text-sm text-muted-foreground font-mono">{trainingConfig.batchSize}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {[8, 16, 32, 48, 64].map((size) => (
                          <Button
                            key={size}
                            variant={trainingConfig.batchSize === size ? "default" : "outline"}
                            size="sm"
                            onClick={() => setTrainingConfig(prev => ({ ...prev, batchSize: size }))}
                            className="w-full"
                          >
                            {size}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">RTX 3090 24GB: 32-64 recommended</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="learning-rate">Learning Rate</Label>
                        <Input
                          id="learning-rate"
                          type="number"
                          value={trainingConfig.learningRate}
                          onChange={(e) =>
                            setTrainingConfig(prev => ({
                              ...prev,
                              learningRate: parseFloat(e.target.value) || 0.001
                            }))
                          }
                          step={0.0001}
                          min={0.0001}
                          max={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="img-size">Image Size</Label>
                        <Select
                          value={imgSize.toString()}
                          onValueChange={(value) => setImgSize(parseInt(value))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="416">416 (Fast)</SelectItem>
                            <SelectItem value="640">640 (Default)</SelectItem>
                            <SelectItem value="960">960 (High)</SelectItem>
                            <SelectItem value="1280">1280 (Ultra)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col space-y-4 pt-2">
                  <Button
                    onClick={handleStartTraining}
                    size="lg"
                    className="w-full text-lg shadow-lg shadow-primary/20"
                    disabled={!canStartTraining}
                  >
                    <Play className="mr-2 h-5 w-5" />
                    Start Training
                  </Button>

                  {selectedServerAnnotations.length === 0 && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <p>
                        Please select annotation files from <strong>Server Storage</strong> to start training.
                      </p>
                    </div>
                  )}
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
