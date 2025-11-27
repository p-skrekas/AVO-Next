import vertexai
from vertexai.generative_models import GenerativeModel, Part
from pathlib import Path
import logging
from app.core.config import settings
import os

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(self):
        self.model = None
        self._initialize_gemini()

    def _initialize_gemini(self):
        """Initialize Gemini model for transcription"""
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

            self.model = GenerativeModel("gemini-2.0-flash-exp")
            logger.info("Gemini transcription service initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize Gemini for transcription: {e}")
            raise

    async def transcribe_audio_file(self, file_path: str, language: str = "Greek") -> str:
        """Transcribe an audio file using Gemini"""
        if not self.model:
            raise ValueError("Gemini model not initialized")

        try:
            logger.info(f"Transcribing audio file with Gemini: {file_path}")

            with open(file_path, "rb") as audio_file:
                audio_data = audio_file.read()

            file_ext = Path(file_path).suffix.lower()
            mime_type_map = {
                ".wav": "audio/wav",
                ".mp3": "audio/mp3",
                ".mpeg": "audio/mpeg",
                ".flac": "audio/flac",
                ".webm": "audio/webm",
                ".ogg": "audio/ogg",
                ".m4a": "audio/mp4",
            }

            mime_type = mime_type_map.get(file_ext, "audio/wav")

            audio_part = Part.from_data(data=audio_data, mime_type=mime_type)

            prompt = f"""Transcribe the following audio in {language}.
Provide ONLY the transcription text, without any additional comments or explanations.
The audio is from a customer ordering products at a tobacco shop."""

            response = self.model.generate_content([prompt, audio_part])
            transcription = response.text.strip()

            if not transcription:
                logger.warning(f"No transcription results for file: {file_path}")
                return ""

            logger.info(f"Transcription successful: {transcription[:100]}...")
            return transcription

        except Exception as e:
            logger.error(f"Error transcribing audio file {file_path}: {e}", exc_info=True)
            raise


# Singleton instance
transcription_service = TranscriptionService()
