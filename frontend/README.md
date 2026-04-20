# HILIPS Frontend

Implementation of the three-phase methodology from the paper:
- **Phase 1**: Cold-start Labeling (LLM + SAM2)
- **Phase 2**: Knowledge Distillation (YOLOv8)
- **Phase 3**: Iterative Refinement (Active Learning)

## Project Overview

The HILIPS frontend is an image-labeling web application that implements the HILIPS (Hierarchical Labeling with Iterative Pseudo-Labeling System) methodology.

### Key Features

- **Cold-start Labeling**: Auto-generate initial labels through an LLM (Gemini) + SAM2 pipeline
- **Knowledge Distillation**: Train a lightweight YOLOv8 model and validate it against the mAP 0.7 threshold
- **Iterative Refinement**: Active-learning-based auto-labeling and review-queue management

## Directory Layout

```
frontend/
├── app/
│   ├── page.tsx                          # Main page (HILIPS terminology)
│   ├── models/
│   │   └── page.tsx                      # Model registry (mAP 0.7 UI)
│   ├── pipeline-status/
│   │   └── page.tsx                      # Real-time three-phase pipeline monitoring
│   ├── training/
│   │   ├── page.tsx                      # Knowledge Distillation console
│   │   └── monitor/
│   │       └── page.tsx                  # Training-session monitoring
│   └── page.tsx                          # Other pages
├── components/
│   ├── labeling-workspace.tsx            # Main labeling workspace
│   ├── advanced-polygon-visualization.tsx  # Mask / polygon rendering
│   ├── class-manager.tsx                 # Class management
│   ├── image-gallery.tsx                 # Image gallery
│   ├── image-gallery-filter.tsx          # Needs Review filter component
│   ├── export-manager.tsx                # COCO-format export
│   └── ui/                               # shadcn/ui components
├── lib/
│   ├── api-config.ts                     # API endpoint config (all HILIPS phases)
│   └── utils.ts                          # Utility functions
├── hooks/
│   ├── use-toast.ts                      # Toast notifications
│   └── use-mobile.tsx                    # Responsive hook
├── public/                               # Static assets
└── styles/                               # Global styles
```

## Getting Started

### 1. Install Dependencies

```bash
# Ensure Node.js 18 or later is installed
node --version

# Install pnpm (recommended)
npm install -g pnpm

# Install dependencies
pnpm install
```

### 2. Run the Dev Server

```bash
# Development mode (auto-reload)
pnpm dev

# Production build
pnpm build

# Start production server
pnpm start
```

### 3. Open the UI

- Dev server: http://localhost:3000
- API docs: http://localhost:8000/docs

## Pages

### Main Page (/)

Navigation follows the HILIPS three-phase methodology.

#### Tab Menu

1. **Dataset Gallery**: Image upload and gallery
2. **Pipeline Status**: Real-time monitoring of the three-phase pipeline
3. **Export Data**: Export annotations in COCO format
4. **Upload Resources**: Upload images and class configurations
5. **Knowledge Distillation**: YOLOv8 training console
6. **Model Registry**: Manage trained model versions and performance

### Pipeline Status (/pipeline-status)

Monitor the HILIPS three-phase pipeline in real time.

#### Phase 1: Cold-start Labeling
- **Status**: Active (LLM + SAM2 pipeline enabled)
- **LLM Model**: Gemini-2.5-flash
- **SAM2 Model**: SAM2-Hiera-T
- **Capability**: Automatic object detection and segmentation on image upload
- **Confidence Threshold**: ≥ 0.3

#### Phase 2: Knowledge Distillation
- **Status**: Idle or Production
- **Current Model**: hilips_v1.0
- **mAP@0.7**: 0.781 (threshold: ≥ 0.7)
- **Capability**: YOLOv8-based lightweight model training
- **Model Version**: v3 (history tracking)

#### Phase 3: Iterative Refinement
- **Status**: Active
- **Confidence Threshold**: < 0.8 (Needs Review), ≥ 0.8 (Auto-Label)
- **Review Queue**: 12 images
- **Capability**: Active-learning-based automated workflow
- **Auto-Annotate**: runs every 24 hours

### Model Registry (/models)

Manage versions and performance of models trained via knowledge distillation.

#### Key Features
- **Model List**: Table of every trained model version
- **mAP 0.7 visualization**:
  - Ready (mAP@0.7 ≥ 0.7)
  - Needs Improvement (mAP@0.7 < 0.7)
  - Production (currently deployed)
- **Version history**: Track training count and performance changes for each model
- **Production promotion**: Promote a Ready model to Production
- **Quick Actions**:
  - Train New Model: start a new training run
  - Export Registry: export the model registry as JSON
  - Refresh: refresh to the latest data

