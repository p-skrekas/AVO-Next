"""Utility for building system prompts with actual catalog and cart data."""
from typing import List, Optional
from app.core.database import mongodb
from app.models.scenario import CartItem
import logging

logger = logging.getLogger(__name__)


def get_product_catalog_csv() -> str:
    """Get the product catalog as a CSV formatted string"""
    try:
        if mongodb.is_connected():
            collection = mongodb.get_collection("products")
            products = list(collection.find())

            catalog_lines = ['"id","title","units_relation","main_unit_description","secondary_unit_description"']
            for p in products:
                p.pop('_id', None)
                product_id = p.get('product_id', p.get('id', ''))
                title = p.get('title', '')
                units_relation = p.get('units_relation', 10)
                main_unit = p.get('main_unit_description', 'ΤΕΜΑΧΙΟ')
                secondary_unit = p.get('secondary_unit_description', 'KOYTA')
                catalog_lines.append(f'"{product_id}","{title}","{units_relation}","{main_unit}","{secondary_unit}"')

            logger.info(f"Loaded {len(products)} products for catalog")
            return "\n".join(catalog_lines)
        else:
            logger.warning("MongoDB not connected, using empty catalog")
            return "No products available"
    except Exception as e:
        logger.error(f"Error getting product catalog: {e}")
        return "Error loading catalog"


def build_cart_json(cart_items: Optional[List[CartItem]]) -> str:
    """Build JSON representation of current cart state"""
    if not cart_items or len(cart_items) == 0:
        return "[]"

    import json
    cart_list = []
    for item in cart_items:
        cart_list.append({
            "id": item.product_id,
            "quantity": item.quantity,
            "unit": item.unit
        })

    return json.dumps(cart_list, ensure_ascii=False, indent=2)


def build_system_prompt(
    template: str,
    current_cart: Optional[List[CartItem]] = None
) -> str:
    """
    Build the complete system prompt by replacing placeholders with actual data.

    Placeholders:
    - {{catalog}} - Replaced with the product catalog from database
    - {{current_cart_json}} - Replaced with the current cart state as JSON
    """
    catalog = get_product_catalog_csv()
    cart_json = build_cart_json(current_cart)

    catalog_lines = catalog.split('\n')
    logger.info(f"Catalog has {len(catalog_lines)} lines (including header)")
    if len(catalog_lines) > 1:
        logger.info(f"Catalog header: {catalog_lines[0]}")
        logger.info(f"First product: {catalog_lines[1] if len(catalog_lines) > 1 else 'N/A'}")
    else:
        logger.warning(f"Catalog appears empty or has issues: {catalog[:500]}")

    prompt = template.replace("{{catalog}}", catalog)
    prompt = prompt.replace("{{current_cart_json}}", cart_json)

    if "{{catalog}}" in prompt:
        logger.error("PLACEHOLDER {{catalog}} WAS NOT REPLACED!")
    if "{{current_cart_json}}" in prompt:
        logger.error("PLACEHOLDER {{current_cart_json}} WAS NOT REPLACED!")

    logger.info(f"Built system prompt with {len(catalog)} chars of catalog data, cart has {len(current_cart) if current_cart else 0} items")

    return prompt
