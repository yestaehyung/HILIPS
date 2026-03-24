# 2.2 Software Functionalities

HILIPS(Human-In-the-Loop Image Processing System)의 레이블링 파이프라인은 **Cold-start Labeling**, **Knowledge Distillation**, **Iterative Refinement**의 세 단계로 구성된다.

---

## 2.2.1 Cold-start Labeling (Phase 1)

레이블이 전혀 없는 초기 상태에서 고품질 annotation을 생성하는 단계이다.

### 파이프라인 흐름

1. **이미지 업로드**: 사용자가 레이블링할 이미지를 시스템에 업로드
2. **LLM 객체 탐지**: Gemini LLM이 이미지를 분석하여 객체의 bounding box와 semantic label 반환
3. **SAM2 세그멘테이션**: LLM이 반환한 bounding box를 SAM2의 box prompt로 변환하여 정밀한 segmentation mask 생성
4. **Annotation 생성**: label + mask를 결합하여 COCO 형식의 annotation 생성
5. **사용자 검토/수정**: 생성된 annotation을 사용자가 검토하고 필요시 수정

### 주요 구현

- `backend/services/llm_sam_pipeline.py`: Gemini + SAM2 통합 파이프라인
- `backend/routers/coldstart.py`: Cold-start API 엔드포인트
- `backend/routers/segmentation.py`: SAM2 point/box prompt 기반 세그멘테이션

### 사용자 인터랙션

- **Gemini Auto-label**: 이미지 전체를 LLM이 분석하여 자동 레이블링
- **Point-based SAM**: 사용자가 클릭한 포인트 기반으로 SAM2가 마스크 생성
- **Manual Drawing**: 사용자가 직접 폴리곤을 그려서 annotation 생성

---

## 2.2.2 Knowledge Distillation (Phase 2)

Cold-start에서 생성된 annotation 데이터를 활용하여 경량 모델(YOLOv8)을 학습하는 단계이다.

### 목적

LLM + SAM2 조합은 높은 품질의 annotation을 생성하지만, 추론 속도가 느리고 비용이 높다. Knowledge Distillation을 통해 이 지식을 경량 모델로 증류하여 실시간 추론이 가능하게 한다.

### 파이프라인 흐름

1. **데이터셋 준비**: COCO 형식 annotation을 YOLO 학습용 포맷으로 변환
2. **YOLOv8 학습**: 선택된 annotation 파일들로 YOLOv8 모델 학습
3. **성능 검증**: mAP@0.7 기준으로 모델 성능 평가
4. **모델 저장**: 학습 완료된 모델을 Model Registry에 등록

### 주요 구현

- `backend/routers/training.py`: YOLO 학습 API 엔드포인트
- `backend/services/yolo_service.py`: YOLO 데이터셋 생성 및 학습 로직
- `backend/services/model_registry.py`: 학습된 모델 관리

### 성능 기준

- **mAP@0.7 ≥ 0.7**: 프로덕션 배포 가능 기준
- 학습 진행 상황 실시간 모니터링 (epoch, loss, metrics)
- GPU 메모리 관리 (SAM2 자동 언로드)

---

## 2.2.3 Iterative Refinement (Phase 3)

학습된 YOLO 모델을 활용하여 새로운 이미지에 대해 자동 레이블링하고, 품질이 낮은 예측은 사용자가 검토하는 순환 구조이다.

### 핵심 개념: Confidence-based Classification

모델의 예측 결과를 confidence score에 따라 분류:

| Confidence | 분류 | 처리 |
|------------|------|------|
| ≥ 0.8 | High | 자동 레이블링 (Auto-label) |
| 0.5 ~ 0.8 | Medium | 사용자 검토 권장 |
| < 0.5 | Low | 반드시 사용자 검토 필요 |

### 파이프라인 흐름

1. **Batch Inference**: 학습된 YOLO 모델로 미레이블 이미지에 대해 추론
2. **Confidence 분석**: 각 detection의 confidence score 분석
3. **자동 분류**:
   - High confidence → 자동으로 annotation 저장
   - Low confidence → `review_queue.json`에 추가
4. **사용자 검토**: 사용자가 review queue의 이미지를 검토/수정
5. **데이터 축적**: 검토 완료된 데이터가 `review_history.json`에 기록
6. **재학습 트리거**: 충분한 데이터가 축적되면 Phase 2로 돌아가 재학습

### 주요 구현

- `backend/services/active_learning.py`: Confidence 기반 분류 및 큐 관리
- `backend/routers/active_learning.py`: Review queue API 엔드포인트
- `backend/routers/models.py`: Batch inference 및 labeling status API

### 순환 구조 (Iteration)

```
Phase 2 (Distillation) → Phase 3 (Refinement) → Phase 2 (재학습) → ...
```

- **Iteration**: 위 순환이 한 바퀴 도는 것
- 모델이 개선됨에 따라 자동 레이블링의 정확도가 향상되고, 사용자가 직접 개입해야 하는 객체의 수가 감소

