"""
YOLOv8 model training API endpoints
"""

import os
import json
import uuid
import logging
import threading
from datetime import datetime

import torch
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from schemas import TrainingRequest, TrainingTask
from services import (
    training_jobs,
    create_yolo_dataset_structure,
    create_yolo_seg_dataset_structure,
    train_yolo_model_background,
    request_training_stop,
)
from utils.gpu_memory import (
    get_gpu_memory_info,
    estimate_yolo_training_memory,
    check_memory_available,
)
from models import is_sam2_loaded

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["training"])


@router.get("/gpu-status")
async def get_gpu_status():
    """Get current GPU memory status and training readiness"""
    total, allocated, free = get_gpu_memory_info()

    # Estimate for default training params
    estimated_training_memory = estimate_yolo_training_memory(
        batch_size=16, img_size=640
    )

    sam2_loaded = is_sam2_loaded()

    return JSONResponse(
        content={
            "gpu_available": torch.cuda.is_available(),
            "total_memory_gb": round(total, 2),
            "allocated_memory_gb": round(allocated, 2),
            "free_memory_gb": round(free, 2),
            "sam2_loaded": sam2_loaded,
            "estimated_training_memory_gb": round(estimated_training_memory, 2),
            "training_ready": free >= estimated_training_memory,
            "recommendation": (
                "Ready for training"
                if free >= estimated_training_memory
                else f"SAM2 will be unloaded during training to free GPU memory. Need ~{estimated_training_memory:.1f}GB, have {free:.1f}GB free"
            ),
        }
    )


def _run_multi_task_training(
    parent_job_id: str,
    tasks: list,
    annotation_filenames: list,
    epochs: int,
    batch_size: int,
    img_size: int,
    unload_sam2: bool,
):
    """
    Orchestrate sequential training for detection and/or segmentation.
    Runs tasks one after another to avoid GPU memory conflicts.
    """
    total_tasks = len(tasks)
    logger.info(
        f"Starting multi-task training: job={parent_job_id}, tasks={[t.value if hasattr(t, 'value') else t for t in tasks]}"
    )

    for idx, task in enumerate(tasks):
        task_type = task.value if hasattr(task, "value") else task
        sub_job_id = f"{parent_job_id}_{task_type[:3]}"
        is_last_task = idx == total_tasks - 1

        training_jobs[parent_job_id]["current_task"] = task_type
        training_jobs[parent_job_id]["current_task_index"] = idx + 1
        training_jobs[parent_job_id]["message"] = (
            f"Preparing {task_type} training ({idx + 1}/{total_tasks})..."
        )

        try:
            logger.info(f"[{parent_job_id}] Creating dataset for {task_type}...")

            if task_type == "detection":
                dataset_dir, yaml_path, processed_count, class_names = (
                    create_yolo_dataset_structure(annotation_filenames, sub_job_id)
                )
            else:
                dataset_dir, yaml_path, processed_count, class_names = (
                    create_yolo_seg_dataset_structure(annotation_filenames, sub_job_id)
                )

            logger.info(
                f"[{parent_job_id}] Dataset created: {processed_count} images, {len(class_names)} classes"
            )

            parent_model_name = training_jobs[parent_job_id].get(
                "model_name", f"model_{parent_job_id}"
            )
            sub_model_name = f"{parent_model_name}_{task_type[:3]}"

            training_jobs[sub_job_id] = {
                "status": "preparing",
                "progress": 0,
                "message": f"Starting {task_type} training...",
                "task_type": task_type,
                "parent_job_id": parent_job_id,
                "model_name": sub_model_name,
                "annotation_filenames": annotation_filenames,
                "epochs": epochs,
                "batch_size": batch_size,
                "img_size": img_size,
                "created_at": datetime.now().isoformat(),
                "dataset_dir": dataset_dir,
                "yaml_path": yaml_path,
                "processed_count": processed_count,
                "class_names": class_names,
                "num_classes": len(class_names),
            }

            training_jobs[parent_job_id]["sub_jobs"][task_type] = sub_job_id

            logger.info(
                f"[{parent_job_id}] Starting {task_type} training (sub_job={sub_job_id})..."
            )

            train_yolo_model_background(
                job_id=sub_job_id,
                dataset_dir=dataset_dir,
                yaml_path=yaml_path,
                epochs=epochs,
                batch_size=batch_size,
                img_size=img_size,
                unload_sam2=(unload_sam2 and idx == 0),
                task_type=task_type,
                skip_sam2_reload=not is_last_task,
            )

            sub_status = training_jobs[sub_job_id].get("status", "unknown")
            logger.info(
                f"[{parent_job_id}] {task_type} training finished with status: {sub_status}"
            )
            if sub_status == "failed":
                training_jobs[parent_job_id]["status"] = "failed"
                training_jobs[parent_job_id]["message"] = (
                    f"{task_type.capitalize()} training failed"
                )
                training_jobs[parent_job_id]["error"] = training_jobs[sub_job_id].get(
                    "error"
                )
                return
            elif sub_status == "stopped":
                training_jobs[parent_job_id]["status"] = "stopped"
                training_jobs[parent_job_id]["message"] = "Training stopped by user"
                return

        except Exception as e:
            import traceback

            error_trace = traceback.format_exc()
            logger.error(
                f"Multi-task training failed for {task_type}: {e}\n{error_trace}"
            )
            training_jobs[parent_job_id]["status"] = "failed"
            training_jobs[parent_job_id]["message"] = (
                f"{task_type.capitalize()} training failed: {str(e)}"
            )
            training_jobs[parent_job_id]["error"] = str(e)
            training_jobs[parent_job_id]["error_trace"] = error_trace
            return

    training_jobs[parent_job_id]["status"] = "completed"
    training_jobs[parent_job_id]["progress"] = 100
    training_jobs[parent_job_id]["completed_at"] = datetime.now().isoformat()

    completed_tasks = []
    for task in tasks:
        task_type = task.value if hasattr(task, "value") else task
        sub_job_id = training_jobs[parent_job_id]["sub_jobs"].get(task_type)
        if (
            sub_job_id
            and training_jobs.get(sub_job_id, {}).get("status") == "completed"
        ):
            completed_tasks.append(task_type)

    training_jobs[parent_job_id]["message"] = (
        f"All training complete: {', '.join(completed_tasks)}"
    )
    logger.info(f"Multi-task training complete: {parent_job_id}")


