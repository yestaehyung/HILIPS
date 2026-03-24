"""
HILIPS Active Learning Router
Iterative Refinement을 위한 Active Learning API 엔드포인트

논문 2.2.3 구현:
- Review queue 관리 (confidence < 0.8 이미지)
- Auto-label queue 관리 (confidence >= 0.8 이미지)
- 검토 완료 표시
- 재학습용 데이터셋 준비
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

from services.active_learning import get_active_learning_service

router = APIRouter(prefix="/api/active-learning", tags=["Active Learning"])


# === Request/Response Models ===


class MarkReviewedRequest(BaseModel):
    """검토 완료 요청"""

    image_path: str
    revised_detections: List[Dict[str, Any]]
    reviewer: str = "human"


class PrepareDatasetRequest(BaseModel):
    """데이터셋 준비 요청"""

    include_reviewed: bool = True
    min_quality_score: float = 0.7


class QueueResponse(BaseModel):
    """큐 응답"""

    success: bool
    queue: List[Dict[str, Any]]
    total_count: int
    timestamp: str


class StatisticsResponse(BaseModel):
    """통계 응답"""

    success: bool
    review_queue: Dict[str, Any]
    auto_label_queue: Dict[str, Any]
    confidence_threshold: float
    review_threshold: float
    timestamp: str


# === Endpoints ===


@router.get("/review-queue", response_model=QueueResponse)
async def get_review_queue(
    limit: Optional[int] = Query(None, description="Maximum number of items to return"),
    priority: Optional[int] = Query(None, description="Minimum priority filter (0-5)"),
):
    """
    검토 필요 이미지 큐 조회

    논문: "confidence score가 임계값(0.8) 미만인 객체는 사용자 검토 대상으로 분류"

    - limit: 반환할 최대 개수
    - priority: 최소 우선순위 (0=낮음, 5=높음)
    """
    try:
        service = get_active_learning_service()
        queue = service.get_review_queue(limit=limit, priority_filter=priority)

        return QueueResponse(
            success=True,
            queue=queue,
            total_count=len(service.review_queue.get("queue", [])),
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auto-label-queue", response_model=QueueResponse)
async def get_auto_label_queue(
    limit: Optional[int] = Query(None, description="Maximum number of items to return"),
):
    """
    자동 레이블링 완료 이미지 큐 조회

    논문: "confidence score가 임계값(0.8) 이상인 객체는 자동으로 레이블링"
    """
    try:
        service = get_active_learning_service()
        queue = service.get_auto_label_queue(limit=limit)

        return QueueResponse(
            success=True,
            queue=queue,
            total_count=len(service.auto_label_queue.get("queue", [])),
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review-queue/mark")
async def mark_reviewed(request: MarkReviewedRequest):
    """
    이미지 검토 완료 표시

    논문: "사용자는 자동 레이블링된 결과를 확인하고, 검토 대상 객체에 대해
          수동으로 레이블을 지정하거나 수정"

    검토 완료된 데이터는 review_history.json에 저장되어
    Knowledge Distillation 재학습에 활용됨
    """
    try:
        service = get_active_learning_service()
        result = service.mark_reviewed(
            image_path=request.image_path,
            revised_detections=request.revised_detections,
            reviewer=request.reviewer,
        )

        return {
            "success": True,
            "message": f"Image marked as reviewed: {request.image_path}",
            "result": result,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/prepare-dataset")
async def prepare_distillation_dataset(request: PrepareDatasetRequest):
    """
    재학습용 데이터셋 준비

    논문: "이 과정에서 축적된 데이터는 주기적으로 Knowledge Distillation 단계로
          전달되어 모델을 재학습"

    검토 완료된 데이터와 고신뢰도 자동 레이블링 데이터를 수집하여
    YOLO 학습에 사용할 수 있는 데이터셋으로 준비
    """
    try:
        service = get_active_learning_service()
        dataset = service.prepare_distillation_dataset(
            include_reviewed=request.include_reviewed,
            min_quality_score=request.min_quality_score,
        )

        return {
            "success": True,
            "message": "Dataset prepared for distillation",
            "dataset": {
                "images": dataset["images"],
                "total_detections": dataset["total_detections"],
                "quality_threshold": dataset["quality_score_threshold"],
                "ready": dataset["ready_for_distillation"],
            },
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=StatisticsResponse)
async def get_statistics():
    """
    Active Learning 통계 조회

    현재 큐 상태, 자동화 비율, 임계값 등 반환
    """
    try:
        service = get_active_learning_service()
        stats = service.get_queue_statistics()

        return StatisticsResponse(
            success=True,
            review_queue=stats["review_queue"],
            auto_label_queue=stats["auto_label_queue"],
            confidence_threshold=stats["confidence_threshold"],
            review_threshold=stats["review_threshold"],
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/review-queue/{image_filename}")
async def remove_from_review_queue(image_filename: str):
    """
    검토 큐에서 특정 이미지 제거 (검토 완료 없이)
    """
    try:
        service = get_active_learning_service()
        queue = service.review_queue.get("queue", [])

        removed = False
        for i, item in enumerate(queue):
            if item.get("filename") == image_filename or image_filename in item.get(
                "image_path", ""
            ):
                queue.pop(i)
                removed = True
                break

        if removed:
            service.save_queues()
            return {
                "success": True,
                "message": f"Removed {image_filename} from review queue",
                "timestamp": datetime.now().isoformat(),
            }
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Image not found in review queue: {image_filename}",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/review-history")
async def get_review_history(
    limit: Optional[int] = Query(50, description="Maximum number of items"),
    since: Optional[str] = Query(None, description="ISO datetime to filter from"),
):
    """
    검토 히스토리 조회

    Knowledge Distillation 재학습에 포함될 검토 완료 데이터 확인
    """
    import json
    from pathlib import Path

    try:
        service = get_active_learning_service()
        history_file = service.annotations_dir / "review_history.json"

        if not history_file.exists():
            return {
                "success": True,
                "history": [],
                "total_count": 0,
                "timestamp": datetime.now().isoformat(),
            }

        with open(history_file, "r") as f:
            history = json.load(f)

        # 시간 필터
        if since:
            since_dt = datetime.fromisoformat(since)
            history = [
                h
                for h in history
                if datetime.fromisoformat(h.get("reviewed_at", "1970-01-01"))
                >= since_dt
            ]

        # 최신순 정렬
        history = sorted(history, key=lambda x: x.get("reviewed_at", ""), reverse=True)

        # 제한
        total = len(history)
        if limit:
            history = history[:limit]

        return {
            "success": True,
            "history": history,
            "total_count": total,
            "returned_count": len(history),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
