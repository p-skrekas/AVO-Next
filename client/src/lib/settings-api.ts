import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface SystemPromptResponse {
  system_prompt: string;
}

export const settingsAPI = {
  getSystemPrompt: async (): Promise<string> => {
    const response = await api.get<SystemPromptResponse>('/api/settings/system-prompt');
    return response.data.system_prompt;
  },

  updateSystemPrompt: async (prompt: string): Promise<string> => {
    const response = await api.put<SystemPromptResponse>('/api/settings/system-prompt', {
      system_prompt: prompt,
    });
    return response.data.system_prompt;
  },
};
