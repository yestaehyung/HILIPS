"""
COCO annotation management API endpoints
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, FileResponse, Response

from config import ANNOTATIONS_DIR
from schemas import PolygonToCOCORequest
from services import (
    convert_polygons_to_coco,
    get_annotation_files,
    get_annotation_file_path,
    delete_annotation_file,
    coco_to_voc_xml,
    list_coco_files,
    zip_voc_export,
)


def _record_review_history(image_filename: str, annotations_count: int):
    """Record labeling completion to review_history.json for workflow tracking"""
    history_file = Path(ANNOTATIONS_DIR) / "review_history.json"
    history = []

    if history_file.exists():
        try:
            with open(history_file, "r") as f:
                history = json.load(f)
        except Exception:
            pass

    # Check if already recorded (avoid duplicates on re-save)
    existing_idx = next(
        (i for i, h in enumerate(history) if h.get("image_path") == image_filename),
        None,
    )

    review_entry = {
        "image_path": image_filename,
        "reviewed_at": datetime.now().isoformat(),
        "reviewer": "user",
        "detection_count": annotations_count,
    }

    if existing_idx is not None:
        # Update existing entry
        history[existing_idx] = review_entry
    else:
        # Add new entry
        history.append(review_entry)

    with open(history_file, "w") as f:
        json.dump(history, f, indent=2)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["annotations"])


@router.post("/convert-to-coco")
async def convert_polygons_to_coco_endpoint(request: PolygonToCOCORequest):
    """Convert polygon data to COCO format and save to server"""
    logger.info("Polygon to COCO format conversion and save request")

    print("=" * 80)
    print("COCO conversion input data:")
    print(f"Image info: {request.image}")
    print(f"Polygon count: {len(request.polygons)}")
    print(f"Metadata: {request.metadata}")

    print("\nPolygon details:")
    for i, polygon in enumerate(request.polygons):
        print(f"  [{i + 1}] ID: {polygon.get('id', 'N/A')}")
        print(f"      Label: {polygon.get('label', 'N/A')}")
        print(f"      BBox: {polygon.get('bbox', 'N/A')}")
        print(f"      Area: {polygon.get('area', 'N/A')}")
        print(f"      IoU: {polygon.get('predicted_iou', 'N/A')}")
        print(f"      Stability: {polygon.get('stability_score', 'N/A')}")
        if "segmentation" in polygon:
            seg_len = len(polygon["segmentation"]) if polygon["segmentation"] else 0
            print(f"      Segmentation Points: {seg_len}")
        print()
    print("=" * 80)

    try:
        result = convert_polygons_to_coco(
            request.image, request.polygons, request.metadata
        )

        print("\nCOCO conversion complete:")
        print(f"Saved file: {result['coco_filename']}")
        print(f"Annotations count: {len(result['coco_data']['annotations'])}")
        print(f"Categories count: {len(result['coco_data']['categories'])}")
        print(f"File path: {result['coco_file_path']}")
        print("=" * 80)

        # Record to review_history.json for workflow "Done" counter
        image_filename = (
            request.image.get("file_name")
            or request.image.get("filename")
            or request.image.get("name", "")
        )
        _record_review_history(image_filename, len(result["coco_data"]["annotations"]))

        return JSONResponse(
            content={
                "message": "COCO data converted and saved successfully.",
                "saved_filename": result["coco_filename"],
                "file_path": result["coco_file_path"],
                "annotations_count": len(result["coco_data"]["annotations"]),
                "coco_data": result["coco_data"],
            }
        )

    except Exception as e:
        logger.error(f"COCO conversion and save error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"COCO conversion and save error: {str(e)}"
        )


@router.get("/annotations")
async def get_annotations_list():
    """Return list of saved COCO annotation files"""
    if not os.path.isdir(ANNOTATIONS_DIR):
        return JSONResponse(
            content={"error": f"'{ANNOTATIONS_DIR}' folder not found."}, status_code=404
        )

    try:
        file_info = get_annotation_files()
        return JSONResponse(content={"files": file_info, "total_count": len(file_info)})
    except Exception as e:
        logger.error(f"Annotation file list query error: {str(e)}", exc_info=True)
        return JSONResponse(content={"error": str(e)}, status_code=500)


@router.get("/annotations/{filename}")
async def get_annotation_file(filename: str):
    """Download specific COCO annotation file"""
    file_path = get_annotation_file_path(filename)

    if not os.path.isfile(file_path):
        logger.warning(f"Annotation file not found: {file_path}")
        raise HTTPException(
            status_code=404, detail=f"Annotation file '{filename}' not found."
        )

    return FileResponse(
        file_path,
        media_type="application/json",
        filename=filename,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.delete("/annotations/{filename}")
async def delete_annotation_file_endpoint(filename: str):
    """Delete specific COCO annotation file"""
    file_path = get_annotation_file_path(filename)

    if not os.path.isfile(file_path):
        logger.warning(f"Annotation file not found: {file_path}")
        raise HTTPException(
            status_code=404, detail=f"Annotation file '{filename}' not found."
        )

    try:
        delete_annotation_file(filename)
        logger.info(f"Annotation file deleted: {filename}")
        return JSONResponse(
            content={
                "message": f"File '{filename}' deleted.",
                "deleted_file": filename,
                "deleted_at": datetime.now().isoformat(),
            }
        )
    except Exception as e:
        logger.error(f"File delete error: {e}")
        raise HTTPException(status_code=500, detail=f"File delete failed: {str(e)}")


@router.get("/annotations/{filename}/voc")
async def export_annotation_as_pascal_voc(filename: str):
    """Download a single annotation converted to Pascal VOC XML."""
    file_path = get_annotation_file_path(filename)
    if not os.path.isfile(file_path):
        raise HTTPException(
            status_code=404, detail=f"Annotation file '{filename}' not found."
        )

    try:
        with open(file_path, "r") as fh:
            coco = json.load(fh)
        base = Path(filename).stem.removesuffix("_coco")
        xml_text = coco_to_voc_xml(coco, image_filename=f"{base}.jpg")
        return Response(
            content=xml_text,
            media_type="application/xml",
            headers={"Content-Disposition": f"attachment; filename={base}.xml"},
        )
    except Exception as e:
        logger.error(f"Pascal VOC export error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pascal VOC export failed: {e}")


@router.get("/export/pascal-voc")
async def export_all_annotations_as_pascal_voc():
    """Download every saved annotation as Pascal VOC XML bundled in a ZIP."""
    try:
        coco_paths = list_coco_files(ANNOTATIONS_DIR)
        if not coco_paths:
            raise HTTPException(status_code=404, detail="No COCO annotations found.")

        archive = zip_voc_export(coco_paths)
        return Response(
            content=archive,
            media_type="application/zip",
            headers={
                "Content-Disposition": "attachment; filename=hilips_pascal_voc.zip"
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pascal VOC bulk export error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pascal VOC export failed: {e}")
