# HILIPS API Server

논문 3단계 방법론 구현:
- **Phase 1**: Cold-start Labeling (LLM + SAM2)
- **Phase 2**: Knowledge Distillation (YOLOv8)
- **Phase 3**: Iterative Refinement (Active Learning)

## 폴더 구조

```
backend/
├── services/
│   ├── llm_sam_pipeline.py       # Phase 1: LLM+SAM2 통합 파이프라인
│   ├── model_registry.py          # Phase 2: mAP 0.7 검증 및 모델 버전 관리
│   ├── active_learning.py         # Phase 3: Active Learning 서비스
│   ├── workflow_scheduler.py       # 자동화 워크플로우 스케줄러
│   ├── yolo_service.py            # YOLOv8 학습 및 추론 (기존)
│   └── coco_service.py            # COCO format 변환 (기존)
├── routers/
│   ├── coldstart.py             # Phase 1: Cold-start Labeling API
│   ├── segmentation.py           # SAM2 segmentation (기존)
│   ├── training.py              # YOLOv8 학습 (기존)
│   ├── models.py               # 모델 관리 (기존)
│   ├── human_in_loop.py        # Human-in-the-Loop (기존)
│   ├── evaluation.py           # 모델 평가 (기존)
│   ├── annotations.py          # 어노테이션 관리 (기존)
│   └── images.py               # 이미지 관리 (기존)
├── sam2/                     # SAM2 패키지
│   ├── sam2_image_predictor.py
│   └── automatic_mask_generator.py
├── models/
│   └── sam2_loader.py          # SAM2 모델 로더
├── annotations/               # COCO format annotation 저장소
├── images/                   # 업로드 이미지 저장소
├── trained_models/           # 학습 완료된 모델 저장소
├── training_datasets/        # 학습용 데이터셋 저장소
├── main.py                    # FastAPI 메인 엔트리 포인트
└── config.py                  # 환경 설정
```

## 환경 설정

### 필수 환경 변수

```bash
# Gemini API Key (Phase 1: Cold-start Labeling)
export GEMINI_API_KEY="your-gemini-api-key-here"

# 모델 저장소 경로
export TRAINED_MODELS_DIR="trained_models"
export ANNOTATIONS_DIR="annotations"

# 학습 데이터셋 경로
export TRAINING_DATASETS_DIR="training_datasets"
```

## 설치

### 1. Python 패키지 설치

```bash
# PyTorch 설치 (CUDA 버전에 맞게)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# 나머지 패키지 설치
pip install -r requirements.txt
```

### 2. SAM2 모델 체크포인트 다운로드

```bash
cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

또는 [SAM2 공식 저장소](https://github.com/facebookresearch/sam2)에서 다운로드하세요.

## 실행

### 개발 서버 실행

```bash
# 개발 모드 (자동 리로드)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 프로덕션 실행
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

서버 실행 후 API 문서 확인: http://localhost:8000/docs

## API 엔드포인트

### Phase 1: Cold-start Labeling

#### 단일 이미지 처리

```bash
POST /api/coldstart/label
Content-Type: application/json

{
  "image_path": "images/test.jpg",
  "task_description": "이미지 내 모든 객체를 탐지하세요",
  "custom_prompt": null,  # 선택사항
  "save_intermediate": true
}
```

**응답:**
```json
{
  "success": true,
  "image_path": "images/test.jpg",
  "annotations": [
    {
      "id": "coldstart_0_123456",
      "label": "객체이름",
      "confidence": 0.95,
      "segmentation": [[x1, y1], [x2, y2], ...],
      "area": 15234,
      "bbox": [x1, y1, w, h],
      "source": "coldstart_llm_sam"
    }
  ],
  "llm_result": {
    "detections": [...],
    "image_description": "이미지 설명",
    "spatial_relationships": [...]
  },
  "statistics": {
    "total_detections": 5,
    "successful_segmentations": 5,
    "processing_time_seconds": 3.2
  }
}
```

#### 배치 처리

```bash
POST /api/coldstart/label/batch
Content-Type: application/json

{
  "image_paths": ["img1.jpg", "img2.jpg", "img3.jpg"],
  "task_description": "이미지 내 모든 객체를 탐지하세요",
  "parallel": true
}
```

