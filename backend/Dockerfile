# syntax=docker/dockerfile:1.6
#
# HILIPS backend — FastAPI + PyTorch + SAM2 + YOLOv8
#
# Uses an official PyTorch image so CUDA 11.8 and cuDNN are ready out of
# the box. The image also works on CPU-only hosts; SAM2 / YOLO will fall
# back to CPU automatically but inference will be much slower.
#
# Build:
#   docker build -t hilips-backend ./backend
#
# Run (GPU):
#   docker run --gpus all --rm -p 8000:8000 \
#     -e GEMINI_API_KEY=$GEMINI_API_KEY \
#     -v "$PWD/backend/checkpoints:/app/checkpoints" \
#     -v "$PWD/backend/annotations:/app/annotations" \
#     -v "$PWD/backend/images:/app/images" \
#     hilips-backend
#
# Run (CPU):
#   docker run --rm -p 8000:8000 -e GEMINI_API_KEY=... hilips-backend

FROM pytorch/pytorch:2.3.0-cuda11.8-cudnn8-runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HILIPS_HOST=0.0.0.0 \
    HILIPS_PORT=8000

WORKDIR /app

# System dependencies for OpenCV and image I/O
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        libgl1 \
        libglib2.0-0 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first for better layer caching
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the rest of the backend
COPY . .

# SAM2 weights are mounted at runtime; placeholder so the path exists
RUN mkdir -p /app/checkpoints /app/annotations /app/images /app/trained_models /app/training_datasets

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
