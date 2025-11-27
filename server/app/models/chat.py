from pydantic import BaseModel, Field
from typing import List
from datetime import datetime


class ChatMessage(BaseModel):
    role: str = Field(..., description="Either 'user' or 'model'")
    content: str = Field(..., description="The message content")
    timestamp: datetime = Field(default_factory=datetime.now)


class ChatRequest(BaseModel):
    session_id: str = Field(..., description="Unique session identifier")
    message: str = Field(..., description="User message to send")


class ChatResponse(BaseModel):
    session_id: str
    message: str
    response: str
    timestamp: datetime = Field(default_factory=datetime.now)


class ChatHistory(BaseModel):
    session_id: str
    messages: List[ChatMessage]
