"""AI Service for generating simulated ground truth orders for testing."""
import vertexai
from vertexai.generative_models import GenerativeModel
from typing import List, Optional, Tuple
from app.core.config import settings
from app.models.scenario import CartItem, ScenarioStep
from app.core.database import mongodb
import logging
import json
import re

logger = logging.getLogger(__name__)


class OrderGenerationService:
    def __init__(self):
        self.model = None
        self._initialize_model()

    def _initialize_model(self):
        """Initialize the Vertex AI model for order generation"""
        try:
            vertexai.init(
                project=settings.GCP_PROJECT_ID,
                location=settings.GCP_LOCATION
            )
            self.model = GenerativeModel("gemini-2.5-flash")
            logger.info("Order generation service initialized with gemini-2.5-flash")
        except Exception as e:
            logger.error(f"Failed to initialize order generation model: {e}")

    def _get_product_catalog(self) -> str:
        """Get the product catalog as a formatted string"""
        try:
            if mongodb.is_connected():
                collection = mongodb.get_collection("products")
                products = list(collection.find())

                catalog_lines = ["ID,Title,Units Relation,Main Unit,Secondary Unit"]
                for p in products:
                    p.pop('_id', None)
                    product_id = p.get('product_id', p.get('id', ''))
                    title = p.get('title', '')
                    units_relation = p.get('units_relation', 10)
                    main_unit = p.get('main_unit_description', 'ΤΕΜΑΧΙΟ')
                    secondary_unit = p.get('secondary_unit_description', 'KOYTA')
                    catalog_lines.append(f"{product_id},{title},{units_relation},{main_unit},{secondary_unit}")

                return "\n".join(catalog_lines)
            else:
                logger.warning("MongoDB not connected, using empty catalog")
                return "No products available"
        except Exception as e:
            logger.error(f"Error getting product catalog: {e}")
            return "Error loading catalog"

    def _build_context_from_previous_steps(
        self,
        previous_steps: List[ScenarioStep]
    ) -> str:
        """Build conversation context from previous steps"""
        if not previous_steps:
            return ""

        context_parts = ["Previous steps in the conversation:"]
        for step in sorted(previous_steps, key=lambda s: s.step_number):
            context_parts.append(f"\n--- Step {step.step_number} ---")
            context_parts.append(f"Customer said: {step.voice_text or 'No transcription'}")

            if step.ground_truth_cart:
                cart_items = [
                    f"  - {item.product_name} (ID: {item.product_id}): {item.quantity} {item.unit}"
                    for item in step.ground_truth_cart
                ]
                context_parts.append("Cart after this step:")
                context_parts.extend(cart_items)
            else:
                context_parts.append("Cart after this step: Empty")

        return "\n".join(context_parts)

    async def generate_order(
        self,
        step_number: int,
        previous_steps: Optional[List[ScenarioStep]] = None
    ) -> Tuple[str, List[CartItem]]:
        """Generate a simulated order for testing purposes."""
        if not self.model:
            raise ValueError("Order generation model not initialized")

        try:
            catalog = self._get_product_catalog()
            context = self._build_context_from_previous_steps(previous_steps or [])

            is_first_step = step_number == 1 or not previous_steps or len(previous_steps) == 0

            if is_first_step:
                prompt = f"""You are generating test data for a voice ordering system for a Greek tobacco/convenience store.

Generate a realistic initial order from a customer. The customer should order between 10 and 20 different products from the catalog below.

<product_catalog>
{catalog}
</product_catalog>

Generate:
1. A natural Greek transcription of what the customer would say when placing this order
2. The cart items

OUTPUT FORMAT (JSON only, no other text):
{{
  "transcription": "The Greek text of what the customer said, e.g., Θέλω 3 κουτιά TEREA RUSSET, 5 κουτιά TEREA AMBER...",
  "cart": [
    {{"product_id": "1", "product_name": "TEREA RUSSET", "quantity": 3, "unit": "KOYTA"}},
    {{"product_id": "2", "product_name": "TEREA AMBER", "quantity": 5, "unit": "KOYTA"}}
  ]
}}

Rules:
- Use products from the catalog only
- Quantities should be realistic (1-10 boxes typically)
- Unit should be "KOYTA" (box/package) for most orders
- The transcription should be natural Greek speech
- Include 10-20 different products
"""
            else:
                prompt = f"""You are generating test data for a voice ordering system for a Greek tobacco/convenience store.

This is step {step_number} of a multi-step ordering conversation. The customer already has items in their cart and now wants to MODIFY their order.

<product_catalog>
{catalog}
</product_catalog>

<previous_conversation>
{context}
</previous_conversation>

Generate a realistic modification to the order. The customer should do ONE of these:
- Add 2-5 new products to the cart
- Remove 1-3 products from the cart
- Change quantities of 2-4 existing products
- A combination of adding, removing, and changing quantities

Generate:
1. A natural Greek transcription of what the customer would say
2. The COMPLETE cart after this modification (not just the changes)

OUTPUT FORMAT (JSON only, no other text):
{{
  "transcription": "The Greek text of what the customer said, e.g., Θέλω να προσθέσω 2 κουτιά TEREA SIENNA και να αφαιρέσω το TEREA AMBER",
  "cart": [
    {{"product_id": "1", "product_name": "TEREA RUSSET", "quantity": 3, "unit": "KOYTA"}},
    {{"product_id": "5", "product_name": "TEREA SIENNA", "quantity": 2, "unit": "KOYTA"}}
  ]
}}

Rules:
- The cart array should contain the COMPLETE cart state after modifications
- Use products from the catalog only
- The transcription should clearly indicate what changes the customer wants
- Be realistic - customers often add forgotten items, remove items they changed their mind about, or adjust quantities
"""

            logger.info(f"Generating order for step {step_number}, is_first_step={is_first_step}")

            response = self.model.generate_content(prompt)
            response_text = response.text.strip()

            logger.info(f"Raw order generation response: {response_text[:500]}...")

            transcription, cart_items = self._parse_response(response_text)

            logger.info(f"Generated transcription: {transcription[:100]}...")
            logger.info(f"Generated {len(cart_items)} cart items")

            return transcription, cart_items

        except Exception as e:
            logger.error(f"Error generating order: {e}", exc_info=True)
            raise

    def _parse_response(self, response_text: str) -> Tuple[str, List[CartItem]]:
        """Parse the LLM response into transcription and CartItem objects"""
        try:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                json_str = json_match.group()
                data = json.loads(json_str)
            else:
                data = json.loads(response_text)

            if not isinstance(data, dict):
                logger.warning(f"Expected dict, got {type(data)}")
                return "", []

            transcription = data.get('transcription', '')
            cart_data = data.get('cart', [])

            cart_items = []
            if isinstance(cart_data, list):
                for item in cart_data:
                    if isinstance(item, dict):
                        cart_items.append(CartItem(
                            product_id=str(item.get('product_id', '')),
                            product_name=item.get('product_name', ''),
                            quantity=int(item.get('quantity', 0)),
                            unit=item.get('unit', 'KOYTA')
                        ))

            return transcription, cart_items

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse order response as JSON: {e}")
            logger.error(f"Response was: {response_text}")
            return "", []
        except Exception as e:
            logger.error(f"Error parsing order response: {e}")
            return "", []


# Singleton instance
order_generation_service = OrderGenerationService()
