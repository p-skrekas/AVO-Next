from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.models import ChatRequest, ChatResponse, ChatHistory
from app.services import chat_service
from app.core import settings
from app.routes import scenario_router, product_router, settings_router
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="AVO_NEXT Voice Ordering Test API",
    description="FastAPI server with Google Gemini AI integration and voice ordering scenario testing",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(scenario_router)
app.include_router(product_router)
app.include_router(settings_router)

# Mount static files for voice uploads
uploads_dir = Path("uploads")
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/")
async def root():
    return {
        "message": "Welcome to AVO_NEXT Chat API",
        "status": "running",
        "version": "1.0.0",
        "ai_configured": settings.is_configured
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "ai_configured": settings.is_configured
    }


@app.post("/api/chat/message", response_model=ChatResponse)
async def send_message(request: ChatRequest):
    """Send a message to the AI and get a response"""
    try:
        if not settings.is_configured:
            raise HTTPException(
                status_code=500,
                detail="Google AI credentials not configured. Please set GOOGLE_API_KEY in .env file."
            )

        response_text = await chat_service.send_message(request.session_id, request.message)

        return ChatResponse(
            session_id=request.session_id,
            message=request.message,
            response=response_text
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Error in send_message: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing your request")


@app.get("/api/chat/history/{session_id}", response_model=ChatHistory)
async def get_history(session_id: str):
    """Get conversation history for a session"""
    try:
        messages = chat_service.get_session_history(session_id)
        return ChatHistory(session_id=session_id, messages=messages)
    except Exception as e:
        logger.error(f"Error getting history: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve chat history")


@app.delete("/api/chat/clear/{session_id}")
async def clear_history(session_id: str):
    """Clear conversation history for a session"""
    try:
        chat_service.clear_session(session_id)
        return {"message": f"Session {session_id} cleared successfully"}
    except Exception as e:
        logger.error(f"Error clearing session: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear session")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
