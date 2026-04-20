"""
Pydantic request models for API endpoints
"""

from enum import Enum
from pydantic import BaseModel
from typing import List, Tuple, Dict, Any, Optional


class TrainingTask(str, Enum):
    """Training task types"""

    DETECTION = "detection"
    SEGMENTATION = "segmentation"


class TrainingRequest(BaseModel):
    """YOLOv8 model training request - supports detection and/or segmentation"""

    annotation_filenames: List[str]
    epochs: int = 10
    batch_size: int = 32
    img_size: int = 640
    model_name: Optional[str] = None
    training_tasks: List[TrainingTask] = [
        TrainingTask.DETECTION,
        TrainingTask.SEGMENTATION,
    ]


class PointPromptRequest(BaseModel):
    """SAM2 point-based segmentation request"""

    filename: str
    points: List[Tuple[int, int]]
    labels: Optional[List[int]] = None
    categories: List[str] = ["JOG", "MEMORY", "DOOR"]
    crop_padding_ratio: float = 0.15
    use_classification: bool = False


class PolygonToCOCORequest(BaseModel):
    """Polygon to COCO format conversion request"""

    image: dict
    polygons: List[dict]
    metadata: Optional[dict] = None


class GeminiSegmentationRequest(BaseModel):
    """Gemini segmentation request"""

    filename: str
    target: str
    model: str = "gemini-2.5-pro"
    temperature: float = 0.5
    resize_width: int = 1024


class ModelInferenceRequest(BaseModel):
    """Model inference request"""

    model_id: str
    image_path: str
    confidence: float = 0.25
    save_labels: bool = True


class HumanInLoopRequest(BaseModel):
    """Human-in-the-loop session request"""

    model_id: str
    image_paths: List[str]
    confidence: float = 0.25
    output_dir: str = "human_in_loop_annotations"


class BatchInferenceRequest(BaseModel):
    image_paths: Optional[List[str]] = None
    process_unlabeled: bool = True
    include_needs_review: bool = False  # 기존 needs_review 이미지도 재레이블링
    max_images: Optional[int] = None
    confidence: float = 0.5
    auto_label_threshold: float = 0.8
    save_annotations: bool = True
