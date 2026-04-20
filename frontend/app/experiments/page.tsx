"use client"

import { useState, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"
import { Clock, TrendingUp, Download, BarChart3, FlaskConical, Timer, Users, Zap, RefreshCw, Trash2, AlertCircle, FileText } from "lucide-react"

const MetricsTrendGrid = dynamic(
  () => import("@/components/experiment-charts").then(mod => mod.MetricsTrendGrid),
  { ssr: false, loading: () => <div className="h-[300px] flex items-center justify-center text-muted-foreground">Loading charts...</div> }
)
const SourceDistributionChart = dynamic(
  () => import("@/components/experiment-charts").then(mod => mod.SourceDistributionChart),
  { ssr: false, loading: () => <div className="h-[250px] flex items-center justify-center text-muted-foreground">Loading chart...</div> }
)
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import MainHeader from "@/components/main-header"

interface ExperimentSummary {
  experiment_id: string
  name: string
  description: string
  current_iteration: number
  confidence_threshold: number
  test_set_id: string | null
  created_at: string
}

interface IterationSummary {
  iteration: number
  images: number
  auto_rate: number
  review_per_image: number
  time_per_image: number
  total_objects: number
  auto_approved: number
  user_modified: number
  user_added: number
}

interface ModelPerformance {
  iteration: number
  map50: number
  precision: number
  recall: number
}

interface OverallStats {
  total_images: number
  total_time_seconds: number
  total_objects: number
  overall_auto_rate: number
  avg_time_per_image: number
}

interface DashboardData {
  experiment: ExperimentSummary
  iteration_summary: IterationSummary[]
  model_performance: ModelPerformance[]
  overall_stats?: OverallStats
}

export default function ExperimentsPage() {
  const { toast } = useToast()
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [experimentToDelete, setExperimentToDelete] = useState<ExperimentSummary | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    loadExperiments()
  }, [])

  useEffect(() => {
    if (selectedExperimentId) {
      loadDashboard(selectedExperimentId)
    }
  }, [selectedExperimentId])

  const loadExperiments = async () => {
    try {
      setLoading(true)
      const response = await apiCall(API_CONFIG.ENDPOINTS.EXPERIMENTS)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success && data.experiments) {
        setExperiments(data.experiments)
        if (data.experiments.length > 0 && !selectedExperimentId) {
          setSelectedExperimentId(data.experiments[0].experiment_id)
        }
      }
    } catch (error) {
      console.error("Failed to load experiments:", error)
      toast({
        variant: "destructive",
        title: "Failed to load experiments",
        description: (error as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }

  const loadDashboard = async (experimentId: string) => {
    try {
      setLoadingDashboard(true)
      const response = await apiCall(`${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${experimentId}/dashboard`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success && data.dashboard) {
        setDashboard(data.dashboard)
      }
    } catch (error) {
      console.error("Failed to load dashboard:", error)
      toast({
        variant: "destructive",
        title: "Failed to load dashboard",
        description: (error as Error).message,
      })
    } finally {
      setLoadingDashboard(false)
    }
  }

  const handleExport = async (format: "json" | "csv") => {
    if (!selectedExperimentId) return

    try {
      setExporting(true)
      const response = await apiCall(`${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${selectedExperimentId}/export?format=${format}`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `experiment_${selectedExperimentId}_${format}.json`
      a.click()
      URL.revokeObjectURL(url)

      toast({
        title: "Export successful",
        description: `Data exported as ${format.toUpperCase()}`,
      })
    } catch (error) {
      console.error("Failed to export:", error)
      toast({
        variant: "destructive",
        title: "Export failed",
        description: (error as Error).message,
      })
    } finally {
      setExporting(false)
    }
  }

  const handleDeleteExperiment = async () => {
    if (!experimentToDelete) return

    setIsDeleting(true)
    try {
      const response = await apiCall(
        `${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${experimentToDelete.experiment_id}`,
        { method: "DELETE" }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      toast({
        title: "Experiment Deleted",
        description: `Experiment ${experimentToDelete.name} has been deleted.`,
      })

      if (selectedExperimentId === experimentToDelete.experiment_id) {
        setSelectedExperimentId(null)
        setDashboard(null)
      }

      loadExperiments()
    } catch (error) {
      console.error("Failed to delete experiment:", error)
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: (error as Error).message,
      })
    } finally {
      setIsDeleting(false)
      setExperimentToDelete(null)
    }
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`
  }

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`

  const getAutoRateColor = (rate: number) => {
    if (rate >= 0.8) return "text-green-600"
    if (rate >= 0.6) return "text-blue-600"
    if (rate >= 0.4) return "text-yellow-600"
    return "text-red-600"
  }

  const getMapForIteration = (iteration: number): number | null => {
    if (!dashboard?.model_performance) return null
    const perf = dashboard.model_performance.find(p => p.iteration === iteration)
    return perf ? perf.map50 : null
  }

  const metricsTrendData = useMemo(() => {
    if (!dashboard?.iteration_summary) return []
    return dashboard.iteration_summary.map(iter => {
      const map50 = getMapForIteration(iter.iteration)
      return {
        name: iter.iteration === 0 ? "Cold-start" : `Iter ${iter.iteration}`,
        iteration: iter.iteration,
        auto_rate: iter.auto_rate * 100,
        review_per_image: iter.review_per_image,
        time_per_image: iter.time_per_image,
        map50: map50 !== null ? map50 * 100 : null,
      }
    })
  }, [dashboard?.iteration_summary, dashboard?.model_performance])

  const sourceDistributionData = useMemo(() => {
    if (!dashboard?.iteration_summary) return []
    return dashboard.iteration_summary.map(iter => {
      const total = iter.total_objects || 1
      return {
        name: iter.iteration === 0 ? "Cold-start" : `Iter ${iter.iteration}`,
        iteration: iter.iteration,
        autoApproved: (iter.auto_approved / total) * 100,
        userModified: (iter.user_modified / total) * 100,
        userAdded: (iter.user_added / total) * 100,
        autoApprovedRaw: iter.auto_approved,
        userModifiedRaw: iter.user_modified,
        userAddedRaw: iter.user_added,
        total: iter.total_objects,
      }
    })
  }, [dashboard?.iteration_summary])

  const handleExportLaTeX = () => {
    if (!dashboard?.iteration_summary) return

    const rows = dashboard.iteration_summary.map(iter => {
      const map50 = getMapForIteration(iter.iteration)
      const mapStr = map50 !== null ? `${(map50 * 100).toFixed(1)}\\%` : "-"
      const iterName = iter.iteration === 0 ? "Cold-start" : `Iter ${iter.iteration}`
      return `${iterName} & ${iter.images} & ${(iter.auto_rate * 100).toFixed(1)}\\% & ${iter.review_per_image.toFixed(2)} & ${formatTime(iter.time_per_image)} & ${mapStr} \\\\`
    }).join("\n")

    const latex = `\\begin{table}[h]
\\centering
\\caption{Labeling efficiency across iterations}
\\begin{tabular}{lccccc}
\\hline
Iteration & Images & Auto Rate & Review/Img & Time/Img & mAP@0.5 \\\\
\\hline
${rows}
\\hline
\\end{tabular}
\\label{tab:iteration-results}
\\end{table}`

    navigator.clipboard.writeText(latex).then(() => {
      toast({
        title: "LaTeX table copied",
        description: "Table copied to clipboard",
      })
    }).catch(() => {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Failed to copy to clipboard",
      })
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <MainHeader />

      <main className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2 flex items-center gap-2">
              <FlaskConical className="h-6 w-6" />
              Experiment Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Research metrics: mAP@0.5, Automation Rate, Review/Image, Time/Image
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedExperimentId || ""}
              onValueChange={setSelectedExperimentId}
              disabled={loading || experiments.length === 0}
            >
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select experiment" />
              </SelectTrigger>
              <SelectContent>
                {experiments.map((exp) => (
                  <SelectItem key={exp.experiment_id} value={exp.experiment_id}>
                    {exp.name} (Iter {exp.current_iteration})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => selectedExperimentId && loadDashboard(selectedExperimentId)}
              disabled={!selectedExperimentId || loadingDashboard}
            >
              <RefreshCw className={`h-4 w-4 ${loadingDashboard ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const exp = experiments.find(e => e.experiment_id === selectedExperimentId)
                if (exp) setExperimentToDelete(exp)
              }}
              disabled={!selectedExperimentId}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Clock className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading experiments...</p>
          </div>
        ) : experiments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No experiments found. Create an experiment via API to start tracking metrics.
            </CardContent>
          </Card>
        ) : dashboard ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <BarChart3 className="h-3 w-3" />
                    Current Iteration
                  </div>
                  <div className="text-2xl font-bold">{dashboard.experiment.current_iteration}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Users className="h-3 w-3" />
                    Total Images
                  </div>
                  <div className="text-2xl font-bold">{dashboard.overall_stats?.total_images || 0}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Zap className="h-3 w-3" />
                    Overall Auto Rate
                  </div>
                  <div className={`text-2xl font-bold ${getAutoRateColor(dashboard.overall_stats?.overall_auto_rate || 0)}`}>
                    {formatPercentage(dashboard.overall_stats?.overall_auto_rate || 0)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Timer className="h-3 w-3" />
                    Avg Time/Image
                  </div>
                  <div className="text-2xl font-bold">
                    {formatTime(dashboard.overall_stats?.avg_time_per_image || 0)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {dashboard.iteration_summary.length > 0 && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">📈 Metrics Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <MetricsTrendGrid data={metricsTrendData} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">📊 Object Source Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <SourceDistributionChart data={sourceDistributionData} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Iteration Summary</CardTitle>
                  <CardDescription>Per-iteration metrics for paper analysis</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("json")}
                    disabled={exporting}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("csv")}
                    disabled={exporting}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportLaTeX}
                    disabled={!dashboard?.iteration_summary?.length}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    LaTeX
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {dashboard.iteration_summary.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No iteration data yet. Start labeling to collect metrics.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Iteration</TableHead>
                        <TableHead className="text-right">Images</TableHead>
                        <TableHead className="text-right">Auto Rate</TableHead>
                        <TableHead className="text-right">Review/Image</TableHead>
                        <TableHead className="text-right">Time/Image</TableHead>
                        <TableHead className="text-right">Objects</TableHead>
                        <TableHead className="text-right">Auto Approved</TableHead>
                        <TableHead className="text-right">Modified</TableHead>
                        <TableHead className="text-right">Added</TableHead>
                        <TableHead className="text-right">mAP@0.5</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.iteration_summary.map((iter) => (
                        <TableRow key={iter.iteration}>
                          <TableCell>
                            <Badge variant={iter.iteration === 0 ? "secondary" : "default"}>
                              {iter.iteration === 0 ? "Cold-start" : `Iter ${iter.iteration}`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{iter.images}</TableCell>
                          <TableCell className={`text-right font-medium ${getAutoRateColor(iter.auto_rate)}`}>
                            {formatPercentage(iter.auto_rate)}
                          </TableCell>
                          <TableCell className="text-right">{iter.review_per_image.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{formatTime(iter.time_per_image)}</TableCell>
                          <TableCell className="text-right">{iter.total_objects}</TableCell>
                          <TableCell className="text-right text-green-600">{iter.auto_approved}</TableCell>
                          <TableCell className="text-right text-yellow-600">{iter.user_modified}</TableCell>
                          <TableCell className="text-right text-blue-600">{iter.user_added}</TableCell>
                          <TableCell className="text-right font-medium">
                            {(() => {
                              const map50 = getMapForIteration(iter.iteration)
                              if (iter.iteration === 0 || map50 === null) return <span className="text-muted-foreground">-</span>
                              return <span className="text-green-600">{formatPercentage(map50)}</span>
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {dashboard.model_performance.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Model Performance (Test Set)
                  </CardTitle>
                  <CardDescription>mAP evaluation against frozen ground truth</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Iteration</TableHead>
                        <TableHead className="text-right">mAP@0.5</TableHead>
                        <TableHead className="text-right">Precision</TableHead>
                        <TableHead className="text-right">Recall</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.model_performance.map((perf) => (
                        <TableRow key={perf.iteration}>
                          <TableCell>
                            <Badge>Iter {perf.iteration}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-bold text-green-600">
                            {formatPercentage(perf.map50)}
                          </TableCell>
                          <TableCell className="text-right">{formatPercentage(perf.precision)}</TableCell>
                          <TableCell className="text-right">{formatPercentage(perf.recall)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Experiment Info</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Experiment ID:</span>
                    <span className="ml-2 font-mono">{dashboard.experiment.experiment_id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2">{dashboard.experiment.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Confidence Threshold:</span>
                    <span className="ml-2">{formatPercentage(dashboard.experiment.confidence_threshold)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Test Set:</span>
                    <span className="ml-2">{dashboard.experiment.test_set_id || "Not configured"}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Description:</span>
                    <span className="ml-2">{dashboard.experiment.description || "No description"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <span className="ml-2">{new Date(dashboard.experiment.created_at).toLocaleString('ko-KR')}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : loadingDashboard ? (
          <div className="text-center py-12">
            <Clock className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading dashboard...</p>
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select an experiment to view metrics
            </CardContent>
          </Card>
        )}
      </main>

      <AlertDialog open={!!experimentToDelete} onOpenChange={(open) => !open && setExperimentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete Experiment
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <span className="block">
                  Are you sure you want to delete experiment <strong className="text-foreground">{experimentToDelete?.name}</strong>?
                </span>
                <span className="block">
                  All iteration data and event logs will be deleted. This action cannot be undone.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExperiment}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
