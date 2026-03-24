"""
HILIPS mAP Calculation Service
Calculates mAP@0.5 for model evaluation against test set ground truth

Uses pycocotools COCOeval for standard COCO-style evaluation
"""

import os
import json
import logging
import tempfile
from datetime import datetime
from typing import Dict, Any, List, Optional, Literal
from pathlib import Path

logger = logging.getLogger(__name__)

# Try to import pycocotools (optional dependency)
PYCOCOTOOLS_AVAILABLE = False

try:
    from pycocotools.coco import COCO  # type: ignore
    from pycocotools.cocoeval import COCOeval  # type: ignore

    PYCOCOTOOLS_AVAILABLE = True
except ImportError:
    COCO = None  # type: ignore
    COCOeval = None  # type: ignore
    logger.warning("pycocotools not available. mAP calculation will be limited.")


class MapCalculationService:
    """
    mAP Calculation Service

    Calculates:
    - mAP@0.5: Mean Average Precision at IoU 0.5
    - mAP@0.5:0.95: Mean Average Precision at IoU 0.5-0.95
    - Per-class AP
    - Precision and Recall
    """

    def __init__(self):
        if not PYCOCOTOOLS_AVAILABLE:
            logger.warning(
                "pycocotools not installed. Install with: pip install pycocotools"
            )

    def compute_map(
        self,
        gt_annotations: List[Dict[str, Any]],
        pred_annotations: List[Dict[str, Any]],
        iou_type: str = "bbox",  # "bbox" or "segm"
    ) -> Dict[str, Any]:
        """
        Compute mAP between ground truth and predictions

        Args:
            gt_annotations: List of {file_name, coco_data} for ground truth
            pred_annotations: List of {file_name, coco_data} for predictions
            iou_type: Type of IoU calculation ("bbox" for bounding box, "segm" for segmentation)

        Returns:
            {
                "map50": float,
                "map50_95": float,
                "precision": float,
                "recall": float,
                "per_class": {class_name: {ap50, ap50_95, precision, recall}},
                "computed_at": str
            }
        """
        if not PYCOCOTOOLS_AVAILABLE:
            return self._compute_map_simple(gt_annotations, pred_annotations)

        return self._compute_map_coco(gt_annotations, pred_annotations, iou_type)

    def _compute_map_coco(
        self,
        gt_annotations: List[Dict[str, Any]],
        pred_annotations: List[Dict[str, Any]],
        iou_type: str = "bbox",
    ) -> Dict[str, Any]:
        """Compute mAP using pycocotools COCOeval"""

        # Merge all GT annotations into single COCO format
        merged_gt = self._merge_coco_annotations(gt_annotations, "gt")

        # Merge all predictions into COCO results format
        merged_pred = self._merge_predictions_to_coco_results(
            pred_annotations, merged_gt
        )

        if not merged_gt["annotations"] or not merged_pred:
            logger.warning("No annotations to evaluate")
            return {
                "map50": 0,
                "map50_95": 0,
                "precision": 0,
                "recall": 0,
                "per_class": {},
                "computed_at": datetime.now().isoformat(),
                "error": "No annotations to evaluate",
            }

        # Save to temp files for COCO API
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as gt_file:
            json.dump(merged_gt, gt_file)
            gt_file_path = gt_file.name

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as pred_file:
            json.dump(merged_pred, pred_file)
            pred_file_path = pred_file.name

        try:
            # Load with COCO API
            coco_gt = COCO(gt_file_path)  # type: ignore[misc]
            coco_pred = coco_gt.loadRes(pred_file_path)

            # Run evaluation
            coco_eval = COCOeval(coco_gt, coco_pred, iou_type)  # type: ignore[misc, arg-type]
            coco_eval.evaluate()
            coco_eval.accumulate()
            coco_eval.summarize()

            # Extract metrics
            # COCO stats indices:
            # 0: AP@[.5:.95] all areas
            # 1: AP@.5 all areas
            # 2: AP@.75 all areas
            # 3-5: AP@[.5:.95] small/medium/large
            # 6: AR@1 all areas
            # 7: AR@10 all areas
            # 8: AR@100 all areas
            # 9-11: AR@100 small/medium/large

            stats = coco_eval.stats

            # Per-class evaluation
            per_class = {}
            for cat_id in coco_gt.getCatIds():
                cat_info = coco_gt.loadCats(cat_id)[0]
                cat_name = cat_info["name"]

                # Run per-category evaluation
                coco_eval_cat = COCOeval(coco_gt, coco_pred, iou_type)  # type: ignore[misc, arg-type]
                coco_eval_cat.params.catIds = [cat_id]
                coco_eval_cat.evaluate()
                coco_eval_cat.accumulate()

                # Suppress output for per-class
                import io
                import sys

                old_stdout = sys.stdout
                sys.stdout = io.StringIO()
                coco_eval_cat.summarize()
                sys.stdout = old_stdout

                cat_stats = coco_eval_cat.stats
                per_class[cat_name] = {
                    "class_id": cat_id,
                    "ap50": float(cat_stats[1]) if len(cat_stats) > 1 else 0,
                    "ap50_95": float(cat_stats[0]) if len(cat_stats) > 0 else 0,
                    "precision": float(cat_stats[1])
                    if len(cat_stats) > 1
                    else 0,  # AP@0.5 as proxy
                    "recall": float(cat_stats[8])
                    if len(cat_stats) > 8
                    else 0,  # AR@100
                }

            result = {
                "map50": float(stats[1]) if len(stats) > 1 else 0,
                "map50_95": float(stats[0]) if len(stats) > 0 else 0,
                "precision": float(stats[1])
                if len(stats) > 1
                else 0,  # Use AP@0.5 as precision proxy
                "recall": float(stats[8]) if len(stats) > 8 else 0,  # AR@100
                "per_class": per_class,
                "computed_at": datetime.now().isoformat(),
                "iou_type": iou_type,
            }

            return result

        except Exception as e:
            logger.error(f"COCO evaluation failed: {e}")
            return {
                "map50": 0,
                "map50_95": 0,
                "precision": 0,
                "recall": 0,
                "per_class": {},
                "computed_at": datetime.now().isoformat(),
                "error": str(e),
            }
        finally:
            # Clean up temp files
            try:
                os.unlink(gt_file_path)
                os.unlink(pred_file_path)
            except Exception:
                pass

    def _compute_map_simple(
        self,
        gt_annotations: List[Dict[str, Any]],
        pred_annotations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Simple mAP calculation without pycocotools

        This is a fallback when pycocotools is not available.
        Uses simple IoU matching and AP calculation.
        """
        logger.info("Using simple mAP calculation (pycocotools not available)")

        # Merge annotations
        merged_gt = self._merge_coco_annotations(gt_annotations, "gt")

        # Build prediction lookup by image
        pred_by_image = {}
        for pred in pred_annotations:
            file_name = pred["file_name"]
            coco_data = pred.get("coco_data", {})
            pred_by_image[file_name] = coco_data.get("annotations", [])

        # Build GT lookup by image
        gt_by_image = {}
        for img in merged_gt["images"]:
            gt_by_image[img["file_name"]] = []

        for ann in merged_gt["annotations"]:
            img_id = ann["image_id"]
            # Find image file name
            for img in merged_gt["images"]:
                if img["id"] == img_id:
                    gt_by_image[img["file_name"]].append(ann)
                    break

        # Calculate metrics
        total_tp = 0
        total_fp = 0
        total_fn = 0
        iou_threshold = 0.5

        for file_name in gt_by_image:
            gt_anns = gt_by_image[file_name]
            pred_anns = pred_by_image.get(file_name, [])

            # Match predictions to GT
            matched_gt = set()

            for pred in pred_anns:
                pred_bbox = pred.get("bbox", [0, 0, 0, 0])
                best_iou = 0
                best_gt_idx = -1

                for gt_idx, gt in enumerate(gt_anns):
                    if gt_idx in matched_gt:
                        continue

                    gt_bbox = gt.get("bbox", [0, 0, 0, 0])
                    iou = self._calculate_iou(pred_bbox, gt_bbox)

                    if iou > best_iou:
                        best_iou = iou
                        best_gt_idx = gt_idx

                if best_iou >= iou_threshold and best_gt_idx >= 0:
                    total_tp += 1
                    matched_gt.add(best_gt_idx)
                else:
                    total_fp += 1

            total_fn += len(gt_anns) - len(matched_gt)

        precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
        recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0

        # Simple AP approximation (not true mAP, but gives indication)
        map50 = precision * recall  # Simplified

        return {
            "map50": map50,
            "map50_95": map50 * 0.8,  # Rough approximation
            "precision": precision,
            "recall": recall,
            "per_class": {},
            "computed_at": datetime.now().isoformat(),
            "method": "simple",
            "warning": "Using simplified calculation. Install pycocotools for accurate mAP.",
        }

    def _calculate_iou(self, bbox1: List[float], bbox2: List[float]) -> float:
        """Calculate IoU between two bboxes (COCO format: [x, y, w, h])"""
        if len(bbox1) < 4 or len(bbox2) < 4:
            return 0.0

        x1, y1, w1, h1 = bbox1
        x2, y2, w2, h2 = bbox2

        # Convert to corner format
        x1_max = x1 + w1
        y1_max = y1 + h1
        x2_max = x2 + w2
        y2_max = y2 + h2

        # Calculate intersection
        inter_x1 = max(x1, x2)
        inter_y1 = max(y1, y2)
        inter_x2 = min(x1_max, x2_max)
        inter_y2 = min(y1_max, y2_max)

        if inter_x2 <= inter_x1 or inter_y2 <= inter_y1:
            return 0.0

        inter_area = (inter_x2 - inter_x1) * (inter_y2 - inter_y1)

        # Calculate union
        area1 = w1 * h1
        area2 = w2 * h2
        union_area = area1 + area2 - inter_area

        if union_area <= 0:
            return 0.0

        return inter_area / union_area

    def _merge_coco_annotations(
        self,
        annotations: List[Dict[str, Any]],
        prefix: str = "",
    ) -> Dict[str, Any]:
        """Merge multiple COCO files into single COCO format"""

        merged = {
            "info": {"description": f"Merged {prefix} annotations"},
            "images": [],
            "categories": [],
            "annotations": [],
        }

        image_id_counter = 1
        ann_id_counter = 1
        category_map = {}  # name -> id
        category_id_counter = 1

        for item in annotations:
            file_name = item["file_name"]
            coco_data = item.get("coco_data", {})

            # Get categories from this file and merge
            for cat in coco_data.get("categories", []):
                cat_name = cat["name"]
                if cat_name not in category_map:
                    category_map[cat_name] = category_id_counter
                    merged["categories"].append(
                        {
                            "id": category_id_counter,
                            "name": cat_name,
                            "supercategory": cat.get("supercategory", "thing"),
                        }
                    )
                    category_id_counter += 1

            # Build category id mapping for this file
            old_to_new_cat = {}
            for cat in coco_data.get("categories", []):
                old_to_new_cat[cat["id"]] = category_map[cat["name"]]

            # Add image
            image_entry = {
                "id": image_id_counter,
                "file_name": file_name,
                "width": coco_data.get("images", [{}])[0].get("width", 0)
                if coco_data.get("images")
                else 0,
                "height": coco_data.get("images", [{}])[0].get("height", 0)
                if coco_data.get("images")
                else 0,
            }
            merged["images"].append(image_entry)

            # Add annotations
            for ann in coco_data.get("annotations", []):
                old_cat_id = ann.get("category_id", 1)
                new_cat_id = old_to_new_cat.get(old_cat_id, old_cat_id)

                merged_ann = {
                    "id": ann_id_counter,
                    "image_id": image_id_counter,
                    "category_id": new_cat_id,
                    "bbox": ann.get("bbox", [0, 0, 0, 0]),
                    "area": ann.get("area", 0),
                    "iscrowd": ann.get("iscrowd", 0),
                }

                # Include segmentation if available
                if "segmentation" in ann:
                    merged_ann["segmentation"] = ann["segmentation"]

                merged["annotations"].append(merged_ann)
                ann_id_counter += 1

            image_id_counter += 1

        return merged

    def _merge_predictions_to_coco_results(
        self,
        predictions: List[Dict[str, Any]],
        gt_coco: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Convert predictions to COCO results format"""

        results = []

        # Build image name to id mapping from GT
        name_to_id = {}
        for img in gt_coco["images"]:
            name_to_id[img["file_name"]] = img["id"]

        # Build category name to id mapping from GT
        cat_name_to_id = {}
        for cat in gt_coco["categories"]:
            cat_name_to_id[cat["name"]] = cat["id"]

        for pred in predictions:
            file_name = pred["file_name"]
            coco_data = pred.get("coco_data", {})

            image_id = name_to_id.get(file_name)
            if image_id is None:
                continue

            # Build category mapping for this prediction file
            pred_cat_to_name = {}
            for cat in coco_data.get("categories", []):
                pred_cat_to_name[cat["id"]] = cat["name"]

            for ann in coco_data.get("annotations", []):
                # Get category name from prediction
                pred_cat_id = ann.get("category_id", 1)
                cat_name = pred_cat_to_name.get(pred_cat_id, f"class_{pred_cat_id}")

                # Map to GT category id
                gt_cat_id = cat_name_to_id.get(cat_name)
                if gt_cat_id is None:
                    continue

                result = {
                    "image_id": image_id,
                    "category_id": gt_cat_id,
                    "bbox": ann.get("bbox", [0, 0, 0, 0]),
                    "score": ann.get(
                        "score", ann.get("confidence", ann.get("stability_score", 1.0))
                    ),
                }

                # Include segmentation if available
                if "segmentation" in ann:
                    result["segmentation"] = ann["segmentation"]

                results.append(result)

        return results

    def evaluate_model_on_test_set(
        self,
        model_id: str,
        test_set_id: str,
        predictions_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate a model on a test set

        Args:
            model_id: Model to evaluate
            test_set_id: Test set to evaluate against
            predictions_dir: Directory containing prediction files (model inference results)

        Returns:
            Evaluation metrics
        """
        from .test_set import get_test_set_service

        test_set_service = get_test_set_service()

        # Get ground truth
        gt_annotations = test_set_service.get_gt_annotations(test_set_id)

        if not gt_annotations:
            return {
                "error": "No ground truth annotations found in test set",
                "test_set_id": test_set_id,
            }

        # Get predictions
        # For now, we'll look for prediction files in predictions_dir
        # Format: {predictions_dir}/{model_id}/{image_name}_pred.json
        pred_annotations = []

        if predictions_dir:
            pred_dir = Path(predictions_dir) / model_id
            if pred_dir.exists():
                for gt in gt_annotations:
                    file_name = gt["file_name"]
                    base_name = os.path.splitext(file_name)[0]
                    pred_file = pred_dir / f"{base_name}_pred.json"

                    if pred_file.exists():
                        try:
                            with open(pred_file, "r") as f:
                                pred_data = json.load(f)
                            pred_annotations.append(
                                {
                                    "file_name": file_name,
                                    "coco_data": pred_data,
                                }
                            )
                        except Exception as e:
                            logger.warning(
                                f"Failed to load prediction for {file_name}: {e}"
                            )

        if not pred_annotations:
            return {
                "error": "No prediction annotations found",
                "model_id": model_id,
                "test_set_id": test_set_id,
            }

        # Compute metrics
        metrics = self.compute_map(gt_annotations, pred_annotations)
        metrics["model_id"] = model_id
        metrics["test_set_id"] = test_set_id
        metrics["num_gt_images"] = len(gt_annotations)
        metrics["num_pred_images"] = len(pred_annotations)

        return metrics


# Singleton instance
_map_service_instance = None


def get_map_calculation_service() -> MapCalculationService:
    """Get mAP calculation service singleton"""
    global _map_service_instance
    if _map_service_instance is None:
        _map_service_instance = MapCalculationService()
    return _map_service_instance


def reset_map_calculation_service():
    """Reset service (for testing)"""
    global _map_service_instance
    _map_service_instance = None
