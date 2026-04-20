"""
HILIPS Workflow State Router
워크플로우 상태 및 Iteration 추적 API 엔드포인트

논문 순환 구조 지원:
- 현재 Phase 조회
- Iteration 추적
- 다음 액션 제안
- 자동화 비율 추이
"""

import os
import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from datetime import datetime

from config import IMAGES_DIR, ANNOTATIONS_DIR
from services.workflow_state import get_workflow_state_service

logger = logging.getLogger(__name__)


def _get_dataset_stats() -> Dict[str, int]:
    """Get dataset statistics: total images, labeled count, needs review count"""
    # Count total images
    total_images = 0
    if os.path.isdir(IMAGES_DIR):
        image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
        total_images = len(
            [
                f
                for f in os.listdir(IMAGES_DIR)
                if os.path.splitext(f)[1].lower() in image_extensions
            ]
        )

    # Count labeled images (have _coco.json files)
    labeled_count = 0
    labeled_images = set()
    needs_review_count = 0

    if os.path.isdir(ANNOTATIONS_DIR):
        import json as json_module

        for f in os.listdir(ANNOTATIONS_DIR):
            if f.endswith("_coco.json"):
                base_name = f.replace("_coco.json", "")
                labeled_images.add(base_name)

                annotation_path = os.path.join(ANNOTATIONS_DIR, f)
                try:
                    with open(annotation_path, "r", encoding="utf-8") as af:
                        data = json_module.load(af)
                        if data.get("metadata", {}).get("needs_review", False):
                            needs_review_count += 1
                except Exception:
                    pass

        labeled_count = len(labeled_images)

    return {
        "total_images": total_images,
        "labeled_count": labeled_count,
        "unlabeled_count": total_images - labeled_count,
        "needs_review_count": needs_review_count,
    }


router = APIRouter(prefix="/api/workflow", tags=["Workflow State"])


# === Request/Response Models ===


class StartIterationRequest(BaseModel):
    """새 Iteration 시작 요청"""

    phase: Optional[int] = 2  # 기본적으로 Phase 2 (Distillation)부터 시작


class UpdateTrainingRequest(BaseModel):
    """학습 정보 업데이트 요청"""

    job_id: str
    model_name: Optional[str] = None
    status: str = "preparing"
    map70: Optional[float] = None
    coco_filenames: Optional[List[str]] = None


class UpdateRefinementRequest(BaseModel):
    """Refinement 정보 업데이트 요청"""

    auto_labeled: int
    needs_review: int
    confidence_threshold: float = 0.8


class SetPhaseRequest(BaseModel):
    """Phase 설정 요청"""

    phase: int


# === Endpoints ===


