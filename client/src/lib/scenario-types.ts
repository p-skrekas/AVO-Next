export type StepStatus = 'pending' | 'completed' | 'failed';

export interface CartItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
}

// Models available for execution
export const MODELS_TO_EXECUTE = ['gemini-2.5-pro', 'gemini-2.5-flash'] as const;
export type ModelName = typeof MODELS_TO_EXECUTE[number];

// Per-model execution result
export interface ModelExecutionResult {
  model_name: string;
  llm_transcription?: string;
  ai_response?: string;
  raw_llm_response?: string;
  predicted_cart?: CartItem[];
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  executed_at?: string;
  error?: string;
}

// Quantity mismatch details
export interface QuantityMismatch {
  product_id: string;
  product_name: string;
  expected_quantity: number;
  actual_quantity: number;
  unit: string;
}

// Comparison result for a single model
export interface CartComparisonResult {
  model_name: string;
  precision: number;
  recall: number;
  f1_score: number;
  exact_match: boolean;
  missing_items: CartItem[];
  extra_items: CartItem[];
  quantity_mismatches: QuantityMismatch[];
}

export interface ScenarioStep {
  step_id: string;
  step_number: number;
  voice_file_path?: string;
  voice_text?: string;
  ground_truth_cart: CartItem[];
  // Multi-model execution results
  model_results?: Record<string, ModelExecutionResult>;
  // Legacy single-model fields (backward compatibility)
  llm_transcription?: string;
  ai_response?: string;
  raw_llm_response?: string;
  predicted_cart?: CartItem[];
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  created_at: string;
  updated_at: string;
}

export interface Scenario {
  scenario_id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model_name: string;
  steps: ScenarioStep[];
  created_at: string;
  updated_at: string;
}

export interface CreateScenarioRequest {
  name: string;
  description?: string;
  num_steps: number;
}

export interface UpdateScenarioRequest {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_name?: string;
}

export interface CreateStepRequest {
  step_number: number;
  ground_truth_cart?: CartItem[];
}

export interface UpdateStepRequest {
  voice_text?: string;
  ai_response?: string;
  ground_truth_cart?: CartItem[];
  predicted_cart?: CartItem[];
}

export interface ScenarioListResponse {
  scenarios: Scenario[];
  total: number;
}

export interface ScenarioResponse {
  scenario: Scenario;
}

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ExecutionStatusInfo {
  status: ExecutionStatus;
  current_model?: string;
  current_model_index?: number;
  total_models?: number;
  current_step: number;
  total_steps: number;
  steps_processed: number;
  steps_skipped: number;
  steps_failed: number;
  models_completed?: number;
  error?: string;
}

export interface ExecuteScenarioResponse {
  message: string;
  scenario_id: string;
  models: string[];
  status: ExecutionStatusInfo;
}

export interface ExecutionStatusResponse {
  scenario_id: string;
  execution_status: ExecutionStatusInfo;
  scenario: Scenario;
}

// Comparison types
export interface StepComparisonResult {
  step_id: string;
  step_number: number;
  ground_truth_cart: CartItem[];
  comparisons: CartComparisonResult[];
}

export interface ModelSummary {
  total_precision: number;
  total_recall: number;
  total_f1: number;
  exact_matches: number;
  total_steps: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_latency_ms: number;
  total_cost: number;
  avg_precision: number;
  avg_recall: number;
  avg_f1: number;
  exact_match_rate: number;
}

export interface ScenarioComparisonResponse {
  scenario_id: string;
  scenario_name: string;
  steps: StepComparisonResult[];
  summary: Record<string, ModelSummary>;
}

// Execution Queue Types
export interface QueuedScenario {
  scenario_id: string;
  scenario_name: string;
  queued_at: string;
  priority: number;
}

export interface ExecutionQueueStatus {
  queue: QueuedScenario[];
  currently_executing: string | null;
  is_batch_running: boolean;
}

export interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details: Record<string, any>;
}

export interface ExecutionLogsResponse {
  scenario_id: string;
  logs: ExecutionLog[];
  total_logs: number;
}

export interface BatchExecuteResponse {
  message: string;
  added: Array<{ scenario_id: string; name: string }>;
  skipped: Array<{ scenario_id: string; reason: string }>;
  queue_length: number;
}
