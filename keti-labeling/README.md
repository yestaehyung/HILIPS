# KETIlabel - HILIPS 프론트엔드

논문 3단계 방법론 구현:
- **Phase 1**: Cold-start Labeling (LLM + SAM2)
- **Phase 2**: Knowledge Distillation (YOLOv8)
- **Phase 3**: Iterative Refinement (Active Learning)

## 프로젝트 개요

KETIlabel은 HILIPS(Hierarchical Labeling with Iterative Pseudo-Labeling System) 방법론을 구현한 이미지 레이블링 웹 애플리케이션입니다.

### 주요 기능

- **Cold-start Labeling**: LLM(Gemini) + SAM2 통합 파이프라인으로 초기 레이블 자동 생성
- **Knowledge Distillation**: YOLOv8 기반 경량 모델 학습 및 mAP 0.7 기준 검증
- **Iterative Refinement**: Active Learning 기반 자동화 레이블링 및 검토 큐 관리

## 폴더 구조

```
keti-labeling/
├── app/
│   ├── page.tsx                          # 메인 페이지 (HILIPS terminology 적용)
│   ├── models/
│   │   └── page.tsx                  # 모델 레지스트리 (mAP 0.7 UI)
│   ├── pipeline-status/
│   │   └── page.tsx                  # 3단계 파이프라인 실시간 모니터링
│   ├── training/
│   │   ├── page.tsx                  # Knowledge Distillation 콘솔
│   │   └── monitor/
│   │       └── page.tsx              # 학습 세션 모니터링
│   └── page.tsx                          # 기존 페이지들
├── components/
│   ├── labeling-workspace.tsx          # 메인 레이블링 워크스페이스
│   ├── advanced-polygon-visualization.tsx  # 마스크/폴리곤 렌더링
│   ├── class-manager.tsx               # 클래스 관리
│   ├── image-gallery.tsx               # 이미지 갤러리
│   ├── image-gallery-filter.tsx          # Needs Review 필터 컴포넌트
│   ├── export-manager.tsx              # COCO format 내보내기
│   └── ui/                            # shadcn/ui 컴포넌트들
├── lib/
│   ├── api-config.ts                   # API 엔드포인트 설정 (HILIPS 3단계)
│   └── utils.ts                       # 유틸리티 함수
├── hooks/
│   ├── use-toast.ts                    # 토스트 알림 훅
│   └── use-mobile.tsx                  # 반응형 훅
├── public/                             # 정적 에셋
└── styles/                             # 전역 스타일
```

## 시작하기

### 1. 의존성 설치

```bash
# Node.js 18 이상 설치 확인
node --version

# pnpm 설치 (권장)
npm install -g pnpm

# 의존성 설치
pnpm install
```

### 2. 개발 서버 실행

```bash
# 개발 모드 (자동 리로드)
pnpm dev

# 프로덕션 빌드
pnpm build

# 프로덕션 시작
pnpm start
```

### 3. 접속

- 개발 서버: http://localhost:3000
- API 문서: http://localhost:8000/docs

## 페이지 설명

### 메인 페이지 (/)

HILIPS 3단계 방법론 기반 네비게이션입니다.

#### 탭 메뉴

1. **Dataset Gallery**: 이미지 업로드 및 갤러리
2. **Pipeline Status**: 3단계 파이프라인 실시간 모니터링
3. **Export Data**: COCO format 어노테이션 내보내기
4. **Upload Resources**: 이미지 및 클래스 설정 업로드
5. **Knowledge Distillation**: YOLOv8 학습 콘솔
6. **Model Registry**: 학습된 모델 버전 및 성능 관리

### Pipeline Status (/pipeline-status)

HILIPS 3단계 파이프라인의 실시간 상태를 모니터링합니다.

#### Phase 1: Cold-start Labeling
- **상태**: Active (LLM + SAM2 파이프라인 활성화)
- **LLM Model**: Gemini-2.5-flash
- **SAM2 Model**: SAM2-Hiera-T
- **기능**: 이미지 업로드 시 자동 객체 탐지 및 세그멘테이션
- **Confidence Threshold**: ≥ 0.3

#### Phase 2: Knowledge Distillation
- **상태**: Idle 또는 Production
- **현재 모델**: hilips_v1.0
- **mAP@0.7**: 0.781 (기준: ≥ 0.7)
- **기능**: YOLOv8 기반 경량 모델 학습
- **모델 버전**: v3 (history tracking)

#### Phase 3: Iterative Refinement
- **상태**: Active
- **Confidence Threshold**: < 0.8 (Needs Review), ≥ 0.8 (Auto-Label)
- **Review Queue**: 12 images
- **기능**: Active Learning 기반 자동화 워크플로우
- **Auto-Annotate**: 24시간마다 실행

