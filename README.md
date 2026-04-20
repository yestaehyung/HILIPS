# HILIPS: Human-In-the-Loop Image Labeling Pipeline

A **web application** for annotating images under visual–semantic ambiguity. HILIPS combines a multimodal LLM (Google Gemini 2.5 Pro), a foundation segmentation model (SAM2), and iterative model distillation (YOLOv8) to minimise manual labeling effort. All annotation work happens in the browser — the Python backend only serves the models behind REST endpoints.

Companion code for the SoftwareX manuscript *HILIPS: A Human-In-the-Loop Image Labeling Pipeline for Visual-Semantic Ambiguity*.

## Overview

HILIPS addresses the annotation bottleneck in supervised learning through a three-stage iterative pipeline (Section 2.2 of the paper):

1. **Cold-start Labeling (Stage 1).** From the web UI, a user uploads images and triggers Gemini 2.5 Pro object detection. The bounding boxes are refined into pixel-level masks by SAM2. The user reviews and corrects the result using three annotation tools: *Manual Polygon*, *Point-based SAM2*, or *Prompt-based auto-labeling*.

2. **Label Transfer (Stage 2).** Verified annotations are used to train a lightweight YOLOv8 model through the **Model Training** page. The UI exposes hyper-parameters matching paper Table 5: Epochs (1–1000), Batch size (8 / 16 / 32), Image size (640 / 1280), Learning rate (0.001 – 0.01).

3. **Iterative Refinement (Stage 3).** The trained model performs inference on new images from the **Gallery**. High-confidence detections are auto-approved; low-confidence ones are flagged for human review. Corrections accumulate and can trigger another training round.

```
Stage 1               Stage 2                Stage 3
Cold-start ──────> Label Transfer ──────> Refinement ─┐
(LLM + SAM2)      (Train YOLO)           (Auto-label) │
                       ^                               │
                       └──────── Retrain ──────────────┘
```

## Quick Start

### Option A — Docker Compose (recommended)

Stand up the full web application with one command:

```bash
git clone https://github.com/yestaehyung/HILIPS.git
cd HILIPS

# 1. Fetch the SAM2 checkpoint (needed by the backend)
mkdir -p backend/checkpoints
curl -L -o backend/checkpoints/sam2.1_hiera_large.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt

# 2. Bring up backend + frontend
export GEMINI_API_KEY=your-gemini-api-key-here
docker compose up --build

# 3. Open the web UI
#    Frontend  →  http://localhost:3000          ← primary entry point
#    Backend   →  http://localhost:8000
#    API docs  →  http://localhost:8000/docs

# Optional GPU profile (requires the NVIDIA Container Toolkit)
docker compose --profile gpu up --build
```

### Option B — Manual install

Requirements: Python ≥ 3.10, Node.js ≥ 18, pnpm ≥ 8, and a CUDA-capable GPU for interactive inference (tested on RTX 3090 with CUDA 11.8).

```bash
# Backend
cd backend
pip install -r requirements.txt
mkdir -p checkpoints
curl -L -o checkpoints/sam2.1_hiera_large.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
export GEMINI_API_KEY="your-api-key"
export GEMINI_MODEL="gemini-2.5-pro"           # optional, this is the default
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (new terminal)
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev                                       # serves http://localhost:3000
```

## Using the Web Application

Once the UI is running at `http://localhost:3000`, a typical session looks like:

1. **Upload.** Drop a folder of images onto the Upload page. Ten ready-to-use industrial CNC panel photos live in `backend/samples/images/` (with matching ground-truth COCO annotations in `backend/samples/annotations/`) so you can exercise the flow without sourcing your own data.

2. **Annotate.** Open an image in the Gallery and pick one of three tools in the side panel:
   - **Gemini Auto-label** — Gemini 2.5 Pro proposes labels, SAM2 refines the masks; you review and commit.
   - **Point-based SAM2** — click on any object, SAM2 traces the boundary.
   - **Manual Polygon** — draw the outline yourself.

3. **Train.** Move to the *Model Training* page, select an annotation set, adjust the hyper-parameters (Epochs 1–1000, Batch 8 / 16 / 32, Image size 640 / 1280, Learning rate 0.001 – 0.01) and start training. Progress and metrics are tracked live under `/training/monitor`.

4. **Auto-label and review.** Return to the Gallery, run *Batch Auto-label* on new images with the trained model, and inspect the *Needs Review* queue. Confidence ≥ θ is auto-approved; the rest is routed to you.

