export type ChatMessage = {
  role: string;
  content: string;
  timestamp: string;
};

export type ChatRequest = {
  session_id: string;
  message: string;
};

export type ChatResponse = {
  session_id: string;
  message: string;
  response: string;
  timestamp: string;
};

export type ChatHistory = {
  session_id: string;
  messages: ChatMessage[];
};
