# HILIPS Labeling Guide

This document explains how participants can use the HILIPS web application to perform image labeling.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Uploading Images](#2-uploading-images)
3. [Selecting Images in the Gallery](#3-selecting-images-in-the-gallery)
4. [Using the Labeling Workspace](#4-using-the-labeling-workspace)
5. [Labeling Methods](#5-labeling-methods)
6. [Editing and Modifying Annotations](#6-editing-and-modifying-annotations)
7. [Saving and Exporting](#7-saving-and-exporting)
8. [Handling Images That Need Review](#8-handling-images-that-need-review)
9. [Frequently Asked Questions](#9-frequently-asked-questions)

---

## 1. Getting Started

### 1.1 Accessing the Web Application

Open the provided URL in a web browser:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`

### 1.2 Main Screen Layout

The main page (Pipeline dashboard) shows the current labeling progress:

| Menu | Description |
|------|-------------|
| **Pipeline** (/) | Overall workflow status dashboard |
| **Gallery** (/gallery) | Image gallery and labeling workspace |
| **Upload** (/upload) | Upload images and class files |
| **Training** (/training) | Model training (for administrators) |
| **Models** (/models) | List of trained models (for administrators) |

---

## 2. Uploading Images

### 2.1 Accessing the Upload Page

Navigate to **Upload** in the top menu or visit `/upload`.

### 2.2 How to Upload Images

1. **Drag and drop**: Drag image files onto the upload area.
2. **Click to select**: Click the upload area and pick images from the file explorer.

### 2.3 Supported File Formats

- **Images**: JPG, JPEG, PNG, BMP, WEBP
- **Multiple images** can be uploaded at once

### 2.4 Uploading a Class Definition File (Optional)

You may upload a text file listing the classes to be used for labeling:
```
person
car
dog
cat
...
```

---

## 3. Selecting Images in the Gallery

### 3.1 Accessing the Gallery Page

Navigate to **Gallery** in the top menu or visit `/gallery`.

### 3.2 Filtering Images

Use the filter tabs at the top of the gallery to categorize images:

| Filter | Description |
|--------|-------------|
| **All Images** | Show every image |
| **Labeled** | Images that have been labeled |
| **Unlabeled** | Images that have not yet been labeled |
| **Needs Review** | Images flagged for review (low-confidence auto-labels) |

### 3.3 Selecting an Image

**Click** an image to label; the labeling workspace opens on the right.

---

## 4. Using the Labeling Workspace

### 4.1 Workspace Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Toolbar]                                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                         ││
│  │                    Image Canvas                         ││
│  │          (masks / polygons overlaid)                    ││
│  │                                                         ││
│  └─────────────────────────────────────────────────────────┘│
│  [Annotation list]                        [Class list]      │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Toolbar Buttons

| Button | Function | Description |
|--------|----------|-------------|
| **HILIPS** | AI auto-labeling | Fully automatic labeling using Gemini LLM + SAM2 |
| **SAM v2** | Click-based segmentation | Click an object and a mask is generated automatically |
| **Manual** | Manual polygon | Click points to define the region manually |
| **Zoom In/Out** | Zoom in/out | Zoom the image in or out |
| **Pan** | Pan | Move around a zoomed-in image |
| **Undo/Redo** | Undo / redo | Undo or redo an action |

### 4.3 Zoom and Pan

- **Mouse wheel**: Zoom in / out
- **Mouse drag** (Pan mode): Move the image
- **Zoom buttons**: Use the +/- buttons in the toolbar

---

## 5. Labeling Methods

### 5.1 HILIPS Auto-labeling (Recommended)

This is the fastest and most efficient method.

**How to use:**
1. Click the **HILIPS** button in the toolbar.
2. The AI analyzes the image automatically:
   - **Gemini LLM**: Detects objects and identifies classes
   - **SAM2**: Generates precise segmentation masks
3. The generated annotations are overlaid on the image.
4. Review the results and edit them as needed.

**Confidence Score:**
- Each annotation has a confidence score.
- **≥ 0.8**: High confidence (green)
- **0.5 – 0.8**: Medium confidence (yellow) — review recommended
- **< 0.5**: Low confidence (red) — review required

---

### 5.2 SAM v2 Click-based Segmentation

Use this when you want to segment a specific object precisely.

**How to use:**
1. Click the **SAM v2** button in the toolbar.
2. **Click inside** the object you want to segment.
3. SAM2 generates an object mask based on the click location.
4. **Select a class** from the class list on the right.
5. Refine the mask with additional clicks if needed:
   - **Left click**: Add a region to the mask
   - **Right click**: Exclude a region from the mask

**Tips:**
- Clicking near the center of the object yields more accurate results.
- Multiple clicks let you fine-tune the mask.

---

### 5.3 Manual Polygon Drawing

Use this when the AI fails to recognize an object or when precise manual labeling is needed.

**How to use:**
1. Click the **Manual** button in the toolbar.
2. **Click points** along the object boundary to draw a polygon.
3. Close the polygon by **clicking the first point again** or pressing **Enter**.
4. **Select a class** from the class list on the right.

**Editing polygons:**
- **Move a point**: Drag a polygon vertex to reposition it
- **Add a point**: Double-click a polygon edge
- **Delete a point**: Select the point and press Delete

---

## 6. Editing and Modifying Annotations

### 6.1 Selecting an Annotation

- **Click on the canvas**: Click a mask/polygon on the image to select it
- **Click in the annotation list**: Select from the list in the lower left

### 6.2 Changing the Class

1. Select the annotation you want to change.
2. Click a new class in the class list on the right.

### 6.3 Deleting an Annotation

1. Select the annotation you want to delete.
2. Press **Delete** or click the **trash icon** in the annotation list.

### 6.4 Editing Annotation Properties

The annotation list lets you inspect and edit each annotation's properties:
- **Class name**
- **Confidence score** (for auto-labeling)
- **Area size**

---

## 7. Saving and Exporting

### 7.1 Saving

Be sure to save once you finish labeling.

**How to save:**
1. Click the **Save** button in the toolbar.
2. Or use the keyboard shortcut **Ctrl + S** (Windows) / **Cmd + S** (Mac).

### 7.2 Save Format

Annotations are saved in **COCO format**:
```json
{
  "image_id": "image_001",
  "annotations": [
    {
      "id": 1,
      "category": "person",
      "segmentation": [[x1, y1, x2, y2, ...]],
      "bbox": [x, y, width, height],
      "area": 12345,
      "confidence": 0.95
    }
  ]
}
```

### 7.3 Auto-save

- The system periodically auto-saves your work.
- Your work is preserved even if you close the browser.

---

## 8. Handling Images That Need Review

### 8.1 Using the Needs Review Filter

After batch auto-labeling, images with low confidence are automatically classified as "Needs Review".

**Review process:**
1. Click the **Needs Review** filter tab in the gallery.
2. A list of images that need review is shown.
3. Click each image to inspect the annotations.
4. Edit them as needed:
   - Incorrect class → change to the correct class
   - Inaccurate mask → adjust manually
   - Missing object → add a new annotation
   - Wrong annotation → delete it
5. Click **Save** once edits are complete.
6. The image automatically moves to "Labeled".

### 8.2 Priority

The review queue is sorted by the following priorities:
1. Images containing annotations with very low confidence
2. Images with an unusual (outlier) number of detections
3. Older images

---

## 9. Frequently Asked Questions

### Q1. I clicked the HILIPS button but nothing happens.
**A:** Check that the backend server is running, and that the image loaded correctly.

### Q2. SAM v2 clicks do not work.
**A:** Make sure SAM v2 mode is active. The button must be in its active (highlighted) state.

### Q3. My polygon has too many points. Can I simplify it?
**A:** Use as few points as possible while following the object boundary. Add more points only where the boundary is curved.

### Q4. I saved, but when I reopen the image the annotations are gone.
**A:** Make sure you saw the "Save complete" message after clicking Save. A network error may have occurred.

### Q5. I'm not sure which class to pick.
**A:** Refer to the class definition document. When in doubt, pick the closest class and revise it later during review.

### Q6. I accidentally deleted an annotation.
**A:** Press **Ctrl + Z** (Windows) / **Cmd + Z** (Mac) to undo, or click the Undo button in the toolbar.

### Q7. The image is too dark to distinguish objects.
**A:** Use the zoom feature, or try a browser brightness-adjustment extension.

### Q8. A single image contains multiple objects of the same class.
**A:** Create a separate annotation for each object. Do not combine several objects into one annotation.

---

## Keyboard Shortcuts

| Shortcut | Function |
|----------|----------|
| **Ctrl/Cmd + S** | Save |
| **Ctrl/Cmd + Z** | Undo |
| **Ctrl/Cmd + Shift + Z** | Redo |
| **Delete** | Delete the selected annotation |
| **Enter** | Complete polygon (manual mode) |
| **Escape** | Cancel the current action |
| **+/-** or **mouse wheel** | Zoom in / out |
| **Space + drag** | Pan the image |

---

## Contact

If you run into problems or have questions during labeling, please contact the research team.

---

*This guide is part of the HILIPS (Hierarchical Labeling with Iterative Pseudo-Labeling System) project.*
