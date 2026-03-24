"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Activity, FileText, Timer, RefreshCw, Trash2, BarChart3, ChevronDown, Database, Eye, Beaker, FlaskConical, Check, AlertCircle } from "lucide-react"
import MainHeader from "@/components/main-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import PostTrainingAutoLabelDialog from "@/components/post-training-auto-label-dialog"

interface TrainingData {
  files: Array<{ id: string; name: string; size: number }>
  config: { modelType: string; epochs: number; learningRate: number; batchSize: number; imgSize?: number; modelName?: string }
  startTime: string
  annotationFilename?: string // legacy support
  annotationFilenames?: string[]
  filesCount?: number
  trainingParameters?: { epochs: number; batch_size: number; img_size: number }
}

interface SubJobStatus {
  job_id: string
  status: string
  progress: number
  message?: string
  metrics?: any
  model_path?: string
  error?: any
}

interface TrainingStatus {
  job_id: string
  status: "preparing" | "training" | "completed" | "failed" | "cancelled"
  progress: number
  message?: string
  created_at?: string
  completed_at?: string | null
  annotation_filename?: string // legacy support
  annotation_filenames?: string[]
  model_name?: string
  training_parameters?: { epochs: number; batch_size: number; img_size: number }
  processed_images_count?: number
  metrics?: any
  error?: any
  training_tasks?: string[]
  current_task?: string
  current_task_index?: number
  total_tasks?: number
  sub_jobs?: Record<string, SubJobStatus>
  task_type?: string
}

interface EvaluationSummary {
  overall_performance?: string
  detection_accuracy?: string
  precision_score?: string
  recall_score?: string
  [key: string]: string | undefined
}

interface EvaluationMetricDetail {
  value?: number
  percentage?: string
  grade?: string
  description?: string
  [key: string]: string | number | undefined
}

interface PerClassMetric {
  class_id: number
  ap50: EvaluationMetricDetail
  ap50_95: EvaluationMetricDetail
  precision: EvaluationMetricDetail
  recall: EvaluationMetricDetail
}

interface ModelEvaluation {
  model_id: string
  model_name: string
  evaluation_summary?: EvaluationSummary
  detailed_metrics?: Record<string, EvaluationMetricDetail>
  per_class_evaluation?: Record<string, PerClassMetric>
  class_names?: string[]
  training_info?: {
    annotation_files?: string[]
    training_parameters?: {
      epochs?: number
      batch_size?: number
      img_size?: number
    }
    processed_images?: number
  }
  created_at?: string
}

