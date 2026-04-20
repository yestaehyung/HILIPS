"""
HILIPS Cold-start Labeling Router
论文 2.2.1 Cold-start Labeling API 엔드포인트

기능:
- LLM + SAM2 통합 파이프라인 API
- 배치 처리 지원
"""
import os
import sys
import json
import logging
from datetime import datetime
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

# 현재 디렉토리를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.llm_sam_pipeline import run_coldstart_labeling, run_batch_coldstart_labeling
from models.sam2_loader import get_predictor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/coldstart", tags=["Cold-start Labeling"])

# 요청/응답 모델
class ColdStartRequest(BaseModel):
    """Cold-start Labeling 요청"""
    image_path: str = Field(..., description="이미지 파일 경로")
    task_description: str = Field(default="이미지 내 모든 객체를 탐지하세요", description="LLM 태스크 프롬프트")
    custom_prompt: str = Field(default=None, description="커스텀 프롬프트 (None이면 기본값 사용)")
    save_intermediate: bool = Field(default=True, description="중간 결과 저장 여부")


class BatchColdStartRequest(BaseModel):
    """배치 Cold-start Labeling 요청"""
    image_paths: List[str] = Field(..., description="이미지 파일 경로 리스트")
    task_description: str = Field(default="이미지 내 모든 객체를 탐지하세요", description="LLM 태스크 프롬프트")
    custom_prompt: str = Field(default=None, description="커스텀 프롬프트")
    parallel: bool = Field(default=True, description="병렬 처리 여부")


class ColdStartResponse(BaseModel):
    """Cold-start Labeling 응답"""
    success: bool
    image_path: str
    annotations: List[Dict[str, Any]] = []
    llm_result: Dict[str, Any] = {}
    statistics: Dict[str, Any] = {}
    image_dimensions: Dict[str, int] = {}
    error: str = None


class BatchColdStartResponse(BaseModel):
    """배치 Cold-start Labeling 응답"""
    success: bool
    successful_count: int
    failed_count: int
    results: List[Dict[str, Any]] = []
    statistics: Dict[str, Any] = {}


@router.post("/label", response_model=ColdStartResponse)
async def coldstart_label(request: ColdStartRequest):
    """
    Cold-start Labeling 단일 이미지 처리
    
    Paper 2.2.1 구현:
    1. LLM이 이미지 분석 → bounding box + semantic label 반환
    2. LLM 박스 → SAM2 box prompt 변환
    3. SAM2가 정밀 segmentation mask 생성
    4. label + mask 결합 → annotation 결과 반환
    """
    try:
        # SAM2 predictor 가져오기
        predictor = get_predictor()
        if predictor is None:
            raise HTTPException(status_code=503, detail="SAM2 model not loaded")
        
        # Gemini API 키 확인
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
        
        # Cold-start 파이프라인 실행
        result = run_coldstart_labeling(
            image_path=request.image_path,
            gemini_api_key=api_key,
            sam2_predictor=predictor,
            custom_prompt=request.custom_prompt or request.task_description,
            save_intermediate=request.save_intermediate
        )
        
        return ColdStartResponse(
            success=len(result['annotations']) > 0,
            image_path=request.image_path,
            annotations=result['annotations'],
            llm_result=result['llm_result'],
            statistics=result['statistics'],
            image_dimensions=result['image_dimensions']
        )
        
    except Exception as e:
        logger.error(f"Cold-start labeling failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/label/batch", response_model=BatchColdStartResponse)
async def batch_coldstart_label(request: BatchColdStartRequest):
    """
    Cold-start Labeling 배치 처리
    
    여러 이미지에 대해 순차 또는 병렬로 cold-start labeling 실행
    """
    try:
        # SAM2 predictor 가져오기
        predictor = get_predictor()
        if predictor is None:
            raise HTTPException(status_code=503, detail="SAM2 model not loaded")
        
        # Gemini API 키 확인
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
        
        # 배치 처리 실행
        result = run_batch_coldstart_labeling(
            image_paths=request.image_paths,
            gemini_api_key=api_key,
            sam2_predictor=predictor,
            custom_prompt=request.custom_prompt or request.task_description,
            parallel=request.parallel
        )
        
        return BatchColdStartResponse(
            success=result['failed'] == [],
            successful_count=len(result['successful']),
            failed_count=len(result['failed']),
            results=result['successful'] + result['failed'],
            statistics=result['statistics']
        )
        
    except Exception as e:
        logger.error(f"Batch cold-start labeling failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def coldstart_status():
    """Cold-start 서비스 상태 확인"""
    predictor = get_predictor()
    api_key = os.environ.get("GEMINI_API_KEY")
    
    return {
        "status": "ready",
        "sam2_loaded": predictor is not None,
        "gemini_configured": api_key is not None,
        "endpoints": {
            "single": "/api/coldstart/label",
            "batch": "/api/coldstart/label/batch"
        }
    }
