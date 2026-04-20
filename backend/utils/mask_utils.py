"""
Mask processing utility functions
"""

import numpy as np
import cv2


def mask_to_polygon(mask):
    """Convert boolean mask to polygon coordinates list"""
    mask_uint8 = (mask * 255).astype(np.uint8)
    contours, _ = cv2.findContours(
        mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    polygons = []
    for contour in contours:
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) >= 3:
            polygon = [(int(point[0][0]), int(point[0][1])) for point in approx]
            polygons.append(polygon)
    return polygons


def process_and_format_masks(masks, scale_factor: float = 1.0):
    """
    Convert SAM2 mask list to JSON data format for API response

    Args:
        masks: SAM2 mask list
        scale_factor: 이미지 리사이즈 시 적용된 스케일 팩터 (1.0 = 원본 크기)
    """
    output_data = []
    inverse_scale = 1.0 / scale_factor

    for i, mask_data in enumerate(masks):
        polygons = mask_to_polygon(mask_data["segmentation"])

        # 스케일 팩터가 1.0이 아닌 경우 좌표를 원본 크기로 스케일링
        if scale_factor != 1.0:
            # bbox 스케일링 [x, y, w, h]
            bbox = mask_data.get("bbox", [])
            if bbox:
                bbox = [
                    int(bbox[0] * inverse_scale),
                    int(bbox[1] * inverse_scale),
                    int(bbox[2] * inverse_scale),
                    int(bbox[3] * inverse_scale),
                ]

            # polygon 좌표 스케일링
            polygons = [
                [(int(p[0] * inverse_scale), int(p[1] * inverse_scale)) for p in poly]
                for poly in polygons
            ]

            # area 스케일링
            area = float(mask_data.get("area", 0)) * (inverse_scale**2)
        else:
            bbox = mask_data.get("bbox", [])
            area = float(mask_data.get("area", 0))

        output_data.append(
            {
                "id": i,
                "area": area,
                "bbox": bbox,
                "predicted_iou": float(mask_data.get("predicted_iou", 0)),
                "stability_score": float(mask_data.get("stability_score", 0)),
                "polygons": polygons,
            }
        )
    return output_data
