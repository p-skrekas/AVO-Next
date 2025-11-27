import axios from 'axios';
import type {
  Scenario,
  CreateScenarioRequest,
  UpdateScenarioRequest,
  UpdateStepRequest,
  ScenarioListResponse,
  ScenarioResponse,
  ExecuteScenarioResponse,
  ExecutionStatusResponse,
  ScenarioComparisonResponse,
  ExecutionQueueStatus,
  ExecutionLogsResponse,
  BatchExecuteResponse,
} from './scenario-types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const scenarioAPI = {
  // Scenario endpoints
  createScenario: async (data: CreateScenarioRequest): Promise<Scenario> => {
    const response = await api.post<ScenarioResponse>('/api/scenarios/', data);
    return response.data.scenario;
  },

  listScenarios: async (): Promise<ScenarioListResponse> => {
    const response = await api.get<ScenarioListResponse>('/api/scenarios/');
    return response.data;
  },

  getScenario: async (scenarioId: string): Promise<ScenarioResponse> => {
    const response = await api.get<ScenarioResponse>(`/api/scenarios/${scenarioId}`);
    return response.data;
  },

  updateScenario: async (scenarioId: string, data: UpdateScenarioRequest): Promise<Scenario> => {
    const response = await api.put<ScenarioResponse>(`/api/scenarios/${scenarioId}`, data);
    return response.data.scenario;
  },

  deleteScenario: async (scenarioId: string): Promise<void> => {
    await api.delete(`/api/scenarios/${scenarioId}`);
  },

  // Step endpoints
  addStep: async (scenarioId: string, stepNumber: number): Promise<any> => {
    const response = await api.post(`/api/scenarios/${scenarioId}/steps`, {
      step_number: stepNumber,
      ground_truth_cart: []
    });
    return response.data;
  },

  updateStep: async (scenarioId: string, stepId: string, data: UpdateStepRequest): Promise<any> => {
    const response = await api.put(`/api/scenarios/${scenarioId}/steps/${stepId}`, data);
    return response.data;
  },

  deleteStep: async (scenarioId: string, stepId: string): Promise<void> => {
    await api.delete(`/api/scenarios/${scenarioId}/steps/${stepId}`);
  },

  // Voice file upload
  uploadVoiceFile: async (scenarioId: string, stepId: string, file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post(
      `/api/scenarios/${scenarioId}/steps/${stepId}/voice`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  // Execute scenario (async - returns immediately)
  executeScenario: async (scenarioId: string): Promise<ExecuteScenarioResponse> => {
    const response = await api.post<ExecuteScenarioResponse>(`/api/scenarios/${scenarioId}/execute`);
    return response.data;
  },

  // Get execution status
  getExecutionStatus: async (scenarioId: string): Promise<ExecutionStatusResponse> => {
    const response = await api.get<ExecutionStatusResponse>(`/api/scenarios/${scenarioId}/execute/status`);
    return response.data;
  },

  // Clone/duplicate a scenario
  cloneScenario: async (scenarioId: string, newName?: string): Promise<Scenario> => {
    const params = newName ? `?new_name=${encodeURIComponent(newName)}` : '';
    const response = await api.post<ScenarioResponse>(`/api/scenarios/${scenarioId}/clone${params}`);
    return response.data.scenario;
  },

  // Get comparison results for all models
  getComparison: async (scenarioId: string): Promise<ScenarioComparisonResponse> => {
    const response = await api.get<ScenarioComparisonResponse>(`/api/scenarios/${scenarioId}/comparison`);
    return response.data;
  },

  // Generate ground truth order for a step using AI (from audio file)
  generateOrder: async (scenarioId: string, stepId: string): Promise<{
    message: string;
    transcription: string;
    cart_items: any[];
    scenario: any;
  }> => {
    const response = await api.post(`/api/scenarios/${scenarioId}/steps/${stepId}/generate-order`);
    return response.data;
  },

  // ============ NEW: Execution Controls ============

  // Cancel a running scenario execution
  cancelExecution: async (scenarioId: string): Promise<{ message: string; scenario_id: string }> => {
    const response = await api.post(`/api/scenarios/${scenarioId}/execute/cancel`);
    return response.data;
  },

  // Execute a single step
  executeStep: async (scenarioId: string, stepId: string): Promise<ExecuteScenarioResponse> => {
    const response = await api.post<ExecuteScenarioResponse>(`/api/scenarios/${scenarioId}/steps/${stepId}/execute`);
    return response.data;
  },

  // Get execution logs
  getExecutionLogs: async (scenarioId: string, limit?: number): Promise<ExecutionLogsResponse> => {
    const params = limit ? `?limit=${limit}` : '';
    const response = await api.get<ExecutionLogsResponse>(`/api/scenarios/${scenarioId}/execute/logs${params}`);
    return response.data;
  },

  // ============ NEW: Batch Execution ============

  // Add multiple scenarios to execution queue
  batchExecute: async (scenarioIds: string[]): Promise<BatchExecuteResponse> => {
    const response = await api.post<BatchExecuteResponse>('/api/scenarios/batch/execute', scenarioIds);
    return response.data;
  },

  // Get execution queue status
  getExecutionQueue: async (): Promise<ExecutionQueueStatus> => {
    const response = await api.get<ExecutionQueueStatus>('/api/scenarios/batch/queue');
    return response.data;
  },

  // Remove scenario from queue
  removeFromQueue: async (scenarioId: string): Promise<{ message: string; queue_length: number }> => {
    const response = await api.post(`/api/scenarios/batch/queue/remove/${scenarioId}`);
    return response.data;
  },

  // Reorder the execution queue
  reorderQueue: async (scenarioIds: string[]): Promise<{ message: string; queue: any[] }> => {
    const response = await api.post('/api/scenarios/batch/queue/reorder', scenarioIds);
    return response.data;
  },

  // Cancel all batch executions
  cancelBatch: async (): Promise<{ message: string; cancelled_running: number; cleared_queue: number }> => {
    const response = await api.post('/api/scenarios/batch/cancel');
    return response.data;
  },
};