5. **Export.** Download every annotation in the format your downstream tooling expects: COCO JSON (native), YOLO TXT (generated on demand), or Pascal VOC XML (via the `/api/export/pascal-voc` endpoint).

A screenshot walk-through of every page is included in `LABELING_GUIDE.md`.

## Architecture

```
HILIPS/
├── frontend/              # Next.js 15 frontend (React 19, TypeScript)
│   ├── app/                    # App Router pages — the UI the reviewer interacts with
│   ├── components/             # shadcn/ui components, Konva canvas, galleries
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # API client
│   └── Dockerfile
├── backend/                    # FastAPI (Python ≥ 3.10, PyTorch, SAM2, YOLO)
│   ├── routers/                # REST API endpoints consumed by the frontend
│   ├── services/               # Pipelines: Gemini + SAM2, YOLO training, active learning, Pascal VOC export
│   ├── models/                 # SAM2 loader
│   ├── schemas/                # Pydantic request/response models
│   ├── samples/                # 10 sample CNC-panel images + COCO annotations
│   ├── Dockerfile
│   └── pyproject.toml
├── docker-compose.yml
├── SOFTWARE_FUNCTIONALITIES.md # Detailed description of every stage
└── LABELING_GUIDE.md           # End-user instructions with UI screenshots
```

### Key design decisions

- **Web UI is the product.** Every labeling action happens in the browser; the backend is a stateless REST service.
- **File-based persistence.** Annotations are stored as JSON in COCO format; no database dependency.
- **On-the-fly format conversion.** Ground truth lives in COCO; YOLO training datasets and Pascal VOC exports are produced on demand.
- **GPU memory management.** SAM2 is unloaded from VRAM during YOLO training so the two models can coexist on a single 8 GB GPU.

## Configuration

Backend environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GEMINI_API_KEY` | Authentication for the Gemini API | — |
| `GEMINI_MODEL` | Gemini model id used by the cold-start pipeline | `gemini-2.5-pro` |
| `TRAINED_MODELS_DIR` | Where YOLO checkpoints are written | `trained_models` |
| `ANNOTATIONS_DIR` | Where COCO annotation JSONs are written | `annotations` |
| `TRAINING_DATASETS_DIR` | Where generated YOLO datasets are kept | `training_datasets` |

Frontend configuration (`frontend/.env.local`):

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## API Reference

The web UI calls the following REST endpoints; they are also callable directly:

| Stage | Endpoint | Method | Description |
|-------|----------|--------|-------------|
| 1 | `/api/coldstart/label` | POST | LLM + SAM2 auto-labeling for a single image |
| 1 | `/api/coldstart/label/batch` | POST | Batch auto-labeling for multiple images |
| 2 | `/api/train-model` | POST | Start YOLO model training |
| 2 | `/api/training/status` | GET | Query training progress |
| 2 | `/api/models` | GET | List trained models |
| 3 | `/api/active-learning/review-queue` | GET | Get images pending human review |
| 3 | `/api/active-learning/review-queue/mark` | POST | Mark a reviewed image |
| Workflow | `/api/workflow/state` | GET | Current pipeline stage and iteration |
| Workflow | `/api/workflow/summary` | GET | Summary statistics |
| Export | `/api/annotations/{filename}` | GET | Download an annotation in COCO format |
| Export | `/api/annotations/{filename}/voc` | GET | Download a single annotation as Pascal VOC XML |
| Export | `/api/export/pascal-voc` | GET | Bundle every annotation as Pascal VOC XML in a ZIP |

Interactive Swagger UI is served at `http://localhost:8000/docs` once the backend is running.

## Technology Stack

### Backend

| Component | Technology |
|-----------|------------|
| Web framework | FastAPI |
| Object detection (Stage 1) | Google Gemini 2.5 Pro |
| Instance segmentation (Stage 1) | SAM2 (Segment Anything Model 2) |
| Object detection model (Stages 2–3) | YOLOv8 (Ultralytics) |
| Deep learning framework | PyTorch 2.x + CUDA 11.8 |
| Annotation formats | COCO (native), YOLO and Pascal VOC (export) |

### Frontend

| Component | Technology |
|-----------|------------|
| Framework | Next.js 15 (App Router) |
| UI library | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Component library | shadcn/ui |
| Canvas rendering | Konva.js |

## License

Released under the MIT License; see [LICENSE](LICENSE). The companion paper is currently under review at *SoftwareX*; once published, a `CITATION.cff` and BibTeX snippet will be added here.
