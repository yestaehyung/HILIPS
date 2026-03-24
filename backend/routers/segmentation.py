"""
SAM2 and Gemini segmentation API endpoints
"""

import os
import gc
import logging

import numpy as np
from PIL import Image
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from config import IMAGES_DIR, API_KEY
from schemas import PointPromptRequest, GeminiSegmentationRequest
from models import get_mask_generator, get_predictor
from models.sam2_loader import sam2_inference_context, reload_sam2_models
from utils import mask_to_polygon, process_and_format_masks
from utils.gpu_memory import clear_gpu_memory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["segmentation"])


# 대용량 이미지 처리 시 OOM 방지를 위한 최대 크기
MAX_IMAGE_SIZE = 2048


@router.post("/generate-polygons-with-points")
async def generate_polygons_with_points(request: PointPromptRequest):
    """Generate polygons using SAM2 based on specific points from server image file"""
    logger.info(
        f"Point-based polygon generation request: {request.filename}, points: {request.points}"
    )

    predictor = get_predictor()
    if predictor is None:
        logger.error("SAM2 predictor not loaded.")
        raise HTTPException(status_code=500, detail="SAM2 model not loaded.")

    image_path = os.path.join(IMAGES_DIR, request.filename)
    if not os.path.isfile(image_path):
        logger.warning(f"Image file not found: {image_path}")
        raise HTTPException(
            status_code=404, detail=f"Image '{request.filename}' not found."
        )

    try:
        logger.info(f"Loading image file: {image_path}")
        pil_image = Image.open(image_path).convert("RGB")
        original_width, original_height = pil_image.size

        # 대용량 이미지 리사이즈 (OOM 방지)
        scale_factor = 1.0
        if max(pil_image.size) > MAX_IMAGE_SIZE:
            scale_factor = MAX_IMAGE_SIZE / max(pil_image.size)
            new_size = (
                int(pil_image.size[0] * scale_factor),
                int(pil_image.size[1] * scale_factor),
            )
            pil_image = pil_image.resize(new_size, Image.LANCZOS)
            logger.info(
                f"Image resized from {original_width}x{original_height} to {new_size[0]}x{new_size[1]} for memory safety"
            )

        image_array = np.array(pil_image)
        height, width, _ = image_array.shape

        # PIL 이미지 메모리 해제
        pil_image.close()
        del pil_image

        # 포인트 좌표 스케일링 (이미지 리사이즈에 맞춤)
        input_points = np.array(request.points) * scale_factor
        input_labels = np.array(
            request.labels if request.labels else [1] * len(request.points)
        )

        if len(input_points) != len(input_labels):
            raise HTTPException(
                status_code=400, detail="Number of points and labels do not match."
            )

        logger.info(
            f"Image size: {width}x{height}. Starting SAM2 point-based mask generation..."
        )

        # GPU 메모리 정리 후 추론 실행
        clear_gpu_memory()

        try:
            with sam2_inference_context():
                predictor.set_image(image_array)

                masks, scores, logits = predictor.predict(
                    point_coords=input_points,
                    point_labels=input_labels,
                    multimask_output=True,
                )

                # GPU 메모리 해제를 위해 predictor 상태 초기화 (메모리 누수 방지)
                predictor.reset_predictor()
        except RuntimeError as e:
            # 에러 발생 시에도 predictor 상태 정리
            try:
                predictor.reset_predictor()
            except Exception:
                pass

            # 메모리 정리
            del image_array
            gc.collect()

            error_msg = str(e).lower()
            if "cuda" in error_msg or "out of memory" in error_msg:
                logger.error(f"CUDA/OOM error detected, attempting recovery: {e}")
                reload_sam2_models()
                clear_gpu_memory()
                raise HTTPException(
                    status_code=503,
                    detail="GPU memory issue occurred. Model has been reloaded. Please retry.",
                )
            raise

        # 불필요한 logits 즉시 해제
        del logits

        logger.info(
            f"SAM2 point-based mask generation complete. {len(masks)} masks generated. Scores: {scores}"
        )

        # For point-based segmentation, return the BEST mask (highest score)
        # instead of filtering by hard threshold
        formatted_masks = []
        mask_id = 0

        # Find the best mask (highest score)
        if len(masks) > 0:
            best_idx = int(np.argmax(scores))
            best_mask = masks[best_idx]
            best_score = scores[best_idx]

            logger.info(f"Selected best mask with score: {best_score}")

            # Process the best mask (regardless of score - user clicked here, so return result)
            mask = best_mask
            score = best_score

            y_indices, x_indices = np.where(mask)
            if len(x_indices) > 0 and len(y_indices) > 0:
                x_min, x_max = x_indices.min(), x_indices.max()
                y_min, y_max = y_indices.min(), y_indices.max()

                # bbox를 원본 이미지 크기로 스케일링
                inverse_scale = 1.0 / scale_factor
                bbox = [
                    int(x_min * inverse_scale),
                    int(y_min * inverse_scale),
                    int((x_max - x_min) * inverse_scale),
                    int((y_max - y_min) * inverse_scale),
                ]
                area = int(mask.sum() * (inverse_scale**2))  # 면적도 스케일링

                polygons = mask_to_polygon(mask)
                # polygon 좌표를 원본 이미지 크기로 스케일링
                if scale_factor != 1.0:
                    polygons = [
                        [
                            [int(p[0] * inverse_scale), int(p[1] * inverse_scale)]
                            for p in poly
                        ]
                        for poly in polygons
                    ]

                mask_data = {
                    "id": mask_id,
                    "area": area,
                    "bbox": bbox,
                    "predicted_iou": float(score),
                    "stability_score": float(score),
                    "polygons": polygons,
                }

                if request.use_classification:
                    try:
                        from gemini_segmentation import classify_cropped_object

                        x, y, w, h = bbox
                        padding_ratio = request.crop_padding_ratio
                        pad_w = int(w * padding_ratio)
                        pad_h = int(h * padding_ratio)

                        crop_x1 = max(0, x - pad_w)
                        crop_y1 = max(0, y - pad_h)
                        crop_x2 = min(width, x + w + pad_w)
                        crop_y2 = min(height, y + h + pad_h)

                        cropped_img = image_array[crop_y1:crop_y2, crop_x1:crop_x2]

                        if cropped_img.size > 0:
                            classification_result = classify_cropped_object(
                                cropped_img, request.categories, api_key=API_KEY
                            )

                            mask_data["gemini_class"] = classification_result.get(
                                "class"
                            )
                            mask_data["classification_confidence"] = (
                                classification_result.get("confidence", 0.0)
                            )

                            logger.info(
                                f"Gemini classification complete: {classification_result.get('class')}"
                            )
                        else:
                            logger.warning(f"Mask {mask_id}: crop image size is 0.")

                    except Exception as e:
                        logger.warning(
                            f"Mask {mask_id} Gemini classification failed: {str(e)}"
                        )

                formatted_masks.append(mask_data)
                mask_id += 1

        # 메모리 정리
        del masks, scores, image_array
        gc.collect()

        return JSONResponse(
            content={
                "filename": request.filename,
                "image_dimensions": {
                    "width": original_width,
                    "height": original_height,
                },
                "input_points": request.points,
                "masks": formatted_masks,
                "total_count": len(formatted_masks),
            }
        )

    except Exception as e:
        logger.error(
            f"'{request.filename}' point-based polygon generation error: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=500, detail=f"Point-based polygon generation error: {str(e)}"
        )