@router.post("/train-model")
async def start_model_training(request: TrainingRequest):
    """
    Start YOLO model training with selected annotation files.
    Supports detection, segmentation, or both (sequential training).
    """
    tasks = request.training_tasks
    task_names = [t.value for t in tasks]

    logger.info(
        f"Model training start request: tasks={task_names}, "
        f"annotation_files={request.annotation_filenames}, epochs={request.epochs}"
    )

    try:
        from ultralytics import YOLO
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="ultralytics library for YOLOv8 training is not installed.",
        )

    if not request.annotation_filenames or len(request.annotation_filenames) == 0:
        raise HTTPException(
            status_code=400, detail="At least 1 annotation file must be selected."
        )

    if not tasks:
        raise HTTPException(
            status_code=400, detail="At least 1 training task must be selected."
        )

    total_images = 0
    total_annotations = 0
    has_segmentation_data = False
    validated_files = []

    for filename in request.annotation_filenames:
        annotation_path = os.path.join("annotations", filename)

        if not os.path.exists(annotation_path):
            raise HTTPException(
                status_code=404, detail=f"Annotation file '{filename}' not found."
            )

        try:
            with open(annotation_path, "r", encoding="utf-8") as f:
                coco_data = json.load(f)

            if "images" not in coco_data or "annotations" not in coco_data:
                raise HTTPException(
                    status_code=400, detail=f"'{filename}' is not a valid COCO format."
                )

            images_count = len(coco_data.get("images", []))
            annotations_count = len(coco_data.get("annotations", []))

            if images_count == 0 or annotations_count == 0:
                raise HTTPException(
                    status_code=400, detail=f"'{filename}' has no trainable data."
                )

            for ann in coco_data.get("annotations", []):
                seg = ann.get("segmentation", [])
                if seg and len(seg) > 0:
                    has_segmentation_data = True
                    break

            total_images += images_count
            total_annotations += annotations_count
            validated_files.append(
                {
                    "filename": filename,
                    "images_count": images_count,
                    "annotations_count": annotations_count,
                }
            )

            logger.info(
                f"COCO file validation complete - {filename}: {images_count} images, {annotations_count} annotations"
            )

        except json.JSONDecodeError:
            raise HTTPException(
                status_code=400, detail=f"'{filename}' is not a valid JSON file."
            )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"COCO file validation failed ({filename}): {str(e)}",
            )

    if TrainingTask.SEGMENTATION in tasks and not has_segmentation_data:
        raise HTTPException(
            status_code=400,
            detail="Segmentation training requested but no segmentation data found in annotations. "
            "Please ensure annotations include polygon segmentation data.",
        )

    logger.info(
        f"Total validation complete: {len(validated_files)} files, {total_images} images, "
        f"{total_annotations} annotations, has_segmentation={has_segmentation_data}"
    )

    job_id = str(uuid.uuid4())[:8]

    try:
        required_memory = estimate_yolo_training_memory(
            request.batch_size, request.img_size
        )
        is_available, free_memory = check_memory_available(required_memory * 0.5)
        total, allocated, _ = get_gpu_memory_info()

        sam2_loaded = is_sam2_loaded()
        unload_sam2 = sam2_loaded and (free_memory < required_memory * 1.5)

        if not is_available and not sam2_loaded:
            logger.warning(
                f"Low GPU memory detected. Free: {free_memory:.2f}GB, "
                f"Estimated required: {required_memory:.2f}GB"
            )

        training_jobs[job_id] = {
            "status": "preparing",
            "progress": 5,
            "message": f"Preparing multi-task training: {', '.join(task_names)}",
            "training_tasks": task_names,
            "sub_jobs": {},
            "current_task": None,
            "current_task_index": 0,
            "total_tasks": len(tasks),
            "annotation_filenames": request.annotation_filenames,
            "epochs": request.epochs,
            "batch_size": request.batch_size,
            "img_size": request.img_size,
            "model_name": request.model_name or f"model_{job_id}",
            "created_at": datetime.now().isoformat(),
            "has_segmentation_data": has_segmentation_data,
            "gpu_info": {
                "total_gb": round(total, 2),
                "allocated_before_gb": round(allocated, 2),
                "estimated_required_gb": round(required_memory, 2),
                "unload_sam2": unload_sam2,
            },
        }

        thread = threading.Thread(
            target=_run_multi_task_training,
            args=(
                job_id,
                tasks,
                request.annotation_filenames,
                request.epochs,
                request.batch_size,
                request.img_size,
                unload_sam2,
            ),
        )
        thread.daemon = True
        thread.start()

        logger.info(
            f"Multi-task training started: job_id={job_id}, tasks={task_names}, "
            f"files={len(request.annotation_filenames)}"
        )

        return JSONResponse(
            content={
                "message": f"Training started for: {', '.join(task_names)}",
                "job_id": job_id,
                "status": "preparing",
                "training_tasks": task_names,
                "annotation_filenames": request.annotation_filenames,
                "files_count": len(request.annotation_filenames),
                "has_segmentation_data": has_segmentation_data,
                "training_parameters": {
                    "epochs": request.epochs,
                    "batch_size": request.batch_size,
                    "img_size": request.img_size,
                },
            }
        )

    except Exception as e:
        logger.error(f"Model training start error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Model training start error: {str(e)}"
        )