### Model Registry (/models)

Knowledge Distillation으로 학습된 모델들의 버전 및 성능을 관리합니다.

#### 주요 기능
- **모델 목록**: 모든 학습된 모델 버전 테이블
- **mAP 0.7 시각화**: 
  - 🟢 Ready (mAP@0.7 ≥ 0.7)
  - 🟡 Needs Improvement (mAP@0.7 < 0.7)
  - 🔵 Production (현재 프로덕션에서 사용 중)
- **버전 이력**: 각 모델의 학습 횟수 및 성능 변화 추적
- **프로덕션 승격**: Ready 상태의 모델을 Production으로 승격
- **Quick Actions**:
  - Train New Model: 새로운 모델 학습
  - Export Registry: 모델 레지스트리 JSON 내보내기
  - Refresh: 최신 데이터 갱신

#### 성능 지표 표시
- **mAP@0.5**: IoU 0.5에서의 mean Average Precision
- **mAP@0.5:0.95**: IoU 0.5~0.95에서의 mean Average Precision
- **mAP@0.7**: IoU 0.7에서의 AP (논문 기준)
- **Precision**: 정밀도
- **Recall**: 재현율
- **F1 Score**: Precision과 Recall의 조화평균

### Knowledge Distillation (/training)

YOLOv8 기반 경량 모델 학습 콘솔입니다.

#### 기능
- **학습 데이터셋 선택**: Cold-start Labeling으로 생성된 어노테이션 파일들
- **학습 설정**: Epochs, Batch Size, Image Size 등 하이퍼파라미터 설정
- **실시간 모니터링**: 학습 progress, loss, mAP 추적
- **GPU 메모리 관리**: SAM2와 YOLO 모델 간 메모리 swap

### Labeling Workspace (/labeling-workspace)

메인 레이블링 워크스페이스입니다.

#### AI Tools
1. **Manual**: 수동 폴리곤 그리기
2. **SAM v2**: 클릭 기반 SAM2 segmentation
3. **SAM + LLM (HILIPS)**: LLM 텍스트 프롬프트 기반 segmentation
4. **HILIPS**: Cold-start Labeling 통합 파이프라인

#### 기능
- **이미지 렌더링**: Advanced Polygon Visualization으로 고성능 마스크 렌더링
- **클래스 관리**: Class Manager로 동적 클래스 정의
- **수동 폴리곤 그리기**: 마우스 클릭으로 포인트 추가
- **객체 선택 및 수정**: 폴리곤 선택, 클래스 할당, 삭제
- **마스크/폴리곤 전환**: SAM 마스크 ↔ 폴리곤 포맷 변환
- **수출/저장**: COCO format으로 서버 저장

### Image Gallery (/image-gallery)

이미지 갤러리 및 Needs Review 필터 기능입니다.

#### 기능
- **이미지 갤러리**: 그리드 뷰로 업로드된 이미지 표시
- **검색**: 파일명으로 필터링
- **정렬**: 이름 오름차순/내림차순
- **필터 탭**:
  - All Images: 모든 이미지
  - Labeled: 레이블링 완료된 이미지
  - Unlabeled: 레이블링 안 된 이미지
  - **Needs Review**: Confidence < 0.8인 객체가 포함된 이미지 (Iterative Refinement)
- **어노테이션 상태**: 이미지 별 레이블링 상태 표시 (Saved badge)

#### Needs Review 필터 논리
**논문 2.2.3**: Confidence score가 임계값(기본값 0.8) 미만인 객체는 사용자 검토 대상으로 분류

- **자동 레이블링**: Confidence ≥ 0.8인 객체 자동으로 레이블링
- **Needs Review**: Confidence < 0.8인 객체가 있는 이미지
- **우선순위화**: Confidence가 매우 낮은(<0.3), detection 수가 이상치인 이미지 우선 검토

## HILIPS 용어 적용

기존 "Training" 용어를 논문 기반 용어로 변경했습니다.

| 기존 용어 | HILIPS 용어 | 설명 |
|----------|------------|------|
| Training | Knowledge Distillation | YOLOv8 기반 경량 모델 학습 (논문 2.2.2) |
| Training Job | Distillation Job | 학습 작업 |
| Model Training | Student Model Training | 경량 모델 학습 |
| Training History | Distillation History | 학습 이력 |

## API 설정 (lib/api-config.ts)

HILIPS 3단계 모든 API 엔드포인트를 중앙 설정합니다.