@router.post("/gemini-segmentation")
async def gemini_segmentation(request: GeminiSegmentationRequest):
    """Detect and segment objects in image using Gemini-2.5-pro"""
    logger.info(
        f"Gemini segmentation request: {request.filename}, target: {request.target}"
    )

    image_path = os.path.join(IMAGES_DIR, request.filename)
    if not os.path.isfile(image_path):
        logger.warning(f"Image file not found: {image_path}")
        raise HTTPException(
            status_code=404, detail=f"Image '{request.filename}' not found."
        )

    try:
        from gemini_segmentation import run_segmentation

        logger.info(f"Starting Gemini segmentation: {image_path}")

        result = run_segmentation(
            image_path=image_path,
            target=request.target,
            model=request.model,
            temperature=request.temperature,
            resize_width=request.resize_width,
            api_key=API_KEY,
        )

        logger.info(
            f"Gemini segmentation complete: {len(result['instances'])} objects detected"
        )

        masks = []
        for i, instance in enumerate(result["instances"]):
            bbox = instance["box_2d"]
            bbox_xywh = [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]]
            area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])

            polygon = [
                [bbox[0], bbox[1]],
                [bbox[2], bbox[1]],
                [bbox[2], bbox[3]],
                [bbox[0], bbox[3]],
            ]

            masks.append(
                {
                    "id": i,
                    "area": area,
                    "bbox": bbox_xywh,
                    "predicted_iou": 0.9,
                    "stability_score": 0.9,
                    "polygons": [polygon],
                    "label": instance["label"],
                }
            )

        return JSONResponse(
            content={
                "filename": request.filename,
                "target": request.target,
                "model": request.model,
                "image_dimensions": result["image_size"],
                "masks": masks,
                "total_count": len(masks),
                "gemini_result": result,
            }
        )

    except Exception as e:
        logger.error(f"Gemini segmentation error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Gemini segmentation error: {str(e)}"
        )


