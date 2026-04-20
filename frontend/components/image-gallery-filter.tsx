"use client"

import type { ElementType } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LayoutGrid, AlertCircle, FlaskConical, GraduationCap, Tag, TagsIcon } from "lucide-react"

export type DataSplitFilter = "all" | "train-only" | "test-set"
export type LabelStatusFilter = "all" | "labeled" | "unlabeled" | "needs-review"
export type FilterType = "all" | "labeled" | "unlabeled" | "needs-review" | "test-set" | "train-only"

interface ImageGalleryFilterProps {
  onFilterChange: (filter: FilterType) => void
  currentFilter: FilterType
  totalCount: number
  labeledCount: number
  unlabeledCount: number
  needsReviewCount: number
  testSetCount?: number
  dataSplitFilter?: DataSplitFilter
  labelStatusFilter?: LabelStatusFilter
  onDataSplitChange?: (filter: DataSplitFilter) => void
  onLabelStatusChange?: (filter: LabelStatusFilter) => void
}

export default function ImageGalleryFilter({
  onFilterChange,
  currentFilter,
  totalCount,
  labeledCount,
  unlabeledCount,
  needsReviewCount,
  testSetCount = 0,
  dataSplitFilter = "all",
  labelStatusFilter = "all",
  onDataSplitChange,
  onLabelStatusChange,
}: ImageGalleryFilterProps) {
  const trainOnlyCount = totalCount - testSetCount

  const dataSplitOptions: { id: DataSplitFilter; label: string; icon: ElementType; count: number }[] = [
    { id: "all", label: "All", icon: LayoutGrid, count: totalCount },
    { id: "train-only", label: "Train", icon: GraduationCap, count: trainOnlyCount },
    { id: "test-set", label: "Test (GT)", icon: FlaskConical, count: testSetCount },
  ]

  const labelStatusOptions: { id: LabelStatusFilter; label: string; icon: ElementType; count: number }[] = [
    { id: "all", label: "All", icon: TagsIcon, count: totalCount },
    { id: "labeled", label: "Labeled", icon: Tag, count: labeledCount },
    { id: "unlabeled", label: "Unlabeled", icon: Tag, count: unlabeledCount },
    { id: "needs-review", label: "Review", icon: AlertCircle, count: needsReviewCount },
  ]

  const handleDataSplitClick = (id: DataSplitFilter) => {
    if (onDataSplitChange) {
      onDataSplitChange(id)
    } else {
      onFilterChange(id === "all" ? "all" : id)
    }
  }

  const handleLabelStatusClick = (id: LabelStatusFilter) => {
    if (onLabelStatusChange) {
      onLabelStatusChange(id)
    } else {
      onFilterChange(id)
    }
  }

  const isDataSplitActive = (id: DataSplitFilter) => {
    if (onDataSplitChange) return dataSplitFilter === id
    if (id === "all") return currentFilter === "all" || currentFilter === "labeled" || currentFilter === "unlabeled" || currentFilter === "needs-review"
    return currentFilter === id
  }

  const isLabelStatusActive = (id: LabelStatusFilter) => {
    if (onLabelStatusChange) return labelStatusFilter === id
    return currentFilter === id
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Data Split</span>
        <div className="flex flex-wrap gap-1.5">
          {dataSplitOptions.map((option) => (
            <Button
              key={option.id}
              variant={isDataSplitActive(option.id) ? "secondary" : "outline"}
              size="sm"
              onClick={() => handleDataSplitClick(option.id)}
              className="gap-1.5 h-8"
            >
              <option.icon className="h-3.5 w-3.5" />
              {option.label}
              <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0">
                {option.count}
              </Badge>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Status</span>
        <div className="flex flex-wrap gap-1.5">
          {labelStatusOptions.map((option) => (
            <Button
              key={option.id}
              variant={isLabelStatusActive(option.id) ? "secondary" : "outline"}
              size="sm"
              onClick={() => handleLabelStatusClick(option.id)}
              className="gap-1.5 h-8"
            >
              <option.icon className="h-3.5 w-3.5" />
              {option.label}
              <Badge 
                variant={option.id === "needs-review" && option.count > 0 ? "destructive" : "secondary"} 
                className="ml-0.5 text-[10px] px-1.5 py-0"
              >
                {option.count}
              </Badge>
            </Button>
          ))}
        </div>
      </div>

      {currentFilter === "needs-review" && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md">
          <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-100">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong className="block mb-1">Needs Review (Iterative Refinement)</strong>
              <p className="opacity-90">
                Images containing objects with confidence scores below the threshold (0.8).
              </p>
            </div>
          </div>
        </div>
      )}

      {currentFilter === "test-set" && (
        <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900 rounded-md">
          <div className="flex items-start gap-2 text-xs text-purple-900 dark:text-purple-100">
            <FlaskConical className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <strong className="block mb-1">Test Set (Ground Truth)</strong>
              <p className="opacity-90">
                Evaluation-only images. Label using Manual/SAM Point only. LLM auto-labeling is disabled.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
