# HILIPS API Server

Implementation of the three-phase methodology from the paper:
- **Phase 1**: Cold-start Labeling (LLM + SAM2)
- **Phase 2**: Knowledge Distillation (YOLOv8)
- **Phase 3**: Iterative Refinement (Active Learning)

## Directory Layout

```
backend/
├── services/
│   ├── llm_sam_pipeline.py       # Phase 1: LLM + SAM2 integrated pipeline
│   ├── model_registry.py         # Phase 2: mAP 0.7 validation and model versioning
│   ├── active_learning.py        # Phase 3: Active-learning service
│   ├── workflow_scheduler.py     # Automated workflow scheduler
│   ├── yolo_service.py           # YOLOv8 training and inference (existing)
│   └── coco_service.py           # COCO format conversion (existing)
├── routers/
│   ├── coldstart.py              # Phase 1: Cold-start labeling API
│   ├── segmentation.py           # SAM2 segmentation (existing)
│   ├── training.py               # YOLOv8 training (existing)
│   ├── models.py                 # Model management (existing)
│   ├── human_in_loop.py          # Human-in-the-loop (existing)
│   ├── evaluation.py             # Model evaluation (existing)
│   ├── annotations.py            # Annotation management (existing)
│   └── images.py                 # Image management (existing)
├── sam2/                         # SAM2 package
│   ├── sam2_image_predictor.py
│   └── automatic_mask_generator.py
├── models/
│   └── sam2_loader.py            # SAM2 model loader
├── annotations/                  # COCO annotation storage
├── images/                       # Uploaded image storage
├── trained_models/               # Trained model storage
├── training_datasets/            # Training dataset storage
├── main.py                       # FastAPI entry point
└── config.py                     # Environment configuration
```

## Configuration

### Required Environment Variables

```bash
# Gemini API key (Phase 1: cold-start labeling)
export GEMINI_API_KEY="your-gemini-api-key-here"

# Model storage paths
export TRAINED_MODELS_DIR="trained_models"
export ANNOTATIONS_DIR="annotations"

# Training dataset path
export TRAINING_DATASETS_DIR="training_datasets"
```

## Installation

### 1. Install Python Packages

```bash
# Install PyTorch (pick the build matching your CUDA version)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# Install the remaining packages
pip install -r requirements.txt
```

### 2. Download the SAM2 Model Checkpoint

```bash
cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

You can also download it from the [official SAM2 repository](https://github.com/facebookresearch/sam2).

## Running

### Start the Dev Server

```bash
# Development mode (auto reload)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Production
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

API docs are served at http://localhost:8000/docs once the server is running.

## API Endpoints

### Phase 1: Cold-start Labeling

#### Single-image Processing

```bash
POST /api/coldstart/label
Content-Type: application/json

{
  "image_path": "images/test.jpg",
  "task_description": "Detect every object in the image",
  "custom_prompt": null,  // optional
  "save_intermediate": true
}
```

**Response:**
```json
{
  "success": true,
  "image_path": "images/test.jpg",
  "annotations": [
    {
      "id": "coldstart_0_123456",
      "label": "object_name",
      "confidence": 0.95,
      "segmentation": [[x1, y1], [x2, y2], ...],
      "area": 15234,
      "bbox": [x1, y1, w, h],
      "source": "coldstart_llm_sam"
    }
  ],
  "llm_result": {
    "detections": [...],
    "image_description": "Image description",
    "spatial_relationships": [...]
  },
  "statistics": {
    "total_detections": 5,
    "successful_segmentations": 5,
    "processing_time_seconds": 3.2
  }
}
```

#### Batch Processing

```bash
POST /api/coldstart/label/batch
Content-Type: application/json

{
  "image_paths": ["img1.jpg", "img2.jpg", "img3.jpg"],
  "task_description": "Detect every object in the image",
  "parallel": true
}
```

### Phase 2: Knowledge Distillation

#### Register a Model (mAP 0.7 validation)

```bash
POST /api/models/register
Content-Type: application/json

{
  "model_id": "hilips_v1.0",
  "model_path": "runs/train/weights/best.pt",
  "metrics": {
    "map50": 0.85,
    "map50_95": 0.73,
    "map70": 0.723,  // Paper threshold: mAP@0.7 ≥ 0.7
    "precision": 0.89,
    "recall": 0.82,
    "f1": 0.855
  },
  "dataset_info": {
    "name": "custom_dataset",
    "num_images": 500,
    "annotations_per_image": 5.2
  },
  "config": {
    "epochs": 100,
    "batch_size": 16,
    "img_size": 640
  }
}
```

**Status rules:**
- `mAP@0.7 ≥ 0.7` → **Ready** (can be used for knowledge distillation)
- `mAP@0.7 < 0.7` → **Needs Improvement** (retraining required)

#### Promote a Model to Production

```bash
POST /api/models/promote
Content-Type: application/json

{
  "model_id": "hilips_v1.0"
}
```

#### List Models

```bash
GET /api/models
```

**Response:**
```json
{
  "models": [
    {
      "model_id": "hilips_v1.0",
      "status": "ready",  // ready, needs_improvement, production, archived
      "latest_version": 1,
      "metrics": {
        "map50": 0.85,
        "map70": 0.723
      }
    }
  ]
}
```

### Phase 3: Iterative Refinement

#### Fetch the Review Queue (Needs Review)

```bash
GET /api/active-learning/review-queue?limit=10&priority_filter=3
```