@router.get("/generate-polygons/{filename}")
async def generate_polygons_from_file(filename: str):
    """Generate polygons from server image file using SAM2 and return as JSON"""
    logger.info(f"Polygon generation request from server file: {filename}")

    mask_generator = get_mask_generator()
    if mask_generator is None:
        logger.error("SAM2 model not loaded.")
        raise HTTPException(status_code=500, detail="SAM2 model not loaded.")

    image_path = os.path.join(IMAGES_DIR, filename)
    if not os.path.isfile(image_path):
        logger.warning(f"Image file not found: {image_path}")
        raise HTTPException(status_code=404, detail=f"Image '{filename}' not found.")

    try:
        logger.info(f"Loading image file: {image_path}")
        pil_image = Image.open(image_path).convert("RGB")
        original_width, original_height = pil_image.size

        # 대용량 이미지 리사이즈 (OOM 방지)
        scale_factor = 1.0
        if max(pil_image.size) > MAX_IMAGE_SIZE:
            scale_factor = MAX_IMAGE_SIZE / max(pil_image.size)
            new_size = (
                int(pil_image.size[0] * scale_factor),
                int(pil_image.size[1] * scale_factor),
            )
            pil_image = pil_image.resize(new_size, Image.LANCZOS)
            logger.info(
                f"Image resized from {original_width}x{original_height} to {new_size[0]}x{new_size[1]} for memory safety"
            )

        image_array = np.array(pil_image)
        height, width, _ = image_array.shape

        # PIL 이미지 메모리 해제
        pil_image.close()
        del pil_image

        logger.info(f"Image size: {width}x{height}. Starting SAM2 mask generation...")

        # GPU 메모리 정리 후 추론 실행
        clear_gpu_memory()

        try:
            with sam2_inference_context():
                masks = mask_generator.generate(image_array)
        except RuntimeError as e:
            # 메모리 정리
            del image_array
            gc.collect()

            error_msg = str(e).lower()
            if "cuda" in error_msg or "out of memory" in error_msg:
                logger.error(f"CUDA/OOM error detected, attempting recovery: {e}")
                reload_sam2_models()
                clear_gpu_memory()
                raise HTTPException(
                    status_code=503,
                    detail="GPU memory issue occurred. Model has been reloaded. Please retry.",
                )
            raise

        logger.info(f"SAM2 mask generation complete. {len(masks)} masks detected.")

        # 결과 좌표를 원본 이미지 크기로 스케일링
        json_result = process_and_format_masks(masks, scale_factor=scale_factor)

        # 메모리 정리
        del masks, image_array
        gc.collect()

        return JSONResponse(
            content={
                "filename": filename,
                "image_dimensions": {
                    "width": original_width,
                    "height": original_height,
                },
                "masks": json_result,
                "total_count": len(json_result),
            }
        )
    except Exception as e:
        logger.error(f"'{filename}' polygon generation error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Polygon generation error: {str(e)}"
        )
