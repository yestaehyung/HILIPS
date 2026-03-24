"""
HILIPS Test Set Management Service
Manages test sets with frozen ground truth for mAP evaluation

Features:
- Create test set from selected images
- Freeze ground truth (copy COCO annotations)
- Manage multiple test sets
- Support for experiment-specific test sets
"""

import os
import json
import shutil
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Directory structure: test_sets/{test_set_id}/
TEST_SETS_DIR = os.environ.get("TEST_SETS_DIR", "test_sets")
ANNOTATIONS_DIR = os.environ.get("ANNOTATIONS_DIR", "annotations")
IMAGES_DIR = os.environ.get("IMAGES_DIR", "images")


class TestSetService:
    """
    Test Set Management Service

    File structure:
    test_sets/
      {test_set_id}/
        manifest.json           # Test set metadata + image list
        gt/                     # Frozen ground truth annotations
          {image_name}_coco.json
    """

    def __init__(
        self,
        test_sets_dir: Optional[str] = None,
        annotations_dir: Optional[str] = None,
        images_dir: Optional[str] = None,
    ):
        self.test_sets_dir = Path(test_sets_dir or TEST_SETS_DIR)
        self.annotations_dir = Path(annotations_dir or ANNOTATIONS_DIR)
        self.images_dir = Path(images_dir or IMAGES_DIR)
        self.test_sets_dir.mkdir(parents=True, exist_ok=True)

    def create_test_set(
        self,
        test_set_id: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        image_filenames: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new test set

        Args:
            test_set_id: Optional ID (auto-generated if not provided)
            name: Human-readable name
            description: Description
            image_filenames: List of image filenames to include

        Returns:
            Test set manifest
        """
        if not test_set_id:
            test_set_id = f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        if not image_filenames:
            image_filenames = []

        test_set_dir = self.test_sets_dir / test_set_id
        test_set_dir.mkdir(parents=True, exist_ok=True)
        gt_dir = test_set_dir / "gt"
        gt_dir.mkdir(exist_ok=True)

        # Build image list with GT status
        images = []
        frozen_count = 0
        missing_gt_count = 0

        for filename in image_filenames:
            base_name = os.path.splitext(filename)[0]
            coco_filename = f"{base_name}_coco.json"
            src_coco_path = self.annotations_dir / coco_filename
            dst_coco_path = gt_dir / coco_filename

            image_entry = {
                "file_name": filename,
                "gt_coco_path": str(dst_coco_path.relative_to(test_set_dir)),
                "has_gt": False,
                "annotation_count": 0,
            }

            # Copy ground truth if exists
            if src_coco_path.exists():
                try:
                    # Read and copy COCO annotation
                    with open(src_coco_path, "r") as f:
                        coco_data = json.load(f)

                    # Freeze the ground truth (make a copy)
                    with open(dst_coco_path, "w", encoding="utf-8") as f:
                        json.dump(coco_data, f, indent=2, ensure_ascii=False)

                    image_entry["has_gt"] = True
                    image_entry["annotation_count"] = len(
                        coco_data.get("annotations", [])
                    )
                    frozen_count += 1

                    logger.info(
                        f"Froze GT for {filename}: {image_entry['annotation_count']} annotations"
                    )
                except Exception as e:
                    logger.warning(f"Failed to copy GT for {filename}: {e}")
                    missing_gt_count += 1
            else:
                missing_gt_count += 1
                logger.warning(f"No GT annotation found for {filename}")

            images.append(image_entry)

        manifest = {
            "test_set_id": test_set_id,
            "name": name or test_set_id,
            "description": description or "",
            "images": images,
            "statistics": {
                "total_images": len(images),
                "images_with_gt": frozen_count,
                "images_missing_gt": missing_gt_count,
                "total_annotations": sum(img["annotation_count"] for img in images),
            },
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "frozen": True,
        }

        manifest_path = test_set_dir / "manifest.json"
        self._atomic_write(manifest_path, manifest)

        logger.info(
            f"Created test set {test_set_id}: {frozen_count}/{len(images)} images with GT"
        )

        return manifest

    def get_test_set(self, test_set_id: str) -> Optional[Dict[str, Any]]:
        """Get test set manifest"""
        manifest_path = self.test_sets_dir / test_set_id / "manifest.json"
        if not manifest_path.exists():
            return None

        try:
            with open(manifest_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load test set {test_set_id}: {e}")
            return None

    def list_test_sets(self) -> List[Dict[str, Any]]:
        """List all test sets"""
        test_sets = []

        if not self.test_sets_dir.exists():
            return test_sets

        for test_set_dir in self.test_sets_dir.iterdir():
            if test_set_dir.is_dir():
                manifest = self.get_test_set(test_set_dir.name)
                if manifest:
                    # Return summary info
                    test_sets.append(
                        {
                            "test_set_id": manifest["test_set_id"],
                            "name": manifest["name"],
                            "description": manifest.get("description", ""),
                            "statistics": manifest["statistics"],
                            "created_at": manifest["created_at"],
                        }
                    )

        # Sort by created_at descending
        test_sets.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return test_sets

    def add_images_to_test_set(
        self,
        test_set_id: str,
        image_filenames: List[str],
    ) -> Dict[str, Any]:
        """
        Add images to existing test set

        Note: This freezes the current GT for newly added images
        """
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            raise ValueError(f"Test set not found: {test_set_id}")

        test_set_dir = self.test_sets_dir / test_set_id
        gt_dir = test_set_dir / "gt"

        existing_filenames = {img["file_name"] for img in manifest["images"]}

        added_count = 0
        for filename in image_filenames:
            if filename in existing_filenames:
                continue

            base_name = os.path.splitext(filename)[0]
            coco_filename = f"{base_name}_coco.json"
            src_coco_path = self.annotations_dir / coco_filename
            dst_coco_path = gt_dir / coco_filename

            image_entry = {
                "file_name": filename,
                "gt_coco_path": str(dst_coco_path.relative_to(test_set_dir)),
                "has_gt": False,
                "annotation_count": 0,
            }

            if src_coco_path.exists():
                try:
                    with open(src_coco_path, "r") as f:
                        coco_data = json.load(f)

                    with open(dst_coco_path, "w", encoding="utf-8") as f:
                        json.dump(coco_data, f, indent=2, ensure_ascii=False)

                    image_entry["has_gt"] = True
                    image_entry["annotation_count"] = len(
                        coco_data.get("annotations", [])
                    )
                except Exception as e:
                    logger.warning(f"Failed to copy GT for {filename}: {e}")

            manifest["images"].append(image_entry)
            added_count += 1

        # Update statistics
        manifest["statistics"]["total_images"] = len(manifest["images"])
        manifest["statistics"]["images_with_gt"] = sum(
            1 for img in manifest["images"] if img["has_gt"]
        )
        manifest["statistics"]["images_missing_gt"] = (
            manifest["statistics"]["total_images"]
            - manifest["statistics"]["images_with_gt"]
        )
        manifest["statistics"]["total_annotations"] = sum(
            img["annotation_count"] for img in manifest["images"]
        )
        manifest["updated_at"] = datetime.now().isoformat()

        manifest_path = test_set_dir / "manifest.json"
        self._atomic_write(manifest_path, manifest)

        logger.info(f"Added {added_count} images to test set {test_set_id}")

        return manifest

    def remove_images_from_test_set(
        self,
        test_set_id: str,
        image_filenames: List[str],
    ) -> Dict[str, Any]:
        """Remove images from test set"""
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            raise ValueError(f"Test set not found: {test_set_id}")

        test_set_dir = self.test_sets_dir / test_set_id
        gt_dir = test_set_dir / "gt"

        filenames_to_remove = set(image_filenames)
        removed_count = 0

        new_images = []
        for img in manifest["images"]:
            if img["file_name"] in filenames_to_remove:
                # Delete GT file
                gt_path = gt_dir / os.path.basename(img["gt_coco_path"])
                if gt_path.exists():
                    gt_path.unlink()
                removed_count += 1
            else:
                new_images.append(img)

        manifest["images"] = new_images

        # Update statistics
        manifest["statistics"]["total_images"] = len(manifest["images"])
        manifest["statistics"]["images_with_gt"] = sum(
            1 for img in manifest["images"] if img["has_gt"]
        )
        manifest["statistics"]["images_missing_gt"] = (
            manifest["statistics"]["total_images"]
            - manifest["statistics"]["images_with_gt"]
        )
        manifest["statistics"]["total_annotations"] = sum(
            img["annotation_count"] for img in manifest["images"]
        )
        manifest["updated_at"] = datetime.now().isoformat()

        manifest_path = test_set_dir / "manifest.json"
        self._atomic_write(manifest_path, manifest)

        logger.info(f"Removed {removed_count} images from test set {test_set_id}")

        return manifest

    def get_gt_annotations(self, test_set_id: str) -> List[Dict[str, Any]]:
        """
        Get all ground truth annotations for a test set

        Returns list of COCO format annotation files
        """
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            raise ValueError(f"Test set not found: {test_set_id}")

        test_set_dir = self.test_sets_dir / test_set_id
        gt_dir = test_set_dir / "gt"

        annotations = []
        for img in manifest["images"]:
            if not img["has_gt"]:
                continue

            gt_path = gt_dir / os.path.basename(img["gt_coco_path"])
            if gt_path.exists():
                try:
                    with open(gt_path, "r") as f:
                        coco_data = json.load(f)
                    annotations.append(
                        {
                            "file_name": img["file_name"],
                            "coco_data": coco_data,
                        }
                    )
                except Exception as e:
                    logger.warning(f"Failed to load GT for {img['file_name']}: {e}")

        return annotations

    def get_gt_for_image(
        self, test_set_id: str, image_filename: str
    ) -> Optional[Dict[str, Any]]:
        """Get ground truth annotation for a specific image"""
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            return None

        test_set_dir = self.test_sets_dir / test_set_id
        gt_dir = test_set_dir / "gt"

        for img in manifest["images"]:
            if img["file_name"] == image_filename and img["has_gt"]:
                gt_path = gt_dir / os.path.basename(img["gt_coco_path"])
                if gt_path.exists():
                    try:
                        with open(gt_path, "r") as f:
                            return json.load(f)
                    except Exception:
                        pass

        return None

    def delete_test_set(self, test_set_id: str) -> bool:
        """Delete a test set and all its data"""
        test_set_dir = self.test_sets_dir / test_set_id
        if not test_set_dir.exists():
            return False

        try:
            shutil.rmtree(test_set_dir)
            logger.info(f"Deleted test set: {test_set_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete test set {test_set_id}: {e}")
            return False

    def refresh_gt(self, test_set_id: str, image_filename: str) -> Dict[str, Any]:
        """
        Refresh ground truth for a specific image

        Use this when GT has been updated and you want to re-freeze it
        """
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            raise ValueError(f"Test set not found: {test_set_id}")

        test_set_dir = self.test_sets_dir / test_set_id
        gt_dir = test_set_dir / "gt"

        # Find the image entry
        for img in manifest["images"]:
            if img["file_name"] == image_filename:
                base_name = os.path.splitext(image_filename)[0]
                coco_filename = f"{base_name}_coco.json"
                src_coco_path = self.annotations_dir / coco_filename
                dst_coco_path = gt_dir / coco_filename

                if src_coco_path.exists():
                    with open(src_coco_path, "r") as f:
                        coco_data = json.load(f)

                    with open(dst_coco_path, "w", encoding="utf-8") as f:
                        json.dump(coco_data, f, indent=2, ensure_ascii=False)

                    img["has_gt"] = True
                    img["annotation_count"] = len(coco_data.get("annotations", []))

                    # Update statistics
                    manifest["statistics"]["images_with_gt"] = sum(
                        1 for i in manifest["images"] if i["has_gt"]
                    )
                    manifest["statistics"]["images_missing_gt"] = (
                        manifest["statistics"]["total_images"]
                        - manifest["statistics"]["images_with_gt"]
                    )
                    manifest["statistics"]["total_annotations"] = sum(
                        i["annotation_count"] for i in manifest["images"]
                    )
                    manifest["updated_at"] = datetime.now().isoformat()

                    manifest_path = test_set_dir / "manifest.json"
                    self._atomic_write(manifest_path, manifest)

                    logger.info(
                        f"Refreshed GT for {image_filename} in test set {test_set_id}"
                    )
                    return manifest
                else:
                    raise ValueError(f"No annotation found for {image_filename}")

        raise ValueError(f"Image {image_filename} not in test set {test_set_id}")

    def _atomic_write(self, path: Path, data: Dict[str, Any]):
        """Write file atomically using temp file + rename"""
        temp_path = path.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)

    def create_random_test_set(
        self,
        count: int = 40,
        test_set_id: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        exclude_unlabeled: bool = False,
    ) -> Dict[str, Any]:
        """
        Create a test set with randomly selected images
        """
        import random

        all_images = []
        if self.images_dir.exists():
            for f in self.images_dir.iterdir():
                if f.is_file() and f.suffix.lower() in [
                    ".jpg",
                    ".jpeg",
                    ".png",
                    ".webp",
                ]:
                    all_images.append(f.name)

        if exclude_unlabeled:
            labeled_images = []
            for img in all_images:
                base_name = os.path.splitext(img)[0]
                coco_path = self.annotations_dir / f"{base_name}_coco.json"
                if coco_path.exists():
                    labeled_images.append(img)
            all_images = labeled_images

        if len(all_images) < count:
            raise ValueError(
                f"Not enough images: {len(all_images)} available, {count} requested"
            )

        selected = random.sample(all_images, count)

        return self.create_test_set(
            test_set_id=test_set_id,
            name=name or f"Random Test Set ({count} images)",
            description=description
            or f"Randomly selected {count} images for evaluation",
            image_filenames=selected,
        )

    def get_test_set_image_filenames(self, test_set_id: str) -> List[str]:
        """Get list of image filenames in a test set"""
        manifest = self.get_test_set(test_set_id)
        if not manifest:
            return []
        return [img["file_name"] for img in manifest.get("images", [])]

    def is_test_set_image(self, image_filename: str) -> Optional[str]:
        """Check if an image is part of any test set, return test_set_id if found"""
        for test_set_dir in self.test_sets_dir.iterdir():
            if test_set_dir.is_dir():
                manifest = self.get_test_set(test_set_dir.name)
                if manifest:
                    for img in manifest.get("images", []):
                        if img["file_name"] == image_filename:
                            return manifest["test_set_id"]
        return None


# Singleton instance
_test_set_instance = None


def get_test_set_service(
    test_sets_dir: Optional[str] = None,
    annotations_dir: Optional[str] = None,
    images_dir: Optional[str] = None,
) -> TestSetService:
    """Get test set service singleton"""
    global _test_set_instance
    if _test_set_instance is None:
        _test_set_instance = TestSetService(test_sets_dir, annotations_dir, images_dir)
    return _test_set_instance


def reset_test_set_service():
    """Reset service (for testing)"""
    global _test_set_instance
    _test_set_instance = None
