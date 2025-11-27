import axios from 'axios';
import type { ChatRequest, ChatResponse, ChatHistory } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const chatAPI = {
  sendMessage: async (sessionId: string, message: string): Promise<ChatResponse> => {
    const response = await api.post<ChatResponse>('/api/chat/message', {
      session_id: sessionId,
      message,
    });
    return response.data;
  },

  getHistory: async (sessionId: string): Promise<ChatHistory> => {
    const response = await api.get<ChatHistory>(`/api/chat/history/${sessionId}`);
    return response.data;
  },

  clearHistory: async (sessionId: string): Promise<void> => {
    await api.delete(`/api/chat/clear/${sessionId}`);
  },

  checkHealth: async (): Promise<{ status: string; ai_configured: boolean }> => {
    const response = await api.get('/health');
    return response.data;
  },
};
