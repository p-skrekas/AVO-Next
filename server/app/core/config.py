import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings:
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    GOOGLE_APPLICATION_CREDENTIALS: str = os.getenv(
        "GOOGLE_APPLICATION_CREDENTIALS",
        str(BASE_DIR / "service-account.json")
    )
    GCP_PROJECT_ID: str = os.getenv("GCP_PROJECT_ID", "mouhalis-voice-order")
    GCP_LOCATION: str = os.getenv("GCP_LOCATION", "us-central1")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # MongoDB settings
    MONGODB_USERNAME: str = os.getenv("MONGODB_USERNAME", "")
    MONGODB_PASSWORD: str = os.getenv("MONGODB_PASSWORD", "")
    MONGODB_CLUSTER_URL: str = os.getenv("MONGODB_CLUSTER_URL", "cluster1.33ddyxh.mongodb.net")
    MONGODB_DATABASE: str = os.getenv("MONGODB_DATABASE", "avo_next")

    @property
    def is_configured(self) -> bool:
        if self.GOOGLE_API_KEY:
            return True
        if self.GOOGLE_APPLICATION_CREDENTIALS:
            return Path(self.GOOGLE_APPLICATION_CREDENTIALS).exists()
        return False

    @property
    def mongodb_url(self) -> str:
        """Generate MongoDB connection URL"""
        if self.MONGODB_USERNAME and self.MONGODB_PASSWORD:
            return f"mongodb+srv://{self.MONGODB_USERNAME}:{self.MONGODB_PASSWORD}@{self.MONGODB_CLUSTER_URL}/?retryWrites=true&w=majority"
        return ""


settings = Settings()
