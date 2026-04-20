"""
YOLOv8 training and inference service
"""

import os
import gc
import json
import logging
import random
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

import torch
import yaml
from fastapi import HTTPException

from config import CUSTOM_CLASSES, TRAINED_MODELS_DIR, TRAINING_DATASETS_DIR

logger = logging.getLogger(__name__)

# Global state management
training_jobs: Dict[str, Any] = {}
hil_sessions: Dict[str, Any] = {}
loaded_models: Dict[str, Any] = {}


def convert_bbox_to_yolo(image_width, image_height, bbox):
    """Convert COCO bbox to YOLO format"""
    x, y, w, h = bbox
    x_center = (x + w / 2) / image_width
    y_center = (y + h / 2) / image_height
    w = w / image_width
    h = h / image_height
    return x_center, y_center, w, h


def process_coco_annotations_to_yolo(
    annotation_path, output_labels_dir, images_dir, category_id_map: Dict[int, int]
):
    """Convert COCO annotation to YOLO format

    Args:
        category_id_map: Mapping from COCO category_id to YOLO class index (0-based)
    """
    try:
        from pycocotools.coco import COCO

        coco = COCO(annotation_path)

        processed_count = 0
        for img_id in coco.getImgIds():
            img_info = coco.loadImgs([img_id])[0]
            img_filename = img_info["file_name"]
            img_path = os.path.join(images_dir, img_filename)

            if not os.path.exists(img_path):
                continue

            img_width, img_height = img_info["width"], img_info["height"]
            annotations = coco.loadAnns(coco.getAnnIds(imgIds=[img_id]))

            label_file_path = os.path.join(
                output_labels_dir, f"{img_filename.split('.')[0]}.txt"
            )
            with open(label_file_path, "w") as label_file:
                seen_labels = set()
                for ann in annotations:
                    if "bbox" in ann and ann.get("area", 0) > 0:
                        bbox = convert_bbox_to_yolo(img_width, img_height, ann["bbox"])
                        coco_cat_id = ann["category_id"]

                        if coco_cat_id not in category_id_map:
                            continue

                        yolo_class_id = category_id_map[coco_cat_id]

                        label_str = f"{yolo_class_id} {' '.join(map(str, bbox))}\n"
                        if label_str not in seen_labels:
                            label_file.write(label_str)
                            seen_labels.add(label_str)

            processed_count += 1

        return processed_count

    except Exception as e:
        logger.error(f"COCO annotation conversion error: {e}")
        raise