export default function TrainingMonitorPage() {
  const [progress, setProgress] = useState(0)
  const [data, setData] = useState<TrainingData | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<TrainingStatus | null>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const [evaluation, setEvaluation] = useState<ModelEvaluation | null>(null)
  const [isEvaluationLoading, setIsEvaluationLoading] = useState(false)
  const [evaluationError, setEvaluationError] = useState<string | null>(null)
  const [isDatasetFilesOpen, setIsDatasetFilesOpen] = useState(false)
  const [isTrainingFilesOpen, setIsTrainingFilesOpen] = useState(false)
  const [showAutoLabelDialog, setShowAutoLabelDialog] = useState(false)
  const autoLabelShownRef = useRef<Set<string>>(new Set())
  const [testSetInfo, setTestSetInfo] = useState<{ id: string; imageCount: number } | null>(null)
  const [isTestSetEvaluating, setIsTestSetEvaluating] = useState(false)
  const [testSetEvaluationResult, setTestSetEvaluationResult] = useState<any>(null)
  const [testSetEvaluationError, setTestSetEvaluationError] = useState<string | null>(null)

  // Load stored training data and job id
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ketilabel_training_data")
      if (raw) setData(JSON.parse(raw))
      const storedJobId = localStorage.getItem("ketilabel_training_job_id")
      if (storedJobId) setJobId(storedJobId)
    } catch {}
  }, [])

  // Poll job status if jobId exists; else simulate
  useEffect(() => {
    if (!jobId) {
      // Simulated progress when no server job
      const interval = setInterval(() => {
        setProgress((p) => Math.min(100, p + Math.random() * 7 + 3))
      }, 1200)
      return () => clearInterval(interval)
    }

    const poll = async () => {
      try {
        const res = await apiCall(`${API_CONFIG.ENDPOINTS.TRAINING_STATUS}/${encodeURIComponent(jobId)}`)
        if (!res.ok) throw new Error(`Status ${res.status}`)
        const s: TrainingStatus = await res.json()
        setStatus(s)
        setProgress(s.progress ?? 0)
        if (s.status === "completed" || s.status === "failed" || s.status === "cancelled") {
          if (pollingRef.current) clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      } catch (e) {
        console.error("Failed to fetch training status", e)
      }
    }

    poll()
    pollingRef.current = setInterval(poll, 5000)
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [jobId])

  useEffect(() => {
    if (status?.status === "completed" && jobId && !autoLabelShownRef.current.has(jobId)) {
      autoLabelShownRef.current.add(jobId)
      setShowAutoLabelDialog(true)
    }
  }, [status?.status, jobId])

  // Load jobs list
  const refreshJobs = useCallback(async () => {
    try {
      const res = await apiCall(API_CONFIG.ENDPOINTS.TRAINING_JOBS)
      if (!res.ok) throw new Error(`Jobs ${res.status}`)
      const body = await res.json()
      setJobs(Array.isArray(body.jobs) ? body.jobs : [])
    } catch {}
  }, [])

  useEffect(() => {
    refreshJobs()
  }, [refreshJobs])

  const deleteJob = async (id: string) => {
    try {
      const targetJob = jobs.find(j => j.job_id === id)
      const currentStatus = targetJob?.status || status?.status
      
      if (currentStatus === "preparing" || currentStatus === "training") {
        const stopRes = await apiCall(`${API_CONFIG.ENDPOINTS.TRAINING_JOBS}/${encodeURIComponent(id)}/stop`, { method: "POST" })
        if (!stopRes.ok) {
          console.error("Failed to stop job:", await stopRes.text())
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      
      const res = await apiCall(`${API_CONFIG.ENDPOINTS.TRAINING_JOBS}/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (res.ok) {
        if (jobId === id) {
          localStorage.removeItem("ketilabel_training_job_id")
          setJobId(null)
          setStatus(null)
          setProgress(0)
        }
        refreshJobs()
      }
    } catch {}
  }

  const startedAt = useMemo(() => (data?.startTime ? new Date(data.startTime) : status?.created_at ? new Date(status.created_at) : null), [data?.startTime, status?.created_at])

  const annotationFilenames = useMemo(() => {
    return data?.annotationFilenames || status?.annotation_filenames || []
  }, [data?.annotationFilenames, status?.annotation_filenames])

  const annotationFileCount = useMemo(() => {
    return annotationFilenames.length || (data?.annotationFilename ? 1 : 0) || (status?.annotation_filename ? 1 : 0)
  }, [annotationFilenames, data?.annotationFilename, status?.annotation_filename])

  const annotationSummary = useMemo(() => {
    if (annotationFileCount > 0) {
      return `${annotationFileCount} files`
    }
    return "Local/Test session"
  }, [annotationFileCount])

  const fetchEvaluation = useCallback(async () => {
    if (!jobId) return
    setIsEvaluationLoading(true)
    setEvaluationError(null)

    try {
      const response = await apiCall(`/api/models/${encodeURIComponent(jobId)}/evaluation`)
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Evaluation request failed (${response.status})`)
      }
      const evaluationData: ModelEvaluation = await response.json()
      setEvaluation(evaluationData)
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : "Unknown evaluation error")
    } finally {
      setIsEvaluationLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    if (status?.status !== "completed") return
    if (isEvaluationLoading) return
    if (evaluation) return
    fetchEvaluation()
  }, [jobId, status?.status, evaluation, isEvaluationLoading, fetchEvaluation])

  useEffect(() => {
    const fetchTestSetInfo = async () => {
      try {
        const response = await apiCall(API_CONFIG.ENDPOINTS.TEST_SETS_IMAGES)
        if (response.ok) {
          const data = await response.json()
          const images = data.images || {}
          const imageFilenames = Object.keys(images)
          if (imageFilenames.length > 0) {
            const testSetId = images[imageFilenames[0]]
            setTestSetInfo({ id: testSetId, imageCount: imageFilenames.length })
          }
        }
      } catch (e) {
        console.warn("Could not fetch test set info:", e)
      }
    }
    fetchTestSetInfo()
  }, [])

  const evaluateOnTestSet = useCallback(async () => {
    if (!jobId || !testSetInfo) return
    setIsTestSetEvaluating(true)
    setTestSetEvaluationError(null)
    setTestSetEvaluationResult(null)

    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.EVALUATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: jobId,
          test_set_id: testSetInfo.id,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Evaluation failed (${response.status})`)
      }

      const result = await response.json()
      setTestSetEvaluationResult(result)
    } catch (error) {
      setTestSetEvaluationError(error instanceof Error ? error.message : "Unknown error")
    } finally {
      setIsTestSetEvaluating(false)
    }
  }, [jobId, testSetInfo])

  return (
    <div className="min-h-screen bg-background">
      <MainHeader />

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="mr-2 h-5 w-5 text-primary" />
              Training Progress
            </CardTitle>
            <CardDescription>{jobId ? (status?.status ?? "-") : "Simulated for testing"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span>Overall Progress</span>
                {status?.current_task && (
                  <Badge variant="outline" className="text-xs font-normal h-5">
                    {status.current_task}
                  </Badge>
                )}
              </div>
              <Badge variant={progress >= 100 ? "default" : "secondary"}>{Math.floor(progress)}%</Badge>
            </div>
            <Progress value={progress} />

            {status?.sub_jobs && Object.keys(status.sub_jobs).length > 0 && (
              <div className="mt-4 space-y-3">
                <Separator />
                <h4 className="text-sm font-medium pt-2">Task Status</h4>
                <div className="grid gap-3">
                  {Object.entries(status.sub_jobs).map(([task, subJob]) => (
                    <div key={task} className="bg-muted/30 p-3 rounded-md border">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={subJob.status === "completed" ? "default" : "outline"} className="capitalize">
                            {task}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                            {subJob.status === "completed" && <Check className="h-3 w-3" />}
                            {subJob.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                            {subJob.status}
                          </span>
                        </div>
                        <span className="text-xs font-mono">{subJob.progress?.toFixed(0) ?? 0}%</span>
                      </div>
                      <Progress value={subJob.progress ?? 0} className="h-1.5" />
                      {subJob.message && (
                        <p className="text-xs text-muted-foreground mt-1.5 truncate" title={subJob.message}>
                          {subJob.message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {status?.metrics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                {Object.entries(status.metrics).map(([k, v]) => (
                  <div key={k} className="p-2 border rounded">{k}: <strong>{String(v)}</strong></div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary and Jobs */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-2 xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                Dataset & Config
              </CardTitle>
              <CardDescription>
                {annotationFileCount > 0 ? (
                  <Collapsible open={isDatasetFilesOpen} onOpenChange={setIsDatasetFilesOpen}>
                    <CollapsibleTrigger className="flex items-center gap-1 hover:text-foreground transition-colors">
                      <span>{annotationSummary}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isDatasetFilesOpen ? 'rotate-180' : ''}`} />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 max-h-32 overflow-y-auto text-xs text-muted-foreground bg-muted/50 rounded p-2">
                        {annotationFilenames.length > 0 
                          ? annotationFilenames.join(', ')
                          : data?.annotationFilename || status?.annotation_filename || '-'}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  annotationSummary
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <div className="flex items-center justify-between">
                  <span>Files</span>
                  <Badge variant="secondary">{data?.files?.length ?? data?.filesCount ?? 0}</Badge>
                </div>
                <Separator className="my-2" />
                {data?.files?.length ? (
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {data.files.map((f) => (
                      <div key={f.id} className="flex items-center justify-between p-2 border rounded">
                        <span className="truncate pr-2">{f.name}</span>
                        <Badge variant="outline">{(f.size / 1024).toFixed(1)} KB</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No local files (server job or testing)</div>
                )}
              </div>

              <div className="text-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  <div className="p-2 border rounded">Epochs: <strong>{status?.training_parameters?.epochs ?? data?.trainingParameters?.epochs ?? data?.config?.epochs ?? 100}</strong></div>
                  <div className="p-2 border rounded">LR: <strong>{data?.config?.learningRate ?? 0.001}</strong></div>
                  <div className="p-2 border rounded">Batch: <strong>{status?.training_parameters?.batch_size ?? data?.trainingParameters?.batch_size ?? data?.config?.batchSize ?? 16}</strong></div>
                  <div className="p-2 border rounded">Img: <strong>{status?.training_parameters?.img_size ?? data?.trainingParameters?.img_size ?? data?.config?.imgSize ?? 640}</strong></div>
                </div>
              </div>
            </CardContent>
          </Card>

          {(status?.status === "completed" || evaluation || evaluationError) && (
            <Card className="lg:col-span-3 xl:col-span-3">
              <CardHeader className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <BarChart3 className="mr-2 h-5 w-5 text-primary" />
                  Model Evaluation
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={fetchEvaluation}
                  disabled={!jobId || isEvaluationLoading}
                  className="flex items-center space-x-1"
                >
                  <RefreshCw className={`h-4 w-4 ${isEvaluationLoading ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {evaluationError && (
                  <Alert variant="destructive">
                    <AlertDescription>Failed to load evaluation: {evaluationError}</AlertDescription>
                  </Alert>
                )}

                {isEvaluationLoading && !evaluation ? (
                  <div className="text-muted-foreground">Loading evaluation data...</div>
                ) : evaluation ? (
                  <div className="space-y-4">
                    {evaluation.evaluation_summary && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-base">Summary</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {Object.entries(evaluation.evaluation_summary).map(([key, value]) => (
                            <div key={key} className="p-3 border rounded-md">
                              <div className="text-xs uppercase text-muted-foreground">{key.replace(/_/g, ' ')}</div>
                              <div className="text-sm font-medium">{value ?? '-'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {evaluation.detailed_metrics && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-base">Detailed Metrics</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {Object.entries(evaluation.detailed_metrics).map(([key, metric]) => (
                            <div key={key} className="border rounded-md p-3 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{key.toUpperCase()}</span>
                                {metric.percentage && <Badge variant="secondary">{metric.percentage}</Badge>}
                              </div>
                              {typeof metric.value === "number" && (
                                <div className="text-xs text-muted-foreground">Value: {metric.value.toFixed(4)}</div>
                              )}
                              {metric.grade && (
                                <div className="text-xs text-muted-foreground">Grade: {metric.grade}</div>
                              )}
                              {metric.description && (
                                <div className="text-xs text-muted-foreground">{metric.description}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {evaluation.per_class_evaluation && Object.keys(evaluation.per_class_evaluation).length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-base">Per-class Performance</h4>
                        <div className="border rounded-md overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left p-2 font-medium">Class</th>
                                  <th className="text-center p-2 font-medium">AP50</th>
                                  <th className="text-center p-2 font-medium">AP50-95</th>
                                  <th className="text-center p-2 font-medium">Precision</th>
                                  <th className="text-center p-2 font-medium">Recall</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(evaluation.per_class_evaluation).map(([className, metrics]) => (
                                  <tr key={className} className="border-t">
                                    <td className="p-2 font-medium">{className}</td>
                                    <td className="text-center p-2">
                                      <Badge variant={metrics.ap50.grade === "Excellent" ? "default" : metrics.ap50.grade === "Good" ? "secondary" : "outline"}>
                                        {metrics.ap50.percentage}
                                      </Badge>
                                    </td>
                                    <td className="text-center p-2">
                                      <Badge variant={metrics.ap50_95.grade === "Excellent" ? "default" : metrics.ap50_95.grade === "Good" ? "secondary" : "outline"}>
                                        {metrics.ap50_95.percentage}
                                      </Badge>
                                    </td>
                                    <td className="text-center p-2">
                                      <Badge variant={metrics.precision.grade === "Excellent" ? "default" : metrics.precision.grade === "Good" ? "secondary" : "outline"}>
                                        {metrics.precision.percentage}
                                      </Badge>
                                    </td>
                                    <td className="text-center p-2">
                                      <Badge variant={metrics.recall.grade === "Excellent" ? "default" : metrics.recall.grade === "Good" ? "secondary" : "outline"}>
                                        {metrics.recall.percentage}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {evaluation.training_info && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-base">Training Info</h4>
                        {evaluation.training_info.annotation_files && evaluation.training_info.annotation_files.length > 0 && (
                          <Collapsible open={isTrainingFilesOpen} onOpenChange={setIsTrainingFilesOpen}>
                            <CollapsibleTrigger className="flex items-center gap-1 hover:text-foreground transition-colors">
                              <span className="text-xs text-muted-foreground">Annotation files</span>
                              <Badge variant="secondary" className="ml-1">{evaluation.training_info.annotation_files.length} files</Badge>
                              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isTrainingFilesOpen ? 'rotate-180' : ''}`} />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-1 max-h-32 overflow-y-auto text-xs text-muted-foreground bg-muted/50 rounded p-2">
                                {evaluation.training_info.annotation_files.join(', ')}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 border rounded">Epochs: <strong>{evaluation.training_info.training_parameters?.epochs ?? '-'}</strong></div>
                          <div className="p-2 border rounded">Batch: <strong>{evaluation.training_info.training_parameters?.batch_size ?? '-'}</strong></div>
                          <div className="p-2 border rounded">Img: <strong>{evaluation.training_info.training_parameters?.img_size ?? '-'}</strong></div>
                          <div className="p-2 border rounded">Processed: <strong>{evaluation.training_info.processed_images ?? '-'}</strong></div>
                        </div>
                      </div>
                    )}

                    {evaluation.created_at && (
                      <div className="text-xs text-muted-foreground">Evaluation created: {new Date(evaluation.created_at).toLocaleString()}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground">Evaluation data is not ready yet.</div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Timer className="mr-2 h-5 w-5" />
                Session
              </CardTitle>
              <CardDescription>Timing & controls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Started</span>
                <span className="text-muted-foreground">{startedAt ? startedAt.toLocaleString() : "-"}</span>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                {status?.status === "completed" && (
                  <>
                    <Link href="/gallery?filter=needs-review" className="flex-1">
                      <Button variant="default" className="w-full">
                        <Eye className="mr-2 h-4 w-4" /> Review Images
                      </Button>
                    </Link>
                    <Link href="/models" className="flex-1">
                      <Button variant="outline" className="w-full">
                        <Database className="mr-2 h-4 w-4" /> Model Registry
                      </Button>
                    </Link>
                  </>
                )}
                {jobId && (
                  <Button variant="secondary" onClick={() => deleteJob(jobId)} className="flex-1">
                    <Trash2 className="mr-2 h-4 w-4" /> Cancel/Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {status?.status === "completed" && testSetInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Beaker className="mr-2 h-5 w-5 text-amber-600" />
                Test Set Evaluation
              </CardTitle>
              <CardDescription>
                Evaluate model performance on {testSetInfo.imageCount} ground-truth images
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!testSetEvaluationResult && !testSetEvaluationError && (
                <div className="flex items-center gap-4">
                  <Button
                    onClick={evaluateOnTestSet}
                    disabled={isTestSetEvaluating}
                    className="gap-2"
                  >
                    {isTestSetEvaluating ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        <FlaskConical className="h-4 w-4" />
                        Evaluate on Test Set
                      </>
                    )}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Test Set ID: {testSetInfo.id}
                  </span>
                </div>
              )}

              {testSetEvaluationError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Evaluation failed: {testSetEvaluationError}
                  </AlertDescription>
                </Alert>
              )}

              {testSetEvaluationResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {testSetEvaluationResult.metrics && Object.entries(testSetEvaluationResult.metrics).map(([key, value]) => (
                      <div key={key} className="p-3 border rounded-md">
                        <div className="text-xs uppercase text-muted-foreground">{key.replace(/_/g, ' ')}</div>
                        <div className="text-lg font-semibold">
                          {typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {testSetEvaluationResult.evaluation_summary && (
                    <div className="p-3 bg-muted/50 rounded-md text-sm">
                      <strong>Summary:</strong> {testSetEvaluationResult.evaluation_summary}
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={evaluateOnTestSet}
                    disabled={isTestSetEvaluating}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isTestSetEvaluating ? 'animate-spin' : ''}`} />
                    Re-evaluate
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Jobs List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">Jobs <Button variant="ghost" size="sm" onClick={refreshJobs}><RefreshCw className="h-4 w-4" /></Button></CardTitle>
            <CardDescription>Pick a job to monitor</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {jobs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No jobs</div>
              ) : (
                jobs.map((j) => (
                  <div key={j.job_id} className={`p-2 border rounded flex items-center justify-between ${jobId === j.job_id ? 'bg-primary/5 border-primary' : ''}`}>
                    <div className="text-sm truncate pr-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{j.model_name || j.job_id}</div>
                        {j.training_tasks && j.training_tasks.length > 0 && (
                          <Badge variant="outline" className="h-4 text-[10px] px-1 py-0">{j.training_tasks.join(" + ")}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {Array.isArray(j.annotation_filenames) && j.annotation_filenames.length
                          ? `${j.annotation_filenames.length} files`
                          : j.annotation_filename || '-'}
                        {' '}• {j.status} • {j.progress}%
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button size="sm" variant="outline" onClick={() => { localStorage.setItem('ketilabel_training_job_id', j.job_id); setJobId(j.job_id) }}>Monitor</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteJob(j.job_id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>


      </main>

      <PostTrainingAutoLabelDialog
        open={showAutoLabelDialog}
        onOpenChange={setShowAutoLabelDialog}
        modelId={jobId || ""}
        modelName={status?.model_name || jobId || "New Model"}
        onComplete={() => {
          refreshJobs()
        }}
      />
    </div>
  )
}
