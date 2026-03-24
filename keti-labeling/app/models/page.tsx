"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"
import { CheckCircle, AlertTriangle, Clock, TrendingUp, Download, Eye, Edit2, Database, Target, BarChart3, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import Link from "next/link"
import MainHeader from "@/components/main-header"

interface ModelInfo {
  model_id: string
  version: number
  status: string
  status_message: string
  metrics: {
    map50: number
    map50_95: number
    map70: number
    precision: number
    recall: number
    f1: number
  }
  created_at: string
  promoted_at?: string
}

interface ClassMetric {
  value: number
  percentage: string
  grade: string
}

interface PerClassEvaluation {
  [className: string]: {
    class_id: number
    ap50: ClassMetric
    ap50_95: ClassMetric
    precision: ClassMetric
    recall: ClassMetric
  }
}

interface ModelEvaluation {
  model_id: string
  model_name: string
  evaluation_summary: {
    overall_performance: string
    detection_accuracy: string
    precision_score: string
    recall_score: string
    num_classes: number
  }
  per_class_evaluation: PerClassEvaluation
  class_names: string[]
}

export default function ModelsPage() {
  const { toast } = useToast()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [registryStats, setRegistryStats] = useState<any>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [modelEvaluation, setModelEvaluation] = useState<ModelEvaluation | null>(null)
  const [loadingEvaluation, setLoadingEvaluation] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [modelToDelete, setModelToDelete] = useState<ModelInfo | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadModels()
    loadRegistryStats()
  }, [])

  const loadModels = async () => {
    try {
      setLoading(true)
      const response = await apiCall(API_CONFIG.ENDPOINTS.MODELS_LIST + '/registry')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success && data.models) {
        setModels(data.models)
      } else {
        setModels([])
      }
      setLoading(false)
    } catch (error) {
      console.error("Failed to load models:", error)
      toast({
        variant: "destructive",
        title: "Failed to load models",
        description: (error as Error).message,
      })
      setModels([])
      setLoading(false)
    }
  }

  const loadRegistryStats = async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.MODELS_LIST + '/registry/stats')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        setRegistryStats(data)
      } else {
        setRegistryStats(null)
      }
    } catch (error) {
      console.error("Failed to load registry stats:", error)
      setRegistryStats(null)
    }
  }

  const loadModelEvaluation = async (modelId: string) => {
    setLoadingEvaluation(true)
    setSelectedModel(modelId)
    try {
      const response = await apiCall(`/api/models/${encodeURIComponent(modelId)}/evaluation`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      setModelEvaluation(data)
    } catch (error) {
      console.error("Failed to load model evaluation:", error)
      toast({
        variant: "destructive",
        title: "Failed to load evaluation",
        description: (error as Error).message,
      })
      setModelEvaluation(null)
    } finally {
      setLoadingEvaluation(false)
    }
  }

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case "Excellent": return "text-green-600 bg-green-50"
      case "Good": return "text-blue-600 bg-blue-50"
      case "Fair": return "text-yellow-600 bg-yellow-50"
      case "Poor": return "text-orange-600 bg-orange-50"
      default: return "text-red-600 bg-red-50"
    }
  }

  const getProgressColor = (value: number) => {
    if (value >= 0.9) return "bg-green-500"
    if (value >= 0.8) return "bg-blue-500"
    if (value >= 0.7) return "bg-yellow-500"
    if (value >= 0.6) return "bg-orange-500"
    return "bg-red-500"
  }

  const handleDeleteClick = (model: ModelInfo) => {
    setModelToDelete(model)
    setDeleteDialogOpen(true)
  }

  const deleteModel = async () => {
    if (!modelToDelete) return
    
    setDeleting(true)
    try {
      const response = await apiCall(
        `/api/models/registry/${encodeURIComponent(modelToDelete.model_id)}?delete_files=true`,
        { method: 'DELETE' }
      )
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || `HTTP ${response.status}`)
      }
      
      toast({
        title: "Model deleted",
        description: `Model ${modelToDelete.model_id} has been removed from registry`,
      })
      
      await loadModels()
      await loadRegistryStats()
    } catch (error) {
      console.error("Failed to delete model:", error)
      toast({
        variant: "destructive",
        title: "Failed to delete model",
        description: (error as Error).message,
      })
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setModelToDelete(null)
    }
  }

  const getStatusBadge = (status: string, map70: number) => {
    const threshold = 0.7
    if (status === "production") {
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-300">
          <CheckCircle className="w-3 h-3 mr-1" />
          Production
        </Badge>
      )
    }
    
    if (map70 >= threshold) {
      return (
        <Badge className="bg-green-100 text-green-800 border-green-300">
          <CheckCircle className="w-3 h-3 mr-1" />
          Ready (mAP@0.7: {map70.toFixed(3)})
        </Badge>
      )
    } else {
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Needs Improvement (mAP@0.7: {map70.toFixed(3)})
        </Badge>
      )
    }
  }

  const promoteModel = async (modelId: string) => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.MODELS_PROMOTE + `?model_id=${encodeURIComponent(modelId)}`, {
        method: 'POST',
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || `HTTP ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Model promoted",
          description: `Model ${modelId} is now in production`,
        })
        await loadModels()
        await loadRegistryStats()
      } else {
        throw new Error(data.error || 'Failed to promote model')
      }
    } catch (error) {
      console.error("Failed to promote model:", error)
      toast({
        variant: "destructive",
        title: "Failed to promote model",
        description: (error as Error).message,
      })
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <MainHeader />

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Model Registry</h1>
          <p className="text-sm text-muted-foreground">
            Manage versions and performance of trained models from Knowledge Distillation.
            Paper threshold: <strong className="text-foreground">mAP@0.7 ≥ 0.7</strong>
          </p>
        </div>

        {/* Registry Statistics */}
        {registryStats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Total Models</div>
                <div className="text-2xl font-bold">{registryStats.total_models}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Ready Models</div>
                <div className="text-2xl font-bold text-green-600">
                  {registryStats.ready_models}
                  <CheckCircle className="w-4 h-4 ml-2 inline text-green-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Production Model</div>
                <div className="text-2xl font-bold text-blue-600">
                  {registryStats.production_models}
                  <Database className="w-4 h-4 ml-2 inline text-blue-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">Average mAP@0.7</div>
                <div className="text-2xl font-bold">
                  {registryStats.average_map70.toFixed(4)}
                  <TrendingUp className="w-4 h-4 ml-2 inline text-green-600" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Models Table */}
        <Card>
          <CardHeader>
            <CardTitle>Model Versions</CardTitle>
            <CardDescription>
              All trained model versions and performance metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center">
                  <Clock className="h-6 w-6 animate-spin" />
                  <span className="ml-2">Loading models...</span>
                </div>
              </div>
            ) : models.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No models registered yet. Start training to create models.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model ID</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>mAP@0.5</TableHead>
                    <TableHead>mAP@0.5:0.95</TableHead>
                    <TableHead>mAP@0.7</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={`${model.model_id}_v${model.version}`}>
                      <TableCell className="font-medium">{model.model_id}</TableCell>
                      <TableCell>v{model.version}</TableCell>
                      <TableCell>{getStatusBadge(model.status, model.metrics.map70)}</TableCell>
                      <TableCell>{model.metrics.map50.toFixed(4)}</TableCell>
                      <TableCell>{model.metrics.map50_95.toFixed(4)}</TableCell>
                      <TableCell>
                        <span className={model.metrics.map70 >= 0.7 ? "text-green-600 font-semibold" : "text-yellow-600 font-semibold"}>
                          {model.metrics.map70.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(model.created_at).toLocaleString('ko-KR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0"
                            onClick={() => loadModelEvaluation(model.model_id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {model.status !== 'production' && model.metrics.map70 >= 0.7 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-blue-600 hover:bg-blue-50"
                              onClick={() => promoteModel(model.model_id)}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDeleteClick(model)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg border">
          <h3 className="font-semibold text-sm mb-3">Status Legend</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="flex items-start gap-2">
              <Badge className="bg-green-100 text-green-800 border-green-300">Ready</Badge>
              <span className="text-muted-foreground">mAP@0.7 ≥ 0.7, ready for Knowledge Distillation</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Needs Improvement</Badge>
              <span className="text-muted-foreground">mAP@0.7 &lt; 0.7, retraining required</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge className="bg-blue-100 text-blue-800 border-blue-300">Production</Badge>
              <span className="text-muted-foreground">Model currently in production</span>
            </div>
          </div>
        </div>

      </main>

      <Dialog open={selectedModel !== null} onOpenChange={(open) => !open && setSelectedModel(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Model Evaluation: {modelEvaluation?.model_name || selectedModel}
            </DialogTitle>
            <DialogDescription>
              Detailed per-class performance evaluation
            </DialogDescription>
          </DialogHeader>

          {loadingEvaluation ? (
            <div className="flex items-center justify-center py-12">
              <Clock className="h-6 w-6 animate-spin mr-2" />
              <span>Loading evaluation...</span>
            </div>
          ) : modelEvaluation ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Overall</div>
                    <Badge className={getGradeColor(modelEvaluation.evaluation_summary.overall_performance)}>
                      {modelEvaluation.evaluation_summary.overall_performance}
                    </Badge>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Detection</div>
                    <div className="text-lg font-bold">{modelEvaluation.evaluation_summary.detection_accuracy}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Precision</div>
                    <div className="text-lg font-bold">{modelEvaluation.evaluation_summary.precision_score}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Classes</div>
                    <div className="text-lg font-bold">{modelEvaluation.evaluation_summary.num_classes}</div>
                  </CardContent>
                </Card>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Per-Class Performance
                </h3>
                
                {Object.keys(modelEvaluation.per_class_evaluation).length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No per-class evaluation data available
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(modelEvaluation.per_class_evaluation).map(([className, metrics]) => (
                      <Card key={className} className="overflow-hidden">
                        <CardHeader className="py-3 px-4 bg-muted/30">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-medium">{className}</CardTitle>
                            <Badge variant="outline" className="text-xs">
                              Class ID: {metrics.class_id}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">AP@0.5</span>
                                <Badge variant="secondary" className={`text-xs ${getGradeColor(metrics.ap50.grade)}`}>
                                  {metrics.ap50.grade}
                                </Badge>
                              </div>
                              <div className="text-lg font-semibold">{metrics.ap50.percentage}</div>
                              <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div 
                                  className={`h-full ${getProgressColor(metrics.ap50.value)}`}
                                  style={{ width: `${metrics.ap50.value * 100}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">AP@0.5:0.95</span>
                                <Badge variant="secondary" className={`text-xs ${getGradeColor(metrics.ap50_95.grade)}`}>
                                  {metrics.ap50_95.grade}
                                </Badge>
                              </div>
                              <div className="text-lg font-semibold">{metrics.ap50_95.percentage}</div>
                              <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div 
                                  className={`h-full ${getProgressColor(metrics.ap50_95.value)}`}
                                  style={{ width: `${metrics.ap50_95.value * 100}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">Precision</span>
                                <Badge variant="secondary" className={`text-xs ${getGradeColor(metrics.precision.grade)}`}>
                                  {metrics.precision.grade}
                                </Badge>
                              </div>
                              <div className="text-lg font-semibold">{metrics.precision.percentage}</div>
                              <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div 
                                  className={`h-full ${getProgressColor(metrics.precision.value)}`}
                                  style={{ width: `${metrics.precision.value * 100}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-muted-foreground">Recall</span>
                                <Badge variant="secondary" className={`text-xs ${getGradeColor(metrics.recall.grade)}`}>
                                  {metrics.recall.grade}
                                </Badge>
                              </div>
                              <div className="text-lg font-semibold">{metrics.recall.percentage}</div>
                              <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
                                <div 
                                  className={`h-full ${getProgressColor(metrics.recall.value)}`}
                                  style={{ width: `${metrics.recall.value * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSelectedModel(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Failed to load evaluation data
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{modelToDelete?.model_id}</strong>?
              This will permanently remove the model from the registry and delete associated files.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteModel}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
