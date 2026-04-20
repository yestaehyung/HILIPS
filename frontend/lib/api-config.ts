export const API_CONFIG = {
  // Use relative URLs for production (Next.js will proxy to backend)
  // For development, this will use rewrite rules in next.config.mjs
  BASE_URL: "", // Empty string to use relative URLs

  // API endpoints - HILIPS 3-stage methodology
  ENDPOINTS: {
    // Gallery & Upload
    IMAGES: "/api/images",
    UPLOAD_IMAGE: "/api/upload-image",
    UPLOAD: "/api/upload",
    
    // Phase 1: Cold-start Labeling (LLM + SAM2)
    COLDSTART_LABEL: "/api/coldstart/label",
    COLDSTART_BATCH: "/api/coldstart/label/batch",
    COLDSTART_STATUS: "/api/coldstart/status",
    
    // Original Segmentation (SAM2 point-based)
    GENERATE_POLYGONS: "/api/generate-polygons",
    GENERATE_POLYGONS_WITH_POINTS: "/api/generate-polygons-with-points",
    
    // LLM-based (Gemini)
    GEMINI_SEGMENTATION: "/api/gemini-segmentation",
    
    // Annotations (COCO format)
    CONVERT_TO_COCO: "/api/convert-to-coco",
    ANNOTATIONS: "/api/annotations",
    
    // Phase 2: Knowledge Distillation
    TRAIN_START: "/api/train-model",
    TRAINING_STATUS: "/api/training/status",
    TRAINING_JOBS: "/api/training/jobs",
    MODELS_LIST: "/api/models",
    MODELS_WEIGHTS: "/api/models/weights",
    MODEL_INFERENCE: "/api/models",
    MODELS_REGISTER: "/api/models/register",
    MODELS_PROMOTE: "/api/models/promote",
    MODELS_EVALUATE: "/api/models/evaluate",
    
    // Phase 3: Iterative Refinement (Active Learning)
    HIL_SESSIONS: "/api/hil/sessions",
    HIL_SESSION_START: "/api/hil/sessions/start",
    HIL_SESSION_COMPLETE: "/api/hil/sessions/complete",
    REVIEW_QUEUE: "/api/active-learning/review-queue",
    AUTO_LABEL_QUEUE: "/api/active-learning/auto-label-queue",
    REVIEW_QUEUE_MARK: "/api/active-learning/review-queue/mark",
    DISTILLATION_DATASET: "/api/active-learning/prepare-dataset",
    
    // Workflow Scheduler
    SCHEDULER_START: "/api/scheduler/start",
    SCHEDULER_STOP: "/api/scheduler/stop",
    SCHEDULER_STATUS: "/api/scheduler/status",
    SCHEDULER_CONFIG: "/api/scheduler/config",
    SCHEDULER_TRIGGER_AUTO: "/api/scheduler/trigger/auto-annotate",
    SCHEDULER_TRIGGER_DISTILL: "/api/scheduler/trigger/distillation",
    
    // Workflow State (Dashboard)
    WORKFLOW_STATE: "/api/workflow/state",
    WORKFLOW_SUMMARY: "/api/workflow/summary",
    WORKFLOW_NEXT_ACTION: "/api/workflow/next-action",
    WORKFLOW_ITERATIONS: "/api/workflow/iterations",
    WORKFLOW_AUTOMATION_TREND: "/api/workflow/automation-trend",
    WORKFLOW_SET_PHASE: "/api/workflow/phase",
    WORKFLOW_START_ITERATION: "/api/workflow/iteration/start",
    
    // Active Learning Stats
    ACTIVE_LEARNING_STATS: "/api/active-learning/stats",
    ACTIVE_LEARNING_REVIEW_HISTORY: "/api/active-learning/review-history",
    
    // Batch Auto-Labeling
    BATCH_INFERENCE: "/api/models",
    LABELING_STATUS: "/api/labeling-status",
    
    // Experiments
    EXPERIMENTS: "/api/experiments",
    EXPERIMENTS_LOG: "/api/experiments",
    EXPERIMENTS_ITERATIONS: "/api/experiments",
    EXPERIMENTS_EXPORT: "/api/experiments",
    EXPERIMENTS_DASHBOARD: "/api/experiments",
    TEST_SETS: "/api/experiments/test-sets",
    TEST_SETS_RANDOM: "/api/experiments/test-sets/random",
    TEST_SETS_IMAGES: "/api/experiments/test-sets/images",
    TEST_SETS_CHECK_IMAGE: "/api/experiments/test-sets/check-image",
    EVALUATE: "/api/experiments/evaluate",
  },
}

// Helper function for API calls
export const apiCall = (endpoint: string, options?: RequestInit) => {
  const url = `${API_CONFIG.BASE_URL}${endpoint}`
  return fetch(url, options)
}

export const apiCallWithTimeout = (
  endpoint: string, 
  options?: RequestInit, 
  timeoutMs: number = 60000
): Promise<Response> => {
  const url = `${API_CONFIG.BASE_URL}${endpoint}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))
}

// Gemini default settings. Paper Section 2.1 specifies Gemini 2.5 Pro.
export const GEMINI_SEGMENTATION_DEFAULTS = {
  model: "gemini-2.5-pro",
  temperature: 0.5,
  resizeWidth: 1024,
}

// Cold-start Labeling default settings
export const COLDSTART_DEFAULTS = {
  confidence_threshold: 0.3,
  save_intermediate: true,
  task_description: "Detect all objects in the image",
}

// Active Learning default settings
export const ACTIVE_LEARNING_DEFAULTS = {
  confidence_threshold: 0.8,  // Paper default
  review_threshold: 0.5,
  auto_annotate_interval: 24,  // hours
}

// Knowledge Distillation default settings
export const DISTILLATION_DEFAULTS = {
  map_threshold: 0.7,  // Paper threshold
  epochs: 100,
  batch_size: 16,
  img_size: 640,
}
