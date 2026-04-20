"""
HILIPS Cold-start Labeling Pipeline
LLM (Gemini) + SAM2 통합 파이프라인

论文 2.2.1 Cold-start Labeling 구현:
- 멀티모달 LLM이 이미지 분석 → bounding box + semantic label 반환
- LLM 박스를 SAM2 box prompt로 변환
- SAM2가 정밀 segmentation mask 생성
- 최종 annotation 결과 반환 (mask + label)
"""

import os
import sys
import json
import logging
import base64
import re
import gc
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from pathlib import Path
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# LLM 프롬프트 템플릿 (论文 요구사항 반영)
LLM_PROMPT_TEMPLATE = """
당신은 이미지 분석 전문가입니다. 다음 이미지에서 모든 객체를 탐지하고 JSON 형식으로 결과를 반환하세요.

**탐지 요구사항:**
1. 이미지 내 모든 시각적으로 구분 가능한 객체 탐지
2. 객체 간 공간적 관계 고려 (예: "책상 위의 컵")
3. 이미지 내 텍스트 정보 활용 (버튼의 "START", "STOP" 등)
4. 각 객체의 의미론적 레이블 결정

**출력 형식 (JSON):**
{{{{
  "detections": [
    {{
      "label": "객체이름",
      "confidence": 0.95,
      "box_2d": [ymin, xmin, ymax, xmax],
      "reasoning": "탐지 이유 (시각적 특징, 텍스트, 공간관계 등)"
    }}
  ],
  "image_description": "전체 이미지 설명",
  "spatial_relationships": ["객체 간 관계 설명"]
}}}}

**좌표 규칙:**
- 모든 좌표는 0-1000 범위의 정규화된 값
- 형식: [ymin, xmin, ymax, xmax] (YOLO/COCO 형식)
- 예: [100, 200, 400, 500] → x=200, y=100, w=200, h=400

**응답은 JSON만 포함, 추가 텍스트 없음:**
"""

# Confidence threshold for accepting LLM detections
LLM_CONFIDENCE_THRESHOLD = 0.3


