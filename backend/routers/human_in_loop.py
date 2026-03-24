"""
Human-in-the-Loop API endpoints
"""
import json
import uuid
import logging
import threading
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from schemas import HumanInLoopRequest
from services import (
    hil_sessions,
    load_trained_model,
    run_model_inference,
    convert_yolo_to_coco_format,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/human-in-loop", tags=["human-in-loop"])


@router.post("/start")
async def start_human_in_loop(request: HumanInLoopRequest):
    """Start Human-in-the-Loop session for multiple images"""
    session_id = uuid.uuid4().hex[:10]
    logger.info(f"Human-in-Loop session start: {session_id}, model: {request.model_id}")

    model = load_trained_model(request.model_id)

    output_dir = Path(request.output_dir) / session_id
    output_dir.mkdir(parents=True, exist_ok=True)

    session_info = {
        "session_id": session_id,
        "model_id": request.model_id,
        "created_at": datetime.now().isoformat(),
        "status": "processing",
        "total_images": len(request.image_paths),
        "processed_images": 0,
        "output_dir": str(output_dir),
        "confidence": request.confidence,
        "images": [],
        "errors": []
    }

    hil_sessions[session_id] = session_info

    def process_images():
        try:
            for i, image_path in enumerate(request.image_paths):
                try:
                    img_path = Path(image_path)
                    if not img_path.exists():
                        img_path = Path("images") / image_path
                        if not img_path.exists():
                            session_info["errors"].append(f"Image not found: {image_path}")
                            continue

                    results = run_model_inference(model, str(img_path), request.confidence)
                    coco_data = convert_yolo_to_coco_format(results, str(img_path), request.model_id)

                    image_name = img_path.stem
                    output_filename = f"{image_name}_inference.json"
                    output_path = output_dir / output_filename

                    with open(output_path, 'w', encoding='utf-8') as f:
                        json.dump(coco_data, f, ensure_ascii=False, indent=2)

                    image_info = {
                        "original_path": str(img_path),
                        "inference_file": str(output_path),
                        "detections_count": len(coco_data["polygons"]),
                        "status": "completed",
                        "reviewed": False
                    }
                    session_info["images"].append(image_info)
                    session_info["processed_images"] += 1

                    logger.info(f"Processing complete: {image_path} ({i+1}/{len(request.image_paths)})")

                except Exception as e:
                    error_msg = f"Image processing error {image_path}: {str(e)}"
                    session_info["errors"].append(error_msg)
                    logger.error(error_msg)

            session_info["status"] = "completed"
            session_info["completed_at"] = datetime.now().isoformat()
            logger.info(f"Human-in-Loop session complete: {session_id}")

        except Exception as e:
            session_info["status"] = "failed"
            session_info["error"] = str(e)
            logger.error(f"Human-in-Loop session failed: {session_id}, {e}")

    thread = threading.Thread(target=process_images)
    thread.start()

    return {
        "success": True,
        "session_id": session_id,
        "status": "processing",
        "total_images": len(request.image_paths),
        "output_dir": str(output_dir)
    }


@router.get("/{session_id}/status")
async def get_hil_session_status(session_id: str):
    """Query session status"""
    if session_id not in hil_sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    return hil_sessions[session_id]


@router.get("/{session_id}/images")
async def get_hil_session_images(session_id: str):
    """Query image list and review status for session"""
    if session_id not in hil_sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    session_info = hil_sessions[session_id]

    detailed_images = []
    for img_info in session_info["images"]:
        try:
            with open(img_info["inference_file"], 'r', encoding='utf-8') as f:
                inference_data = json.load(f)

            detailed_info = {
                "original_path": img_info["original_path"],
                "inference_file": img_info["inference_file"],
                "detections_count": img_info["detections_count"],
                "status": img_info["status"],
                "reviewed": img_info["reviewed"],
                "inference_data": inference_data
            }
            detailed_images.append(detailed_info)
        except Exception as e:
            logger.error(f"Image data load error: {e}")
            continue

    return {
        "session_id": session_id,
        "total_images": len(detailed_images),
        "reviewed_count": sum(1 for img in detailed_images if img["reviewed"]),
        "images": detailed_images
    }


@router.put("/{session_id}/labels/{image_index}")
async def update_hil_labels(session_id: str, image_index: int, updated_data: dict):
    """Save user-modified labels"""
    if session_id not in hil_sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    session_info = hil_sessions[session_id]

    if image_index >= len(session_info["images"]):
        raise HTTPException(status_code=404, detail=f"Image index '{image_index}' not found.")

    image_info = session_info["images"][image_index]
    inference_file = Path(image_info["inference_file"])

    try:
        with open(inference_file, 'r', encoding='utf-8') as f:
            original_data = json.load(f)

        updated_data["metadata"]["modified_at"] = datetime.now().isoformat()
        updated_data["metadata"]["original_inference_id"] = original_data["metadata"].get("inference_id")
        updated_data["metadata"]["human_reviewed"] = True

        with open(inference_file, 'w', encoding='utf-8') as f:
            json.dump(updated_data, f, ensure_ascii=False, indent=2)

        backup_file = inference_file.with_suffix('.original.json')
        if not backup_file.exists():
            with open(backup_file, 'w', encoding='utf-8') as f:
                json.dump(original_data, f, ensure_ascii=False, indent=2)

        session_info["images"][image_index]["reviewed"] = True
        session_info["images"][image_index]["detections_count"] = len(updated_data.get("polygons", []))

        logger.info(f"Label update complete: {session_id}, image {image_index}")

        return {
            "success": True,
            "session_id": session_id,
            "image_index": image_index,
            "updated_detections": len(updated_data.get("polygons", [])),
            "backup_created": str(backup_file)
        }

    except Exception as e:
        logger.error(f"Label update error: {e}")
        raise HTTPException(status_code=500, detail=f"Label update failed: {str(e)}")


@router.get("/{session_id}/export")
async def export_hil_session(session_id: str, format: str = "coco"):
    """Export modified labels to training format"""
    if session_id not in hil_sessions:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")

    session_info = hil_sessions[session_id]

    reviewed_labels = []
    for img_info in session_info["images"]:
        if img_info["reviewed"]:
            try:
                with open(img_info["inference_file"], 'r', encoding='utf-8') as f:
                    label_data = json.load(f)
                    reviewed_labels.append(label_data)
            except Exception as e:
                logger.error(f"Label data load error: {e}")

    if not reviewed_labels:
        raise HTTPException(status_code=400, detail="No modified labels.")

    export_dir = Path(session_info["output_dir"]) / "export"
    export_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_filename = f"human_reviewed_labels_{session_id}_{timestamp}.json"
    export_path = export_dir / export_filename

    export_data = {
        "session_info": {
            "session_id": session_id,
            "model_id": session_info["model_id"],
            "created_at": session_info["created_at"],
            "exported_at": datetime.now().isoformat(),
            "total_reviewed": len(reviewed_labels)
        },
        "labels": reviewed_labels
    }

    with open(export_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)

    return {
        "success": True,
        "export_file": str(export_path),
        "reviewed_count": len(reviewed_labels),
        "format": format
    }
