"""
Model evaluation API endpoints
"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from services import training_jobs, get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["evaluation"])


def get_performance_grade(value: float) -> str:
    """Get performance grade based on metric value"""
    if value >= 0.9:
        return "Excellent"
    elif value >= 0.8:
        return "Good"
    elif value >= 0.7:
        return "Fair"
    elif value >= 0.6:
        return "Poor"
    else:
        return "Very Poor"


def _get_model_info_from_registry(model_id: str) -> dict | None:
    """Model Registry에서 모델 정보 조회"""
    try:
        registry = get_registry()
        model_data = registry.get_model(model_id)
        if not model_data:
            return None

        # Registry 형식을 training_jobs 형식으로 변환
        latest_metrics = model_data.get("latest_metrics", {})
        versions = model_data.get("versions", [])
        latest_version = versions[-1] if versions else {}

        return {
            "status": "completed",
            "model_name": model_id,
            "metrics": {
                "map50": latest_metrics.get("map50", 0),
                "map50_95": latest_metrics.get("map50_95", 0),
                "map70": latest_metrics.get("map70", 0),
                "precision": latest_metrics.get("precision", 0),
                "recall": latest_metrics.get("recall", 0),
                "f1": latest_metrics.get("f1", 0),
                "per_class": latest_metrics.get("per_class", {}),
                "class_names": latest_metrics.get("class_names", []),
            },
            "annotation_filenames": model_data.get("dataset_info", {}).get(
                "annotation_files", []
            ),
            "epochs": model_data.get("config", {}).get("epochs", 100),
            "batch_size": model_data.get("config", {}).get("batch_size", 16),
            "img_size": model_data.get("config", {}).get("img_size", 640),
            "processed_count": model_data.get("dataset_info", {}).get(
                "processed_count", 0
            ),
            "completed_at": latest_version.get("created_at"),
            "created_at": versions[0].get("created_at") if versions else None,
        }
    except Exception as e:
        logger.error(f"Failed to get model from registry: {e}")
        return None


@router.get("/models/{model_id}/evaluation")
async def get_model_evaluation(model_id: str):
    """Query detailed evaluation results for specific model"""
    # 1. training_jobs에서 먼저 조회 (in-memory, 최신 데이터)
    job_info = training_jobs.get(model_id)

    # 2. training_jobs에 없으면 Model Registry에서 조회 (persistent storage)
    if not job_info:
        job_info = _get_model_info_from_registry(model_id)

    if not job_info:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_id}' not found in training jobs or registry.",
        )

    if job_info.get("status") != "completed":
        raise HTTPException(
            status_code=400, detail=f"Model '{model_id}' training not completed."
        )

    metrics = job_info.get("metrics", {})
    if not metrics:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation results for model '{model_id}' not found.",
        )

    # Build per-class evaluation
    per_class_evaluation = {}
    per_class_metrics = metrics.get("per_class", {})
    for class_name, class_metrics in per_class_metrics.items():
        per_class_evaluation[class_name] = {
            "class_id": class_metrics.get("class_id", -1),
            "ap50": {
                "value": class_metrics.get("ap50", 0),
                "percentage": f"{class_metrics.get('ap50', 0) * 100:.1f}%",
                "grade": get_performance_grade(class_metrics.get("ap50", 0)),
            },
            "ap50_95": {
                "value": class_metrics.get("ap50_95", 0),
                "percentage": f"{class_metrics.get('ap50_95', 0) * 100:.1f}%",
                "grade": get_performance_grade(class_metrics.get("ap50_95", 0)),
            },
            "precision": {
                "value": class_metrics.get("precision", 0),
                "percentage": f"{class_metrics.get('precision', 0) * 100:.1f}%",
                "grade": get_performance_grade(class_metrics.get("precision", 0)),
            },
            "recall": {
                "value": class_metrics.get("recall", 0),
                "percentage": f"{class_metrics.get('recall', 0) * 100:.1f}%",
                "grade": get_performance_grade(class_metrics.get("recall", 0)),
            },
        }

    return JSONResponse(
        content={
            "model_id": model_id,
            "model_name": job_info.get("model_name", f"model_{model_id}"),
            "evaluation_summary": {
                "overall_performance": get_performance_grade(metrics.get("map50", 0)),
                "detection_accuracy": f"{metrics.get('map50', 0) * 100:.1f}%",
                "precision_score": f"{metrics.get('precision', 0) * 100:.1f}%",
                "recall_score": f"{metrics.get('recall', 0) * 100:.1f}%",
                "num_classes": len(per_class_metrics),
            },
            "detailed_metrics": {
                "map50": {
                    "value": metrics.get("map50", 0),
                    "percentage": f"{metrics.get('map50', 0) * 100:.1f}%",
                    "grade": get_performance_grade(metrics.get("map50", 0)),
                    "description": "Mean Average Precision at IoU 0.5 (main performance metric)",
                },
                "map50_95": {
                    "value": metrics.get("map50_95", 0),
                    "percentage": f"{metrics.get('map50_95', 0) * 100:.1f}%",
                    "grade": get_performance_grade(metrics.get("map50_95", 0)),
                    "description": "Mean Average Precision at IoU 0.5-0.95 (strict evaluation)",
                },
                "precision": {
                    "value": metrics.get("precision", 0),
                    "percentage": f"{metrics.get('precision', 0) * 100:.1f}%",
                    "grade": get_performance_grade(metrics.get("precision", 0)),
                    "description": "Precision (ratio of true positives among predicted objects)",
                },
                "recall": {
                    "value": metrics.get("recall", 0),
                    "percentage": f"{metrics.get('recall', 0) * 100:.1f}%",
                    "grade": get_performance_grade(metrics.get("recall", 0)),
                    "description": "Recall (ratio of detected objects among actual objects)",
                },
            },
            "per_class_evaluation": per_class_evaluation,
            "class_names": metrics.get("class_names", []),
            "training_info": {
                "annotation_files": job_info.get("annotation_filenames", []),
                "training_parameters": {
                    "epochs": job_info.get("epochs"),
                    "batch_size": job_info.get("batch_size"),
                    "img_size": job_info.get("img_size"),
                },
                "processed_images": job_info.get("processed_count", 0),
                "training_duration": job_info.get("completed_at")
                and job_info.get("created_at"),
            },
            "created_at": job_info.get("completed_at"),
        }
    )


@router.get("/evaluation/summary")
async def get_all_models_evaluation_summary():
    """Query evaluation result summary for all completed models"""
    completed_models = []

    for job_id, job_info in training_jobs.items():
        if job_info.get("status") == "completed" and job_info.get("metrics"):
            metrics = job_info["metrics"]
            per_class = metrics.get("per_class", {})

            # Find best/worst performing classes
            class_performance = []
            for class_name, class_metrics in per_class.items():
                class_performance.append(
                    {"class_name": class_name, "ap50": class_metrics.get("ap50", 0)}
                )
            class_performance.sort(key=lambda x: x["ap50"], reverse=True)

            completed_models.append(
                {
                    "model_id": job_id,
                    "model_name": job_info.get("model_name", f"model_{job_id}"),
                    "map50": metrics.get("map50", 0),
                    "precision": metrics.get("precision", 0),
                    "recall": metrics.get("recall", 0),
                    "num_classes": len(per_class),
                    "class_names": metrics.get("class_names", []),
                    "best_class": class_performance[0] if class_performance else None,
                    "worst_class": class_performance[-1] if class_performance else None,
                    "annotation_files_count": len(
                        job_info.get("annotation_filenames", [])
                    ),
                    "processed_images": job_info.get("processed_count", 0),
                    "completed_at": job_info.get("completed_at"),
                    "performance_score": (
                        metrics.get("map50", 0) * 0.5
                        + metrics.get("precision", 0) * 0.25
                        + metrics.get("recall", 0) * 0.25
                    ),
                }
            )

    completed_models.sort(key=lambda x: x["performance_score"], reverse=True)

    return JSONResponse(
        content={
            "models": completed_models,
            "total_count": len(completed_models),
            "best_model": completed_models[0] if completed_models else None,
            "average_performance": {
                "map50": sum(m["map50"] for m in completed_models)
                / len(completed_models)
                if completed_models
                else 0,
                "precision": sum(m["precision"] for m in completed_models)
                / len(completed_models)
                if completed_models
                else 0,
                "recall": sum(m["recall"] for m in completed_models)
                / len(completed_models)
                if completed_models
                else 0,
            }
            if completed_models
            else None,
        }
    )