@router.get("/training/status/{job_id}")
async def get_training_status(job_id: str):
    """Query status of specific training job (supports parent and sub-jobs)"""
    if job_id not in training_jobs:
        raise HTTPException(
            status_code=404, detail=f"Training job '{job_id}' not found."
        )

    job_info = training_jobs[job_id]

    sub_jobs_status = {}
    if "sub_jobs" in job_info:
        for task_type, sub_job_id in job_info["sub_jobs"].items():
            if sub_job_id in training_jobs:
                sub_info = training_jobs[sub_job_id]
                sub_jobs_status[task_type] = {
                    "job_id": sub_job_id,
                    "status": sub_info.get("status"),
                    "progress": sub_info.get("progress"),
                    "message": sub_info.get("message"),
                    "current_epoch": sub_info.get("current_epoch"),
                    "total_epochs": sub_info.get("total_epochs"),
                    "metrics": sub_info.get("metrics"),
                    "model_path": sub_info.get("model_path"),
                }

    overall_progress = job_info.get("progress", 0)
    if sub_jobs_status:
        total_tasks = job_info.get("total_tasks", len(sub_jobs_status))
        completed_tasks = sum(
            1 for s in sub_jobs_status.values() if s["status"] == "completed"
        )
        current_task_progress = 0
        for s in sub_jobs_status.values():
            if s["status"] in ["preparing", "training"]:
                current_task_progress = s.get("progress", 0)
                break
        overall_progress = (
            int((completed_tasks / total_tasks) * 100) if total_tasks > 0 else 0
        )
        if current_task_progress > 0 and completed_tasks < total_tasks:
            task_contribution = 100 / total_tasks
            overall_progress += int((current_task_progress / 100) * task_contribution)

    return JSONResponse(
        content={
            "job_id": job_id,
            "status": job_info["status"],
            "progress": overall_progress,
            "message": job_info["message"],
            "created_at": job_info["created_at"],
            "completed_at": job_info.get("completed_at"),
            "annotation_filenames": job_info.get("annotation_filenames", []),
            "model_name": job_info.get("model_name"),
            "training_tasks": job_info.get("training_tasks", []),
            "current_task": job_info.get("current_task"),
            "current_task_index": job_info.get("current_task_index"),
            "total_tasks": job_info.get("total_tasks"),
            "sub_jobs": sub_jobs_status,
            "training_parameters": {
                "epochs": job_info.get("epochs"),
                "batch_size": job_info.get("batch_size"),
                "img_size": job_info.get("img_size"),
            },
            "processed_images_count": job_info.get("processed_count", 0),
            "current_epoch": job_info.get("current_epoch"),
            "total_epochs": job_info.get("total_epochs"),
            "stop_requested": job_info.get("stop_requested", False),
            "task_type": job_info.get("task_type"),
            "metrics": job_info.get("metrics"),
            "error": job_info.get("error"),
        }
    )


