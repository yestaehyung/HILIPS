import os
import io
import json
import uuid
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
from PIL import Image
import supervision as sv

def run_segmentation(image_path: str, target: str,
                     model: str = "gemini-2.5-flash-preview-05-20",
                     temperature: float = 0.5,
                     resize_width: int = 1024,
                     api_key: str = None) -> Dict[str, Any]:

    # 1) 이미지 로드
    image = Image.open(image_path).convert("RGB")
    W0, H0 = image.size

    # 2) 리사이즈
    target_h = int(resize_width * H0 / max(1, W0))
    resized = image.resize((resize_width, target_h), Image.Resampling.LANCZOS)

    # 3) Gemini 호출
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=api_key)
    prompt = (
        f"Detect {target}. "
        'Return ONLY valid JSON: an array of objects, each with '
        '"box_2d":[x1,y1,x2,y2] (integers, image pixel coords) and "label":string.'
    )
    resp = client.models.generate_content(
        model=model,
        contents=[resized, prompt],
        config=types.GenerateContentConfig(
            temperature=temperature,
            safety_settings=None,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )
    )
    resp_text = resp.text

    # 4) Supervision 파싱
    resolution_wh = resized.size
    detections = sv.Detections.from_vlm(
        vlm=sv.VLM.GOOGLE_GEMINI_2_5,
        result=resp_text,
        resolution_wh=resolution_wh
    )

    # 5) 라벨 추출
    labels: List[str] = []
    if hasattr(detections, "data") and isinstance(detections.data, dict):
        labels = (
            detections.data.get("label")
            or detections.data.get("text")
            or detections.data.get("name")
            or []
        )
        if not isinstance(labels, (list, np.ndarray)):
            labels = [str(labels)]
    if not labels or len(labels) != len(detections):
        if detections.class_id is not None:
            labels = [str(c) for c in detections.class_id]
        else:
            labels = ["object"] * len(detections)
    labels = [str(x) for x in list(labels)]

    # 6) 박스 좌표 복구
    W_resized, H_resized = resolution_wh
    sx, sy = W0 / max(1, W_resized), H0 / max(1, H_resized)
    boxes_xyxy = []
    for (x1, y1, x2, y2) in detections.xyxy.astype(float).tolist():
        boxes_xyxy.append([
            int(round(x1 * sx)),
            int(round(y1 * sy)),
            int(round(x2 * sx)),
            int(round(y2 * sy)),
        ])

    # 7) JSON 결과
    request_id = uuid.uuid4().hex[:10]
    result = {
        "request_id": request_id,
        "prompt": prompt,
        "image_size": {"width": W0, "height": H0},
        "instances": [
            {"label": l, "box_2d": b}
            for l, b in zip(labels, boxes_xyxy)
        ],
        "raw_vlm_output": resp_text
    }

    return result


def classify_cropped_object(cropped_image: np.ndarray,
                           categories: List[str],
                           model: str = "gemini-2.5-flash-preview-05-20",
                           temperature: float = 0.5,
                           api_key: str = None) -> Dict[str, Any]:
    """
    Crop된 이미지를 받아서 주어진 카테고리 중에서 객체를 분류합니다.

    Args:
        cropped_image: numpy array 형태의 crop된 이미지
        categories: 분류할 카테고리 목록 (예: ["button", "label", "input"])
        model: Gemini 모델명
        temperature: 응답 창의성

    Returns:
        분류 결과를 포함한 딕셔너리
        {
            "class": str,           # 예측된 클래스명
            "confidence": float,    # 신뢰도 (0~1)
            "raw_response": str     # Gemini 원본 응답
        }
    """
    if not categories or len(categories) == 0:
        return {
            "class": None,
            "confidence": 0.0,
            "error": "No categories provided"
        }

    try:
        # numpy array를 PIL Image로 변환
        if isinstance(cropped_image, np.ndarray):
            cropped_pil = Image.fromarray(cropped_image.astype(np.uint8))
        else:
            cropped_pil = cropped_image

        # Gemini API 호출
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # 프롬프트 구성
        categories_str = ", ".join(categories)
        prompt = (
            f"Look at this image and classify the object shown. "
            f"Choose ONLY ONE category from: {categories_str}. "
            f"Return ONLY valid JSON with the exact format: "
            f'{{"class": "<selected category>", "confidence": <0.0 to 1.0>}}'
        )

        resp = client.models.generate_content(
            model=model,
            contents=[cropped_pil, prompt],
            config=types.GenerateContentConfig(
                temperature=temperature,
                safety_settings=None,
                thinking_config=types.ThinkingConfig(thinking_budget=0)
            )
        )

        resp_text = resp.text.strip()

        # JSON 파싱
        import json
        import re

        # JSON 부분 추출 (마크다운 코드블록 제거)
        json_match = re.search(r'\{.*\}', resp_text, re.DOTALL)
        if json_match:
            json_str = json_match.group()
            parsed = json.loads(json_str)

            class_name = parsed.get("class")
            confidence = float(parsed.get("confidence", 0.5))

            # 카테고리에 없는 값이 나온 경우 처리
            if class_name not in categories:
                class_name = categories[0]  # 첫 번째 카테고리로 fallback
                confidence = 0.5

            return {
                "class": class_name,
                "confidence": confidence,
                "raw_response": resp_text
            }
        else:
            # JSON 파싱 실패 시 첫 카테고리로 fallback
            return {
                "class": categories[0],
                "confidence": 0.5,
                "error": "Failed to parse JSON response",
                "raw_response": resp_text
            }

    except Exception as e:
        return {
            "class": categories[0] if categories else None,
            "confidence": 0.0,
            "error": str(e)
        }


# if __name__ == "__main__":
#     import sys
#     if len(sys.argv) < 3:
#         print("Usage: python segment_local.py <image_path> <target>")
#         sys.exit(1)

#     image_path = sys.argv[1]
#     target = sys.argv[2]

#     result = run_segmentation(image_path, target)
#     out_dir = Path("outputs") / result["request_id"]
#     out_dir.mkdir(parents=True, exist_ok=True)
#     (out_dir / "result.json").write_text(
#         json.dumps(result, ensure_ascii=False, indent=2),
#         encoding="utf-8"
#     )
    # print(json.dumps(result, ensure_ascii=False, indent=2))
