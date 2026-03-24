# AGENTS.md - HILIPS Repository Guidelines

> Guidelines for AI coding agents. HILIPS = Hierarchical Labeling with Iterative Pseudo-Labeling System

## Project Structure

**Monorepo** with Next.js frontend + FastAPI backend:

```
HILIPS/
├── keti-labeling/     # Next.js 15 (React 19, TypeScript, Tailwind, shadcn/ui)
│   ├── app/           # App Router pages/layouts
│   ├── components/    # UI components (shadcn/ui based)
│   ├── hooks/         # Custom React hooks
│   └── lib/           # API clients, utilities (no React)
├── backend/           # FastAPI (Python, PyTorch, SAM2, YOLO)
│   ├── routers/       # API endpoints
│   ├── services/      # Business logic
│   ├── models/        # ML model loaders
│   └── schemas/       # Pydantic models
└── LABELING_GUIDE.md  # User documentation
```

---

## Build, Lint, and Test Commands

### Frontend (`keti-labeling/`)

```bash
pnpm install              # Install dependencies
pnpm dev                  # Dev server (localhost:3000)
pnpm build                # Production build
pnpm lint                 # ESLint check
pnpm lint --fix           # Auto-fix lint issues
npx tsc --noEmit          # Type check

# Testing (Jest + React Testing Library)
pnpm exec jest                        # All tests
pnpm exec jest path/to/file.test.tsx  # Single file
pnpm exec jest -t "test name"         # Single test by name
pnpm exec jest --coverage             # With coverage
```

### Backend (`backend/`)

```bash
pip install -r requirements.txt                    # Install deps
uvicorn main:app --reload --host 0.0.0.0 --port 8000  # Dev server
ruff check . --fix                                 # Lint + fix
mypy .                                             # Type check (if installed)
```

---

## Code Style

### TypeScript/React

**File Naming:**
- Components: `PascalCase.tsx` (e.g., `LabelingWorkspace.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-workflow-status.ts`)
- Utilities: `kebab-case.ts` (e.g., `api-config.ts`)

**Imports Order:**
```typescript
"use client"  // Client directive first

import { useState } from "react"           // 1. React/Next.js
import { Button } from "@/components/ui"   // 2. External/UI libs
import { apiCall } from "@/lib/api-config" // 3. Internal modules
import type { SomeType } from "@/types"    // 4. Types
```

**Component Pattern:**
```typescript
interface Props { requiredProp: string; optionalProp?: number }

export default function Component({ requiredProp, optionalProp = 10 }: Props) {
  const [state, setState] = useState()   // hooks first
  useEffect(() => {}, [])                // effects
  const handleClick = () => {}           // handlers
  return <div>...</div>                  // render
}
```

**Styling:** Tailwind only. Use `cn()` for conditional classes. Use `class-variance-authority` for variants.

**Types:** Explicit types on exports. Use `zod` for runtime validation. Avoid `any`.

### Python

**File Naming:** `snake_case.py`. Classes: `PascalCase`. Constants: `UPPER_SNAKE_CASE`.

**Module Structure:**
```python
"""Module docstring"""
import os, logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class RequestModel(BaseModel):
    field: str
    optional_field: Optional[str] = None

def function_name(param: str) -> Dict[str, Any]:
    """Function docstring"""
    pass
```

**Error Handling:**
```python
# Routers: HTTPException
raise HTTPException(status_code=404, detail="Not found")

# Services: ValueError + logging
logger.error(f"Failed: {e}")
raise ValueError(f"Invalid: {value}")
```

---

## Testing

- **Frontend:** `*.test.tsx` beside components. Use React Testing Library. Include a11y checks.
- **Backend:** pytest with TestClient. Mock ML models and file I/O.
- **Coverage target:** ≥80% on new modules.

---

## Key Architecture Decisions

1. **No database** - File-based JSON persistence
2. **Service layer** - Routers delegate to services (`get_*_service()` singletons)
3. **API proxy** - Frontend calls go through Next.js rewrites to backend
4. **shadcn/ui** - Reuse components from `components/ui/`
5. **Ports** - Frontend: 3000, Backend: 8000

---

## Common Pitfalls

| Area | Issue |
|------|-------|
| Frontend | Missing `"use client"` for components with hooks |
| Backend | Pydantic model mismatch → 422 errors |
| Both | Field name mismatch between frontend/backend APIs |
| ML | SAM2/YOLO require GPU; check model loading on startup |
| Types | Never use `as any`, `@ts-ignore`, `@ts-expect-error` |

---

## Commit Guidelines

- **Style:** Imperative, sentence-case (`Update training configuration...`)
- **Pre-push:** Run `pnpm lint && pnpm build` (frontend), verify backend starts
- **PR:** Include change summary, linked issue, test evidence (screenshots for UI)
