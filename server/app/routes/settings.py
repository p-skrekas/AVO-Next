"""API routes for global settings management."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.settings import settings_service, DEFAULT_SYSTEM_PROMPT
from app.core.database import mongodb
from app.core.prompt_builder import get_product_catalog_csv
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SystemPromptRequest(BaseModel):
    system_prompt: str


class SystemPromptResponse(BaseModel):
    system_prompt: str


@router.get("/system-prompt", response_model=SystemPromptResponse)
async def get_system_prompt():
    """Get the default system prompt"""
    prompt = settings_service.get_system_prompt()
    return SystemPromptResponse(system_prompt=prompt)


@router.put("/system-prompt", response_model=SystemPromptResponse)
async def update_system_prompt(request: SystemPromptRequest):
    """Update the default system prompt"""
    if not request.system_prompt.strip():
        raise HTTPException(status_code=400, detail="System prompt cannot be empty")

    success = settings_service.set_system_prompt(request.system_prompt)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save system prompt")

    return SystemPromptResponse(system_prompt=request.system_prompt)


@router.post("/system-prompt/reset")
async def reset_system_prompt():
    """Reset the system prompt to the default value"""
    success = settings_service.set_system_prompt(DEFAULT_SYSTEM_PROMPT)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to reset system prompt")
    logger.info("System prompt reset to default")
    return {"message": "System prompt reset to default", "system_prompt": DEFAULT_SYSTEM_PROMPT}


@router.get("/debug/catalog")
async def get_catalog_debug():
    """Debug endpoint to see what catalog data looks like"""
    try:
        raw_products = []
        if mongodb.is_connected():
            collection = mongodb.get_collection("products")
            products = list(collection.find().limit(10))
            for p in products:
                p.pop('_id', None)
                raw_products.append(p)

        catalog_csv = get_product_catalog_csv()
        catalog_lines = catalog_csv.split('\n')[:15]

        return {
            "mongodb_connected": mongodb.is_connected(),
            "raw_products_sample": raw_products,
            "catalog_csv_sample": catalog_lines,
            "total_catalog_lines": len(catalog_csv.split('\n'))
        }
    except Exception as e:
        logger.error(f"Error in catalog debug: {e}")
        raise HTTPException(status_code=500, detail=str(e))
