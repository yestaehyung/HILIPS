# HILIPS: Human-In-the-Loop Iterative Pseudo-Labeling System

A web-based interactive annotation platform that combines large language models (LLMs), foundation segmentation models (SAM2), and iterative model distillation to minimize manual labeling effort for instance segmentation tasks.

## Overview

HILIPS addresses the annotation bottleneck in supervised learning by implementing a three-phase iterative pipeline:

1. **Cold-start Labeling (Phase 1):** A multimodal LLM (Gemini) detects objects and generates bounding boxes, which are then refined into pixel-level segmentation masks by SAM2. Users review and correct the results through an interactive web interface.

2. **Knowledge Distillation (Phase 2):** Human-verified annotations from Phase 1 are used to train a lightweight YOLOv8 model, distilling the knowledge from the LLM+SAM2 pipeline into a fast, deployable detector.

3. **Iterative Refinement (Phase 3):** The trained YOLO model performs batch inference on new images. High-confidence predictions (>= 0.8) are auto-labeled; low-confidence predictions are routed to a human review queue. Reviewed data accumulates and triggers retraining, progressively reducing the need for manual intervention.

```
Phase 1              Phase 2                Phase 3
Cold-start ──────> Distillation ──────> Refinement ─┐
(LLM + SAM2)      (Train YOLO)        (Auto-label)  │
                        ^                            │
                        └────── Retrain ─────────────┘
```

## Architecture

```
HILIPS/
├── backend/                # FastAPI backend (Python)
│   ├── routers/            # REST API endpoints
│   ├── services/           # Business logic & ML pipelines
│   ├── models/             # Model loaders (SAM2)
│   ├── schemas/            # Pydantic request/response models
│   ├── configs/            # SAM2 model configurations
│   └── utils/              # GPU memory management, mask utilities
├── keti-labeling/          # Next.js 15 frontend (TypeScript)
│   ├── app/                # App Router pages
│   ├── components/         # UI components (annotation tools, galleries)
│   ├── hooks/              # Custom React hooks
│   └── lib/                # API client, utilities
└── SOFTWARE_FUNCTIONALITIES.md
```

### Key Design Decisions

- **File-based persistence:** Annotations stored as JSON in COCO format — no database dependency required
- **COCO-to-YOLO conversion:** All annotations maintained in COCO format, converted to YOLO format on-the-fly for training
- **GPU memory management:** SAM2 is automatically unloaded from VRAM during YOLO training to prevent out-of-memory errors
- **Service layer pattern:** Routers delegate to singleton service instances via `get_*_service()` factory functions

## Requirements

### Hardware

- NVIDIA GPU with >= 8 GB VRAM (tested on RTX 3090 24 GB)
- CUDA 11.8 or later

### Software

- Python >= 3.10
- Node.js >= 18
- pnpm >= 8

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yestaehyung/HILIPS.git
cd HILIPS
```

### 2. Backend setup

```bash
cd backend
pip install -r requirements.txt
```

Download the SAM2 checkpoint from [Meta's SAM2 repository](https://github.com/facebookresearch/sam2) and place it at:

```
backend/checkpoints/sam2.1_hiera_large.pt
```

Set the Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY="your-api-key"
```

### 3. Frontend setup

```bash
cd keti-labeling
pnpm install
cp .env.example .env.local
```

Edit `.env.local` to point to your backend server:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Usage

### Start the backend server

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Start the frontend development server

```bash
cd keti-labeling
pnpm dev
```

Open http://localhost:3000 in your browser.

### Workflow

1. **Upload images** via the Upload page
2. **Annotate** using the Gallery page — choose between Gemini auto-labeling, point-based SAM2 segmentation, or manual polygon drawing
3. **Train a YOLO model** on the Training page with your verified annotations
4. **Auto-label new images** using the trained model via Batch Auto-label
5. **Review** low-confidence predictions in the review queue
6. **Retrain** with the expanded dataset to improve model performance

## API Reference

| Phase | Endpoint | Method | Description |
|-------|----------|--------|-------------|
| Phase 1 | `/api/coldstart/label` | POST | LLM + SAM2 auto-labeling for a single image |
| Phase 1 | `/api/coldstart/label/batch` | POST | Batch auto-labeling for multiple images |
| Phase 2 | `/api/train-model` | POST | Start YOLO model training |
| Phase 2 | `/api/training/status` | GET | Query training progress |
| Phase 2 | `/api/models` | GET | List trained models |
| Phase 3 | `/api/active-learning/review-queue` | GET | Get images pending human review |
| Phase 3 | `/api/active-learning/review-queue/mark` | POST | Mark a reviewed image |
| Workflow | `/api/workflow/state` | GET | Current pipeline phase and iteration |
| Workflow | `/api/workflow/summary` | GET | Summary statistics |

## Technology Stack

### Backend

| Component | Technology |
|-----------|------------|
| Web framework | FastAPI |
| Object detection (Phase 1) | Google Gemini API |
| Instance segmentation (Phase 1) | SAM2 (Segment Anything Model 2) |
| Object detection model (Phase 2-3) | YOLOv8 (Ultralytics) |
| Deep learning framework | PyTorch |
| Annotation format | COCO |

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

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Citation

If you use HILIPS in your research, please cite:

```bibtex
@article{hilips2026,
  title={HILIPS: Human-In-the-Loop Iterative Pseudo-Labeling System for Efficient Instance Segmentation Annotation},
  journal={SoftwareX},
  year={2026}
}
```