### Phase 1 엔드포인트
```typescript
COLDSTART_LABEL: "/api/coldstart/label",
COLDSTART_BATCH: "/api/coldstart/label/batch",
COLDSTART_STATUS: "/api/coldstart/status",
```

### Phase 2 엔드포인트
```typescript
TRAIN_START: "/api/train-model",
TRAINING_STATUS: "/api/training/status",
TRAINING_JOBS: "/api/training/jobs",
MODELS_LIST: "/api/models",
MODELS_REGISTER: "/api/models/register",
MODELS_PROMOTE: "/api/models/promote",
MODELS_EVALUATE: "/api/models/evaluate",
```

### Phase 3 엔드포인트
```typescript
HIL_SESSIONS: "/api/hil/sessions",
HIL_SESSION_START: "/api/hil/sessions/start",
HIL_SESSION_COMPLETE: "/api/hil/sessions/complete",
REVIEW_QUEUE: "/api/active-learning/review-queue",
AUTO_LABEL_QUEUE: "/api/active-learning/auto-label-queue",
REVIEW_QUEUE_MARK: "/api/active-learning/review-queue/mark",
DISTILLATION_DATASET: "/api/active-learning/prepare-dataset",
```

### 기본 설정
```typescript
// Cold-start Labeling
COLDSTART_DEFAULTS: {
  confidence_threshold: 0.3,
  save_intermediate: true,
  task_description: "이미지 내 모든 객체를 탐지하세요",
}

// Active Learning
ACTIVE_LEARNING_DEFAULTS: {
  confidence_threshold: 0.8,  // 논문 기본값
  review_threshold: 0.5,
  auto_annotate_interval: 24,  // hours
}

// Knowledge Distillation
DISTILLATION_DEFAULTS: {
  map_threshold: 0.7,  // 논문 기준
  epochs: 100,
  batch_size: 16,
  img_size: 640,
}
```

## 환경 변수

```bash
# API 서버 주소
NEXT_PUBLIC_API_URL=http://localhost:8000

# (선택사항) 다른 포트 사용
# NEXT_PUBLIC_API_URL=http://your-backend-server:8000
```

## 브라우저 호환성

- Chrome/Edge: 최신 버전 (권장)
- Firefox: 최신 버전
- Safari: 최신 버전
- Mobile 지원: 반응형 UI (Tailwind CSS)

## 주요 기능 요약

### Cold-start Labeling (Phase 1)
- ✅ LLM(Gemini 2.5) 객체 탐지
- ✅ SAM2 정밀 segmentation
- ✅ Bounding box 자동 추출
- ✅ 의미론적 레이블 자동 생성
- ✅ 단일/배치 이미지 처리
- ✅ 사용자 검토/수정 인터페이스

### Knowledge Distillation (Phase 2)
- ✅ YOLOv8 학습 콘솔
- ✅ mAP@0.7 기준 시각화
- ✅ 모델 버전 관리
- ✅ Ready/Needs Improvement/Production 상태 판정
- ✅ 프로덕션 승격 기능
- ✅ 성능 이력 추적

### Iterative Refinement (Phase 3)
- ✅ Confidence 기반 자동 레이블링
- ✅ Needs Review 필터
- ✅ Active Learning 큐 관리
- ✅ 24시간마다 auto-annotate
- ✅ 주간 자동 재학습 트리거
- ✅ 실시간 파이프라인 상태 모니터링

## 개발 참고

### 코드 스타일 가이드
- TypeScript Strict Mode 사용
- React Hooks 규칙 준수
- 컴포넌트 최적화 (React.memo, useMemo)
- 에러 바운더리 처리

### 테스트
```bash
# 유닛 테스트 실행
pnpm test

# 커버리지 확인
pnpm test:coverage
```

### 빌드
```bash
# 개발 빌드
pnpm build

# 프로덕션 빌드 (최적화)
pnpm build:prod
```

## 문제 해결

### 포트 충돌
- Backend: 8000, Frontend: 3000
- 다른 포트 사용 시 `NEXT_PUBLIC_API_URL` 환경 변수 설정

### GPU 메모리 부족
- YOLO 학습 시 OOM 발생: `batch_size` 줄이기
- SAM2+YOLO 동시 로드: 서비스 우회차 또는 메모리 관리 기능 사용

## 참고

- [논문 원본](https://arxiv.org/abs/xxxx.xxxx)
- [HILIPS 백엔드 README](../backend/README.md)
- [Next.js 공식 문서](https://nextjs.org/docs)
- [shadcn/ui](https://ui.shadcn.com/)

## 라이선스

이 프로젝트는 연구 목적으로 개발되었습니다.
