"""
SAM2 model loader and initialization with memory management
"""
import os
import gc
import logging
from contextlib import contextmanager

import torch

from config import SAM2_CHECKPOINT, SAM2_MODEL_CFG

logger = logging.getLogger(__name__)

# Global model instances
mask_generator = None
predictor = None
device = None
_sam2_model = None  # Store raw model for unloading


def initialize_device():
    """Initialize CUDA device and settings"""
    global device

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if torch.cuda.is_available():
        # Only set TF32 settings, autocast should be used locally in inference
        if torch.cuda.get_device_properties(0).major >= 8:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True

    return device


def load_sam2_models():
    """Load SAM2 models"""
    global mask_generator, predictor, device, _sam2_model

    try:
        from sam2.build_sam import build_sam2
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as e:
        logger.error(f"Cannot find 'sam2' module: {e}. SAM2 features will be disabled.")
        return None, None

    if device is None:
        initialize_device()

    try:
        if os.path.isfile(SAM2_CHECKPOINT):
            _sam2_model = build_sam2(SAM2_MODEL_CFG, SAM2_CHECKPOINT, device=device)
            mask_generator = SAM2AutomaticMaskGenerator(_sam2_model)
            predictor = SAM2ImagePredictor(_sam2_model)
            logger.info("SAM2 models loaded successfully.")
        else:
            logger.error("SAM2 model or config file not found. Check paths.")
    except Exception as e:
        logger.error(f"SAM2 model load failed: {e}", exc_info=True)

    return mask_generator, predictor


def unload_sam2_models() -> dict:
    """
    Unload SAM2 models to free GPU memory

    Returns:
        Dictionary with unload status and memory freed
    """
    global mask_generator, predictor, _sam2_model

    from utils.gpu_memory import get_gpu_memory_info

    before = get_gpu_memory_info()

    # Delete model references
    if mask_generator is not None:
        del mask_generator
        mask_generator = None

    if predictor is not None:
        del predictor
        predictor = None

    if _sam2_model is not None:
        # Move to CPU first then delete (helps with memory release)
        try:
            _sam2_model.cpu()
        except Exception:
            pass
        del _sam2_model
        _sam2_model = None

    # Force cleanup
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()

    after = get_gpu_memory_info()
    freed = before[1] - after[1]

    logger.info(f"SAM2 models unloaded. Freed {freed:.2f}GB GPU memory.")

    return {
        "status": "unloaded",
        "freed_gb": round(freed, 2),
        "allocated_gb": round(after[1], 2)
    }


def reload_sam2_models() -> dict:
    """
    Reload SAM2 models after unloading

    Returns:
        Dictionary with reload status
    """
    global mask_generator, predictor

    mask_generator, predictor = load_sam2_models()

    return {
        "status": "loaded" if mask_generator is not None else "failed",
        "mask_generator_ready": mask_generator is not None,
        "predictor_ready": predictor is not None
    }


def is_sam2_loaded() -> bool:
    """Check if SAM2 models are currently loaded"""
    return mask_generator is not None and predictor is not None


@contextmanager
def sam2_inference_context():
    """
    Context manager for SAM2 inference with proper autocast

    Usage:
        with sam2_inference_context():
            masks = mask_generator.generate(image)
    """
    if torch.cuda.is_available():
        with torch.autocast("cuda", dtype=torch.bfloat16):
            yield
    else:
        yield


def get_mask_generator():
    """Get mask generator instance"""
    global mask_generator
    if mask_generator is None:
        load_sam2_models()
    return mask_generator


def get_predictor():
    """Get predictor instance"""
    global predictor
    if predictor is None:
        load_sam2_models()
    return predictor


def get_device():
    """Get device instance"""
    global device
    if device is None:
        initialize_device()
    return device
