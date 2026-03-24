"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { 
  ArrowRight, TrendingUp, Zap, Brain, RotateCcw, 
  CheckCircle, AlertCircle, Clock, Play
} from "lucide-react"
import Link from "next/link"
import { WorkflowSummary } from "@/hooks/use-workflow-status"

interface WorkflowSummaryCardProps {
  summary: WorkflowSummary | null
  loading?: boolean
  compact?: boolean
  onGoToLabeling?: () => void
  onStartTraining?: () => void
}

const PHASE_INFO = {
  1: { 
    name: "Cold-start", 
    icon: Zap, 
    color: "text-blue-600", 
    bg: "bg-blue-100",
    description: "Initial labeling phase. Use SAM or manual tools to label images. YOLO model will be available after training.",
    hint: "Click on any image below to start labeling with SAM v2"
  },
  2: { 
    name: "Distillation", 
    icon: Brain, 
    color: "text-purple-600", 
    bg: "bg-purple-100",
    description: "Model is being trained with your labels. Auto-labeling will become available soon.",
    hint: "Review auto-labeled images for accuracy"
  },
  3: { 
    name: "Refinement", 
    icon: RotateCcw, 
    color: "text-green-600", 
    bg: "bg-green-100",
    description: "Iterative improvement phase. Review and correct auto-labeled results to improve model accuracy.",
    hint: "Focus on correcting low-confidence predictions"
  },
} as const

export default function WorkflowSummaryCard({ summary, loading, compact = false, onGoToLabeling, onStartTraining }: WorkflowSummaryCardProps) {
  if (loading && !summary) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading workflow status...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <span className="text-muted-foreground">Unable to load workflow status</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  const phase = summary.current_phase as 1 | 2 | 3
  const phaseInfo = PHASE_INFO[phase] || PHASE_INFO[1]
  const PhaseIcon = phaseInfo.icon

  if (compact) {
    const isOnGalleryPage = summary.next_action.route === "/" || summary.next_action.route === "/gallery"
    
    return (
      <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`${phaseInfo.bg} p-2 rounded-lg`}>
                <PhaseIcon className={`h-5 w-5 ${phaseInfo.color}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Phase {phase}: {phaseInfo.name}</span>
                  <Badge variant="outline" className="text-xs">
                    Iteration {summary.current_iteration}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {phaseInfo.hint}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="text-center px-3 py-1 rounded bg-amber-100 dark:bg-amber-950/50">
                <div className="font-bold text-amber-600">{summary.queues.review_queue_size}</div>
                <div className="text-xs text-muted-foreground">Review</div>
              </div>
              <div className="text-center px-3 py-1 rounded bg-green-100 dark:bg-green-950/50">
                <div className="font-bold text-green-600">{summary.queues.labeled_count}</div>
                <div className="text-xs text-muted-foreground">Labeled</div>
              </div>
              {phase === 1 && summary.queues.labeled_count >= 1 && (
                <Link href="/training">
                  <Button size="sm" className="bg-purple-600 hover:bg-purple-700">
                    <Play className="mr-2 h-4 w-4" />
                    Start Training
                  </Button>
                </Link>
              )}
              {phase === 3 && onStartTraining && (
                <Button 
                  size="sm" 
                  className="bg-purple-600 hover:bg-purple-700" 
                  onClick={onStartTraining}
                  disabled={summary.queues.reviewed_since_last_train === 0}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start Training
                  {summary.queues.reviewed_since_last_train > 0 && ` (${summary.queues.reviewed_since_last_train})`}
                </Button>
              )}
              {!isOnGalleryPage && phase !== 1 && phase !== 3 && (
                <Link href={summary.next_action.route}>
                  <Button size="sm">
                    {summary.next_action.cta}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Workflow Status
          </CardTitle>
          <Badge variant="outline">
            Iteration {summary.current_iteration}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-3">
            <div className={`${phaseInfo.bg} p-2 rounded-lg`}>
              <PhaseIcon className={`h-5 w-5 ${phaseInfo.color}`} />
            </div>
            <div>
              <p className="font-medium">Phase {phase}: {phaseInfo.name}</p>
              <p className="text-sm text-muted-foreground">{summary.phase_name}</p>
            </div>
          </div>
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Active
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <p className="text-2xl font-bold text-amber-600">{summary.queues.review_queue_size}</p>
            <p className="text-xs text-muted-foreground">Need Review</p>
          </div>
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
            <p className="text-2xl font-bold text-green-600">{summary.queues.auto_label_queue_size}</p>
            <p className="text-xs text-muted-foreground">Auto-labeled</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30">
            <p className="text-2xl font-bold text-blue-600">{summary.queues.reviewed_since_last_train}</p>
            <p className="text-xs text-muted-foreground">Reviewed</p>
          </div>
        </div>

        {summary.training.last_map70 !== null && (
          <div className="p-3 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Last Model mAP@0.7</span>
              <span className={`font-bold ${summary.training.last_map70 >= 0.7 ? 'text-green-600' : 'text-amber-600'}`}>
                {(summary.training.last_map70 * 100).toFixed(1)}%
              </span>
            </div>
            <Progress 
              value={summary.training.last_map70 * 100} 
              className="h-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Target: ≥70% (Paper requirement)
            </p>
          </div>
        )}

        {summary.automation_trend.message && (
          <div className="p-3 rounded-lg bg-muted/30 border-l-4 border-primary">
            <p className="text-sm">{summary.automation_trend.message}</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">{summary.next_action.title}</span>
          {onGoToLabeling && summary.next_action.route === "/" ? (
            <Button size="sm" variant="default" onClick={onGoToLabeling}>
              {summary.next_action.cta}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Link href={summary.next_action.route}>
              <Button size="sm" variant="default">
                {summary.next_action.cta}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
