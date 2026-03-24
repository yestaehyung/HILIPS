"""
Model management API endpoints
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, FileResponse

from config import (
    TRAINED_MODELS_DIR,
    TRAINING_DATASETS_DIR,
    ANNOTATIONS_DIR,
    IMAGES_DIR,
)
from schemas import ModelInferenceRequest, BatchInferenceRequest
from services import (
    training_jobs,
    load_trained_model,
    run_model_inference,
    convert_yolo_to_coco_format,
    get_registry,
)
from services.workflow_state import get_workflow_state_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models")
async def list_trained_models():
    """Query list of trained models"""
    if not os.path.exists(TRAINED_MODELS_DIR):
        return JSONResponse(content={"models": [], "total_count": 0})

    models_list = []

    for job_id, job_info in training_jobs.items():
        if job_info["status"] == "completed" and "model_path" in job_info:
            model_path = job_info["model_path"]
            if os.path.exists(model_path):
                model_info = {
                    "model_id": job_id,
                    "model_name": job_info["model_name"],
                    "model_path": model_path,
                    "torchscript_path": job_info.get("torchscript_path"),
                    "created_at": job_info["completed_at"],
                    "annotation_filenames": job_info["annotation_filenames"],
                    "training_parameters": {
                        "epochs": job_info["epochs"],
                        "batch_size": job_info["batch_size"],
                        "img_size": job_info["img_size"],
                    },
                    "metrics": job_info.get("metrics", {}),
                    "processed_images_count": job_info.get("processed_count", 0),
                }

                try:
                    model_stat = os.stat(model_path)
                    model_info["file_size"] = model_stat.st_size
                    model_info["modified_time"] = model_stat.st_mtime
                except:
                    pass

                models_list.append(model_info)

    return JSONResponse(
        content={
            "models": sorted(
                models_list, key=lambda x: x.get("created_at", ""), reverse=True
            ),
            "total_count": len(models_list),
        }
    )


@router.get("/models/weights")
async def list_model_weights():
    """Query list of available model weights"""
    weights = []

    models_dir = Path(TRAINED_MODELS_DIR)
    if models_dir.exists():
        for model_file in models_dir.glob("*.pt"):
            model_id = model_file.stem.replace("model_", "")

            model_info = {
                "model_id": model_id,
                "filename": model_file.name,
                "filepath": str(model_file),
                "size_mb": round(model_file.stat().st_size / (1024 * 1024), 2),
                "created_at": datetime.fromtimestamp(
                    model_file.stat().st_mtime
                ).isoformat(),
                "status": "unknown",
                "metrics": {},
                "training_info": {},
            }

            if model_id in training_jobs:
                job_info = training_jobs[model_id]
                model_info.update(
                    {
                        "status": job_info.get("status", "unknown"),
                        "metrics": job_info.get("metrics", {}),
                        "training_info": {
                            "created_at": job_info.get("created_at", ""),
                            "completed_at": job_info.get("completed_at", ""),
                            "message": job_info.get("message", ""),
                            "progress": job_info.get("progress", 0),
                            "dataset_name": job_info.get("dataset_name", ""),
                            "annotation_files": job_info.get("annotation_files", []),
                            "epochs": job_info.get("epochs", 0),
                            "batch_size": job_info.get("batch_size", 0),
                        },
                    }
                )

            weights.append(model_info)

    datasets_dir = Path(TRAINING_DATASETS_DIR)
    if datasets_dir.exists():
        for dataset_dir in datasets_dir.iterdir():
            if dataset_dir.is_dir():
                best_weight = dataset_dir / "runs" / "train" / "weights" / "best.pt"
                last_weight = dataset_dir / "runs" / "train" / "weights" / "last.pt"

                for weight_file in [best_weight, last_weight]:
                    if weight_file.exists():
                        model_id = f"{dataset_dir.name}_{weight_file.stem}"

                        weight_info = {
                            "model_id": model_id,
                            "filename": f"{dataset_dir.name}_{weight_file.name}",
                            "filepath": str(weight_file),
                            "size_mb": round(
                                weight_file.stat().st_size / (1024 * 1024), 2
                            ),
                            "created_at": datetime.fromtimestamp(
                                weight_file.stat().st_mtime
                            ).isoformat(),
                            "status": "training_artifact",
                            "type": weight_file.stem,
                            "dataset_id": dataset_dir.name,
                            "metrics": {},
                            "training_info": {},
                        }

                        if dataset_dir.name in training_jobs:
                            job_info = training_jobs[dataset_dir.name]
                            weight_info["metrics"] = job_info.get("metrics", {})
                            weight_info["training_info"] = {
                                "created_at": job_info.get("created_at", ""),
                                "completed_at": job_info.get("completed_at", ""),
                                "message": job_info.get("message", ""),
                                "dataset_name": job_info.get("dataset_name", ""),
                                "annotation_files": job_info.get(
                                    "annotation_files", []
                                ),
                                "epochs": job_info.get("epochs", 0),
                                "batch_size": job_info.get("batch_size", 0),
                            }

                        weights.append(weight_info)

    weights.sort(key=lambda x: x["created_at"], reverse=True)

    return {"total_models": len(weights), "models": weights}


# ============================================================================
# Model Registry Endpoints (MUST be before /models/{model_id})
# ============================================================================


@router.get("/models/registry")
async def list_registry_models():
    try:
        registry = get_registry()
        models = registry.get_all_models()

        result = []
        for model in models:
            model_detail = registry.get_model(model["model_id"])
            if model_detail:
                versions = model_detail.get("versions", [])
                latest_version = versions[-1] if versions else {}

                result.append(
                    {
                        "model_id": model["model_id"],
                        "version": model.get("latest_version", 1),
                        "status": model.get("status", "unknown"),
                        "status_message": latest_version.get("status_message", ""),
                        "metrics": model.get("metrics", {}),
                        "created_at": model.get("created_at", ""),
                        "promoted_at": model_detail.get("promoted_at"),
                    }
                )

        return {"success": True, "models": result, "total_count": len(result)}
    except Exception as e:
        logger.error(f"Failed to list registry models: {e}")
        return {"success": False, "models": [], "total_count": 0, "error": str(e)}


@router.get("/models/registry/stats")
async def get_registry_stats():
    try:
        registry = get_registry()
        stats = registry.get_statistics()

        return {"success": True, **stats}
    except Exception as e:
        logger.error(f"Failed to get registry stats: {e}")
        return {
            "success": False,
            "error": str(e),
            "total_models": 0,
            "ready_models": 0,
            "production_models": 0,
            "needs_improvement": 0,
            "average_map70": 0,
            "map_threshold": 0.7,
        }


@router.post("/models/promote")
async def promote_model_to_production(model_id: str):
    try:
        registry = get_registry()
        result = registry.promote_to_production(model_id)

        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to promote model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/models/register")
async def register_model_to_registry(
    model_id: str,
    model_path: str,
    metrics: dict,
    dataset_info: dict = {},
    config: dict = {},
):
    try:
        registry = get_registry()
        result = registry.register_model(
            model_id=model_id,
            model_path=model_path,
            metrics=metrics,
            dataset_info=dataset_info,
            config=config,
        )

        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Failed to register model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/models/evaluate")
async def evaluate_model_metrics(model_id: str, metrics: dict):
    try:
        registry = get_registry()
        result = registry.evaluate_model(model_id, metrics)

        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to evaluate model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/models/registry/{model_id}")
async def delete_model_from_registry(model_id: str, delete_files: bool = True):
    try:
        registry = get_registry()
        result = registry.delete_model(model_id, delete_files=delete_files)

        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models/{model_id}")
async def get_model_info(model_id: str):
    """Query detailed info for specific model"""
    if model_id not in training_jobs:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")

    job_info = training_jobs[model_id]
    if job_info["status"] != "completed":
        raise HTTPException(
            status_code=400, detail=f"Model '{model_id}' training not completed."
        )

    model_path = job_info.get("model_path")
    if not model_path or not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Model file not found.")

    return JSONResponse(
        content={
            "model_id": model_id,
            "model_name": job_info["model_name"],
            "model_path": model_path,
            "torchscript_path": job_info.get("torchscript_path"),
            "created_at": job_info["completed_at"],
            "annotation_filenames": job_info["annotation_filenames"],
            "training_parameters": {
                "epochs": job_info["epochs"],
                "batch_size": job_info["batch_size"],
                "img_size": job_info["img_size"],
            },
            "metrics": job_info.get("metrics", {}),
            "processed_images_count": job_info.get("processed_count", 0),
        }
    )


@router.get("/models/{model_id}/download")
async def download_model(model_id: str):
    """Download specific model file"""
    if model_id not in training_jobs:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")

    job_info = training_jobs[model_id]
    if job_info["status"] != "completed":
        raise HTTPException(
            status_code=400, detail=f"Model '{model_id}' training not completed."
        )

    model_path = job_info.get("model_path")
    if not model_path or not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Model file not found.")

    model_filename = f"{job_info['model_name']}.pt"

    return FileResponse(
        model_path,
        media_type="application/octet-stream",
        filename=model_filename,
        headers={"Content-Disposition": f"attachment; filename={model_filename}"},
    )


@router.get("/models/{model_id}/download/torchscript")
async def download_model_torchscript(model_id: str):
    """Download TorchScript file for specific model"""
    if model_id not in training_jobs:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")

    job_info = training_jobs[model_id]
    if job_info["status"] != "completed":
        raise HTTPException(
            status_code=400, detail=f"Model '{model_id}' training not completed."
        )

    torchscript_path = job_info.get("torchscript_path")
    if not torchscript_path or not os.path.exists(torchscript_path):
        raise HTTPException(status_code=404, detail=f"TorchScript file not found.")

    torchscript_filename = f"{job_info['model_name']}.torchscript"

    return FileResponse(
        torchscript_path,
        media_type="application/octet-stream",
        filename=torchscript_filename,
        headers={"Content-Disposition": f"attachment; filename={torchscript_filename}"},
    )


@router.get("/models/weights/{model_id}")
async def get_model_weight_details(model_id: str):
    """Query detailed info for specific model weight"""
    model_path = Path(f"{TRAINED_MODELS_DIR}/model_{model_id}.pt")
    if model_path.exists():
        model_info = {
            "model_id": model_id,
            "filename": model_path.name,
            "filepath": str(model_path),
            "size_mb": round(model_path.stat().st_size / (1024 * 1024), 2),
            "created_at": datetime.fromtimestamp(
                model_path.stat().st_mtime
            ).isoformat(),
            "status": "unknown",
            "metrics": {},
            "training_info": {},
            "type": "trained_model",
        }

        if model_id in training_jobs:
            job_info = training_jobs[model_id]
            model_info.update(
                {
                    "status": job_info.get("status", "unknown"),
                    "metrics": job_info.get("metrics", {}),
                    "training_info": job_info,
                }
            )

        return model_info

    parts = model_id.split("_")
    if len(parts) >= 2:
        dataset_id = "_".join(parts[:-1])
        weight_type = parts[-1]

        weight_path = Path(
            f"{TRAINING_DATASETS_DIR}/{dataset_id}/runs/train/weights/{weight_type}.pt"
        )
        if weight_path.exists():
            result = {
                "model_id": model_id,
                "filename": f"{dataset_id}_{weight_type}.pt",
                "filepath": str(weight_path),
                "size_mb": round(weight_path.stat().st_size / (1024 * 1024), 2),
                "created_at": datetime.fromtimestamp(
                    weight_path.stat().st_mtime
                ).isoformat(),
                "status": "training_artifact",
                "type": weight_type,
                "dataset_id": dataset_id,
                "metrics": {},
                "training_info": {},
            }

            if dataset_id in training_jobs:
                job_info = training_jobs[dataset_id]
                result["metrics"] = job_info.get("metrics", {})
                result["training_info"] = job_info

            return result

    raise HTTPException(status_code=404, detail=f"Model weight '{model_id}' not found.")


@router.post("/models/weights/compare")
async def compare_model_weights(model_ids: List[str]):
    """Compare multiple model weights"""
    if len(model_ids) < 2:
        raise HTTPException(
            status_code=400, detail="At least 2 models required for comparison."
        )

    models = []
    for model_id in model_ids:
        try:
            model_details = await get_model_weight_details(model_id)
            models.append(model_details)
        except HTTPException:
            continue

    if len(models) < 2:
        raise HTTPException(
            status_code=400, detail="Not enough models available for comparison."
        )

    comparison = {
        "models": models,
        "comparison": {
            "best_map50": None,
            "best_map50_95": None,
            "best_precision": None,
            "best_recall": None,
            "model_sizes": [(m["model_id"], m["size_mb"]) for m in models],
            "creation_dates": [(m["model_id"], m["created_at"]) for m in models],
        },
    }

    best_map50 = max(
        models, key=lambda x: x.get("metrics", {}).get("map50", 0), default=None
    )
    best_map50_95 = max(
        models, key=lambda x: x.get("metrics", {}).get("map50_95", 0), default=None
    )
    best_precision = max(
        models, key=lambda x: x.get("metrics", {}).get("precision", 0), default=None
    )
    best_recall = max(
        models, key=lambda x: x.get("metrics", {}).get("recall", 0), default=None
    )

    if best_map50:
        comparison["comparison"]["best_map50"] = {
            "model_id": best_map50["model_id"],
            "value": best_map50.get("metrics", {}).get("map50", 0),
        }

    if best_map50_95:
        comparison["comparison"]["best_map50_95"] = {
            "model_id": best_map50_95["model_id"],
            "value": best_map50_95.get("metrics", {}).get("map50_95", 0),
        }

    if best_precision:
        comparison["comparison"]["best_precision"] = {
            "model_id": best_precision["model_id"],
            "value": best_precision.get("metrics", {}).get("precision", 0),
        }

    if best_recall:
        comparison["comparison"]["best_recall"] = {
            "model_id": best_recall["model_id"],
            "value": best_recall.get("metrics", {}).get("recall", 0),
        }

    return comparison


@router.post("/models/{model_id}/inference")
async def model_inference(model_id: str, request: ModelInferenceRequest):
    """Perform image inference with selected model"""
    logger.info(f"Model inference request: {model_id}, image: {request.image_path}")

    image_path = Path(request.image_path)
    if not image_path.exists():
        image_path = Path("images") / request.image_path
        if not image_path.exists():
            raise HTTPException(
                status_code=404, detail=f"Image file not found: {request.image_path}"
            )

    model = load_trained_model(model_id)
    results = run_model_inference(model, str(image_path), request.confidence)
    coco_data = convert_yolo_to_coco_format(results, str(image_path), model_id)

    if request.save_labels:
        output_dir = Path(ANNOTATIONS_DIR)
        output_dir.mkdir(exist_ok=True)

        image_name = image_path.stem
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"{image_name}_inference_{model_id}_{timestamp}.json"
        output_path = output_dir / output_filename

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(coco_data, f, ensure_ascii=False, indent=2)

        coco_data["metadata"]["saved_to"] = str(output_path)
        logger.info(f"Inference result saved: {output_path}")

    return {
        "success": True,
        "model_id": model_id,
        "image_path": str(image_path),
        "detections_count": len(coco_data["polygons"]),
        "inference_data": coco_data,
    }


@router.post("/models/{model_id}/batch-inference")
async def batch_model_inference(model_id: str, request: BatchInferenceRequest):
    """
    Batch inference for auto-labeling unlabeled images.

    Runs YOLO model on multiple images and saves annotations.
    High confidence detections (>= auto_label_threshold) are auto-labeled.
    Low confidence detections are marked for review.
    """
    logger.info(
        f"Batch inference request: model={model_id}, process_unlabeled={request.process_unlabeled}, include_needs_review={request.include_needs_review}"
    )

    images_dir = Path(IMAGES_DIR)
    annotations_dir = Path(ANNOTATIONS_DIR)

    if not images_dir.exists():
        raise HTTPException(status_code=404, detail="Images directory not found")

    all_images = [
        f.name
        for f in images_dir.iterdir()
        if f.suffix.lower() in [".jpg", ".jpeg", ".png"]
    ]

    existing_annotations = set()
    needs_review_images = set()

    if annotations_dir.exists():
        for f in annotations_dir.glob("*_coco.json"):
            base_name = f.stem.replace("_coco", "")
            for ext in [".jpg", ".jpeg", ".png"]:
                existing_annotations.add(f"{base_name}{ext}")

            if request.include_needs_review:
                try:
                    with open(f, "r", encoding="utf-8") as ann_file:
                        data = json.load(ann_file)
                        if data.get("metadata", {}).get("needs_review", False):
                            for ext in [".jpg", ".jpeg", ".png"]:
                                potential = f"{base_name}{ext}"
                                if potential in all_images:
                                    needs_review_images.add(potential)
                                    break
                except Exception:
                    pass

    if request.image_paths:
        images_to_process = [img for img in request.image_paths if img in all_images]
    elif request.process_unlabeled:
        unlabeled = [img for img in all_images if img not in existing_annotations]
        if request.include_needs_review:
            images_to_process = list(set(unlabeled) | needs_review_images)
        else:
            images_to_process = unlabeled
    else:
        images_to_process = all_images

    if request.max_images and request.max_images > 0:
        images_to_process = images_to_process[: request.max_images]

    if not images_to_process:
        return {
            "success": True,
            "message": "No images to process",
            "total_processed": 0,
            "auto_labeled": 0,
            "needs_review": 0,
            "errors": 0,
            "results": [],
        }

    model = load_trained_model(model_id)

    results = []
    auto_labeled_count = 0
    needs_review_count = 0
    error_count = 0

    for image_name in images_to_process:
        image_path = images_dir / image_name
        try:
            inference_result = run_model_inference(
                model, str(image_path), request.confidence
            )
            coco_data = convert_yolo_to_coco_format(
                inference_result, str(image_path), model_id
            )

            polygons = coco_data.get("polygons", [])
            high_conf_polygons = []
            low_conf_polygons = []

            for poly in polygons:
                conf = poly.get("confidence", 0)
                if conf >= request.auto_label_threshold:
                    poly["auto_labeled"] = True
                    high_conf_polygons.append(poly)
                else:
                    poly["needs_review"] = True
                    low_conf_polygons.append(poly)

            is_auto_labeled = (
                len(high_conf_polygons) > 0 and len(low_conf_polygons) == 0
            )
            needs_review = len(low_conf_polygons) > 0

            if is_auto_labeled:
                auto_labeled_count += 1
            if needs_review:
                needs_review_count += 1

            if request.save_annotations and len(polygons) > 0:
                annotations_dir.mkdir(exist_ok=True)
                output_filename = f"{image_path.stem}_coco.json"
                output_path = annotations_dir / output_filename

                image_info = coco_data.get("image", {})

                unique_labels = set()
                for poly in polygons:
                    label = poly.get("label", "object")
                    unique_labels.add(label)

                categories = []
                label_to_id = {}
                for i, label in enumerate(sorted(unique_labels), 1):
                    categories.append(
                        {"id": i, "name": label, "supercategory": "thing"}
                    )
                    label_to_id[label] = i

                coco_annotations = []
                for i, poly in enumerate(polygons, 1):
                    label = poly.get("label", "object")
                    points = poly.get("points", [])

                    if len(points) >= 4:
                        xs = [points[j] for j in range(0, len(points), 2)]
                        ys = [points[j] for j in range(1, len(points), 2)]
                        x_min, x_max = min(xs), max(xs)
                        y_min, y_max = min(ys), max(ys)
                        bbox = [x_min, y_min, x_max - x_min, y_max - y_min]
                        area = (x_max - x_min) * (y_max - y_min)
                    else:
                        bbox = [0, 0, 0, 0]
                        area = 0

                    coco_annotations.append(
                        {
                            "id": i,
                            "image_id": 1,
                            "category_id": label_to_id.get(label, 1),
                            "segmentation": [points] if points else [],
                            "bbox": bbox,
                            "area": area,
                            "iscrowd": 0,
                            "confidence": poly.get("confidence", 0),
                            "auto_labeled": poly.get("auto_labeled", False),
                            "needs_review": poly.get("needs_review", False),
                        }
                    )

                save_data = {
                    "info": {
                        "description": "YOLO Batch Inference Annotations",
                        "version": "1.0",
                        "date_created": datetime.now().isoformat(),
                    },
                    "images": [
                        {
                            "id": 1,
                            "width": image_info.get("width", 0),
                            "height": image_info.get("height", 0),
                            "file_name": image_name,
                        }
                    ],
                    "categories": categories,
                    "annotations": coco_annotations,
                    "metadata": {
                        "model_id": model_id,
                        "batch_inference": True,
                        "auto_labeled": is_auto_labeled,
                        "needs_review": needs_review,
                        "created_at": datetime.now().isoformat(),
                    },
                }

                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(save_data, f, ensure_ascii=False, indent=2)

            results.append(
                {
                    "image": image_name,
                    "success": True,
                    "detections": len(polygons),
                    "auto_labeled": is_auto_labeled,
                    "needs_review": needs_review,
                    "high_confidence_count": len(high_conf_polygons),
                    "low_confidence_count": len(low_conf_polygons),
                }
            )

        except Exception as e:
            logger.error(f"Batch inference error for {image_name}: {e}")
            error_count += 1
            results.append(
                {
                    "image": image_name,
                    "success": False,
                    "error": str(e),
                }
            )

    logger.info(
        f"Batch inference complete: {len(images_to_process)} processed, "
        f"{auto_labeled_count} auto-labeled, {needs_review_count} need review, {error_count} errors"
    )

    try:
        workflow_service = get_workflow_state_service()
        workflow_service.set_phase(3)
        logger.info("Transitioned to Phase 3 (Refinement) after auto-labeling")
    except Exception as e:
        logger.warning(f"Failed to set Phase 3: {e}")

    return {
        "success": True,
        "model_id": model_id,
        "total_processed": len(images_to_process),
        "auto_labeled": auto_labeled_count,
        "needs_review": needs_review_count,
        "errors": error_count,
        "results": results,
    }


@router.get("/labeling-status")
async def get_labeling_status():
    """
    Get counts of labeled/unlabeled/needs-review images.
    Used by frontend to show filter badges.
    """
    images_dir = Path(IMAGES_DIR)
    annotations_dir = Path(ANNOTATIONS_DIR)

    if not images_dir.exists():
        return {
            "total": 0,
            "labeled": 0,
            "unlabeled": 0,
            "needs_review": 0,
        }

    all_images = [
        f.name
        for f in images_dir.iterdir()
        if f.suffix.lower() in [".jpg", ".jpeg", ".png"]
    ]

    labeled_images = set()
    needs_review_images = set()

    if annotations_dir.exists():
        for annotation_file in annotations_dir.glob("*_coco.json"):
            base_name = annotation_file.stem.replace("_coco", "")

            for ext in [".jpg", ".jpeg", ".png"]:
                potential_image = f"{base_name}{ext}"
                if potential_image in all_images:
                    labeled_images.add(potential_image)
                    break

            try:
                with open(annotation_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    metadata = data.get("metadata", {})
                    if metadata.get("needs_review", False):
                        image_name = (
                            data.get("image", {}).get("filename")
                            or data.get("image", {}).get("file_name")
                            or (
                                data.get("images", [{}])[0].get("file_name")
                                if data.get("images")
                                else None
                            )
                        )
                        if not image_name:
                            for ext in [".jpg", ".jpeg", ".png"]:
                                potential = f"{base_name}{ext}"
                                if potential in all_images:
                                    image_name = potential
                                    break
                        if image_name:
                            needs_review_images.add(image_name)
            except Exception:
                pass

    unlabeled_count = len(all_images) - len(labeled_images)

    return {
        "total": len(all_images),
        "labeled": len(labeled_images),
        "unlabeled": unlabeled_count,
        "needs_review": len(needs_review_images),
        "labeled_images": list(labeled_images),
        "needs_review_images": list(needs_review_images),
    }
