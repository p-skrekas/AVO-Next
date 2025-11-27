import vertexai
from vertexai.generative_models import GenerativeModel, ChatSession, Part, GenerationConfig
from typing import Dict, List, Optional, Tuple
from app.models.chat import ChatMessage
from app.core.config import settings
import logging
import os
import json
import time
import asyncio
from pathlib import Path

MAX_RETRIES = 5
INITIAL_BACKOFF_SECONDS = 1
MAX_BACKOFF_SECONDS = 60

logger = logging.getLogger(__name__)

ORDER_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "transcription": {
            "type": "STRING",
            "description": "The exact transcription of the user's speech/audio input in Greek"
        },
        "ai_response": {
            "type": "STRING",
            "description": "The conversational response to the user in Greek"
        },
        "order": {
            "type": "ARRAY",
            "description": "The current cart/order items. Include ALL items that should be in the cart after this interaction.",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "id": {
                        "type": "STRING",
                        "description": "The product ID - MUST be copied exactly from the first column of the catalog CSV."
                    },
                    "quantity": {
                        "type": "INTEGER",
                        "description": "The quantity in the same unit the customer used"
                    },
                    "unit": {
                        "type": "STRING",
                        "description": "The unit type: 'KOYTA' for boxes/packages or 'ΤΕΜΑΧΙΟ' for individual pieces",
                        "enum": ["KOYTA", "ΤΕΜΑΧΙΟ", "CAN", "ΠΕΝΤΑΔΑ", "ΚΑΣΕΤΙΝΑ"]
                    }
                },
                "required": ["id", "quantity", "unit"]
            }
        }
    },
    "required": ["transcription", "ai_response", "order"]
}


