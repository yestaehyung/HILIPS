"""
COCO format conversion and annotation service
"""

import os
import re
import json
import logging
from datetime import datetime
from typing import List, Dict, Any

from config import ANNOTATIONS_DIR

logger = logging.getLogger(__name__)


def convert_polygons_to_coco(
    image_info: dict, polygons: List[dict], metadata: dict = None
) -> dict:
    """Convert polygon data to COCO format and save to server"""

    current_time = datetime.now().isoformat()

    image_filename = image_info["url"].split("/")[-1]
    base_filename = os.path.splitext(image_filename)[0]
    coco_filename = f"{base_filename}_coco.json"
    coco_file_path = os.path.join(ANNOTATIONS_DIR, coco_filename)

    # Extract unique labels from polygons
    unique_labels = set()
    unlabeled_count = 0
    for polygon_data in polygons:
        label = polygon_data.get("label")
        if not label or label.strip() == "":
            unlabeled_count += 1
            label = f"unlabeled_object_{unlabeled_count}"
        unique_labels.add(label)

    sorted_labels = sorted(unique_labels)

    # Create dynamic categories
    categories = []
    label_to_id = {}
    for i, label in enumerate(sorted_labels, 1):
        categories.append({"id": i, "name": label, "supercategory": "thing"})
        label_to_id[label] = i

    # Create COCO format structure
    coco_data = {
        "info": {
            "description": "SAM2 Generated Annotations",
            "version": "1.0",
            "year": datetime.now().year,
            "contributor": "Grounded-SAM-2",
            "date_created": current_time,
        },
        "licenses": [{"id": 1, "name": "Unknown", "url": ""}],
        "images": [
            {
                "id": 1,
                "width": image_info["width"],
                "height": image_info["height"],
                "file_name": image_filename,
                "license": 1,
                "date_captured": current_time,
            }
        ],
        "categories": categories,
        "annotations": [],
    }

    # Convert polygons to COCO annotations
    unlabeled_objects = [
        p for p in polygons if not p.get("label") or p.get("label").strip() == ""
    ]

    for polygon_data in polygons:
        segmentation = []
        if "segmentation" in polygon_data and polygon_data["segmentation"]:
            flat_coords = []
            for point in polygon_data["segmentation"]:
                flat_coords.extend([float(point[0]), float(point[1])])
            segmentation = [flat_coords]

        bbox = polygon_data.get("bbox", [0, 0, 0, 0])
        area = polygon_data.get("area", 0)

        annotation_id = polygon_data.get("id", 0)
        if isinstance(annotation_id, str):
            match = re.search(r"\d+", annotation_id)
            annotation_id = (
                int(match.group()) if match else len(coco_data["annotations"]) + 1
            )

        label = polygon_data.get("label")
        if not label or label.strip() == "":
            current_index = unlabeled_objects.index(polygon_data) + 1
            label = f"unlabeled_object_{current_index}"

        category_id = label_to_id.get(label, 1)

        annotation = {
            "id": annotation_id,
            "image_id": 1,
            "category_id": category_id,
            "segmentation": segmentation,
            "bbox": [float(x) for x in bbox],
            "area": float(area),
            "iscrowd": 0,
        }

        if polygon_data.get("predicted_iou") is not None:
            annotation["predicted_iou"] = float(polygon_data["predicted_iou"])
        if polygon_data.get("stability_score") is not None:
            annotation["stability_score"] = float(polygon_data["stability_score"])

        if polygon_data.get("id"):
            annotation["external_id"] = str(polygon_data["id"])
        if polygon_data.get("source"):
            annotation["source"] = polygon_data["source"]
        if polygon_data.get("confidence") is not None:
            annotation["confidence"] = float(polygon_data["confidence"])
        if polygon_data.get("color"):
            annotation["color"] = polygon_data["color"]
        if polygon_data.get("classId"):
            annotation["class_id_external"] = polygon_data["classId"]
        if polygon_data.get("className"):
            annotation["class_name_external"] = polygon_data["className"]
        if polygon_data.get("metadata"):
            annotation["metadata"] = polygon_data["metadata"]

        coco_data["annotations"].append(annotation)

    if metadata:
        coco_data["metadata"] = metadata
        if "needs_review" not in metadata:
            coco_data["metadata"]["needs_review"] = False
    else:
        coco_data["metadata"] = {"needs_review": False}

    # Create annotations directory if not exists
    os.makedirs(ANNOTATIONS_DIR, exist_ok=True)

    # Save to file
    with open(coco_file_path, "w", encoding="utf-8") as f:
        json.dump(coco_data, f, indent=2, ensure_ascii=False)

    logger.info(
        f"COCO conversion complete: {len(coco_data['annotations'])} annotations, file: {coco_file_path}"
    )

    return {
        "coco_filename": coco_filename,
        "coco_file_path": coco_file_path,
        "coco_data": coco_data,
    }


def get_annotation_files() -> List[dict]:
    """Get list of saved COCO annotation files with metadata"""
    if not os.path.isdir(ANNOTATIONS_DIR):
        return []

    files = os.listdir(ANNOTATIONS_DIR)
    json_files = sorted([f for f in files if f.lower().endswith(".json")])

    file_info = []
    for filename in json_files:
        file_path = os.path.join(ANNOTATIONS_DIR, filename)
        stat = os.stat(file_path)

        needs_review = False
        annotations_count = 0
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                metadata = data.get("metadata", {})
                needs_review = metadata.get("needs_review", False)
                annotations_count = len(data.get("annotations", []))
        except Exception:
            pass

        file_info.append(
            {
                "filename": filename,
                "size": stat.st_size,
                "modified_time": stat.st_mtime,
                "needs_review": needs_review,
                "annotations_count": annotations_count,
            }
        )

    return file_info


def get_annotation_file_path(filename: str) -> str:
    """Get full path for annotation file"""
    return os.path.join(ANNOTATIONS_DIR, filename)


def delete_annotation_file(filename: str) -> bool:
    """Delete annotation file"""
    file_path = os.path.join(ANNOTATIONS_DIR, filename)
    if os.path.isfile(file_path):
        os.remove(file_path)
        return True
    return False
