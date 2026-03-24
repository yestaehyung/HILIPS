"""
HILIPS Experiment Management API Endpoints
Research paper metrics logging and dashboard data
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.experiment_log import get_experiment_log_service
from services.test_set import get_test_set_service
from services.metrics_map import get_map_calculation_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/experiments", tags=["Experiments"])


# === Request/Response Models ===


class CreateExperimentRequest(BaseModel):
    """Create experiment request"""

    experiment_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    test_set_id: Optional[str] = None
    confidence_threshold: float = 0.8


class StartIterationRequest(BaseModel):
    """Start iteration request"""

    experiment_id: str


class LogLabelingEventRequest(BaseModel):
    """Log labeling event request"""

    iteration: int
    image_id: str
    objects: List[dict]  # [{id, class, source, confidence, user_action, bbox, area}]
    time_seconds: float
    session_id: Optional[str] = None
    labeling_method: Optional[str] = None
    metadata: Optional[dict] = None


class CreateTestSetRequest(BaseModel):
    """Create test set request"""

    test_set_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    image_filenames: List[str] = []


class AddImagesToTestSetRequest(BaseModel):
    """Add images to test set request"""

    image_filenames: List[str]


class EvaluateModelRequest(BaseModel):
    """Evaluate model on test set request"""

    model_id: str
    test_set_id: str
    predictions_dir: Optional[str] = None


class CreateRandomTestSetRequest(BaseModel):
    count: int = 40
    test_set_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    exclude_unlabeled: bool = False


# === Experiment Endpoints ===


@router.post("")
async def create_experiment(request: CreateExperimentRequest):
    """
    Create a new experiment for tracking labeling metrics

    Paper metrics tracked:
    - mAP@0.5: Model quality
    - Automation Rate: Auto-approved objects / Total objects
    - Review per Image: Objects reviewed per image
    - Time per Image: Labeling time
    """
    try:
        service = get_experiment_log_service()
        result = service.create_experiment(
            experiment_id=request.experiment_id,
            name=request.name,
            description=request.description,
            test_set_id=request.test_set_id,
            confidence_threshold=request.confidence_threshold,
        )

        return JSONResponse(
            content={
                "success": True,
                "experiment": result,
                "message": f"Experiment {result['experiment_id']} created",
            }
        )
    except Exception as e:
        logger.error(f"Failed to create experiment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_experiments():
    """List all experiments"""
    try:
        service = get_experiment_log_service()
        experiments = service.list_experiments()

        return JSONResponse(
            content={
                "success": True,
                "experiments": experiments,
                "count": len(experiments),
            }
        )
    except Exception as e:
        logger.error(f"Failed to list experiments: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str):
    """Get experiment details"""
    try:
        service = get_experiment_log_service()
        experiment = service.get_experiment(experiment_id)

        if not experiment:
            raise HTTPException(
                status_code=404, detail=f"Experiment {experiment_id} not found"
            )

        return JSONResponse(
            content={
                "success": True,
                "experiment": experiment,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get experiment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{experiment_id}")
async def delete_experiment(experiment_id: str):
    try:
        service = get_experiment_log_service()
        success = service.delete_experiment(experiment_id)

        if not success:
            raise HTTPException(
                status_code=404, detail=f"Experiment {experiment_id} not found"
            )

        return JSONResponse(
            content={
                "success": True,
                "message": f"Experiment {experiment_id} deleted",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete experiment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{experiment_id}/iterations/start")
async def start_iteration(experiment_id: str):
    """
    Start a new iteration within an experiment

    Call this when beginning a new training cycle
    """
    try:
        service = get_experiment_log_service()
        result = service.start_iteration(experiment_id)

        return JSONResponse(
            content={
                "success": True,
                "iteration": result,
                "message": f"Started iteration {result['iteration']}",
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to start iteration: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{experiment_id}/log")
async def log_labeling_event(experiment_id: str, request: LogLabelingEventRequest):
    """
    Log a labeling event (one image save)

    Records:
    - Object-level tracking (source, confidence, user_action)
    - Time spent on image
    - Statistics (auto_approved, user_reviewed, etc.)
    """
    try:
        service = get_experiment_log_service()
        result = service.log_labeling_event(
            experiment_id=experiment_id,
            iteration=request.iteration,
            image_id=request.image_id,
            objects=request.objects,
            time_seconds=request.time_seconds,
            labeling_method=request.labeling_method,
            metadata=request.metadata,
        )

        return JSONResponse(
            content={
                "success": True,
                "event": result,
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to log event: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{experiment_id}/iterations")
async def get_iteration_summaries(
    experiment_id: str,
    force_recompute: bool = Query(False, description="Force recompute summaries"),
):
    """
    Get iteration summaries for dashboard

    Returns per-iteration:
    - images: Image count
    - auto_rate: Automation rate
    - review_per_image: Objects reviewed per image
    - time_per_image: Average labeling time
    """
    try:
        service = get_experiment_log_service()
        summaries = service.get_all_iteration_summaries(experiment_id, force_recompute)

        return JSONResponse(
            content={
                "success": True,
                "iterations": summaries,
                "count": len(summaries),
            }
        )
    except Exception as e:
        logger.error(f"Failed to get iteration summaries: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{experiment_id}/iterations/{iteration}")
async def get_iteration_summary(
    experiment_id: str,
    iteration: int,
    force_recompute: bool = Query(False, description="Force recompute summary"),
):
    """Get summary for specific iteration"""
    try:
        service = get_experiment_log_service()
        summary = service.get_iteration_summary(
            experiment_id, iteration, force_recompute
        )

        return JSONResponse(
            content={
                "success": True,
                "summary": summary,
            }
        )
    except Exception as e:
        logger.error(f"Failed to get iteration summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{experiment_id}/export")
async def export_experiment(
    experiment_id: str,
    format: str = Query("json", description="Export format: json or csv"),
):
    """
    Export experiment data for analysis

    Supports:
    - json: Full nested data
    - csv: Flattened iteration and event data
    """
    try:
        service = get_experiment_log_service()
        result = service.export_experiment_data(experiment_id, format)

        return JSONResponse(
            content={
                "success": True,
                "data": result,
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to export experiment: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === Test Set Endpoints ===


@router.post("/test-sets")
async def create_test_set(request: CreateTestSetRequest):
    """
    Create a test set with frozen ground truth

    Ground truth annotations are copied and frozen for consistent evaluation
    """
    try:
        service = get_test_set_service()
        result = service.create_test_set(
            test_set_id=request.test_set_id,
            name=request.name,
            description=request.description,
            image_filenames=request.image_filenames,
        )

        return JSONResponse(
            content={
                "success": True,
                "test_set": result,
                "message": f"Test set {result['test_set_id']} created with {result['statistics']['images_with_gt']} images with GT",
            }
        )
    except Exception as e:
        logger.error(f"Failed to create test set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-sets/random")
async def create_random_test_set(request: CreateRandomTestSetRequest):
    try:
        service = get_test_set_service()

        existing_test_sets = service.list_test_sets()
        deleted_count = 0
        for ts in existing_test_sets:
            service.delete_test_set(ts["test_set_id"])
            deleted_count += 1

        if deleted_count > 0:
            logger.info(
                f"Deleted {deleted_count} existing test set(s) before creating new one"
            )

        result = service.create_random_test_set(
            count=request.count,
            test_set_id=request.test_set_id,
            name=request.name,
            description=request.description,
            exclude_unlabeled=request.exclude_unlabeled,
        )

        return JSONResponse(
            content={
                "success": True,
                "test_set": result,
                "message": f"Random test set created with {result['statistics']['total_images']} images",
                "deleted_previous": deleted_count,
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create random test set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/test-sets")
async def list_test_sets():
    """List all test sets"""
    try:
        service = get_test_set_service()
        test_sets = service.list_test_sets()

        return JSONResponse(
            content={
                "success": True,
                "test_sets": test_sets,
                "count": len(test_sets),
            }
        )
    except Exception as e:
        logger.error(f"Failed to list test sets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/test-sets/images")
async def get_all_test_set_images():
    try:
        service = get_test_set_service()
        test_sets = service.list_test_sets()

        all_images = {}
        for ts in test_sets:
            filenames = service.get_test_set_image_filenames(ts["test_set_id"])
            for fn in filenames:
                all_images[fn] = ts["test_set_id"]

        return JSONResponse(
            content={
                "images": all_images,
                "count": len(all_images),
            }
        )
    except Exception as e:
        logger.error(f"Failed to get test set images: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/test-sets/check-image/{image_filename:path}")
async def check_image_in_test_set(image_filename: str):
    try:
        service = get_test_set_service()
        test_set_id = service.is_test_set_image(image_filename)
        return JSONResponse(
            content={
                "is_test_set": test_set_id is not None,
                "test_set_id": test_set_id,
            }
        )
    except Exception as e:
        logger.error(f"Failed to check image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/test-sets/{test_set_id}")
async def get_test_set(test_set_id: str):
    """Get test set details"""
    try:
        service = get_test_set_service()
        test_set = service.get_test_set(test_set_id)

        if not test_set:
            raise HTTPException(
                status_code=404, detail=f"Test set {test_set_id} not found"
            )

        return JSONResponse(
            content={
                "success": True,
                "test_set": test_set,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get test set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test-sets/{test_set_id}/images")
async def add_images_to_test_set(test_set_id: str, request: AddImagesToTestSetRequest):
    """Add images to existing test set"""
    try:
        service = get_test_set_service()
        result = service.add_images_to_test_set(test_set_id, request.image_filenames)

        return JSONResponse(
            content={
                "success": True,
                "test_set": result,
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to add images to test set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/test-sets/{test_set_id}")
async def delete_test_set(test_set_id: str):
    """Delete a test set"""
    try:
        service = get_test_set_service()
        success = service.delete_test_set(test_set_id)

        if not success:
            raise HTTPException(
                status_code=404, detail=f"Test set {test_set_id} not found"
            )

        return JSONResponse(
            content={
                "success": True,
                "message": f"Test set {test_set_id} deleted",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete test set: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === Evaluation Endpoints ===


@router.post("/evaluate")
async def evaluate_model_on_test_set(request: EvaluateModelRequest):
    """
    Evaluate a model on a test set

    Computes:
    - mAP@0.5
    - mAP@0.5:0.95
    - Precision
    - Recall
    - Per-class metrics
    """
    try:
        map_service = get_map_calculation_service()
        test_set_service = get_test_set_service()

        # Get ground truth from test set
        gt_annotations = test_set_service.get_gt_annotations(request.test_set_id)

        if not gt_annotations:
            raise HTTPException(
                status_code=404,
                detail=f"No ground truth found in test set {request.test_set_id}",
            )

        # For now, we'll need predictions to be provided
        # In a full implementation, we'd run inference here
        if not request.predictions_dir:
            return JSONResponse(
                content={
                    "success": False,
                    "message": "predictions_dir required. Run model inference first.",
                    "test_set": {
                        "test_set_id": request.test_set_id,
                        "images_with_gt": len(gt_annotations),
                    },
                }
            )

        result = map_service.evaluate_model_on_test_set(
            model_id=request.model_id,
            test_set_id=request.test_set_id,
            predictions_dir=request.predictions_dir,
        )

        return JSONResponse(
            content={
                "success": True,
                "evaluation": result,
            }
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to evaluate model: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate/direct")
async def evaluate_annotations_directly(
    gt_annotations: List[dict],
    pred_annotations: List[dict],
    iou_type: str = Query("bbox", description="IoU type: bbox or segm"),
):
    """
    Direct mAP evaluation between GT and predictions

    Use this for custom evaluation without test sets.

    Args:
        gt_annotations: List of {file_name, coco_data}
        pred_annotations: List of {file_name, coco_data}
    """
    try:
        map_service = get_map_calculation_service()
        result = map_service.compute_map(gt_annotations, pred_annotations, iou_type)

        return JSONResponse(
            content={
                "success": True,
                "evaluation": result,
            }
        )
    except Exception as e:
        logger.error(f"Failed to evaluate: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# === Dashboard Endpoints ===


@router.get("/{experiment_id}/dashboard")
async def get_experiment_dashboard(experiment_id: str):
    """
    Get all data needed for experiment dashboard

    Returns:
    - Experiment info
    - Iteration summaries
    - Model performance (if test set linked)
    """
    try:
        exp_service = get_experiment_log_service()

        experiment = exp_service.get_experiment(experiment_id)
        if not experiment:
            raise HTTPException(
                status_code=404, detail=f"Experiment {experiment_id} not found"
            )

        summaries = exp_service.get_all_iteration_summaries(experiment_id)

        # Build dashboard data
        dashboard = {
            "experiment": {
                "experiment_id": experiment["experiment_id"],
                "name": experiment["name"],
                "description": experiment.get("description", ""),
                "current_iteration": experiment["current_iteration"],
                "confidence_threshold": experiment.get("confidence_threshold", 0.8),
                "test_set_id": experiment.get("test_set_id"),
                "created_at": experiment["created_at"],
            },
            "iteration_summary": summaries,
            "model_performance": [],  # Will be populated if test set is linked
        }

        # Calculate overall statistics
        if summaries:
            total_images = sum(s["images"] for s in summaries)
            total_time = sum(s.get("total_time_seconds", 0) for s in summaries)
            total_objects = sum(s["total_objects"] for s in summaries)
            total_auto_approved = sum(s["auto_approved"] for s in summaries)

            dashboard["overall_stats"] = {
                "total_images": total_images,
                "total_time_seconds": total_time,
                "total_objects": total_objects,
                "overall_auto_rate": total_auto_approved / total_objects
                if total_objects > 0
                else 0,
                "avg_time_per_image": total_time / total_images
                if total_images > 0
                else 0,
            }

        return JSONResponse(
            content={
                "success": True,
                "dashboard": dashboard,
                "timestamp": datetime.now().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dashboard: {e}")
        raise HTTPException(status_code=500, detail=str(e))