---

## 데이터 흐름 요약

```
[이미지 업로드]
       ↓
[Phase 1: Cold-start]
  - Gemini LLM → bounding box + label
  - SAM2 → segmentation mask
  - 사용자 검토/수정
       ↓
[Phase 2: Distillation]
  - COCO → YOLO 포맷 변환
  - YOLOv8 학습
  - mAP@0.7 검증
       ↓
[Phase 3: Refinement]
  - YOLO batch inference
  - Confidence ≥ 0.8 → Auto-label
  - Confidence < 0.8 → Review Queue
  - 사용자 검토 완료
       ↓
[충분한 데이터 축적 시 Phase 2로 복귀]
```

---

## 사용자 시나리오

### Scenario 1: 초기 레이블링 (Cold-start)

```
1. 사용자가 /upload 페이지에서 레이블링할 이미지들을 업로드한다
2. /gallery 페이지로 이동하여 이미지를 선택한다
3. 레이블링 워크스페이스에서:
   - "Gemini Auto-label" 버튼 클릭 → LLM이 자동으로 객체 탐지 및 세그멘테이션
   - 또는 이미지 위를 클릭하여 Point-based SAM으로 개별 객체 선택
   - 또는 Manual Drawing으로 직접 폴리곤 그리기
4. 생성된 annotation을 검토하고, 잘못된 부분은 수정/삭제한다
5. "Save" 버튼으로 annotation을 저장한다
6. 다음 이미지로 이동하여 반복한다
```

### Scenario 2: 모델 학습 (Knowledge Distillation)

```
1. 충분한 이미지에 레이블링을 완료한 후, /training 페이지로 이동한다
2. 학습에 사용할 annotation 파일들을 선택한다
3. 학습 파라미터를 설정한다 (epochs, batch size, image size)
4. "Start Training" 버튼을 클릭하여 YOLOv8 학습을 시작한다
5. /training/monitor 페이지에서 학습 진행 상황을 모니터링한다
6. 학습 완료 후 mAP@0.7 성능을 확인한다
7. 학습된 모델은 자동으로 Model Registry에 등록된다
```

### Scenario 3: 자동 레이블링 및 검토 (Iterative Refinement)

```
1. 학습된 모델이 있는 상태에서, /gallery 페이지로 이동한다
2. "Batch Auto-label" 버튼을 클릭한다
3. 사용할 모델과 confidence threshold를 선택한다
4. 미레이블 이미지들에 대해 자동 추론이 실행된다:
   - Confidence ≥ 0.8: 자동으로 annotation 저장
   - Confidence < 0.8: "Needs Review"로 마킹
5. 필터에서 "Needs Review"를 선택하여 검토가 필요한 이미지들을 확인한다
6. 각 이미지를 열어 annotation을 검토/수정하고 저장한다
7. 검토 완료 후, Pipeline 페이지에서 "Train New Model" 버튼을 클릭한다
8. 새로운 iteration이 시작되고, 추가된 데이터로 모델을 재학습한다
```

### Scenario 4: 순환 학습 (Iteration Cycle)

```
[Iteration 0]
  - 50장 이미지 Cold-start 레이블링 완료
  - 첫 YOLO 모델 학습 (mAP@0.7: 0.65)

[Iteration 1]
  - 100장 추가 이미지 업로드
  - Batch inference 실행 → 70장 auto-label, 30장 needs review
  - 30장 검토 완료
  - 재학습 (mAP@0.7: 0.75) ✓ 기준 달성

[Iteration 2]
  - 200장 추가 이미지 업로드
  - Batch inference 실행 → 180장 auto-label, 20장 needs review
  - 모델 개선으로 수동 검토 필요 이미지 감소
  - 재학습 (mAP@0.7: 0.82)
```

---

## 주요 파일 구조

```
backend/
├── services/
│   ├── llm_sam_pipeline.py    # Cold-start: Gemini + SAM2
│   ├── active_learning.py     # Iterative Refinement: Confidence 분류
│   ├── yolo_service.py        # Distillation: YOLO 학습
│   ├── workflow_state.py      # Phase/Iteration 상태 관리
│   └── model_registry.py      # 학습된 모델 관리
├── routers/
│   ├── coldstart.py           # Phase 1 API
│   ├── training.py            # Phase 2 API
│   ├── active_learning.py     # Phase 3 API
│   ├── models.py              # 모델 추론/배치 API
│   └── workflow.py            # 워크플로우 상태 API
└── models/
    └── sam2_loader.py         # SAM2 모델 로더

keti-labeling/
├── app/
│   ├── page.tsx               # Pipeline 대시보드
│   ├── gallery/page.tsx       # 이미지 갤러리/레이블링
│   └── training/page.tsx      # 학습 설정/모니터링
└── components/
    └── labeling-workspace.tsx # 레이블링 워크스페이스
```
