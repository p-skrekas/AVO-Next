# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AVO_NEXT is a full-stack AI chat application with a FastAPI backend integrated with Google Vertex AI (Gemini) and a React frontend. The application supports both conversational AI chat and voice ordering scenario testing with multi-step conversations and cart validation. The primary use case is voice ordering for a tobacco shop with Greek language support.

## Repository Structure

```
AVO_NEXT/
├── client/              # React + Vite frontend (TypeScript)
│   ├── src/
│   │   ├── components/  # React components
│   │   │   ├── Chat.tsx              # Standard chat interface
│   │   │   ├── Scenarios.tsx         # Scenario list management
│   │   │   ├── ScenarioDetail.tsx    # Individual scenario view with multi-model comparison
│   │   │   ├── CreateScenarioDialog.tsx
│   │   │   ├── Products.tsx          # Product catalog viewer
│   │   │   ├── Settings.tsx          # Application settings
│   │   │   └── ui/                    # shadcn/ui components
│   │   ├── hooks/       # Custom React hooks (useVoiceRecorder)
│   │   └── lib/         # API clients and type definitions
│   │       ├── api.ts               # Chat API client
│   │       ├── scenario-api.ts      # Scenario API client
│   │       ├── product-api.ts       # Product API client
│   │       └── settings-api.ts      # Settings API client
│   └── package.json
└── server/              # FastAPI backend (Python)
    ├── app/
    │   ├── chat_service.py           # Vertex AI chat integration
    │   ├── transcription_service.py  # Audio transcription (gemini-2.0-flash-exp)
    │   ├── scenario_service.py       # Scenario CRUD + cart comparison
    │   ├── scenario_routes.py        # Scenario REST endpoints
    │   ├── scenario_models.py        # Pydantic models + MODELS_TO_EXECUTE config
    │   ├── settings_service.py       # System prompt management
    │   ├── settings_routes.py        # Settings REST endpoints
    │   ├── product_routes.py         # Product REST endpoints
    │   ├── products_data.py          # CSV product loader
    │   ├── database.py               # MongoDB singleton with in-memory fallback
    │   ├── prompt_builder.py         # Dynamic prompt construction
    │   └── config.py                 # Environment configuration
    ├── uploads/voice_files/          # Uploaded audio storage
    └── main.py                       # FastAPI app entry point
```

## Development Commands

### Client (React + Vite)

Navigate to `client/` directory first:

```bash
cd client
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Server (FastAPI)

Navigate to `server/` directory first:

```bash
cd server
python -m venv venv  # Create virtual environment (first time only)

# Activate virtual environment:
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux/Mac

pip install -r requirements.txt  # Install dependencies

# Configure Google AI credentials (REQUIRED):
cp .env.example .env
# Edit .env and add your GOOGLE_API_KEY