#### Metrics Displayed
- **mAP@0.5**: mean Average Precision at IoU 0.5
- **mAP@0.5:0.95**: mean Average Precision across IoU 0.5 – 0.95
- **mAP@0.7**: AP at IoU 0.7 (the paper's threshold)
- **Precision**
- **Recall**
- **F1 Score**: harmonic mean of precision and recall

### Knowledge Distillation (/training)

YOLOv8-based lightweight model training console.

#### Capabilities
- **Select the training dataset**: annotation files generated by cold-start labeling
- **Training settings**: hyperparameters such as epochs, batch size, image size
- **Real-time monitoring**: track progress, loss, and mAP during training
- **GPU memory management**: swap SAM2 and YOLO models out as needed

### Labeling Workspace (/labeling-workspace)

The main labeling workspace.

#### AI Tools
1. **Manual**: draw polygons manually
2. **SAM v2**: click-based SAM2 segmentation
3. **SAM + LLM (HILIPS)**: segmentation from an LLM text prompt
4. **HILIPS**: the integrated cold-start labeling pipeline

#### Capabilities
- **Image rendering**: high-performance mask rendering via Advanced Polygon Visualization
- **Class management**: dynamic class definitions through the Class Manager
- **Manual polygon drawing**: add points with mouse clicks
- **Select and edit objects**: pick polygons, assign classes, delete them
- **Mask / polygon conversion**: convert between SAM masks and polygon formats
- **Export / save**: save to the server in COCO format

### Image Gallery (/image-gallery)

Image gallery with a Needs Review filter.

#### Capabilities
- **Image gallery**: grid view of uploaded images
- **Search**: filter by filename
- **Sort**: ascending / descending by name
- **Filter tabs**:
  - All Images: every image
  - Labeled: labeled images
  - Unlabeled: not-yet-labeled images
  - **Needs Review**: images containing objects with confidence < 0.8 (Iterative Refinement)
- **Annotation status**: shows the labeling status of each image (Saved badge)

#### Needs Review Filter Logic
**Paper 2.2.3**: objects with a confidence score below the threshold (default 0.8) are routed to user review.

- **Auto-label**: objects with confidence ≥ 0.8 are labeled automatically
- **Needs Review**: images containing at least one object with confidence < 0.8
- **Prioritization**: images with very low confidence (< 0.3) or an outlier detection count are reviewed first

## HILIPS Terminology

The original "Training" vocabulary has been updated to paper-aligned terminology.

| Old term | HILIPS term | Description |
|----------|-------------|-------------|
| Training | Knowledge Distillation | YOLOv8-based lightweight model training (paper 2.2.2) |
| Training Job | Distillation Job | Training job |
| Model Training | Student Model Training | Lightweight model training |
| Training History | Distillation History | Training history |

## API Configuration (lib/api-config.ts)

Centralizes every HILIPS API endpoint across the three phases.

### Phase 1 Endpoints
```typescript
COLDSTART_LABEL: "/api/coldstart/label",
COLDSTART_BATCH: "/api/coldstart/label/batch",
COLDSTART_STATUS: "/api/coldstart/status",
```

### Phase 2 Endpoints
```typescript
TRAIN_START: "/api/train-model",
TRAINING_STATUS: "/api/training/status",
TRAINING_JOBS: "/api/training/jobs",
MODELS_LIST: "/api/models",
MODELS_REGISTER: "/api/models/register",
MODELS_PROMOTE: "/api/models/promote",
MODELS_EVALUATE: "/api/models/evaluate",
```

### Phase 3 Endpoints
```typescript
HIL_SESSIONS: "/api/hil/sessions",
HIL_SESSION_START: "/api/hil/sessions/start",
HIL_SESSION_COMPLETE: "/api/hil/sessions/complete",
REVIEW_QUEUE: "/api/active-learning/review-queue",
AUTO_LABEL_QUEUE: "/api/active-learning/auto-label-queue",
REVIEW_QUEUE_MARK: "/api/active-learning/review-queue/mark",
DISTILLATION_DATASET: "/api/active-learning/prepare-dataset",
```

### Defaults
```typescript
// Cold-start Labeling
COLDSTART_DEFAULTS: {
  confidence_threshold: 0.3,
  save_intermediate: true,
  task_description: "Detect every object in the image",
}

// Active Learning
ACTIVE_LEARNING_DEFAULTS: {
  confidence_threshold: 0.8,  // Paper default
  review_threshold: 0.5,
  auto_annotate_interval: 24,  // hours
}

// Knowledge Distillation
DISTILLATION_DEFAULTS: {
  map_threshold: 0.7,  // Paper threshold
  epochs: 100,
  batch_size: 16,
  img_size: 640,
}
```

## Environment Variables

```bash
# API server address
NEXT_PUBLIC_API_URL=http://localhost:8000

# (optional) use a different host
# NEXT_PUBLIC_API_URL=http://your-backend-server:8000
```

## Browser Compatibility

- Chrome / Edge: latest (recommended)
- Firefox: latest
- Safari: latest
- Mobile: responsive UI (Tailwind CSS)

## Feature Summary

### Cold-start Labeling (Phase 1)
- LLM (Gemini 2.5) object detection
- SAM2 precise segmentation
- Automatic bounding-box extraction
- Automatic semantic label generation
- Single / batch image processing
- User review / correction UI

### Knowledge Distillation (Phase 2)
- YOLOv8 training console
- mAP@0.7 threshold visualization
- Model version management
- Ready / Needs Improvement / Production status decisions
- Production promotion
- Performance-history tracking

### Iterative Refinement (Phase 3)
- Confidence-based auto-labeling
- Needs Review filter
- Active-learning queue management
- Auto-annotate every 24 hours
- Weekly automatic retraining trigger
- Real-time pipeline-status monitoring

## Development Notes

### Code-style Guide
- TypeScript strict mode
- Follow the rules of React hooks
- Optimize components (React.memo, useMemo)
- Handle errors with error boundaries

### Testing
```bash
# Run unit tests
pnpm test

# Check coverage
pnpm test:coverage
```

### Building
```bash
# Development build
pnpm build

# Production build (optimized)
pnpm build:prod
```

## Troubleshooting

### Port Conflicts
- Backend: 8000, Frontend: 3000
- When using different ports, set the `NEXT_PUBLIC_API_URL` environment variable

### GPU Out of Memory
- If YOLO training OOMs, reduce `batch_size`
- When SAM2 and YOLO are loaded simultaneously, use the service bypass or memory-management features

## References

- [Paper](https://arxiv.org/abs/xxxx.xxxx)
- [HILIPS backend README](../backend/README.md)
- [Next.js documentation](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com/)

## License

This project is developed for research purposes.