def encode_image_to_base64(image_path: str) -> str:
    """이미지를 base64로 인코딩"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def parse_llm_response(response_text: str) -> Dict[str, Any]:
    """LLM 응답 텍스트에서 JSON 파싱"""
    # JSON 코드 블록 제거
    response_clean = response_text.strip()
    if response_clean.startswith("```json"):
        response_clean = response_clean[7:]
    elif response_clean.startswith("```"):
        response_clean = response_clean[3:]
    if response_clean.endswith("```"):
        response_clean = response_clean[:-3]
    response_clean = response_clean.strip()

    # JSON 파싱
    try:
        return json.loads(response_clean)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing failed: {e}")
        # Fallback: 정규식으로 추출 시도
        json_match = re.search(r"\{[^{}]*\{[^{}]*\}[^{}]*\}", response_clean)
        if json_match:
            try:
                return json.loads(json_match.group())
            except:
                pass
        raise ValueError(f"Invalid LLM response format: {response_text[:200]}...")


def scale_normalized_box_to_pixel(
    box: List[float], img_width: int, img_height: int
) -> List[float]:
    """
    정규화된 박스 좌표를 픽셀 좌표로 변환

    Args:
        box: [ymin, xmin, ymax, xmax] (0-1000 정규화)
        img_width: 이미지 너비 (픽셀)
        img_height: 이미지 높이 (픽셀)

    Returns:
        [x1, y1, x2, y2] (SAM2 box prompt 형식, 픽셀)
    """
    ymin, xmin, ymax, xmax = box
    x1 = int(xmin * img_width / 1000)
    y1 = int(ymin * img_height / 1000)
    x2 = int(xmax * img_width / 1000)
    y2 = int(ymax * img_height / 1000)
    return [x1, y1, x2, y2]


def run_gemini_detection(
    image_path: str, api_key: str, prompt: str = None
) -> Dict[str, Any]:
    """
    Gemini를 사용한 객체 탐지

    Args:
        image_path: 이미지 파일 경로
        api_key: Gemini API 키
        prompt: 커스텀 프롬프트 (None이면 기본 템플릿 사용)

    Returns:
        detections 리스트 포함 딕셔너리
    """
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)

        # 이미지 로드
        img = Image.open(image_path)
        img_width, img_height = img.size

        # 프롬프트 설정
        final_prompt = prompt or LLM_PROMPT_TEMPLATE

        # Gemini model (defaults to gemini-2.5-pro per paper Section 2.1;
        # override by setting GEMINI_MODEL)
        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
        model = genai.GenerativeModel(model_name)

        response = model.generate_content([final_prompt, img])

        # PIL 이미지 메모리 해제
        img.close()
        del img

        # 응답 파싱
        result = parse_llm_response(response.text)

        # detections 추출 및 검증
        detections = result.get("detections", [])
        validated_detections = []

        for det in detections:
            confidence = det.get("confidence", 0)
            if confidence < LLM_CONFIDENCE_THRESHOLD:
                logger.warning(
                    f"Low confidence detection filtered: {det.get('label')} ({confidence:.2f})"
                )
                continue

            box = det.get("box_2d", [])
            if len(box) != 4:
                logger.warning(f"Invalid box format: {box}")
                continue

            # 박스 좌표 검증
            ymin, xmin, ymax, xmax = box
            if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
                logger.warning(f"Box coordinates out of range: {box}")
                continue

            validated_detections.append(
                {
                    "label": det.get("label", "unknown"),
                    "confidence": confidence,
                    "box_2d": box,
                    "reasoning": det.get("reasoning", ""),
                    "spatial_relationships": det.get("spatial_relationships", []),
                }
            )

        return {
            "detections": validated_detections,
            "image_description": result.get("image_description", ""),
            "spatial_relationships": result.get("spatial_relationships", []),
            "image_width": img_width,
            "image_height": img_height,
            "raw_response": response.text,
        }

    except ImportError:
        raise ImportError(
            "google-generativeai not installed. Run: pip install google-generativeai"
        )
    except Exception as e:
        logger.error(f"Gemini detection failed: {e}")
        raise


def run_sam2_segmentation_from_boxes(
    image_path: str,
    detections: List[Dict[str, Any]],
    sam2_predictor,
    max_image_size: int = 2048,
) -> List[Dict[str, Any]]:
    """
    SAM2를 사용한 박스 기반 세그멘테이션

    Paper: LLM이 반환한 bounding box 좌표를 SAM의 box prompt로 변환

    Args:
        image_path: 이미지 파일 경로
        detections: LLM 탐지 결과 리스트
        sam2_predictor: SAM2ImagePredictor 인스턴스
        max_image_size: 최대 이미지 크기 (OOM 방지)

    Returns:
        세그멘테이션 결과 리스트 (mask + label + box)
    """
    # 이미지 로드 및 리사이즈 (OOM 방지)
    pil_image = Image.open(image_path)
    original_size = pil_image.size  # (width, height)

    # 대용량 이미지는 리사이즈
    scale_factor = 1.0
    if max(pil_image.size) > max_image_size:
        scale_factor = max_image_size / max(pil_image.size)
        new_size = (
            int(pil_image.size[0] * scale_factor),
            int(pil_image.size[1] * scale_factor),
        )
        pil_image = pil_image.resize(new_size, Image.LANCZOS)
        logger.info(
            f"Image resized from {original_size} to {new_size} for memory safety"
        )

    image = np.array(pil_image)

    # PIL 이미지 메모리 해제
    pil_image.close()
    del pil_image

    sam2_predictor.set_image(image)

    results = []

    for i, det in enumerate(detections):
        box_2d = det["box_2d"]
        img_height, img_width = image.shape[:2]

        # 정규화된 박스 → 픽셀 좌표 변환
        # [ymin, xmin, ymax, xmax] → [x1, y1, x2, y2] for SAM2
        input_box = scale_normalized_box_to_pixel(box_2d, img_width, img_height)

        # SAM2 예측
        try:
            masks, scores, logits = sam2_predictor.predict(
                box=np.array(input_box)[None, :],  # 배치 차원 추가
                multimask_output=True,  # 다중 mask 옵션
            )

            # 가장 좋은 mask 선택 (score 기준)
            best_mask_idx = np.argmax(scores)
            best_mask = masks[best_mask_idx].copy()  # copy하여 원본 참조 해제
            best_score = float(scores[best_mask_idx])

            # 불필요한 대용량 배열 즉시 해제
            del masks, scores, logits

            # 면적 계산
            area = int(best_mask.sum())

            # segmentation polygon 변환
            from sam2.utils.amg import mask_to_polygons

            polygons = mask_to_polygons(best_mask)

            # mask 메모리 해제
            del best_mask

            result = {
                "id": f"coldstart_{i}_{datetime.now().strftime('%H%M%S')}",
                "label": det["label"],
                "confidence": det["confidence"],
                "mask_confidence": best_score,
                "segmentation": polygons[0] if polygons else [],  # 첫 번째 polygon
                "area": area,
                "bbox": input_box,  # [x1, y1, x2, y2]
                "original_box_2d": box_2d,  # 원본 LLM 박스
                "reasoning": det.get("reasoning", ""),
                "source": "coldstart_llm_sam",
                "created_at": datetime.now().isoformat(),
            }

            results.append(result)

        except Exception as e:
            logger.error(f"SAM2 segmentation failed for detection {i}: {e}")
            # 실패해도 계속 진행
            continue

    # GPU 메모리 해제를 위해 predictor 상태 초기화
    sam2_predictor.reset_predictor()

    # numpy array 메모리 해제
    del image
    gc.collect()

    return results


def run_coldstart_labeling(
    image_path: str,
    gemini_api_key: str,
    sam2_predictor,
    custom_prompt: str = None,
    save_intermediate: bool = True,
) -> Dict[str, Any]:
    """
    Cold-start Labeling 완전 파이프라인

    Paper 2.2.1 구현:
    1. 사용자 이미지 업로드
    2. 멀티모달 LLM에 이미지 + 태스크 설명 프롬프트 전달
    3. LLM: 객체 위치(bounding box) + 의미론적 레이블 반환
    4. LLM 박스 → SAM box prompt 변환
    5. SAM: 정밀 segmentation mask 생성
    6. label + mask 결합 → annotation 결과
    7. 사용자 검토/수정 가능

    Args:
        image_path: 입력 이미지 경로
        gemini_api_key: Gemini API 키
        sam2_predictor: SAM2ImagePredictor 인스턴스
        custom_prompt: 커스텀 태스크 프롬프트
        save_intermediate: 중간 결과 저장 여부

    Returns:
        {
            'annotations': [...],  # 세그멘테이션 결과
            'llm_result': {...},   # LLM 원본 결과
            'statistics': {...}    # 통계 정보
        }
    """
    start_time = datetime.now()

    # Step 1: LLM 객체 탐지
    logger.info(f"[Cold-start] Starting LLM detection for: {image_path}")
    llm_result = run_gemini_detection(image_path, gemini_api_key, custom_prompt)

    detections = llm_result.get("detections", [])
    if not detections:
        logger.warning("No detections from LLM")
        return {
            "annotations": [],
            "llm_result": llm_result,
            "statistics": {
                "total_detections": 0,
                "processing_time_seconds": (
                    datetime.now() - start_time
                ).total_seconds(),
            },
        }

    # Step 2: SAM2 세그멘테이션
    logger.info(
        f"[Cold-start] Starting SAM2 segmentation for {len(detections)} objects"
    )
    annotations = run_sam2_segmentation_from_boxes(
        image_path, detections, sam2_predictor
    )

    # Step 3: 통계 계산
    total_area = sum(a["area"] for a in annotations)
    avg_confidence = (
        sum(a["confidence"] for a in annotations) / len(annotations)
        if annotations
        else 0
    )
    avg_mask_confidence = (
        sum(a["mask_confidence"] for a in annotations) / len(annotations)
        if annotations
        else 0
    )

    # Step 4: 중간 결과 저장 (선택적)
    if save_intermediate:
        output_dir = Path("annotations/coldstart")
        output_dir.mkdir(parents=True, exist_ok=True)

        base_name = Path(image_path).stem
        output_path = output_dir / f"{base_name}_coldstart.json"

        intermediate_result = {
            "image_path": image_path,
            "llm_result": {
                "detections": detections,
                "image_description": llm_result.get("image_description", ""),
                "spatial_relationships": llm_result.get("spatial_relationships", []),
            },
            "annotations": annotations,
            "statistics": {
                "total_detections": len(detections),
                "successful_segmentations": len(annotations),
                "total_area": total_area,
                "avg_confidence": avg_confidence,
                "avg_mask_confidence": avg_mask_confidence,
                "processing_time_seconds": (
                    datetime.now() - start_time
                ).total_seconds(),
            },
            "created_at": datetime.now().isoformat(),
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(intermediate_result, f, indent=2, ensure_ascii=False)

        logger.info(f"[Cold-start] Intermediate result saved: {output_path}")

    processing_time = (datetime.now() - start_time).total_seconds()

    return {
        "annotations": annotations,
        "llm_result": {
            "detections": detections,
            "image_description": llm_result.get("image_description", ""),
            "spatial_relationships": llm_result.get("spatial_relationships", []),
        },
        "statistics": {
            "total_detections": len(detections),
            "successful_segmentations": len(annotations),
            "total_area": total_area,
            "avg_confidence": avg_confidence,
            "avg_mask_confidence": avg_mask_confidence,
            "processing_time_seconds": processing_time,
        },
        "image_dimensions": {
            "width": llm_result.get("image_width", 0),
            "height": llm_result.get("image_height", 0),
        },
    }


def run_batch_coldstart_labeling(
    image_paths: List[str],
    gemini_api_key: str,
    sam2_predictor,
    custom_prompt: str = None,
    parallel: bool = True,
) -> Dict[str, Any]:
    """
    배치 Cold-start Labeling

    여러 이미지에 대해 순차 또는 병렬로 cold-start labeling 실행
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = {
        "successful": [],
        "failed": [],
        "statistics": {
            "total_images": len(image_paths),
            "total_annotations": 0,
            "total_detections": 0,
            "processing_time_seconds": 0,
        },
    }

    start_time = datetime.now()

    if parallel:
        # 병렬 처리
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(
                    run_coldstart_labeling,
                    path,
                    gemini_api_key,
                    sam2_predictor,
                    custom_prompt,
                ): path
                for path in image_paths
            }

            for future in as_completed(futures):
                path = futures[future]
                try:
                    result = future.result()
                    if result["annotations"]:
                        results["successful"].append(
                            {
                                "image_path": path,
                                "annotations": result["annotations"],
                                "statistics": result["statistics"],
                            }
                        )
                        results["statistics"]["total_annotations"] += len(
                            result["annotations"]
                        )
                        results["statistics"]["total_detections"] += result[
                            "statistics"
                        ]["total_detections"]
                    else:
                        results["failed"].append(
                            {"image_path": path, "error": "No annotations"}
                        )
                except Exception as e:
                    results["failed"].append({"image_path": path, "error": str(e)})
    else:
        # 순차 처리
        for path in image_paths:
            try:
                result = run_coldstart_labeling(
                    path, gemini_api_key, sam2_predictor, custom_prompt
                )
                if result["annotations"]:
                    results["successful"].append(
                        {
                            "image_path": path,
                            "annotations": result["annotations"],
                            "statistics": result["statistics"],
                        }
                    )
                    results["statistics"]["total_annotations"] += len(
                        result["annotations"]
                    )
                    results["statistics"]["total_detections"] += result["statistics"][
                        "total_detections"
                    ]
                else:
                    results["failed"].append(
                        {"image_path": path, "error": "No annotations"}
                    )
            except Exception as e:
                results["failed"].append({"image_path": path, "error": str(e)})

    results["statistics"]["processing_time_seconds"] = (
        datetime.now() - start_time
    ).total_seconds()

    return results
