"""
SAM2 API Server - Main Entry Point

This is the main FastAPI application that brings together all the routers
for SAM2 segmentation, YOLO training, and annotation management.
"""

import os
import sys

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import configuration
from config import logger

# Import model loaders
from models import load_sam2_models

# Import all routers
from routers import (
    images_router,
    images_file_router,
    segmentation_router,
    annotations_router,
    training_router,
    models_router,
    human_in_loop_router,
    evaluation_router,
    coldstart_router,
    active_learning_router,
    scheduler_router,
    workflow_router,
    experiments_router,
)

# Create FastAPI app
app = FastAPI(
    title="HILIPS API Server",
    description="HILIPS - Hierarchical Labeling with Iterative Pseudo-Labeling System\n\nImplements Section 2.2 of the paper:\n- Cold-start Labeling (LLM + SAM2)\n- Knowledge Distillation (YOLOv8)\n- Iterative Refinement (Active Learning)",
    version="1.0.0",
)

# CORS settings (development - allow all origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(images_router)
app.include_router(images_file_router)
app.include_router(segmentation_router)
app.include_router(annotations_router)
app.include_router(training_router)
app.include_router(models_router)
app.include_router(human_in_loop_router)
app.include_router(evaluation_router)
app.include_router(coldstart_router)
app.include_router(active_learning_router)
app.include_router(scheduler_router)
app.include_router(workflow_router)
app.include_router(experiments_router)


@app.on_event("startup")
async def startup_event():
    """Initialize models on startup"""
    logger.info("Starting HILIPS API Server...")
    load_sam2_models()
    logger.info("HILIPS API Server started successfully.")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "HILIPS API Server",
        "version": "1.0.0",
        "description": "Hierarchical Labeling with Iterative Pseudo-Labeling System",
        "docs": "/docs",
        "pipeline": {
            "phase_1_coldstart": "/api/coldstart",
            "phase_2_distillation": "/api/train-model",
            "phase_3_refinement": "/api/hil/sessions",
        },
        "workflow": {
            "state": "/api/workflow/state",
            "summary": "/api/workflow/summary",
            "next_action": "/api/workflow/next-action",
            "iterations": "/api/workflow/iterations",
        },
        "active_learning": {
            "review_queue": "/api/active-learning/review-queue",
            "auto_label_queue": "/api/active-learning/auto-label-queue",
            "stats": "/api/active-learning/stats",
        },
        "scheduler": {
            "status": "/api/scheduler/status",
            "config": "/api/scheduler/config",
        },
        "experiments": {
            "list": "/api/experiments",
            "dashboard": "/api/experiments/{id}/dashboard",
            "test_sets": "/api/experiments/test-sets",
            "evaluate": "/api/experiments/evaluate",
        },
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    from models import get_mask_generator, get_predictor

    return {
        "status": "healthy",
        "sam2_mask_generator": get_mask_generator() is not None,
        "sam2_predictor": get_predictor() is not None,
        "pipeline_components": {
            "coldstart_labeling": True,
            "knowledge_distillation": True,
            "iterative_refinement": True,
        },
    }