**Response:**
```json
{
  "queue": [
    {
      "image_path": "images/test.jpg",
      "confidence_analysis": {
        "total": 5,
        "auto_label_count": 3,
        "review_count": 2,
        "needs_review": true,
        "confidence_threshold": 0.8
      },
      "priority": 3
    }
  ]
}
```

#### Mark an Image as Reviewed

```bash
POST /api/active-learning/review-queue/mark
Content-Type: application/json

{
  "image_path": "images/test.jpg",
  "revised_detections": [...],
  "reviewer": "human"
}
```

#### Prepare a Dataset for Retraining

```bash
GET /api/active-learning/prepare-dataset?min_quality_score=0.7
```

## Paper: Detailed Three-Phase Description

### Phase 1: Cold-start Labeling

**Paper 2.2.1:**
- In the initial state, with no training data available, combine the reasoning ability of a multimodal LLM with the segmentation ability of SAM.
- The user uploads images → the LLM receives the image plus a task-description prompt.
- The LLM analyzes the objects in the image and returns bounding-box coordinates plus semantic labels.
  - Uses both visual features and any in-image text (e.g., buttons labeled "START", "STOP").
  - Considers spatial relationships among objects.
- The LLM bounding boxes are converted into SAM box prompts.
- SAM generates a precise segmentation mask for each region.
- The final annotation combines the LLM semantic label with the SAM mask.
- The user can review, correct labels, and add missed objects.
- Corrected results are saved to the database and used as training data for the knowledge-distillation stage.

**Implementation files:**
- `services/llm_sam_pipeline.py`: integrated pipeline
  - `run_gemini_detection()`: Gemini object detection
  - `run_sam2_segmentation_from_boxes()`: SAM2 box-based segmentation
  - `run_coldstart_labeling()`: full pipeline
- `routers/coldstart.py`: cold-start labeling API endpoints

### Phase 2: Knowledge Distillation

**Paper 2.2.2:**
- Use the dataset built during cold-start labeling.
- Train a lightweight model (YOLOv8).
- Goal: compress the LLM's reasoning output into a model small enough for real-time inference.
- Training data: image + annotation (mask, bounding box, label).
- LLM-generated labels are used as ground truth.
- After training, performance is evaluated on a validation set.
- Baseline threshold (mAP 0.7): if met, the model can be used in the next stage.
- Model versions and performance metrics are recorded and managed in the database.

**Implementation files:**
- `services/model_registry.py`: model registry
  - `register_model()`: register a model + mAP 0.7 validation
  - `promote_to_production()`: promote to production
  - `evaluate_model()`: periodic re-evaluation
- `services/yolo_service.py`: YOLOv8 training (existing)
  - `train_yolo_model_background()`: background training
  - `convert_yolo_to_coco_format()`: convert inference results

### Phase 3: Iterative Refinement

**Paper 2.2.3:**
- Plug the trained lightweight model back into the labeling pipeline.
- Increase automation ratios.
- For each new image, use the lightweight model to detect and classify objects.
- Confidence score ≥ 0.8 (default): automatically labeled.
- Confidence score < 0.8: classified for user review.
- The user checks the auto-labels and manually labels only the objects that require review.
- When unseen objects are discovered, the cold-start LLM pipeline is invoked selectively.
- Accumulated data is periodically sent back to the knowledge-distillation stage to retrain the model.
- The model improves: auto-labeling accuracy rises and user intervention decreases.

**Implementation files:**
- `services/active_learning.py`: active-learning service
  - `classify_for_iterative_refinement()`: confidence-based classification
  - `detect_unseen_objects()`: unseen-object detection
  - `prepare_distillation_dataset()`: prepare dataset for retraining
  - `get_review_queue()`: fetch the needs-review queue
  - `mark_reviewed()`: mark items as reviewed
- `services/workflow_scheduler.py`: automated workflows
  - `auto_annotate`: auto-labeling every 24 hours
  - `distillation`: weekly automatic retraining trigger
  - `evaluation`: periodic evaluation every 6 hours

## System Requirements

- Python 3.8+
- CUDA-capable GPU (recommended)
- At least 8 GB of GPU memory (for sam2.1_hiera_tiny)
- Gemini API key (for cold-start labeling)

## Usage

### 1. Start the Server

```bash
# Start the backend server
cd backend
python main.py
```

### 2. Start the Frontend

```bash
cd frontend
npm run dev
```

### 3. Open the UI

- Frontend: http://localhost:3000
- Backend API docs: http://localhost:8000/docs
- Pipeline dashboard: http://localhost:3000/pipeline-status
- Model registry: http://localhost:3000/models

## Key Features

### Cold-start Labeling
- Gemini 2.5 Flash API integration
- SAM2 box-based segmentation
- Single and batch image processing
- Automatic saving of intermediate results
- Automatic normalized → pixel coordinate conversion

### Knowledge Distillation
- Automatic mAP@0.7 validation and status decisions
- Model version management (version history)
- Automatic Ready / Needs Improvement / Production status
- Production promotion feature
- Performance-history tracking (improvement calculation)

### Iterative Refinement
- Confidence-based auto-labeling (≥ 0.8)
- Prioritized Needs Review queue
- Automatic unseen-object detection
- Automatic preparation of datasets for retraining
- Auto-annotate every 24 hours
- Weekly automatic retraining trigger

## References

- [Paper](https://arxiv.org/abs/xxxx.xxxx) (paper link)
- [Official SAM2 repository](https://github.com/facebookresearch/sam2)
- [Official YOLOv8 documentation](https://docs.ultralytics.com/)
- [Gemini API documentation](https://ai.google.dev/gemini-api/docs)
