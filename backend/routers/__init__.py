"""
API routers
"""

from .images import router as images_router, images_file_router
from .segmentation import router as segmentation_router
from .annotations import router as annotations_router
from .training import router as training_router
from .models import router as models_router
from .human_in_loop import router as human_in_loop_router
from .evaluation import router as evaluation_router
from .coldstart import router as coldstart_router
from .active_learning import router as active_learning_router
from .scheduler import router as scheduler_router
from .workflow import router as workflow_router
from .experiments import router as experiments_router

__all__ = [
    "images_router",
    "images_file_router",
    "segmentation_router",
    "annotations_router",
    "training_router",
    "models_router",
    "human_in_loop_router",
    "evaluation_router",
    "coldstart_router",
    "active_learning_router",
    "scheduler_router",
    "workflow_router",
    "experiments_router",
]
