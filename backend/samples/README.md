# Sample Dataset

A small, tracked subset of the industrial CNC control panel dataset used to evaluate HILIPS. This directory exists so reviewers can run the cold-start pipeline, training, and batch-inference endpoints without downloading external assets.

## Contents

```
backend/samples/
├── images/            # 10 JPEG photos of a CNC control panel
│   ├── 1_on.jpg       # Panel with LEDs on
│   ├── 1_off.jpg      # Panel with LEDs off
│   ├── 2_on.jpg
│   ├── 6_on.jpg
│   ├── 13_on.jpg
│   ├── 33_on.jpg
│   ├── 42_on.jpg
│   ├── 46_off.jpg
│   ├── 56_off.jpg
│   └── 60_on.jpg
└── annotations/       # Matching COCO-format ground truth (one JSON per image)
    └── *_coco.json
```

## Classes

The annotations cover three classes that exhibit **visual-semantic ambiguity** — buttons of nearly identical appearance that can only be distinguished by their printed text or spatial role:

| Class | Color | Function |
|-------|-------|----------|
| DOOR   | red    | Machine door control |
| JOG    | orange | Jog / shuttle dial |
| MEMORY | yellow | Memory button |

## Use cases

1. **Cold-start smoke test** — Point the `/api/coldstart/label` endpoint at one of these images to exercise the Gemini + SAM2 pipeline.
2. **Training data reference** — These 10 images are a reproducible subset of the 200-image industrial control-panel dataset used in the paper's evaluation.
3. **Auto-label verification** — Run `/api/active-learning/auto-label-queue` against these images once a YOLO model is trained, and confirm that the confidence-based routing matches the annotations here.

## Annotation format

Each file in `annotations/` follows the HILIPS-standard COCO JSON layout:

```json
{
  "image_id": "1_on",
  "annotations": [
    {
      "id": 1,
      "category": "JOG",
      "segmentation": [[x1, y1, x2, y2, ...]],
      "bbox": [x, y, width, height],
      "area": 12345,
      "confidence": 1.0
    }
  ]
}
```

`confidence: 1.0` indicates a human-verified annotation. See `SOFTWARE_FUNCTIONALITIES.md` for the full pipeline description.
