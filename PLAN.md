# Plan: Multi-Model Scenario Execution with Comparison

## Overview
Modify scenario execution to run all three LLM models (gemini-2.5-pro, gemini-2.5-flash, gemini-3-pro-preview) for each scenario and compare results against ground truth.

## Current State
- Each scenario has a single `model_name` field
- Each step stores single execution results: `predicted_cart`, `ai_response`, `llm_transcription`, `input_tokens`, `output_tokens`, `latency_ms`
- Execution runs one model at a time

## Proposed Changes

### 1. Backend Data Model Changes (`server/app/scenario_models.py`)

**New model for per-model results:**
```python
class ModelExecutionResult(BaseModel):
    model_name: str
    llm_transcription: Optional[str] = None
    ai_response: Optional[str] = None
    raw_llm_response: Optional[str] = None
    predicted_cart: Optional[List[CartItem]] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    executed_at: Optional[datetime] = None
```

**Modify ScenarioStep:**
- Keep existing fields for backward compatibility (can be deprecated later)
- Add new field: `model_results: Dict[str, ModelExecutionResult]` - keyed by model_name

**Add comparison metrics model:**
```python
class CartComparisonResult(BaseModel):
    model_name: str
    precision: float  # correct items / predicted items
    recall: float     # correct items / ground truth items
    f1_score: float
    exact_match: bool  # predicted cart == ground truth cart
    missing_items: List[CartItem]
    extra_items: List[CartItem]
    quantity_mismatches: List[dict]  # items with wrong quantities
```

### 2. Backend Service Changes (`server/app/scenario_service.py`)

- Add method `update_step_model_result(scenario_id, step_id, model_name, result)` to store per-model results
- Add method `calculate_cart_comparison(ground_truth, predicted)` to compute comparison metrics

### 3. Backend Route Changes (`server/app/scenario_routes.py`)

**Modify execution logic:**
- Define constant: `MODELS_TO_EXECUTE = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-pro-preview"]`
- For each model, run all steps sequentially (maintaining conversation context per model)
- Store results in `model_results` dict on each step

**Update execution status:**
```python
execution_status[scenario_id] = {
    "status": ExecutionStatus.RUNNING,
    "current_model": "gemini-2.5-pro",
    "current_model_index": 1,
    "total_models": 3,
    "current_step": 1,
    "total_steps": N,
    ...
}
```

**Add new endpoint for comparison results:**
- `GET /api/scenarios/{scenario_id}/comparison` - returns comparison metrics for all models

### 4. Frontend Type Changes (`client/src/lib/scenario-types.ts`)

```typescript
interface ModelExecutionResult {
    model_name: string;
    llm_transcription?: string;
    ai_response?: string;
    raw_llm_response?: string;
    predicted_cart?: CartItem[];
    input_tokens?: number;
    output_tokens?: number;
    latency_ms?: number;
    executed_at?: string;
}

interface CartComparisonResult {
    model_name: string;
    precision: number;
    recall: number;
    f1_score: number;
    exact_match: boolean;
    missing_items: CartItem[];
    extra_items: CartItem[];
    quantity_mismatches: { item: CartItem; expected: number; actual: number }[];
}

// Update ScenarioStep
interface ScenarioStep {
    // ... existing fields
    model_results?: Record<string, ModelExecutionResult>;
}

// Update ExecutionStatusInfo
interface ExecutionStatusInfo {
    // ... existing fields
    current_model?: string;
    current_model_index?: number;
    total_models?: number;
}
```

### 5. Frontend UI Changes (`client/src/components/ScenarioDetail.tsx`)

**Execution Button:**
- Show: "Executing Model 1/3 (gemini-2.5-pro) - Step 2/5"

**Results Tab - Redesign:**
- For each step, show a comparison table:
  ```
  | Model           | Predicted Cart | Precision | Recall | F1   | Match |
  |-----------------|---------------|-----------|--------|------|-------|
  | gemini-2.5-pro  | [items...]    | 95%       | 100%   | 97%  | No    |
  | gemini-2.5-flash| [items...]    | 90%       | 90%    | 90%  | No    |
  | gemini-3-pro    | [items...]    | 100%      | 100%   | 100% | Yes   |
  ```
- Ground truth cart displayed separately above
- Expandable sections to view AI responses per model

**Cost Tab - Update:**
- Show cost breakdown per model
- Total cost across all models
- Summary comparison table

### 6. Implementation Order

1. **Phase 1: Backend Data Model**
   - Add `ModelExecutionResult` model
   - Add `model_results` field to `ScenarioStep`
   - Update `UpdateStepRequest` model

2. **Phase 2: Backend Execution**
   - Modify `execute_scenario_background` to iterate over all models
   - Update `process_scenario_step` to accept and store model-specific results
   - Update execution status to track current model

3. **Phase 3: Comparison Logic**
   - Implement cart comparison algorithm
   - Add comparison endpoint

4. **Phase 4: Frontend Types & API**
   - Update TypeScript types
   - Add API function for comparison endpoint

5. **Phase 5: Frontend UI**
   - Update execution button to show model progress
   - Redesign Results tab with comparison view
   - Update Cost tab for multi-model summary

## Migration Consideration
- Existing scenarios will have empty `model_results`
- Old single-model fields remain for backward compatibility
- New executions populate `model_results`