### Phase 2: Knowledge Distillation

#### 모델 등록 (mAP 0.7 검증)

```bash
POST /api/models/register
Content-Type: application/json

{
  "model_id": "hilips_v1.0",
  "model_path": "runs/train/weights/best.pt",
  "metrics": {
    "map50": 0.85,
    "map50_95": 0.73,
    "map70": 0.723,  # 논문 기준: mAP@0.7 ≥ 0.7
    "precision": 0.89,
    "recall": 0.82,
    "f1": 0.855
  },
  "dataset_info": {
    "name": "custom_dataset",
    "num_images": 500,
    "annotations_per_image": 5.2
  },
  "config": {
    "epochs": 100,
    "batch_size": 16,
    "img_size": 640
  }
}
```

**상태 판정:**
- `mAP@0.7 ≥ 0.7`: → **Ready** (Knowledge Distillation 사용 가능)
- `mAP@0.7 < 0.7`: → **Needs Improvement** (재학습 필요)

#### 모델 프로덕션 승격

```bash
POST /api/models/promote
Content-Type: application/json

{
  "model_id": "hilips_v1.0"
}
```

#### 모델 목록 조회

```bash
GET /api/models
```

**응답:**
```json
{
  "models": [
    {
      "model_id": "hilips_v1.0",
      "status": "ready",  # ready, needs_improvement, production, archived
      "latest_version": 1,
      "metrics": {
        "map50": 0.85,
        "map70": 0.723
      }
    }
  ]
}
```

### Phase 3: Iterative Refinement

#### 검토 큐 (Needs Review) 조회

```bash
GET /api/active-learning/review-queue?limit=10&priority_filter=3
```

**응답:**
```json
{
  "queue": [
    {
      "image_path": "images/test.jpg",
      "confidence_analysis": {
        "total": 5,
        "auto_label_count": 3,
        "review_count": 2,
        "needs_review": true,
        "confidence_threshold": 0.8
      },
      "priority": 3
    }
  ]
}
```

#### 검토 완료 표시

```bash
POST /api/active-learning/review-queue/mark
Content-Type: application/json

{
  "image_path": "images/test.jpg",
  "revised_detections": [...],
  "reviewer": "human"
}
```

#### 재학습용 데이터셋 준비

```bash
GET /api/active-learning/prepare-dataset?min_quality_score=0.7
```

## 논문 3단계 상세 설명

### Phase 1: Cold-start Labeling

**논문 2.2.1:**
- 학습 데이터가 없는 초기 상황에서 멀티모달 LLM의 추론 능력과 SAM의 분할 능력을 결합
- 사용자 이미지 업로드 → LLM 이미지+태스크 설명 프롬프트 전달
- LLM: 이미지 내 객체 분석, bounding box 좌표 + 의미론적 레이블 반환
  - 시각적 특징 + 이미지 내 텍스트 정보(버튼 "START", "STOP" 등)
  - 객체 간 공간적 관계 고려
- LLM bounding box → SAM box prompt 변환
- SAM: 해당 영역에 정밀 segmentation mask 생성
- 최종: LLM 의미론적 레이블 + SAM mask 결합
- 사용자: 결과 검토, 레이블 수정, 누락된 객체 추가 가능
- 수정된 결과: 데이터베이스 저장 → Knowledge Distillation 학습 데이터로 활용

**구현 파일:**
- `services/llm_sam_pipeline.py`: 통합 파이프라인
  - `run_gemini_detection()`: Gemini 객체 탐지
  - `run_sam2_segmentation_from_boxes()`: SAM2 박스 기반 segmentation
  - `run_coldstart_labeling()`: 전체 파이프라인
- `routers/coldstart.py`: Cold-start Labeling API 엔드포인트

### Phase 2: Knowledge Distillation

**논문 2.2.2:**
- Cold-start Labeling 단계에서 생성된 데이터셋 활용
- 경량 모델(YOLOv8) 학습
- 목적: LLM 추론 결과를 실시간 실행 가능한 크기의 모델로 압축
- 학습 데이터: 이미지 + annotation(mask, bounding box, 레이블)
- LLM 생성 레이블을 ground truth로 사용
- 학습 완료: 검증 데이터셋에서 성능 평가
- 기준 성능(mAP 0.7 이상): 만족 시 다음 단계에서 사용 가능
- 모델 버전 및 성능 지표: 데이터베이스 기록 및 관리