uvicorn main:app --reload        # Start dev server (http://localhost:8000)
python main.py                   # Alternative: production mode
```

API documentation available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Google Cloud Setup

The server requires Google Cloud Vertex AI authentication with a service account:

1. Obtain a service account JSON file from Google Cloud Console
2. Place the file in `server/` directory (default name: `service-account.json`)
3. Create a `.env` file in `server/` directory:
```
GOOGLE_APPLICATION_CREDENTIALS=service-account.json
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1
```

### MongoDB Setup (Optional)

For persistent storage of scenarios and products, configure MongoDB in `.env`:
```
MONGODB_USERNAME=your_username
MONGODB_PASSWORD=your_password
MONGODB_CLUSTER_URL=cluster.mongodb.net
MONGODB_DATABASE=avo_next
```

If MongoDB is not configured, the server falls back to in-memory storage.

### Running Both Services

To run the full application:
1. Start the backend: `cd server && uvicorn main:app --reload`
2. Start the frontend: `cd client && npm run dev`
3. Access the app at http://localhost:5173

## Architecture

### Frontend (client/)

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7 with Hot Module Replacement
- **Styling**: Tailwind CSS 4 with shadcn/ui component system
- **HTTP Client**: Axios for API communication
- **UI Components**: shadcn/ui (New York style) with Radix UI primitives and Lucide icons
- **Path Aliases**: `@/` maps to `src/` (configured in tsconfig.json and vite.config.ts)
- **API Integration**: `src/lib/api.ts` contains typed API client functions

### Backend (server/)

- **Framework**: FastAPI (async Python web framework)
- **AI Integration**: Google Vertex AI SDK via `vertexai` package
  - Chat: `gemini-2.5-pro` model (configurable per scenario)
  - Transcription: `gemini-2.0-flash-exp` model for audio-to-text
- **Database**: MongoDB (optional) with in-memory fallback via `pymongo`
- **ASGI Server**: Uvicorn
- **Data Validation**: Pydantic models
- **CORS**: Configured to allow all origins (adjust for production)
- **Session Management**: In-memory chat sessions with MongoDB storage for scenarios/products
- **File Uploads**: Audio file support for voice ordering scenarios (saved to `uploads/voice_files/`)

### API Endpoints

**Chat:**
- `POST /api/chat/message` - Send a message to AI and get response
- `GET /api/chat/history/{session_id}` - Retrieve conversation history
- `DELETE /api/chat/clear/{session_id}` - Clear session history

**Scenarios:**
- `POST /api/scenarios/` - Create new scenario with N steps
- `GET /api/scenarios/` - List all scenarios
- `GET /api/scenarios/{scenario_id}` - Get specific scenario
- `PUT /api/scenarios/{scenario_id}` - Update scenario metadata (including system_prompt and model_name)
- `DELETE /api/scenarios/{scenario_id}` - Delete scenario
- `POST /api/scenarios/{scenario_id}/execute` - Execute all steps with conversational memory
- `PUT /api/scenarios/{scenario_id}/steps/{step_id}` - Update step details
- `POST /api/scenarios/{scenario_id}/steps` - Add new step
- `DELETE /api/scenarios/{scenario_id}/steps/{step_id}` - Delete step
- `POST /api/scenarios/{scenario_id}/steps/{step_id}/voice` - Upload voice file (auto-transcribes)

**Products:**
- `GET /api/products/` - List all products
- `GET /api/products/{product_id}` - Get specific product
- `POST /api/products/seed` - Seed products database from CSV data

**System:**
- `GET /` - Root endpoint with API information
- `GET /health` - Health check with AI configuration status

### Application Architecture

**Three-Module Design:**

1. **Chat Module** - Standard conversational AI interface
   - Frontend: `Chat.tsx` → Backend: `chat_service.py`
   - Uses Vertex AI `ChatSession` for conversation continuity
   - In-memory session storage (lost on restart)

2. **Scenario Testing Module** - Multi-model voice ordering benchmark
   - Frontend: `Scenarios.tsx`, `ScenarioDetail.tsx` → Backend: `scenario_service.py`, `scenario_routes.py`
   - Compares multiple models: configured in `MODELS_TO_EXECUTE` in `scenario_models.py`
   - Default models: `gemini-2.5-pro`, `gemini-2.5-flash`
   - Each scenario has N steps, each step has: voice file, ground truth cart, per-model results
   - Calculates precision/recall/F1/exact-match metrics via `compare_carts()`

3. **Products Module** - Product catalog for prompt building
   - Backend: `products_data.py` loads CSV → `prompt_builder.py` injects into system prompt
   - 459 products with: id, title, units_relation, main_unit, secondary_unit

**Key Implementation Details:**

- **Vertex AI Integration** (`chat_service.py`):
  - Initializes with service account credentials
  - `ChatSession` per session ID maintains conversation context
  - `send_audio_with_cart()` / `send_message_with_cart()` return: `(clean_response, cart_items, transcription, input_tokens, output_tokens, latency_ms, raw_response)`
  - Extracts cart from `<order>` XML tags and transcription from `<transcription>` tags
  - Retry logic with exponential backoff for rate limits (5 retries, 1-60s backoff)

- **Transcription Service** (`transcription_service.py`):
  - Uses `gemini-2.0-flash-exp` for standalone audio transcription
  - Supports: WAV, MP3, FLAC, WebM, OGG, M4A
  - Default language: Greek

- **Prompt Builder** (`prompt_builder.py`):
  - Dynamically builds system prompt with full product catalog
  - Injects current cart state for conversational context

- **Scenario Execution Flow** (`scenario_routes.py`):
  1. For each model in `MODELS_TO_EXECUTE`:
     - Clear chat session
     - Process steps sequentially (maintains conversational memory within model)
     - Extract cart from XML response, compare with ground truth
  2. Store results per model in `step.model_results[model_name]`

- **Cart Comparison** (`scenario_service.compare_carts()`):
  - Matches by `product_id`
  - Returns: precision, recall, F1, exact_match, missing_items, extra_items, quantity_mismatches

- **Database Layer** (`database.py`):
  - MongoDB Atlas via `pymongo` with singleton pattern
  - Graceful fallback to in-memory `Dict` storage

**Response XML Format Expected from LLM:**
```xml
<transcription>User's speech transcribed</transcription>
<ai_response>Conversational response to user</ai_response>
<order>
  <product>
    <id>product_id</id>
    <quantity>1</quantity>
    <unit>KOYTA</unit>
  </product>
</order>
```
