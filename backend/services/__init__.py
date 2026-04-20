"""
HILIPS services — three-stage pipeline modules:

- Cold-start Labeling (LLM + SAM2)
- Knowledge Distillation / Label Transfer (Model Registry)
- Iterative Refinement (Active Learning, Workflow Scheduler)
"""

from .yolo_service import (
    training_jobs,
    hil_sessions,
    create_yolo_dataset_structure,
    create_yolo_seg_dataset_structure,
    train_yolo_model_background,
    load_trained_model,
    run_model_inference,
    convert_yolo_to_coco_format,
    convert_bbox_to_yolo,
    convert_segmentation_to_yolo,
    process_coco_annotations_to_yolo_seg,
    request_training_stop,
)
from .coco_service import (
    convert_polygons_to_coco,
    get_annotation_files,
    get_annotation_file_path,
    delete_annotation_file,
)
from .llm_sam_pipeline import (
    run_coldstart_labeling,
    run_batch_coldstart_labeling,
    run_gemini_detection,
    run_sam2_segmentation_from_boxes,
    scale_normalized_box_to_pixel,
)
from .model_registry import ModelRegistry, ModelStatus, get_registry, reset_registry
from .active_learning import (
    ActiveLearningService,
    get_active_learning_service,
    reset_active_learning_service,
)
from .workflow_scheduler import (
    WorkflowScheduler,
    WorkflowStatus,
    get_scheduler,
    reset_scheduler,
)
from .experiment_log import (
    ExperimentLogService,
    LabelingMethod,
    UserAction,
    get_experiment_log_service,
    reset_experiment_log_service,
)
from .test_set import (
    TestSetService,
    get_test_set_service,
    reset_test_set_service,
)
from .metrics_map import (
    MapCalculationService,
    get_map_calculation_service,
    reset_map_calculation_service,
)
from .pascal_voc_service import (
    coco_to_voc_xml,
    convert_coco_file_to_voc,
    list_coco_files,
    zip_voc_export,
)

__all__ = [
    # YOLO Service
    "training_jobs",
    "hil_sessions",
    "create_yolo_dataset_structure",
    "create_yolo_seg_dataset_structure",
    "train_yolo_model_background",
    "load_trained_model",
    "run_model_inference",
    "convert_yolo_to_coco_format",
    "convert_bbox_to_yolo",
    "convert_segmentation_to_yolo",
    "process_coco_annotations_to_yolo_seg",
    "request_training_stop",
    # COCO Service
    "convert_polygons_to_coco",
    "get_annotation_files",
    "get_annotation_file_path",
    "delete_annotation_file",
    # LLM-SAM Pipeline
    "run_coldstart_labeling",
    "run_batch_coldstart_labeling",
    "run_gemini_detection",
    "run_sam2_segmentation_from_boxes",
    "scale_normalized_box_to_pixel",
    # Model Registry
    "ModelRegistry",
    "ModelStatus",
    "get_registry",
    # Active Learning
    "ActiveLearningService",
    "get_active_learning_service",
    # Workflow Scheduler
    "WorkflowScheduler",
    "WorkflowStatus",
    "get_scheduler",
    # Experiment Logging
    "ExperimentLogService",
    "LabelingMethod",
    "UserAction",
    "get_experiment_log_service",
    "reset_experiment_log_service",
    # Test Set Management
    "TestSetService",
    "get_test_set_service",
    "reset_test_set_service",
    # mAP Calculation
    "MapCalculationService",
    "get_map_calculation_service",
    "reset_map_calculation_service",
    # Pascal VOC export
    "coco_to_voc_xml",
    "convert_coco_file_to_voc",
    "list_coco_files",
    "zip_voc_export",
]
