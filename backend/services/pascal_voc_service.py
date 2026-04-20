"""
Pascal VOC export service.

Converts HILIPS COCO-format annotations to Pascal VOC XML (one XML per
image). Satisfies the multi-format export requirement from the paper
(Section 2.2, Table 4: Support for COCO, YOLO, and Pascal VOC formats).

Pascal VOC XML layout:

    <annotation>
      <folder>images</folder>
      <filename>1_on.jpg</filename>
      <size>
        <width>1920</width>
        <height>1080</height>
        <depth>3</depth>
      </size>
      <object>
        <name>DOOR</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
          <xmin>100</xmin>
          <ymin>200</ymin>
          <xmax>150</xmax>
          <ymax>250</ymax>
        </bndbox>
      </object>
      ...
    </annotation>
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom import minidom

logger = logging.getLogger(__name__)


def _prettify(element: Element) -> str:
    """Return a human-readable XML string for *element*."""
    rough = tostring(element, encoding="utf-8")
    reparsed = minidom.parseString(rough)
    return reparsed.toprettyxml(indent="  ")


def coco_to_voc_xml(
    coco: Dict[str, Any],
    image_filename: str,
    folder: str = "images",
    image_width: Optional[int] = None,
    image_height: Optional[int] = None,
) -> str:
    """
    Convert a single-image COCO dict to a Pascal VOC XML string.

    Args:
        coco: COCO-style dict with ``annotations`` (or ``images`` + ``annotations``
            for a full-dataset COCO file for a single image).
        image_filename: basename to record in <filename> (e.g. ``1_on.jpg``).
        folder: value for the <folder> element.
        image_width: optional override when the COCO dict does not carry size info.
        image_height: optional override when the COCO dict does not carry size info.

    Returns:
        Pretty-printed Pascal VOC XML as a string.
    """
    annotation_root = Element("annotation")

    SubElement(annotation_root, "folder").text = folder
    SubElement(annotation_root, "filename").text = image_filename

    # Resolve width/height: prefer explicit args, otherwise look inside the
    # HILIPS single-image COCO dict, otherwise fall back to the full-dataset
    # COCO layout (``images`` list).
    width = image_width
    height = image_height
    if width is None or height is None:
        image_meta = coco.get("image") or {}
        if isinstance(coco.get("images"), list) and coco["images"]:
            image_meta = coco["images"][0]
        width = width or image_meta.get("width")
        height = height or image_meta.get("height")

    size_el = SubElement(annotation_root, "size")
    SubElement(size_el, "width").text = str(int(width)) if width else "0"
    SubElement(size_el, "height").text = str(int(height)) if height else "0"
    SubElement(size_el, "depth").text = "3"

    SubElement(annotation_root, "segmented").text = "0"

    categories_by_id: Dict[int, str] = {}
    if isinstance(coco.get("categories"), list):
        for cat in coco["categories"]:
            cat_id = cat.get("id")
            name = cat.get("name")
            if cat_id is not None and name:
                categories_by_id[int(cat_id)] = str(name)

    for ann in coco.get("annotations", []):
        bbox = ann.get("bbox")
        if not bbox or len(bbox) < 4:
            continue

        x, y, w, h = bbox[:4]
        if w <= 0 or h <= 0:
            continue

        # Prefer an explicit category name (HILIPS single-image layout), fall
        # back to the COCO ``category_id`` → ``categories`` lookup.
        name = ann.get("category") or ann.get("category_name")
        if not name:
            cat_id = ann.get("category_id")
            if cat_id is not None:
                name = categories_by_id.get(int(cat_id), f"class_{cat_id}")
        if not name:
            name = "object"

        obj_el = SubElement(annotation_root, "object")
        SubElement(obj_el, "name").text = str(name)
        SubElement(obj_el, "pose").text = "Unspecified"
        SubElement(obj_el, "truncated").text = "0"
        SubElement(obj_el, "difficult").text = "0"

        bbox_el = SubElement(obj_el, "bndbox")
        SubElement(bbox_el, "xmin").text = str(int(round(x)))
        SubElement(bbox_el, "ymin").text = str(int(round(y)))
        SubElement(bbox_el, "xmax").text = str(int(round(x + w)))
        SubElement(bbox_el, "ymax").text = str(int(round(y + h)))

    return _prettify(annotation_root)


def convert_coco_file_to_voc(coco_path: str, output_dir: str) -> str:
    """Convert a single HILIPS COCO JSON file to a Pascal VOC XML file on disk."""
    coco_path_obj = Path(coco_path)
    if not coco_path_obj.exists():
        raise FileNotFoundError(f"COCO annotation not found: {coco_path}")

    with coco_path_obj.open("r") as fh:
        coco = json.load(fh)

    # HILIPS single-image COCO file pattern: "<base>_coco.json" for "<base>.jpg"
    base = coco_path_obj.stem.removesuffix("_coco")

    # Try the common image extensions to find the matching filename.
    image_filename = f"{base}.jpg"
    for ext in (".jpg", ".jpeg", ".png", ".bmp"):
        candidate = f"{base}{ext}"
        if (coco_path_obj.parent.parent / "images" / candidate).exists():
            image_filename = candidate
            break

    xml_text = coco_to_voc_xml(coco, image_filename=image_filename)

    output_dir_path = Path(output_dir)
    output_dir_path.mkdir(parents=True, exist_ok=True)
    output_path = output_dir_path / f"{base}.xml"

    with output_path.open("w", encoding="utf-8") as fh:
        fh.write(xml_text)

    logger.info("Wrote Pascal VOC XML: %s", output_path)
    return str(output_path)


def zip_voc_export(coco_paths: Iterable[str]) -> bytes:
    """
    Bundle several COCO-to-VOC conversions into a single ZIP archive in memory.

    Useful for the HTTP endpoint so clients receive a single download.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for coco_path in coco_paths:
            coco_path_obj = Path(coco_path)
            if not coco_path_obj.exists():
                logger.warning("Skipping missing COCO file: %s", coco_path)
                continue

            with coco_path_obj.open("r") as fh:
                coco = json.load(fh)

            base = coco_path_obj.stem.removesuffix("_coco")
            image_filename = f"{base}.jpg"
            xml_text = coco_to_voc_xml(coco, image_filename=image_filename)
            zf.writestr(f"{base}.xml", xml_text)

    buffer.seek(0)
    return buffer.getvalue()


def list_coco_files(annotations_dir: str) -> List[str]:
    """Return every ``*_coco.json`` file in ``annotations_dir`` (recursive)."""
    root = Path(annotations_dir)
    if not root.exists():
        return []
    return sorted(str(p) for p in root.rglob("*_coco.json"))