def create_yolo_dataset_structure(annotation_files: List[str], job_id: str):
    """Create dataset structure for YOLO training using multiple COCO files"""
    try:
        dataset_dir = f"{TRAINING_DATASETS_DIR}/{job_id}"
        os.makedirs(dataset_dir, exist_ok=True)
        os.makedirs(f"{dataset_dir}/images/train", exist_ok=True)
        os.makedirs(f"{dataset_dir}/images/val", exist_ok=True)
        os.makedirs(f"{dataset_dir}/labels/train", exist_ok=True)
        os.makedirs(f"{dataset_dir}/labels/val", exist_ok=True)

        total_processed_count = 0
        used_images = set()

        all_categories: Dict[int, str] = {}

        for annotation_file in annotation_files:
            annotation_path = os.path.join("annotations", annotation_file)
            if not os.path.exists(annotation_path):
                raise FileNotFoundError(f"Annotation file not found: {annotation_path}")

            with open(annotation_path, "r", encoding="utf-8") as f:
                coco_data = json.load(f)

            for cat in coco_data.get("categories", []):
                cat_id = cat.get("id")
                cat_name = cat.get("name")
                if cat_id is not None and cat_name:
                    all_categories[cat_id] = cat_name

            for img_info in coco_data.get("images", []):
                img_filename = img_info.get("file_name")
                if img_filename:
                    used_images.add(img_filename)

        sorted_cat_ids = sorted(all_categories.keys())
        category_id_map = {cat_id: idx for idx, cat_id in enumerate(sorted_cat_ids)}
        class_names = [all_categories[cat_id] for cat_id in sorted_cat_ids]

        logger.info(
            f"Extracted {len(class_names)} classes from annotations: {class_names}"
        )

        for annotation_file in annotation_files:
            annotation_path = os.path.join("annotations", annotation_file)

            processed_count = process_coco_annotations_to_yolo(
                annotation_path,
                f"{dataset_dir}/labels/train",
                "images",
                category_id_map,
            )

            total_processed_count += processed_count
            logger.info(f"{annotation_file} processed: {processed_count} images")

        all_images = [
            img
            for img in used_images
            if img.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        random.seed(42)
        random.shuffle(all_images)

        split_idx = int(len(all_images) * 0.8)
        train_images = all_images[:split_idx]
        val_images = all_images[split_idx:]

        logger.info(f"Dataset split: {len(train_images)} train, {len(val_images)} val")

        train_linked = 0
        for img_filename in train_images:
            img_path = os.path.abspath(os.path.join("images", img_filename))
            if os.path.exists(img_path):
                img_symlink = os.path.join(dataset_dir, "images/train", img_filename)
                if not os.path.exists(img_symlink):
                    os.symlink(img_path, img_symlink)
                train_linked += 1
            else:
                logger.warning(f"Image file not found: {img_filename}")

        val_linked = 0
        for img_filename in val_images:
            img_path = os.path.abspath(os.path.join("images", img_filename))
            if os.path.exists(img_path):
                img_symlink = os.path.join(dataset_dir, "images/val", img_filename)
                if not os.path.exists(img_symlink):
                    os.symlink(img_path, img_symlink)

                label_name = f"{img_filename.split('.')[0]}.txt"
                train_label = os.path.join(dataset_dir, "labels/train", label_name)
                val_label = os.path.join(dataset_dir, "labels/val", label_name)
                if os.path.exists(train_label) and not os.path.exists(val_label):
                    shutil.copy2(train_label, val_label)

                val_linked += 1

        logger.info(f"Linked {train_linked} train images, {val_linked} val images")

        data_yaml = {
            "train": os.path.abspath(f"{dataset_dir}/images/train"),
            "val": os.path.abspath(f"{dataset_dir}/images/val"),
            "nc": len(class_names),
            "names": {i: name for i, name in enumerate(class_names)},
        }

        yaml_path = f"{dataset_dir}/data.yaml"
        with open(yaml_path, "w") as f:
            yaml.dump(data_yaml, f, default_flow_style=False)

        return dataset_dir, yaml_path, total_processed_count, class_names

    except Exception as e:
        logger.error(f"Dataset structure creation error: {e}")
        raise


def convert_segmentation_to_yolo(
    image_width: int, image_height: int, segmentation: List
) -> List[float]:
    """
    Convert COCO segmentation polygon to YOLO normalized format.
    COCO: flat list [x1, y1, x2, y2, ...] in pixel coordinates
    YOLO: flat list [x1, y1, x2, y2, ...] normalized to 0-1
    """
    if not segmentation:
        return []

    normalized = []
    for i in range(0, len(segmentation), 2):
        if i + 1 < len(segmentation):
            x = segmentation[i] / image_width
            y = segmentation[i + 1] / image_height
            x = max(0.0, min(1.0, x))
            y = max(0.0, min(1.0, y))
            normalized.extend([x, y])

    return normalized


def process_coco_annotations_to_yolo_seg(
    annotation_path: str,
    output_labels_dir: str,
    images_dir: str,
    category_id_map: Dict[int, int],
) -> int:
    """
    Convert COCO annotation to YOLO segmentation format.
    YOLO seg format: class_id x1 y1 x2 y2 ... xn yn (normalized polygon coordinates)
    """
    try:
        from pycocotools.coco import COCO

        coco = COCO(annotation_path)

        processed_count = 0
        skipped_no_seg = 0

        for img_id in coco.getImgIds():
            img_info = coco.loadImgs([img_id])[0]
            img_filename = img_info["file_name"]
            img_path = os.path.join(images_dir, img_filename)

            if not os.path.exists(img_path):
                continue

            img_width, img_height = img_info["width"], img_info["height"]
            annotations = coco.loadAnns(coco.getAnnIds(imgIds=[img_id]))

            label_file_path = os.path.join(
                output_labels_dir, f"{img_filename.split('.')[0]}.txt"
            )

            valid_annotations = []
            for ann in annotations:
                coco_cat_id = ann["category_id"]
                if coco_cat_id not in category_id_map:
                    continue

                seg = ann.get("segmentation", [])
                if not seg or (isinstance(seg, list) and len(seg) == 0):
                    skipped_no_seg += 1
                    continue

                if isinstance(seg, list) and len(seg) > 0:
                    if isinstance(seg[0], list):
                        polygon = seg[0]
                    else:
                        polygon = seg
                else:
                    skipped_no_seg += 1
                    continue

                if len(polygon) < 6:
                    continue

                normalized_polygon = convert_segmentation_to_yolo(
                    img_width, img_height, polygon
                )

                if len(normalized_polygon) >= 6:
                    yolo_class_id = category_id_map[coco_cat_id]
                    valid_annotations.append((yolo_class_id, normalized_polygon))

            if valid_annotations:
                with open(label_file_path, "w") as label_file:
                    for class_id, polygon in valid_annotations:
                        coords_str = " ".join(f"{c:.6f}" for c in polygon)
                        label_file.write(f"{class_id} {coords_str}\n")
                processed_count += 1

        if skipped_no_seg > 0:
            logger.warning(
                f"Skipped {skipped_no_seg} annotations without segmentation data"
            )

        return processed_count

    except Exception as e:
        logger.error(f"COCO to YOLO segmentation conversion error: {e}")
        raise


def create_yolo_seg_dataset_structure(annotation_files: List[str], job_id: str):
    """
    Create dataset structure for YOLO segmentation training.
    Uses polygon segmentation data instead of bounding boxes.
    """
    try:
        dataset_dir = f"{TRAINING_DATASETS_DIR}/{job_id}_seg"
        os.makedirs(dataset_dir, exist_ok=True)
        os.makedirs(f"{dataset_dir}/images/train", exist_ok=True)
        os.makedirs(f"{dataset_dir}/images/val", exist_ok=True)
        os.makedirs(f"{dataset_dir}/labels/train", exist_ok=True)
        os.makedirs(f"{dataset_dir}/labels/val", exist_ok=True)

        total_processed_count = 0
        used_images = set()

        all_categories: Dict[int, str] = {}

        for annotation_file in annotation_files:
            annotation_path = os.path.join("annotations", annotation_file)
            if not os.path.exists(annotation_path):
                raise FileNotFoundError(f"Annotation file not found: {annotation_path}")

            with open(annotation_path, "r", encoding="utf-8") as f:
                coco_data = json.load(f)

            for cat in coco_data.get("categories", []):
                cat_id = cat.get("id")
                cat_name = cat.get("name")
                if cat_id is not None and cat_name:
                    all_categories[cat_id] = cat_name

            for img_info in coco_data.get("images", []):
                img_filename = img_info.get("file_name")
                if img_filename:
                    used_images.add(img_filename)

        sorted_cat_ids = sorted(all_categories.keys())
        category_id_map = {cat_id: idx for idx, cat_id in enumerate(sorted_cat_ids)}
        class_names = [all_categories[cat_id] for cat_id in sorted_cat_ids]

        logger.info(
            f"[SEG] Extracted {len(class_names)} classes from annotations: {class_names}"
        )

        for annotation_file in annotation_files:
            annotation_path = os.path.join("annotations", annotation_file)

            processed_count = process_coco_annotations_to_yolo_seg(
                annotation_path,
                f"{dataset_dir}/labels/train",
                "images",
                category_id_map,
            )

            total_processed_count += processed_count
            logger.info(f"[SEG] {annotation_file} processed: {processed_count} images")

        all_images = [
            img
            for img in used_images
            if img.lower().endswith((".jpg", ".jpeg", ".png"))
        ]
        random.seed(42)
        random.shuffle(all_images)

        split_idx = int(len(all_images) * 0.8)
        train_images = all_images[:split_idx]
        val_images = all_images[split_idx:]

        logger.info(
            f"[SEG] Dataset split: {len(train_images)} train, {len(val_images)} val"
        )

        train_linked = 0
        for img_filename in train_images:
            img_path = os.path.abspath(os.path.join("images", img_filename))
            if os.path.exists(img_path):
                img_symlink = os.path.join(dataset_dir, "images/train", img_filename)
                if not os.path.exists(img_symlink):
                    os.symlink(img_path, img_symlink)
                train_linked += 1

        val_linked = 0
        for img_filename in val_images:
            img_path = os.path.abspath(os.path.join("images", img_filename))
            if os.path.exists(img_path):
                img_symlink = os.path.join(dataset_dir, "images/val", img_filename)
                if not os.path.exists(img_symlink):
                    os.symlink(img_path, img_symlink)

                label_name = f"{img_filename.split('.')[0]}.txt"
                train_label = os.path.join(dataset_dir, "labels/train", label_name)
                val_label = os.path.join(dataset_dir, "labels/val", label_name)
                if os.path.exists(train_label) and not os.path.exists(val_label):
                    shutil.copy2(train_label, val_label)

                val_linked += 1

        logger.info(
            f"[SEG] Linked {train_linked} train images, {val_linked} val images"
        )

        data_yaml = {
            "train": os.path.abspath(f"{dataset_dir}/images/train"),
            "val": os.path.abspath(f"{dataset_dir}/images/val"),
            "nc": len(class_names),
            "names": {i: name for i, name in enumerate(class_names)},
        }

        yaml_path = f"{dataset_dir}/data.yaml"
        with open(yaml_path, "w") as f:
            yaml.dump(data_yaml, f, default_flow_style=False)

        if total_processed_count == 0:
            raise ValueError(
                "No valid segmentation data found in annotations. "
                "Ensure annotations contain polygon segmentation data."
            )

        return dataset_dir, yaml_path, total_processed_count, class_names

    except Exception as e:
        logger.error(f"[SEG] Dataset structure creation error: {e}")
        raise


def load_trained_model(model_id: str):
    """Load trained model"""
    from ultralytics import YOLO

    if model_id in loaded_models:
        return loaded_models[model_id]

    model_path = Path(f"{TRAINED_MODELS_DIR}/model_{model_id}.pt")
    if model_path.exists():
        try:
            model = YOLO(str(model_path))
            loaded_models[model_id] = model
            logger.info(f"Model loaded successfully: {model_id}")
            return model
        except Exception as e:
            logger.error(f"Model load failed {model_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Model load failed: {str(e)}")

    parts = model_id.split("_")
    if len(parts) >= 2:
        dataset_id = "_".join(parts[:-1])
        weight_type = parts[-1]
        weight_path = Path(
            f"{TRAINING_DATASETS_DIR}/{dataset_id}/runs/train/weights/{weight_type}.pt"
        )

        if weight_path.exists():
            try:
                model = YOLO(str(weight_path))
                loaded_models[model_id] = model
                logger.info(f"Model loaded successfully: {model_id}")
                return model
            except Exception as e:
                logger.error(f"Model load failed {model_id}: {e}")
                raise HTTPException(
                    status_code=500, detail=f"Model load failed: {str(e)}"
                )

    raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")


def run_model_inference(model, image_path: str, confidence: float = 0.25):
    """Perform model inference"""
    try:
        results = model(image_path, conf=confidence, verbose=False)
        return results[0]
    except Exception as e:
        logger.error(f"Inference failed: {e}")
        raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")


def convert_yolo_to_coco_format(results, image_path: str, model_id: str):
    """Convert inference results to COCO format"""
    from PIL import Image

    img = Image.open(image_path)
    W, H = img.size

    coco_data = {
        "image": {
            "width": W,
            "height": H,
            "url": str(image_path),
            "filename": Path(image_path).name,
        },
        "polygons": [],
        "metadata": {
            "model_id": model_id,
            "inference_id": uuid.uuid4().hex[:10],
            "created_at": datetime.now().isoformat(),
            "confidence_threshold": results.conf.tolist()
            if hasattr(results, "conf")
            else [],
        },
    }

    if results.boxes is not None and len(results.boxes) > 0:
        boxes = results.boxes.xyxy.cpu().numpy()
        confidences = results.boxes.conf.cpu().numpy()
        class_ids = results.boxes.cls.cpu().numpy().astype(int)
        class_names = results.names

        for i, (box, conf, cls_id) in enumerate(zip(boxes, confidences, class_ids)):
            x1, y1, x2, y2 = box
            polygon_coords = [
                float(x1),
                float(y1),
                float(x2),
                float(y1),
                float(x2),
                float(y2),
                float(x1),
                float(y2),
            ]

            polygon_data = {
                "label": class_names.get(cls_id, f"class_{cls_id}"),
                "points": polygon_coords,
                "confidence": float(conf),
                "detection_id": i,
            }

            coco_data["polygons"].append(polygon_data)

    return coco_data


def request_training_stop(job_id: str) -> bool:
    """
    Request to stop a training job.

    Args:
        job_id: The job ID to stop

    Returns:
        True if stop request was set, False if job not found or already stopped
    """
    if job_id not in training_jobs:
        return False

    job_info = training_jobs[job_id]
    if job_info["status"] not in ["preparing", "training"]:
        return False

    training_jobs[job_id]["stop_requested"] = True
    training_jobs[job_id]["message"] = (
        "Stop requested, waiting for current epoch to finish..."
    )
    logger.info(f"Stop requested for training job: {job_id}")
    return True


def _create_stop_callback(job_id: str, task_type: str = "detection"):
    """
    Create a callback function that checks for stop requests after each epoch.

    Args:
        job_id: The job ID to monitor
        task_type: "detection" or "segmentation"

    Returns:
        Callback function for ultralytics trainer
    """
    task_label = "Segmentation" if task_type == "segmentation" else "Detection"

    def on_train_epoch_end(trainer):
        if job_id in training_jobs and training_jobs[job_id].get(
            "stop_requested", False
        ):
            logger.info(
                f"Stop requested detected for job {job_id}, stopping training..."
            )
            trainer.stop = True

        if job_id in training_jobs:
            current_epoch = trainer.epoch + 1
            total_epochs = trainer.epochs
            progress = 15 + int((current_epoch / total_epochs) * 65)
            training_jobs[job_id]["progress"] = min(progress, 80)
            training_jobs[job_id]["current_epoch"] = current_epoch
            training_jobs[job_id]["total_epochs"] = total_epochs
            training_jobs[job_id]["message"] = (
                f"{task_label} training... (Epoch {current_epoch}/{total_epochs})"
            )

    return on_train_epoch_end


def train_yolo_model_background(
    job_id: str,
    dataset_dir: str,
    yaml_path: str,
    epochs: int = 10,
    batch_size: int = 16,
    img_size: int = 640,
    unload_sam2: bool = True,
    task_type: str = "detection",
    skip_sam2_reload: bool = False,
):
    """
    Train YOLO model in background with GPU memory management.
    Supports both detection and segmentation training.

    Args:
        job_id: Unique job identifier
        dataset_dir: Path to dataset directory
        yaml_path: Path to data.yaml file
        epochs: Number of training epochs
        batch_size: Training batch size
        img_size: Training image size
        unload_sam2: Whether to unload SAM2 models during training
        task_type: "detection" or "segmentation"
        skip_sam2_reload: If True, skip SAM2 reload in finally block (for multi-task training)
    """
    from ultralytics import YOLO
    from utils.gpu_memory import (
        clear_gpu_memory,
        check_memory_available,
        estimate_yolo_training_memory,
        get_gpu_memory_info,
    )
    from models.sam2_loader import (
        unload_sam2_models,
        reload_sam2_models,
        is_sam2_loaded,
    )
    from services.model_registry import get_registry

    sam2_was_loaded = False
    model = None
    was_stopped = False

    try:
        training_jobs[job_id]["status"] = "preparing"
        training_jobs[job_id]["progress"] = 5
        training_jobs[job_id]["message"] = "Preparing GPU memory..."
        training_jobs[job_id]["stop_requested"] = False

        # Step 1: Estimate memory requirements
        required_memory = estimate_yolo_training_memory(batch_size, img_size)
        logger.info(f"Estimated YOLO training memory: {required_memory:.2f}GB")

        # Step 2: Check if SAM2 should be unloaded
        sam2_was_loaded = is_sam2_loaded()

        if unload_sam2 and sam2_was_loaded:
            training_jobs[job_id]["message"] = (
                "Unloading SAM2 models to free GPU memory..."
            )
            unload_result = unload_sam2_models()
            logger.info(
                f"SAM2 unloaded: freed {unload_result.get('freed_gb', 0):.2f}GB"
            )

        # Step 3: Clear GPU memory cache
        clear_gpu_memory(force_gc=True)

        # Step 4: Validate available memory
        is_available, free_memory = check_memory_available(required_memory)

        if not is_available:
            error_msg = (
                f"Insufficient GPU memory. Required: {required_memory:.2f}GB, "
                f"Available: {free_memory:.2f}GB"
            )
            logger.error(error_msg)
            training_jobs[job_id]["status"] = "failed"
            training_jobs[job_id]["message"] = error_msg
            training_jobs[job_id]["error"] = error_msg
            return

        logger.info(
            f"GPU memory check passed. Available: {free_memory:.2f}GB, "
            f"Required: {required_memory:.2f}GB"
        )

        # Step 5: Start training
        training_jobs[job_id]["status"] = "training"
        training_jobs[job_id]["progress"] = 10

        base_model = "yolov8s-seg.pt" if task_type == "segmentation" else "yolov8s.pt"
        task_label = "segmentation" if task_type == "segmentation" else "detection"
        training_jobs[job_id]["message"] = f"Loading YOLO {task_label} model..."
        training_jobs[job_id]["task_type"] = task_type

        model = YOLO(base_model)

        # Register callback for stop check and progress update
        stop_callback = _create_stop_callback(job_id, task_type)
        model.add_callback("on_train_epoch_end", stop_callback)

        training_jobs[job_id]["message"] = f"Training {task_label} model..."
        training_jobs[job_id]["progress"] = 15

        results = model.train(
            data=yaml_path,
            epochs=epochs,
            batch=batch_size,
            imgsz=img_size,
            project=f"{dataset_dir}/runs",
            name="train",
            verbose=True,
            workers=0,
            amp=False,
            val=False,  # 학습 중 validation 비활성화 (batch*2 사용으로 OOM 방지, 학습 후 별도 수행)
        )

        # Check if training was stopped by user
        was_stopped = training_jobs[job_id].get("stop_requested", False)

        # Handle stopped training
        if was_stopped:
            training_jobs[job_id]["status"] = "stopped"
            training_jobs[job_id]["progress"] = training_jobs[job_id].get(
                "progress", 50
            )
            training_jobs[job_id]["message"] = "Training stopped by user"
            training_jobs[job_id]["completed_at"] = datetime.now().isoformat()
            logger.info(f"Training stopped by user: {job_id}")
            return

        training_jobs[job_id]["progress"] = 80
        training_jobs[job_id]["message"] = (
            "Training complete, running final validation..."
        )

        # Validation with smaller batch size and error handling
        metrics = None
        try:
            metrics = model.val(batch=2)  # 작은 배치로 안정적인 validation
            logger.info(f"Validation completed for job {job_id}")
        except Exception as val_error:
            logger.warning(
                f"Validation failed for job {job_id}: {val_error}, using training metrics"
            )
            # 학습 중 validation 결과 사용
            metrics = results

        # Step 6: Save model
        models_dir = TRAINED_MODELS_DIR
        os.makedirs(models_dir, exist_ok=True)

        model_suffix = "_seg" if task_type == "segmentation" else ""
        model_name = f"model_{job_id}{model_suffix}"
        model_path = f"{models_dir}/{model_name}.pt"
        torchscript_path = f"{models_dir}/{model_name}.torchscript"

        best_model_path = f"{dataset_dir}/runs/train/weights/best.pt"
        if os.path.exists(best_model_path):
            shutil.copy2(best_model_path, model_path)
            model.export(format="torchscript", save_dir=models_dir)

        training_jobs[job_id]["status"] = "completed"
        training_jobs[job_id]["progress"] = 100
        training_jobs[job_id]["message"] = "Training complete"
        training_jobs[job_id]["model_path"] = model_path
        training_jobs[job_id]["torchscript_path"] = torchscript_path

        # Extract metrics safely
        try:
            metrics_source = (
                metrics.seg
                if (task_type == "segmentation" and hasattr(metrics, "seg"))
                else getattr(metrics, "box", None)
            )

            if metrics is not None and metrics_source is not None:
                training_jobs[job_id]["metrics"] = {
                    "task_type": task_type,
                    "map50": float(metrics_source.map50)
                    if hasattr(metrics_source, "map50")
                    else 0,
                    "map50_95": float(metrics_source.map)
                    if hasattr(metrics_source, "map")
                    else 0,
                    "precision": float(metrics_source.mp)
                    if hasattr(metrics_source, "mp")
                    else 0,
                    "recall": float(metrics_source.mr)
                    if hasattr(metrics_source, "mr")
                    else 0,
                }

                # Per-class metrics
                per_class_metrics = {}
                try:
                    class_names = getattr(metrics, "names", {})
                    ap50_per_class = getattr(metrics_source, "ap50", None)
                    ap_per_class = getattr(metrics_source, "ap", None)
                    p_per_class = getattr(metrics_source, "p", None)
                    r_per_class = getattr(metrics_source, "r", None)

                    for idx, class_name in class_names.items():
                        per_class_metrics[class_name] = {
                            "class_id": idx,
                            "ap50": float(ap50_per_class[idx])
                            if ap50_per_class is not None and idx < len(ap50_per_class)
                            else 0,
                            "ap50_95": float(ap_per_class[idx])
                            if ap_per_class is not None and idx < len(ap_per_class)
                            else 0,
                            "precision": float(p_per_class[idx])
                            if p_per_class is not None and idx < len(p_per_class)
                            else 0,
                            "recall": float(r_per_class[idx])
                            if r_per_class is not None and idx < len(r_per_class)
                            else 0,
                        }

                    training_jobs[job_id]["metrics"]["per_class"] = per_class_metrics
                    training_jobs[job_id]["metrics"]["class_names"] = list(
                        class_names.values()
                    )
                    logger.info(
                        f"Per-class metrics extracted for {len(per_class_metrics)} classes"
                    )
                except Exception as per_class_error:
                    logger.warning(
                        f"Failed to extract per-class metrics: {per_class_error}"
                    )
                    training_jobs[job_id]["metrics"]["per_class"] = {}
            else:
                training_jobs[job_id]["metrics"] = {
                    "task_type": task_type,
                    "map50": 0,
                    "map50_95": 0,
                    "precision": 0,
                    "recall": 0,
                    "per_class": {},
                    "note": "Metrics unavailable - validation skipped or failed",
                }
        except Exception as metric_error:
            logger.warning(f"Failed to extract metrics: {metric_error}")
            training_jobs[job_id]["metrics"] = {"error": str(metric_error)}

        training_jobs[job_id]["completed_at"] = datetime.now().isoformat()

        # Register model to ModelRegistry
        try:
            registry = get_registry()
            job_metrics = training_jobs[job_id].get("metrics", {})
            dataset_info = {
                "annotation_files": training_jobs[job_id].get(
                    "annotation_filenames", []
                ),
                "processed_count": training_jobs[job_id].get("processed_count", 0),
                "dataset_dir": dataset_dir,
            }
            config_info = {
                "epochs": epochs,
                "batch_size": batch_size,
                "img_size": img_size,
            }
            registry_result = registry.register_model(
                model_id=job_id,
                model_path=model_path,
                metrics=job_metrics,
                dataset_info=dataset_info,
                config=config_info,
            )
            training_jobs[job_id]["registry_status"] = registry_result.get("status")
            training_jobs[job_id]["registry_message"] = registry_result.get(
                "status_message"
            )
            logger.info(
                f"Model registered to registry: {job_id} -> {registry_result.get('status')}"
            )
        except Exception as registry_error:
            logger.error(f"Failed to register model to registry: {registry_error}")
            training_jobs[job_id]["registry_error"] = str(registry_error)

        logger.info(f"Model training complete: {job_id}")

    except torch.cuda.OutOfMemoryError as e:
        error_msg = f"GPU out of memory: {str(e)}"
        logger.error(f"OOM during training {job_id}: {e}")
        training_jobs[job_id]["status"] = "failed"
        training_jobs[job_id]["message"] = error_msg
        training_jobs[job_id]["error"] = error_msg

    except Exception as e:
        error_msg = f"Training failed: {str(e)}"
        logger.error(f"Model training failed {job_id}: {e}", exc_info=True)
        training_jobs[job_id]["status"] = "failed"
        training_jobs[job_id]["message"] = error_msg
        training_jobs[job_id]["error"] = error_msg

    finally:
        # Step 7: Cleanup and reload SAM2 if needed
        try:
            # Delete YOLO model to free memory
            if model is not None:
                del model
                model = None

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Reload SAM2 if it was loaded before (skip if multi-task training)
            if sam2_was_loaded and unload_sam2 and not skip_sam2_reload:
                current_msg = training_jobs[job_id].get("message", "")
                training_jobs[job_id]["message"] = f"{current_msg} Reloading SAM2..."
                reload_result = reload_sam2_models()
                logger.info(f"SAM2 reloaded: {reload_result}")

        except Exception as cleanup_error:
            logger.error(f"Error during cleanup: {cleanup_error}")