class ChatService:
    def __init__(self):
        self.sessions: Dict[str, List[ChatMessage]] = {}
        self.chat_sessions: Dict[str, ChatSession] = {}
        self.model = None
        self._initialize_vertex_ai()

    def _initialize_vertex_ai(self):
        """Initialize Vertex AI with service account"""
        try:
            creds_path = Path(settings.GOOGLE_APPLICATION_CREDENTIALS)
            if not creds_path.exists():
                logger.error(f"Service account file not found: {creds_path}")
                return

            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = str(creds_path)

            vertexai.init(
                project=settings.GCP_PROJECT_ID,
                location=settings.GCP_LOCATION
            )

            self.model = GenerativeModel("gemini-2.5-pro")
            logger.info(f"Vertex AI initialized with project: {settings.GCP_PROJECT_ID}")

        except Exception as e:
            logger.error(f"Failed to initialize Vertex AI: {e}")
            raise

    def get_or_create_session(self, session_id: str) -> List[ChatMessage]:
        """Get existing session or create new one"""
        if session_id not in self.sessions:
            self.sessions[session_id] = []
        return self.sessions[session_id]

    def add_message(self, session_id: str, role: str, content: str):
        """Add a message to session history"""
        session = self.get_or_create_session(session_id)
        message = ChatMessage(role=role, content=content)
        session.append(message)

    def get_or_create_chat_session(
        self,
        session_id: str,
        system_prompt: Optional[str] = None,
        model_name: Optional[str] = None,
        use_structured_output: bool = False
    ) -> ChatSession:
        """Get or create a Vertex AI chat session"""
        if session_id not in self.chat_sessions:
            try:
                vertexai.init(
                    project=settings.GCP_PROJECT_ID,
                    location=settings.GCP_LOCATION
                )
            except Exception as e:
                logger.warning(f"Failed to re-init Vertex AI: {e}")

            generation_config = None
            if use_structured_output:
                generation_config = GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=ORDER_RESPONSE_SCHEMA
                )
                logger.info(f"Using structured output for session {session_id}")

            if system_prompt:
                try:
                    model_id = model_name if model_name else "gemini-2.5-pro"
                    logger.info(f"Creating model {model_id} with system prompt")
                    model = GenerativeModel(
                        model_id,
                        system_instruction=system_prompt,
                        generation_config=generation_config
                    )
                except Exception as e:
                    logger.warning(f"Failed to initialize model with system instruction: {e}")
                    model = self.model
            elif model_name:
                try:
                    model = GenerativeModel(model_name, generation_config=generation_config)
                except Exception as e:
                    logger.warning(f"Failed to initialize custom model {model_name}: {e}")
                    model = self.model
            else:
                model = self.model

            self.chat_sessions[session_id] = model.start_chat(response_validation=False)
        return self.chat_sessions[session_id]

    async def send_message(self, session_id: str, message: str) -> str:
        """Send message to Gemini via Vertex AI and get response"""
        if not self.model:
            raise ValueError("Vertex AI model not initialized.")

        try:
            self.add_message(session_id, "user", message)
            chat = self.get_or_create_chat_session(session_id)
            response = chat.send_message(message)
            response_text = response.text
            self.add_message(session_id, "model", response_text)
            return response_text

        except Exception as e:
            logger.error(f"Error sending message to Vertex AI: {e}")
            raise

    def get_session_history(self, session_id: str) -> List[ChatMessage]:
        """Get full session history"""
        return self.get_or_create_session(session_id)

    def clear_session(self, session_id: str):
        """Clear session history"""
        if session_id in self.sessions:
            del self.sessions[session_id]
        if session_id in self.chat_sessions:
            del self.chat_sessions[session_id]

    def _get_audio_mime_type(self, file_path: str) -> str:
        """Determine the MIME type based on file extension"""
        ext = Path(file_path).suffix.lower()
        mime_types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.webm': 'audio/webm',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.flac': 'audio/flac',
        }
        return mime_types.get(ext, 'audio/webm')

    async def send_audio_with_cart(
        self,
        session_id: str,
        audio_file_path: str,
        system_prompt: Optional[str] = None,
        model_name: Optional[str] = None
    ) -> Tuple[str, Optional[List[Dict]], Optional[str], int, int, int, str]:
        """Send audio file and extract response, cart items, transcription, and usage metrics"""
        if not self.model:
            raise ValueError("Vertex AI model not initialized.")

        if not Path(audio_file_path).exists():
            raise ValueError(f"Audio file not found: {audio_file_path}")

        with open(audio_file_path, 'rb') as f:
            audio_data = f.read()

        mime_type = self._get_audio_mime_type(audio_file_path)
        logger.info(f"Sending audio file: {audio_file_path}, MIME: {mime_type}, size: {len(audio_data)} bytes")

        audio_part = Part.from_data(data=audio_data, mime_type=mime_type)
        chat = self.get_or_create_chat_session(session_id, system_prompt, model_name, use_structured_output=True)

        last_exception = None
        for attempt in range(MAX_RETRIES):
            try:
                start_time = time.time()
                # Run the blocking Vertex AI call in a thread pool to allow true parallel execution
                response = await asyncio.to_thread(chat.send_message, audio_part)
                end_time = time.time()
                latency_ms = int((end_time - start_time) * 1000)

                response_text = response.text

                input_tokens = 0
                output_tokens = 0
                try:
                    if hasattr(response, 'usage_metadata'):
                        usage = response.usage_metadata
                        input_tokens = usage.prompt_token_count if hasattr(usage, 'prompt_token_count') else 0
                        output_tokens = usage.candidates_token_count if hasattr(usage, 'candidates_token_count') else 0
                        logger.info(f"Token usage - Input: {input_tokens}, Output: {output_tokens}, Latency: {latency_ms}ms")
                except Exception as e:
                    logger.warning(f"Could not extract token usage: {e}")

                self.add_message(session_id, "user", f"[Audio file: {Path(audio_file_path).name}]")
                self.add_message(session_id, "model", response_text)

                cart_items, transcription, clean_response = self._parse_structured_response(response_text)

                return clean_response, cart_items, transcription, input_tokens, output_tokens, latency_ms, response_text

            except Exception as e:
                last_exception = e
                error_str = str(e).lower()

                is_rate_limit = any(keyword in error_str for keyword in [
                    'rate limit', 'rate_limit', 'quota', '429', 'resource exhausted',
                    'resourceexhausted', 'too many requests'
                ])

                if is_rate_limit and attempt < MAX_RETRIES - 1:
                    backoff_time = min(
                        INITIAL_BACKOFF_SECONDS * (2 ** attempt),
                        MAX_BACKOFF_SECONDS
                    )
                    logger.warning(
                        f"Rate limit hit for {model_name or 'default model'} (attempt {attempt + 1}/{MAX_RETRIES}). "
                        f"Retrying in {backoff_time} seconds..."
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(f"Error sending audio to Vertex AI: {e}")
                    raise

        logger.error(f"All {MAX_RETRIES} retry attempts failed")
        raise last_exception

    async def send_message_with_cart(
        self,
        session_id: str,
        message: str,
        system_prompt: Optional[str] = None,
        model_name: Optional[str] = None
    ) -> Tuple[str, Optional[List[Dict]], Optional[str], int, int, int, str]:
        """Send message and extract response, cart items, transcription, and usage metrics"""
        if not self.model:
            raise ValueError("Vertex AI model not initialized.")

        self.add_message(session_id, "user", message)
        chat = self.get_or_create_chat_session(session_id, system_prompt, model_name, use_structured_output=True)

        last_exception = None
        for attempt in range(MAX_RETRIES):
            try:
                start_time = time.time()
                # Run the blocking Vertex AI call in a thread pool to allow true parallel execution
                response = await asyncio.to_thread(chat.send_message, message)
                end_time = time.time()
                latency_ms = int((end_time - start_time) * 1000)

                response_text = response.text

                input_tokens = 0
                output_tokens = 0
                try:
                    if hasattr(response, 'usage_metadata'):
                        usage = response.usage_metadata
                        input_tokens = usage.prompt_token_count if hasattr(usage, 'prompt_token_count') else 0
                        output_tokens = usage.candidates_token_count if hasattr(usage, 'candidates_token_count') else 0
                        logger.info(f"Token usage - Input: {input_tokens}, Output: {output_tokens}, Latency: {latency_ms}ms")
                except Exception as e:
                    logger.warning(f"Could not extract token usage: {e}")

                self.add_message(session_id, "model", response_text)
                cart_items, transcription, clean_response = self._parse_structured_response(response_text)

                return clean_response, cart_items, transcription, input_tokens, output_tokens, latency_ms, response_text

            except Exception as e:
                last_exception = e
                error_str = str(e).lower()

                is_rate_limit = any(keyword in error_str for keyword in [
                    'rate limit', 'rate_limit', 'quota', '429', 'resource exhausted',
                    'resourceexhausted', 'too many requests'
                ])

                if is_rate_limit and attempt < MAX_RETRIES - 1:
                    backoff_time = min(
                        INITIAL_BACKOFF_SECONDS * (2 ** attempt),
                        MAX_BACKOFF_SECONDS
                    )
                    logger.warning(
                        f"Rate limit hit (attempt {attempt + 1}/{MAX_RETRIES}). "
                        f"Retrying in {backoff_time} seconds..."
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(f"Error sending message with cart to Vertex AI: {e}")
                    raise

        logger.error(f"All {MAX_RETRIES} retry attempts failed")
        raise last_exception

    def _parse_structured_response(self, response_text: str) -> Tuple[Optional[List[Dict]], Optional[str], str]:
        """Parse structured JSON response from the model"""
        data = json.loads(response_text)
        logger.info(f"Successfully parsed structured JSON response")

        cart_items = []
        order = data.get("order", [])
        for item in order:
            product_id = str(item.get("id", ""))
            quantity = item.get("quantity", 0)
            unit = item.get("unit", "KOYTA")

            logger.info(f"Structured output item - id: {product_id}, quantity: {quantity}, unit: {unit}")

            cart_items.append({
                "product_id": product_id,
                "product_name": f"Product {product_id}",
                "quantity": quantity,
                "unit": unit
            })
        logger.info(f"Extracted {len(cart_items)} items from structured order")

        transcription = data.get("transcription", None)
        if transcription:
            logger.info(f"Extracted transcription: {transcription[:100]}...")

        ai_response = data.get("ai_response", "")
        if ai_response:
            logger.info(f"Extracted AI response: {ai_response[:100]}...")

        return cart_items, transcription, ai_response


# Singleton instance
chat_service = ChatService()
