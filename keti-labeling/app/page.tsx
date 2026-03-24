"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  CheckCircle, AlertTriangle, Clock, RefreshCw, Zap,
  ArrowRight, Brain, RotateCcw, ImageIcon, Tags, Activity, Play
} from "lucide-react"
import Link from "next/link"
import MainHeader from "@/components/main-header"
import { useWorkflowStatus } from "@/hooks/use-workflow-status"
import { apiCall, API_CONFIG } from "@/lib/api-config"
import { useToast } from "@/hooks/use-toast"

const PHASES = [
  { num: 1, name: "Cold-start", icon: Zap, route: "/gallery", color: "cyan" },
  { num: 2, name: "Distillation", icon: Brain, route: "/training", color: "purple" },
  { num: 3, name: "Refinement", icon: RotateCcw, route: "/gallery?filter=needs-review", color: "emerald" },
] as const

export default function Home() {
  const { summary, loading, error, refresh, setPhase, startIteration } = useWorkflowStatus(5000)
  const [isStartingIteration, setIsStartingIteration] = useState(false)
  const [currentExperimentId, setCurrentExperimentId] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    const savedExpId = localStorage.getItem("hilips_current_experiment")
    setCurrentExperimentId(savedExpId)
  }, [])

  const handleStartNextIteration = async () => {
    if (!currentExperimentId) {
      toast({
        variant: "destructive",
        title: "No Experiment Selected",
        description: "Please select an experiment in Gallery first.",
      })
      return
    }

    setIsStartingIteration(true)
    const success = await startIteration(2)
    
    if (success && currentExperimentId) {
      try {
        const response = await apiCall(`${API_CONFIG.ENDPOINTS.EXPERIMENTS}/${currentExperimentId}/iterations/start`, {
          method: "POST",
        })
        if (response.ok) {
          const data = await response.json()
          toast({
            title: "Iteration Started",
            description: `Started iteration ${data.iteration?.iteration || "new"}`,
          })
        }
      } catch (error) {
        console.error("Failed to start experiment iteration:", error)
      }
    }
    
    setIsStartingIteration(false)
    if (success) {
      window.location.href = "/training"
    }
  }

  const getPhaseStatus = (phase: number) => {
    if (!summary) return "idle"
    if (summary.current_phase === phase) return "active"
    if (summary.current_phase > phase) return "completed"
    return "idle"
  }

  const formatStatValue = (value: number | undefined | null) => {
    if (value === undefined || value === null) return { display: "—", isEmpty: true }
    if (value === 0) return { display: "0", isEmpty: true }
    return { display: value.toString(), isEmpty: false }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <MainHeader />
        <main className="container mx-auto px-4 py-12">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <p className="text-lg font-medium mb-2">Failed to load pipeline status</p>
            <p className="text-sm text-muted-foreground mb-4">Please check your connection and try again</p>
            <Button onClick={refresh} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <MainHeader />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Iteration {summary?.current_iteration ?? 0}
            </p>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={refresh} 
            disabled={loading}
            className="hover:bg-muted transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {loading && !summary ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 animate-spin text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Loading pipeline status...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Phase Stepper */}
            <div className="relative flex items-center justify-between px-4">
              {PHASES.map((phase, idx) => {
                const status = getPhaseStatus(phase.num)
                const Icon = phase.icon
                const isActive = status === "active"
                const isCompleted = status === "completed"
                const nextStatus = idx < PHASES.length - 1 ? getPhaseStatus(phase.num + 1) : "idle"
                
                return (
                  <div key={phase.num} className="flex items-center flex-1">
                    <button 
                      onClick={() => setPhase(phase.num)}
                      className="flex flex-col items-center group relative z-10 cursor-pointer"
                      title={isActive ? `Current: Phase ${phase.num}` : `Switch to Phase ${phase.num}: ${phase.name}`}
                    >
                      <div className={`
                        relative w-12 h-12 rounded-full flex items-center justify-center 
                        transition-all duration-300 ease-out
                        ${isActive ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-110' : ''}
                        ${isCompleted ? 'bg-primary/20 text-primary' : ''}
                        ${status === 'idle' ? 'bg-muted text-muted-foreground hover:bg-muted/80' : ''}
                        group-hover:scale-105 group-hover:shadow-md
                      `}>
                        {isCompleted ? (
                          <CheckCircle className="h-5 w-5" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                        {isActive && (
                          <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
                        )}
                      </div>
                      <span className={`
                        text-xs mt-3 font-medium transition-colors duration-200
                        ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}
                      `}>
                        {phase.name}
                      </span>
                    </button>
                    
                    {/* Connection Line */}
                    {idx < PHASES.length - 1 && (
                      <div className="flex-1 mx-4 relative h-[3px] rounded-full overflow-hidden bg-border">
                        <div 
                          className={`
                            absolute inset-y-0 left-0 rounded-full transition-all duration-500
                            ${nextStatus !== 'idle' ? 'bg-primary w-full' : 'w-0'}
                            ${isCompleted && nextStatus === 'active' ? 'bg-gradient-to-r from-primary to-primary/60' : ''}
                          `}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Next Action Card */}
            {summary?.next_action && (
              <Card className="border-primary/30 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 overflow-hidden relative">
                <div className="absolute inset-0 bg-grid-white/5 [mask-image:linear-gradient(0deg,transparent,black)]" />
                <CardContent className="p-5 relative">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="shrink-0 w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <ArrowRight className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{summary.next_action.title}</p>
                        <p className="text-sm text-muted-foreground truncate">{summary.next_action.description}</p>
                      </div>
                    </div>
                    <Link href={summary.next_action.route}>
                      <Button className="shrink-0 shadow-sm hover:shadow-md transition-shadow">
                        {summary.next_action.cta}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { 
                  icon: ImageIcon, 
                  value: summary?.queues.total_images, 
                  label: "Total Images",
                  color: "blue",
                  bgClass: "bg-blue-500/20",
                  iconClass: "text-blue-600"
                },
                { 
                  icon: Tags, 
                  value: summary?.queues.labeled_count, 
                  label: "Labeled",
                  color: "green",
                  bgClass: "bg-emerald-500/20",
                  iconClass: "text-emerald-600"
                },
                { 
                  icon: Activity, 
                  value: summary?.queues.review_queue_size, 
                  label: "Needs Review",
                  color: "amber",
                  bgClass: "bg-amber-500/20",
                  iconClass: "text-amber-600"
                },
                { 
                  icon: CheckCircle, 
                  value: summary?.queues.reviewed_since_last_train, 
                  label: "Reviewed",
                  color: "purple",
                  bgClass: "bg-purple-500/20",
                  iconClass: "text-purple-600"
                },
              ].map((stat) => {
                const Icon = stat.icon
                const { display, isEmpty } = formatStatValue(stat.value)
                
                return (
                  <Card 
                    key={stat.label} 
                    className="group hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-border/60"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-lg ${stat.bgClass} transition-transform group-hover:scale-105`}>
                          <Icon className={`h-5 w-5 ${stat.iconClass}`} />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold tracking-tight ${isEmpty ? 'text-muted-foreground/60' : ''}`}>
                            {display}
                          </p>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Current Phase Details */}
            {summary && (
              <Card className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="px-3 py-1 font-medium">
                        Phase {summary.current_phase}
                      </Badge>
                      <span className="text-sm font-semibold">
                        {PHASES[summary.current_phase - 1]?.name}
                      </span>
                    </div>
                    {summary.training.last_map70 !== null && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">mAP@0.7:</span>
                        <Badge 
                          variant="outline" 
                          className={`
                            font-mono font-medium
                            ${summary.training.last_map70 >= 0.7 
                              ? 'border-green-500/50 text-green-600 bg-green-500/10' 
                              : 'border-amber-500/50 text-amber-600 bg-amber-500/10'
                            }
                          `}
                        >
                          {(summary.training.last_map70 * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Auto-labeled", value: summary.queues.auto_label_queue_size },
                      { label: "Since Last Train", value: summary.queues.reviewed_since_last_train },
                      { label: "Train Count", value: summary.training.train_count },
                      { label: "Models", value: summary.training.model_count },
                    ].map((item, idx) => {
                      const { display, isEmpty } = formatStatValue(item.value)
                      return (
                        <div 
                          key={item.label} 
                          className={`
                            p-3 rounded-lg bg-muted/50 
                            ${idx < 3 ? 'border-r border-border/30 md:border-r' : ''}
                          `}
                        >
                          <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                          <p className={`text-lg font-semibold ${isEmpty ? 'text-muted-foreground/50' : ''}`}>
                            {display}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {summary?.current_phase === 3 && (
              <Card className="border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-emerald-500/10 to-emerald-500/5">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="shrink-0 w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <RotateCcw className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold">Start Next Iteration</p>
                        <p className="text-sm text-muted-foreground">
                          {summary.queues.reviewed_since_last_train > 0 
                            ? `${summary.queues.reviewed_since_last_train} reviewed images ready for training`
                            : "Finish reviewing and start new training cycle"
                          }
                        </p>
                      </div>
                    </div>
                    <Button 
                      onClick={handleStartNextIteration}
                      disabled={isStartingIteration}
                      className="shrink-0 bg-emerald-600 hover:bg-emerald-700 shadow-sm hover:shadow-md transition-shadow"
                    >
                      {isStartingIteration ? (
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Train New Model
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        )}
      </main>
    </div>
  )
}