@router.get("/training/jobs")
async def list_training_jobs():
    """Query list of all training jobs (excludes sub-jobs, shows parent jobs only)"""
    jobs_list = []
    for job_id, job_info in training_jobs.items():
        if job_info.get("parent_job_id"):
            continue

        jobs_list.append(
            {
                "job_id": job_id,
                "status": job_info["status"],
                "progress": job_info["progress"],
                "message": job_info["message"],
                "created_at": job_info["created_at"],
                "completed_at": job_info.get("completed_at"),
                "annotation_filenames": job_info.get("annotation_filenames", []),
                "model_name": job_info.get("model_name"),
                "training_tasks": job_info.get("training_tasks", []),
                "current_task": job_info.get("current_task"),
                "sub_jobs": list(job_info.get("sub_jobs", {}).keys()),
                "processed_images_count": job_info.get("processed_count", 0),
                "current_epoch": job_info.get("current_epoch"),
                "total_epochs": job_info.get("total_epochs"),
                "stop_requested": job_info.get("stop_requested", False),
                "task_type": job_info.get("task_type"),
            }
        )

    return JSONResponse(
        content={
            "jobs": sorted(jobs_list, key=lambda x: x["created_at"], reverse=True),
            "total_count": len(jobs_list),
        }
    )


@router.post("/training/jobs/{job_id}/stop")
async def stop_training_job(job_id: str):
    """Request to stop a running training job (graceful stop after current epoch)"""
    if job_id not in training_jobs:
        raise HTTPException(
            status_code=404, detail=f"Training job '{job_id}' not found."
        )

    job_info = training_jobs[job_id]

    if job_info["status"] not in ["preparing", "training"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot stop training job '{job_id}' with status '{job_info['status']}'. "
            "Only 'preparing' or 'training' jobs can be stopped.",
        )

    stopped_jobs = []

    if "sub_jobs" in job_info:
        for task_type, sub_job_id in job_info["sub_jobs"].items():
            if sub_job_id in training_jobs:
                sub_info = training_jobs[sub_job_id]
                if sub_info.get("status") in ["preparing", "training"]:
                    if request_training_stop(sub_job_id):
                        stopped_jobs.append(sub_job_id)
        training_jobs[job_id]["stop_requested"] = True
        training_jobs[job_id]["message"] = "Stop requested for all sub-tasks..."
    else:
        if request_training_stop(job_id):
            stopped_jobs.append(job_id)

    if not stopped_jobs:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to request stop for training job '{job_id}'.",
        )

    logger.info(f"Training job stop requested: {job_id}, stopped_jobs={stopped_jobs}")

    return JSONResponse(
        content={
            "message": f"Stop requested for training job '{job_id}'. "
            "Training will stop after current epoch.",
            "job_id": job_id,
            "stopped_jobs": stopped_jobs,
            "status": "stop_requested",
            "current_epoch": job_info.get("current_epoch"),
            "total_epochs": job_info.get("total_epochs"),
        }
    )


@router.delete("/training/jobs/{job_id}")
async def delete_training_job(job_id: str):
    """Delete a training job (only completed, failed, or stopped jobs)"""
    if job_id not in training_jobs:
        raise HTTPException(
            status_code=404, detail=f"Training job '{job_id}' not found."
        )

    job_info = training_jobs[job_id]

    if job_info["status"] in ["preparing", "training"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete training job '{job_id}' while it is {job_info['status']}. "
            f"Use POST /training/jobs/{job_id}/stop first.",
        )

    del training_jobs[job_id]
    logger.info(f"Training job deleted: {job_id}")

    return JSONResponse(
        content={"message": f"Training job '{job_id}' deleted.", "job_id": job_id}
    )
