"""
Image management API endpoints
"""
import os
import logging

from fastapi import APIRouter, UploadFile, File, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse

from config import IMAGES_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["images"])


@router.get("/images")
async def get_image_list():
    """Return list of jpeg files in images folder"""
    if not os.path.isdir(IMAGES_DIR):
        return JSONResponse(content={"error": f"'{IMAGES_DIR}' folder not found."}, status_code=404)
    try:
        files = os.listdir(IMAGES_DIR)
        image_files = sorted([f for f in files if f.lower().endswith(('.jpeg', '.jpg', '.png'))])
        return JSONResponse(content=image_files)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """Upload image and save to images folder"""
    logger.info(f"Image upload request: {file.filename}")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files can be uploaded.")

    if not os.path.exists(IMAGES_DIR):
        os.makedirs(IMAGES_DIR)

    try:
        new_filename = file.filename
        image_path = os.path.join(IMAGES_DIR, new_filename)

        image_data = await file.read()
        with open(image_path, "wb") as f:
            f.write(image_data)

        logger.info(f"Image saved successfully: {image_path}")

        return JSONResponse(content={
            "message": "Image uploaded successfully.",
            "original_filename": file.filename,
            "saved_filename": new_filename,
            "file_path": image_path
        })
    except Exception as e:
        logger.error(f"Image upload error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image upload error: {str(e)}")


# Separate router for serving images (without /api prefix)
images_file_router = APIRouter(tags=["images"])


@images_file_router.get("/images/{filename}")
async def get_image_file(filename: str):
    """Return image file from images folder"""
    image_path = os.path.join(IMAGES_DIR, filename)
    if not os.path.isfile(image_path):
        return Response(content=f"Image '{filename}' not found.", status_code=404)
    return FileResponse(image_path)
