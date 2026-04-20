# 2.2 Software Functionalities

The HILIPS (Human-In-the-Loop Image Processing System) labeling pipeline is composed of three stages: **Cold-start Labeling**, **Knowledge Distillation**, and **Iterative Refinement**.

---

## 2.2.1 Cold-start Labeling (Phase 1)

This stage produces high-quality annotations from the initial state in which no labels are available.

### Pipeline Flow

1. **Image upload**: The user uploads images to be labeled into the system.
2. **LLM object detection**: Gemini analyzes each image and returns the bounding boxes and semantic labels of the detected objects.
3. **SAM2 segmentation**: The bounding boxes from the LLM are converted into SAM2 box prompts and used to produce precise segmentation masks.
4. **Annotation generation**: Labels and masks are combined into annotations in COCO format.
5. **User review / correction**: The user reviews the generated annotations and edits them as needed.

### Key Implementation

- `backend/services/llm_sam_pipeline.py`: integrated Gemini + SAM2 pipeline
- `backend/routers/coldstart.py`: cold-start API endpoints
- `backend/routers/segmentation.py`: SAM2 point/box-prompt segmentation

### User Interactions

- **Gemini Auto-label**: the LLM analyzes the whole image and auto-labels every object.
- **Point-based SAM**: SAM2 generates a mask from a point the user clicks on.
- **Manual Drawing**: the user draws a polygon manually to create an annotation.

---

## 2.2.2 Knowledge Distillation (Phase 2)

This stage uses the annotations produced in cold-start labeling to train a lightweight model (YOLOv8).

### Purpose

The LLM + SAM2 combination produces high-quality annotations, but inference is slow and expensive. Knowledge distillation compresses this knowledge into a lightweight model that supports real-time inference.

### Pipeline Flow

1. **Dataset preparation**: convert COCO-format annotations into a YOLO training format.
2. **YOLOv8 training**: train a YOLOv8 model on the selected annotation files.
3. **Performance validation**: evaluate the model against an mAP@0.7 threshold.
4. **Model storage**: register the trained model in the model registry.

### Key Implementation

- `backend/routers/training.py`: YOLO training API endpoints
- `backend/services/yolo_service.py`: YOLO dataset generation and training logic
- `backend/services/model_registry.py`: trained-model management

### Performance Criteria

- **mAP@0.7 ≥ 0.7**: threshold for production deployment
- Real-time monitoring of training progress (epoch, loss, metrics)
- GPU memory management (SAM2 unloads automatically)

---

## 2.2.3 Iterative Refinement (Phase 3)

A loop in which the trained YOLO model auto-labels new images and the user reviews low-quality predictions.

### Core Concept: Confidence-based Classification

Classify predictions by confidence score:

| Confidence | Category | Handling |
|------------|----------|----------|
| ≥ 0.8 | High | Auto-label |
| 0.5 – 0.8 | Medium | User review recommended |
| < 0.5 | Low | User review required |

### Pipeline Flow

1. **Batch inference**: run the trained YOLO model on unlabeled images.
2. **Confidence analysis**: analyze the confidence score of each detection.
3. **Automatic classification**:
   - High confidence → save the annotation automatically.
   - Low confidence → add the image to `review_queue.json`.
4. **User review**: the user reviews and corrects images in the review queue.
5. **Data accumulation**: completed reviews are recorded in `review_history.json`.
6. **Retraining trigger**: once enough data has been accumulated, return to Phase 2 and retrain.

### Key Implementation

- `backend/services/active_learning.py`: confidence-based classification and queue management
- `backend/routers/active_learning.py`: review-queue API endpoints
- `backend/routers/models.py`: batch inference and labeling-status APIs

### Loop Structure (Iteration)

```
Phase 2 (Distillation) → Phase 3 (Refinement) → Phase 2 (Retraining) → ...
```

- **Iteration**: one full trip around the loop above
- As the model improves, auto-label accuracy rises and the number of objects that require manual intervention drops.