@router.get("/state")
async def get_workflow_state():
    """
    현재 워크플로우 상태 조회

    Dashboard에서 사용하는 통합 상태 정보:
    - 현재 Phase (1: Cold-start, 2: Distillation, 3: Refinement)
    - 현재 Iteration 번호
    - 큐 상태 (검토 대기, 자동 레이블링 완료)
    - 학습 상태
    """
    try:
        service = get_workflow_state_service()
        state = service.get_current_state()

        return {
            "success": True,
            "state": state,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/next-action")
async def get_next_action():
    """
    다음 권장 액션 조회

    현재 상태를 기반으로 사용자가 취해야 할 다음 액션을 제안합니다.
    Dashboard의 "Next Steps" 섹션에서 사용.
    """
    try:
        service = get_workflow_state_service()
        action = service.get_next_action()

        return {
            "success": True,
            "action": action,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/iteration/start")
async def start_new_iteration(request: StartIterationRequest):
    """
    새 Iteration 시작

    논문: Phase 3 검토 완료 후 → Phase 2 재학습으로 순환
    """
    try:
        service = get_workflow_state_service()
        iteration = service.start_new_iteration(phase=request.phase)

        return {
            "success": True,
            "message": f"Started iteration {iteration['iteration_index']}",
            "iteration": iteration,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/iteration/training")
async def update_iteration_training(request: UpdateTrainingRequest):
    """
    현재 Iteration의 학습 정보 업데이트

    학습 시작, 진행, 완료 시 호출
    """
    try:
        service = get_workflow_state_service()
        service.update_iteration_training(
            job_id=request.job_id,
            model_name=request.model_name,
            status=request.status,
            map70=request.map70,
            coco_filenames=request.coco_filenames,
        )

        return {
            "success": True,
            "message": f"Training info updated for job {request.job_id}",
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/iteration/refinement")
async def update_iteration_refinement(request: UpdateRefinementRequest):
    """
    현재 Iteration의 Refinement 정보 업데이트

    자동 레이블링 결과 업데이트 시 호출
    """
    try:
        service = get_workflow_state_service()
        service.update_iteration_refinement(
            auto_labeled=request.auto_labeled,
            needs_review=request.needs_review,
            confidence_threshold=request.confidence_threshold,
        )

        return {
            "success": True,
            "message": "Refinement info updated",
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/iteration/complete")
async def complete_iteration():
    """
    현재 Iteration 완료 처리
    """
    try:
        service = get_workflow_state_service()
        service.complete_iteration()

        return {
            "success": True,
            "message": "Iteration completed",
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/iterations")
async def get_iteration_history(
    limit: Optional[int] = Query(
        10, description="Maximum number of iterations to return"
    ),
):
    """
    Iteration 히스토리 조회
    """
    try:
        service = get_workflow_state_service()
        iterations = service.get_iteration_history(limit=limit)

        return {
            "success": True,
            "iterations": iterations,
            "total_count": len(service.state.get("iterations", [])),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/automation-trend")
async def get_automation_trend():
    """
    자동화 비율 추이 조회

    논문: "모델이 개선됨에 따라 자동 레이블링의 정확도가 향상되고,
          사용자가 직접 개입해야 하는 객체의 수가 감소"

    각 Iteration의 자동화 비율과 mAP 변화 추이를 반환합니다.
    """
    try:
        service = get_workflow_state_service()
        trend = service.get_automation_trend()

        return {
            "success": True,
            "trend": trend,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/phase")
async def set_phase(request: SetPhaseRequest):
    """
    현재 Phase 수동 설정

    - Phase 1: Cold-start Labeling (LLM + SAM2)
    - Phase 2: Knowledge Distillation (YOLO Training)
    - Phase 3: Iterative Refinement (Auto-label + Review)
    """
    try:
        if request.phase not in [1, 2, 3]:
            raise HTTPException(status_code=400, detail="Phase must be 1, 2, or 3")

        service = get_workflow_state_service()
        service.set_phase(request.phase)

        phase_names = {
            1: "Cold-start Labeling",
            2: "Knowledge Distillation",
            3: "Iterative Refinement",
        }

        return {
            "success": True,
            "message": f"Phase set to {request.phase}: {phase_names[request.phase]}",
            "current_phase": request.phase,
            "timestamp": datetime.now().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary")
async def get_workflow_summary():
    """
    워크플로우 요약 정보 (Dashboard용)

    한 번의 API 호출로 Dashboard에 필요한 모든 정보 반환:
    - 현재 상태
    - 다음 액션
    - 자동화 추이
    """
    try:
        service = get_workflow_state_service()

        state = service.get_current_state()
        next_action = service.get_next_action()
        trend = service.get_automation_trend()

        # Get dataset statistics
        dataset_stats = _get_dataset_stats()

        # Merge dataset stats into queues
        queues_with_stats = {
            **state["queues"],
            **dataset_stats,
        }

        return {
            "success": True,
            "summary": {
                "current_iteration": state["current_iteration"],
                "current_phase": state["current_phase"],
                "phase_name": {1: "Cold-start", 2: "Distillation", 3: "Refinement"}.get(
                    state["current_phase"], "Unknown"
                ),
                "queues": queues_with_stats,
                "training": state["training"],
                "next_action": next_action,
                "automation_trend": {
                    "total_iterations": trend["total_iterations"],
                    "improvement_percent": trend["improvement_percent"],
                    "message": trend["message"],
                },
            },
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.exception("Error in get_workflow_summary")
        raise HTTPException(status_code=500, detail=str(e))
