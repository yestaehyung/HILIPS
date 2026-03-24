"""
HILIPS Workflow Scheduler Router
자동화 워크플로우 스케줄러 API 엔드포인트

논문 2.2.3 Iterative Refinement 자동화:
- 정기적인 auto-annotate 스케줄링
- 모델 재학습 트리거
- 워크플로우 상태 관리
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from datetime import datetime

from services.workflow_scheduler import get_scheduler, WorkflowStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scheduler", tags=["Workflow Scheduler"])


# === Request/Response Models ===


class SchedulerConfigUpdate(BaseModel):
    """스케줄러 설정 업데이트"""

    auto_annotate: Optional[Dict[str, Any]] = None
    distillation: Optional[Dict[str, Any]] = None
    evaluation: Optional[Dict[str, Any]] = None
    notifications: Optional[Dict[str, Any]] = None


class TriggerResponse(BaseModel):
    """트리거 응답"""

    success: bool
    job_id: str
    message: str
    timestamp: str


class SchedulerStatusResponse(BaseModel):
    """스케줄러 상태 응답"""

    success: bool
    status: str
    config: Dict[str, Any]
    scheduled_jobs: int
    running_jobs: int
    recent_jobs: List[Any]
    timestamp: str


# === Endpoints ===


@router.get("/status", response_model=SchedulerStatusResponse)
async def get_scheduler_status():
    """
    스케줄러 상태 조회

    현재 실행 상태, 설정, 진행중인 작업 등 반환
    """
    try:
        scheduler = get_scheduler()
        status = scheduler.get_status()

        return SchedulerStatusResponse(
            success=True,
            status=status["status"],
            config=status["config"],
            scheduled_jobs=status["scheduled_jobs"],
            running_jobs=status["running_jobs"],
            recent_jobs=status["recent_jobs"],
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        logger.exception("Error in get_scheduler_status")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_scheduler():
    """
    스케줄러 시작

    자동화 워크플로우(auto-annotate, evaluation, distillation) 시작
    """
    try:
        scheduler = get_scheduler()

        if scheduler.status == WorkflowStatus.RUNNING:
            return {
                "success": True,
                "message": "Scheduler is already running",
                "status": scheduler.status.value,
                "timestamp": datetime.now().isoformat(),
            }

        scheduler.start()

        return {
            "success": True,
            "message": "Scheduler started successfully",
            "status": scheduler.status.value,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_scheduler():
    """
    스케줄러 중지
    """
    try:
        scheduler = get_scheduler()

        if scheduler.status == WorkflowStatus.IDLE:
            return {
                "success": True,
                "message": "Scheduler is already stopped",
                "status": scheduler.status.value,
                "timestamp": datetime.now().isoformat(),
            }

        scheduler.stop()

        return {
            "success": True,
            "message": "Scheduler stopped successfully",
            "status": scheduler.status.value,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_scheduler_config():
    """
    스케줄러 설정 조회
    """
    try:
        scheduler = get_scheduler()

        return {
            "success": True,
            "config": scheduler.config,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/config")
async def update_scheduler_config(config: SchedulerConfigUpdate):
    """
    스케줄러 설정 업데이트

    - auto_annotate: 자동 레이블링 설정 (interval_hours, confidence_threshold 등)
    - distillation: 재학습 설정 (trigger, data_threshold, interval_days 등)
    - evaluation: 평가 설정 (interval_hours, map_threshold 등)
    - notifications: 알림 설정
    """
    try:
        scheduler = get_scheduler()

        update_dict = {}
        if config.auto_annotate:
            update_dict["auto_annotate"] = {
                **scheduler.config.get("auto_annotate", {}),
                **config.auto_annotate,
            }
        if config.distillation:
            update_dict["distillation"] = {
                **scheduler.config.get("distillation", {}),
                **config.distillation,
            }
        if config.evaluation:
            update_dict["evaluation"] = {
                **scheduler.config.get("evaluation", {}),
                **config.evaluation,
            }
        if config.notifications:
            update_dict["notifications"] = {
                **scheduler.config.get("notifications", {}),
                **config.notifications,
            }

        if update_dict:
            scheduler.update_config(update_dict)

        return {
            "success": True,
            "message": "Config updated successfully",
            "config": scheduler.config,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trigger/auto-annotate", response_model=TriggerResponse)
async def trigger_auto_annotate():
    """
    수동 Auto-Annotate 트리거

    논문 Phase 3: 경량 모델을 사용하여 새 이미지에 대해 객체 탐지 수행
    """
    try:
        scheduler = get_scheduler()
        job_id = scheduler.trigger_auto_annotate()

        return TriggerResponse(
            success=True,
            job_id=job_id,
            message="Auto-annotate job triggered",
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trigger/distillation", response_model=TriggerResponse)
async def trigger_distillation():
    """
    수동 Knowledge Distillation 트리거

    논문 Phase 2: 축적된 데이터로 모델 재학습
    """
    try:
        scheduler = get_scheduler()
        job_id = scheduler.trigger_distillation()

        return TriggerResponse(
            success=True,
            job_id=job_id,
            message="Distillation job triggered",
            timestamp=datetime.now().isoformat(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs")
async def get_jobs(status_filter: Optional[str] = None, limit: int = 20):
    """
    작업 목록 조회

    - status_filter: 'running', 'completed', 'error' 등으로 필터
    - limit: 반환할 최대 개수
    """
    try:
        scheduler = get_scheduler()
        jobs = list(scheduler.running_jobs.items())

        # 필터링
        if status_filter:
            jobs = [(k, v) for k, v in jobs if v.get("status") == status_filter]

        # 최신순 정렬 (started_at 기준)
        jobs = sorted(jobs, key=lambda x: x[1].get("started_at", ""), reverse=True)[
            :limit
        ]

        return {
            "success": True,
            "jobs": [{"job_id": job_id, **job_data} for job_id, job_data in jobs],
            "total_count": len(scheduler.running_jobs),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs/{job_id}")
async def get_job_detail(job_id: str):
    """
    특정 작업 상세 조회
    """
    try:
        scheduler = get_scheduler()

        if job_id not in scheduler.running_jobs:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

        job = scheduler.running_jobs[job_id]

        return {
            "success": True,
            "job_id": job_id,
            "job": job,
            "timestamp": datetime.now().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