---

## Data-flow Summary

```
[Image upload]
       ↓
[Phase 1: Cold-start]
  - Gemini LLM → bounding box + label
  - SAM2 → segmentation mask
  - User review / correction
       ↓
[Phase 2: Distillation]
  - COCO → YOLO format conversion
  - YOLOv8 training
  - mAP@0.7 validation
       ↓
[Phase 3: Refinement]
  - YOLO batch inference
  - Confidence ≥ 0.8 → Auto-label
  - Confidence < 0.8 → Review queue
  - User completes review
       ↓
[Return to Phase 2 once enough data is accumulated]
```

---

## User Scenarios

### Scenario 1: Initial Labeling (Cold-start)

```
1. The user uploads images for labeling on /upload.
2. They navigate to /gallery and pick an image.
3. In the labeling workspace:
   - Click the "Gemini Auto-label" button → the LLM auto-detects and segments objects.
   - Or click on the image to use point-based SAM to select individual objects.
   - Or use Manual Drawing to draw polygons by hand.
4. Review the generated annotations; fix or delete anything that is wrong.
5. Click "Save" to store the annotations.
6. Move to the next image and repeat.
```

### Scenario 2: Model Training (Knowledge Distillation)

```
1. After labeling enough images, navigate to /training.
2. Select the annotation files to train on.
3. Configure the training parameters (epochs, batch size, image size).
4. Click "Start Training" to kick off YOLOv8 training.
5. Monitor progress on /training/monitor.
6. When training is done, inspect mAP@0.7.
7. The trained model is registered automatically in the model registry.
```

### Scenario 3: Auto-labeling and Review (Iterative Refinement)

```
1. With a trained model available, navigate to /gallery.
2. Click the "Batch Auto-label" button.
3. Select the model and confidence threshold to use.
4. Auto-inference runs on unlabeled images:
   - Confidence ≥ 0.8: save the annotation automatically.
   - Confidence < 0.8: mark the image as "Needs Review".
5. Pick "Needs Review" in the filter to see images that need attention.
6. Open each image, review / correct the annotation, and save.
7. Once review is complete, click "Train New Model" on the Pipeline page.
8. A new iteration begins; the model is retrained with the new data.
```

### Scenario 4: Iteration Cycle

```
[Iteration 0]
  - 50 images labeled via cold-start
  - First YOLO model trained (mAP@0.7: 0.65)

[Iteration 1]
  - 100 additional images uploaded
  - Batch inference runs → 70 auto-labeled, 30 need review
  - 30 images reviewed
  - Retraining (mAP@0.7: 0.75) ✓ threshold met

[Iteration 2]
  - 200 additional images uploaded
  - Batch inference runs → 180 auto-labeled, 20 need review
  - Improved model reduces the number of images requiring manual review
  - Retraining (mAP@0.7: 0.82)
```

---

## Key File Structure

```
backend/
├── services/
│   ├── llm_sam_pipeline.py    # Cold-start: Gemini + SAM2
│   ├── active_learning.py     # Iterative Refinement: confidence-based classification
│   ├── yolo_service.py        # Distillation: YOLO training
│   ├── workflow_state.py      # Phase / iteration state management
│   └── model_registry.py      # Trained-model management
├── routers/
│   ├── coldstart.py           # Phase 1 API
│   ├── training.py            # Phase 2 API
│   ├── active_learning.py     # Phase 3 API
│   ├── models.py              # Model inference / batch APIs
│   └── workflow.py            # Workflow-status API
└── models/
    └── sam2_loader.py         # SAM2 model loader

frontend/
├── app/
│   ├── page.tsx               # Pipeline dashboard
│   ├── gallery/page.tsx       # Image gallery / labeling
│   └── training/page.tsx      # Training configuration / monitoring
└── components/
    └── labeling-workspace.tsx # Labeling workspace
```
