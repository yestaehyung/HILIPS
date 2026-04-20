"""
Application configuration and settings
"""

import os
import logging

# API Keys
API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Default Gemini model. Paper specifies Gemini 2.5 Pro; override via
# GEMINI_MODEL env var if a different stable API endpoint is needed.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")

# Logging configuration
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# SAM2 Model paths
SAM2_CHECKPOINT = "checkpoints/sam2.1_hiera_large.pt"
SAM2_MODEL_CFG = "configs/sam2.1/sam2.1_hiera_l.yaml"

# Directory paths
IMAGES_DIR = "images"
ANNOTATIONS_DIR = "annotations"
TRAINED_MODELS_DIR = "trained_models"
TRAINING_DATASETS_DIR = "training_datasets"

# YOLO training defaults (optimized for RTX 3090 24GB)
DEFAULT_EPOCHS = 10
DEFAULT_BATCH_SIZE = 32  # 3090 24GB can handle 32-64 comfortably
DEFAULT_IMG_SIZE = 640

# GPU Configuration
GPU_TOTAL_MEMORY_GB = 24  # RTX 3090
GPU_RESERVED_FOR_SYSTEM_GB = 2  # Reserve for system/display

# Custom classes for YOLO training
CUSTOM_CLASSES = [
    "button_1",
    "button_2",
    "button_3",
    "button_4",
    "button_5",
    "button_6",
    "button_7",
    "button_8",
    "button_9",
    "button_10",
]
