"""
GPU Memory Management Utilities
"""

import gc
import logging
from typing import Tuple

import torch

logger = logging.getLogger(__name__)


def get_gpu_memory_info() -> Tuple[float, float, float]:
    """
    Get GPU memory information in GB

    Returns:
        Tuple of (total_memory, allocated_memory, free_memory) in GB
    """
    if not torch.cuda.is_available():
        return (0.0, 0.0, 0.0)

    total = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    allocated = torch.cuda.memory_allocated(0) / (1024**3)
    reserved = torch.cuda.memory_reserved(0) / (1024**3)
    free = total - reserved

    return (total, allocated, free)


def clear_gpu_memory(force_gc: bool = True) -> dict:
    """
    Clear GPU memory cache and optionally run garbage collection

    Args:
        force_gc: Whether to run Python garbage collection

    Returns:
        Dictionary with memory stats before and after cleanup
    """
    if not torch.cuda.is_available():
        return {"status": "no_gpu"}

    before = get_gpu_memory_info()

    if force_gc:
        gc.collect()

    torch.cuda.empty_cache()
    torch.cuda.synchronize()

    after = get_gpu_memory_info()

    freed = before[1] - after[1]

    logger.info(
        f"GPU memory cleanup: freed {freed:.2f}GB, "
        f"allocated: {after[1]:.2f}GB / {after[0]:.2f}GB"
    )

    return {
        "status": "cleaned",
        "before_allocated_gb": round(before[1], 2),
        "after_allocated_gb": round(after[1], 2),
        "freed_gb": round(freed, 2),
        "total_gb": round(after[0], 2),
    }


def check_memory_available(required_gb: float = 4.0) -> Tuple[bool, float]:
    """
    Check if sufficient GPU memory is available

    Args:
        required_gb: Minimum required GPU memory in GB

    Returns:
        Tuple of (is_available, free_memory_gb)
    """
    if not torch.cuda.is_available():
        return (False, 0.0)

    _, _, free = get_gpu_memory_info()

    return (free >= required_gb, round(free, 2))


def estimate_yolo_training_memory(batch_size: int, img_size: int) -> float:
    """
    Estimate GPU memory required for YOLO training (calibrated for RTX 3090)
    """
    base_model_memory = 0.5
    memory_per_batch = (batch_size * 3 * img_size * img_size * 4 * 10) / (1024**3)
    optimizer_memory = base_model_memory * 2
    total = (base_model_memory + memory_per_batch + optimizer_memory) * 1.5

    return round(total, 2)


def get_recommended_batch_size(img_size: int = 640, available_gb: float = 22.0) -> int:
    """
    Get recommended batch size for given image size and available GPU memory
    """
    for batch in [64, 48, 32, 16, 8]:
        estimated = estimate_yolo_training_memory(batch, img_size)
        if estimated < available_gb * 0.8:
            return batch
    return 8


def get_max_batch_size(img_size: int = 640, total_gpu_gb: float = 24.0) -> int:
    """
    Get maximum safe batch size for RTX 3090 (24GB)
    """
    available = total_gpu_gb - 2.0
    return get_recommended_batch_size(img_size, available)
