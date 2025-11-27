from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


class MongoDB:
    def __init__(self):
        self.client: MongoClient = None
        self.db: Database = None
        self._connect()

    def _connect(self):
        """Initialize MongoDB connection"""
        try:
            if not settings.mongodb_url:
                logger.warning("MongoDB URL not configured. Using in-memory storage.")
                return

            self.client = MongoClient(settings.mongodb_url)
            self.db = self.client[settings.MONGODB_DATABASE]

            # Test connection
            self.client.admin.command('ping')
            logger.info(f"Successfully connected to MongoDB database: {settings.MONGODB_DATABASE}")

        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            self.client = None
            self.db = None

    def get_collection(self, collection_name: str) -> Collection:
        """Get a MongoDB collection"""
        if self.db is None:
            raise ConnectionError("MongoDB not connected")
        return self.db[collection_name]

    def is_connected(self) -> bool:
        """Check if MongoDB is connected"""
        return self.client is not None and self.db is not None

    def close(self):
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
            logger.info("MongoDB connection closed")


# Singleton instance
mongodb = MongoDB()
