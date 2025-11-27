# AVO_NEXT Server

FastAPI server with Google Gemini AI integration for the AVO_NEXT chat application.

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
```bash
# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Configure Google AI credentials:
```bash
cp .env.example .env
```

Edit `.env` and add your Google API key:
```
GOOGLE_API_KEY=your_google_api_key_here
```

Alternatively, for service account authentication, place your service account JSON file in the server directory and set:
```
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

## Running the Server

### Development Mode
```bash
uvicorn main:app --reload
```

### Production Mode
```bash
python main.py
```

The server will start at `http://localhost:8000`

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## API Endpoints

### Chat Endpoints
- `POST /api/chat/message` - Send a message and get AI response
  - Body: `{"session_id": "string", "message": "string"}`
  - Returns: `{"session_id": "string", "message": "string", "response": "string", "timestamp": "string"}`

- `GET /api/chat/history/{session_id}` - Get conversation history
  - Returns: `{"session_id": "string", "messages": [...]}`

- `DELETE /api/chat/clear/{session_id}` - Clear conversation history

### System Endpoints
- `GET /` - Root endpoint with API information
- `GET /health` - Health check endpoint

## Architecture

### Files

- `main.py` - FastAPI application with endpoint definitions
- `chat_service.py` - Google Gemini AI integration and session management
- `models.py` - Pydantic data models for requests and responses
- `config.py` - Configuration and environment variable loading

### Session Management

The server maintains in-memory conversation history per session ID. Each session preserves the conversation context, allowing for multi-turn conversations with the AI. Sessions persist until explicitly cleared or server restart.

### Google Gemini Integration

Uses the Google Generative AI Python SDK with the Gemini 1.5 Pro model. The chat service builds conversation history from session messages and sends them to Gemini for context-aware responses.
