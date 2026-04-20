"use client"

import { useState, useEffect, useCallback } from "react"
import { apiCall, API_CONFIG } from "@/lib/api-config"

export interface WorkflowQueues {
  review_queue_size: number
  auto_label_queue_size: number
  reviewed_since_last_train: number
  total_images: number
  labeled_count: number
  unlabeled_count: number
  needs_review_count: number
}

export interface WorkflowTraining {
  active_job_id: string | null
  last_completed_job_id: string | null
  last_map70: number | null
  train_count?: number
  model_count?: number
}

export interface NextAction {
  phase: number
  action: string
  title: string
  description: string
  cta: string
  route: string
}

export interface AutomationTrend {
  total_iterations: number
  improvement_percent: number | null
  message: string
}

export interface WorkflowSummary {
  current_iteration: number
  current_phase: number
  phase_name: string
  queues: WorkflowQueues
  training: WorkflowTraining
  next_action: NextAction
  automation_trend: AutomationTrend
}

export interface SchedulerStatus {
  status: "idle" | "running" | "scheduled" | "error"
  config: Record<string, unknown>
  scheduled_jobs: number
  running_jobs: number
}

export interface WorkflowStatus {
  summary: WorkflowSummary | null
  scheduler: SchedulerStatus | null
  loading: boolean
  error: string | null
}

export function useWorkflowStatus(pollingInterval: number = 10000) {
  const [status, setStatus] = useState<WorkflowStatus>({
    summary: null,
    scheduler: null,
    loading: true,
    error: null,
  })

  const fetchWorkflowSummary = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.WORKFLOW_SUMMARY)
      if (!response.ok) {
        throw new Error(`Failed to fetch workflow summary: ${response.status}`)
      }
      const data = await response.json()
      return data.summary as WorkflowSummary
    } catch (error) {
      console.error("Error fetching workflow summary:", error)
      return null
    }
  }, [])

  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.SCHEDULER_STATUS)
      if (!response.ok) {
        throw new Error(`Failed to fetch scheduler status: ${response.status}`)
      }
      const data = await response.json()
      return {
        status: data.status,
        config: data.config,
        scheduled_jobs: data.scheduled_jobs,
        running_jobs: data.running_jobs,
      } as SchedulerStatus
    } catch (error) {
      console.error("Error fetching scheduler status:", error)
      return null
    }
  }, [])

  const refresh = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }))
    
    try {
      const [summary, scheduler] = await Promise.all([
        fetchWorkflowSummary(),
        fetchSchedulerStatus(),
      ])

      setStatus({
        summary,
        scheduler,
        loading: false,
        error: null,
      })
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }))
    }
  }, [fetchWorkflowSummary, fetchSchedulerStatus])

  useEffect(() => {
    refresh()
    
    if (pollingInterval > 0) {
      const interval = setInterval(refresh, pollingInterval)
      return () => clearInterval(interval)
    }
  }, [refresh, pollingInterval])

  const startIteration = useCallback(async (phase: number = 2) => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.WORKFLOW_START_ITERATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
      })
      if (!response.ok) throw new Error("Failed to start iteration")
      await refresh()
      return true
    } catch (error) {
      console.error("Error starting iteration:", error)
      return false
    }
  }, [refresh])

  const setPhase = useCallback(async (phase: number) => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.WORKFLOW_SET_PHASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
      })
      if (!response.ok) throw new Error("Failed to set phase")
      await refresh()
      return true
    } catch (error) {
      console.error("Error setting phase:", error)
      return false
    }
  }, [refresh])

  const triggerAutoAnnotate = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.SCHEDULER_TRIGGER_AUTO, {
        method: "POST",
      })
      if (!response.ok) throw new Error("Failed to trigger auto-annotate")
      const data = await response.json()
      await refresh()
      return data.job_id
    } catch (error) {
      console.error("Error triggering auto-annotate:", error)
      return null
    }
  }, [refresh])

  const triggerDistillation = useCallback(async () => {
    try {
      const response = await apiCall(API_CONFIG.ENDPOINTS.SCHEDULER_TRIGGER_DISTILL, {
        method: "POST",
      })
      if (!response.ok) throw new Error("Failed to trigger distillation")
      const data = await response.json()
      await refresh()
      return data.job_id
    } catch (error) {
      console.error("Error triggering distillation:", error)
      return null
    }
  }, [refresh])

  return {
    ...status,
    refresh,
    startIteration,
    setPhase,
    triggerAutoAnnotate,
    triggerDistillation,
  }
}
