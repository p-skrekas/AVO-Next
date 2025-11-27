# Routes package
from app.routes.scenario import router as scenario_router
from app.routes.product import router as product_router
from app.routes.settings import router as settings_router

__all__ = ["scenario_router", "product_router", "settings_router"]