**구현 파일:**
- `services/model_registry.py`: 모델 레지스트리
  - `register_model()`: 모델 등록 + mAP 0.7 검증
  - `promote_to_production()`: 프로덕션 승격
  - `evaluate_model()`: 정기적 재평가
- `services/yolo_service.py`: YOLOv8 학습 (기존)
  - `train_yolo_model_background()`: 백그라운드 학습
  - `convert_yolo_to_coco_format()`: 추론 결과 변환

### Phase 3: Iterative Refinement

**논문 2.2.3:**
- 학습된 경량 모델을 레이블링 파이프라인에 재투입
- 자동화 비율 높이기
- 새로운 이미지 입력: 경량 모델로 객체 탐지 및 분류
- Confidence score ≥ 0.8 (기본값): 자동으로 레이블링
- Confidence score < 0.8: 사용자 검토 대상 분류
- 사용자: 자동 레이블링 결과 확인, 검토 대상 객체만 수동 레이블
- Unseen object 발견: Cold-start Labeling 단계의 LLM 파이프라인 선택적 호출
- 축적된 데이터: 주기적으로 Knowledge Distillation 단계로 전달 → 모델 재학습
- 모델 개선: 자동 레이블링 정확도 향상, 사용자 개입 감소

**구현 파일:**
- `services/active_learning.py`: Active Learning 서비스
  - `classify_for_iterative_refinement()`: Confidence 기반 분류
  - `detect_unseen_objects()`: Unseen object 탐지
  - `prepare_distillation_dataset()`: 재학습용 데이터셋 준비
  - `get_review_queue()`: Needs Review 큐 조회
  - `mark_reviewed()`: 검토 완료 표시
- `services/workflow_scheduler.py`: 자동화 워크플로우
  - `auto_annotate`: 24시간마다 자동 레이블링
  - `distillation`: 주 1회 자동 재학습 트리거
  - `evaluation`: 6시간마다 정기적 평가

## 시스템 요구사항

- Python 3.8+
- CUDA 지원 GPU (권장)
- 최소 8GB GPU 메모리 (sam2.1_hiera_tiny 기준)
- Gemini API Key (Cold-start Labeling용)

## 사용법

### 1. 서버 시작

```bash
# 백엔드 서버 시작
cd backend
python main.py
```

### 2. 프론트엔드 시작

```bash
cd keti-labeling
npm run dev
```

### 3. 접속

- 프론트엔드: http://localhost:3000
- 백엔드 API 문서: http://localhost:8000/docs
- Pipeline Dashboard: http://localhost:3000/pipeline-status
- Model Registry: http://localhost:3000/models

## 주요 기능

### Cold-start Labeling
- ✅ Gemini 2.5 Flash API 통합
- ✅ SAM2 박스 기반 segmentation
- ✅ 단일/배치 이미지 처리
- ✅ 중간 결과 자동 저장
- ✅ 정규화 좌표 → 픽셀 좌표 자동 변환

### Knowledge Distillation
- ✅ mAP@0.7 자동 검증 및 상태 판정
- ✅ 모델 버전 관리 (version history)
- ✅ Ready / Needs Improvement / Production 상태 자동 판정
- ✅ 프로덕션 승격 기능
- ✅ 성능 이력 추적 (improvement 계산)

### Iterative Refinement
- ✅ Confidence 기반 자동 레이블링 (≥0.8)
- ✅ Needs Review 큐 우선순위화
- ✅ Unseen object 자동 탐지
- ✅ 재학습용 데이터셋 자동 준비
- ✅ 24시간마다 auto-annotate
- ✅ 주 1회마다 자동 재학습 트리거

## 참고

- [논문 원본](https://arxiv.org/abs/xxxx.xxxx) (해당 논문 링크)
- [SAM2 공식 저장소](https://github.com/facebookresearch/sam2)
- [YOLOv8 공식 문서](https://docs.ultralytics.com/)
- [Gemini API 문서](https://ai.google.dev/gemini-api/docs)
