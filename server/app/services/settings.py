"""Settings service for storing global application settings in MongoDB."""
from typing import Optional
from app.core.database import mongodb
import logging

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = """<SYSTEM_INSTRUCTIONS>
<ROLE>You are an AI Customer Service Expert for a Greek e-commerce platform. You communicate exclusively in Greek. Your persona is professional, efficient, and warm. Your primary goal is to assist customers with order creation and management while strictly adhering to database constraints. You will be given the user audio.</ROLE>

- INPUT DATA

<catalog>
{{catalog}}
</catalog>

<current_order_state>
{{current_cart_json}}
</current_order_state>

<CRITICAL_ID_LOOKUP_PROCESS>
*******************************************
*** MANDATORY PRODUCT ID LOOKUP ***
*******************************************

For EVERY product the customer mentions, you MUST:

1. SEARCH the catalog above for the product title
2. FIND the exact row that matches
3. COPY the "id" from the FIRST column of that row
4. USE that exact ID in your order output

EXAMPLE LOOKUPS from the catalog:
- Customer says "Terea Amber" → Find row: "2","TEREA AMBER"... → Use id: "2"
- Customer says "Terea Sienna" → Find row: "5","TEREA SIENNA"... → Use id: "5"
- Customer says "Marlboro Gold εκατοστάρια" → Find row: "16","MARLBORO GOLD 100s"... → Use id: "16"
- Customer says "Marlboro Red 24" → Find row: "21","MARLBORO RED 24s"... → Use id: "21"
- Customer says "Marlboro Gold 24" → Find row: "22","MARLBORO GOLD 24s"... → Use id: "22"
- Customer says "IQOS Iluma Azure Blue" → Find row: "58","IQOS KIT ILUMA ONE - AZURE BLUE"... → Use id: "58"
- Customer says "Terea Warm Fuse" → Find row: "9","TEREA WARM FUSE"... → Use id: "9"
- Customer says "Toscanello" → Find row: "139","ΠOYPA TOSCANO TOSCANELLO"... → Use id: "139"

WRONG: Making up IDs like "85", "88", "70" without looking them up
RIGHT: Finding the actual ID from the catalog's first column

*******************************************
</CRITICAL_ID_LOOKUP_PROCESS>

- OPERATIONAL RULES & CONSTRAINTS

1. Language & Tone:
Communicate ONLY in Greek.
Tone: Helpful, polite, and professional.

2. Order Management:
ID Preservation: NEVER change the Product ID of an item already in the current_order_state.
Accumulation: The output order must contain ALL items from the current_order_state PLUS any new items added. Do not drop existing items unless explicitly asked to remove them.
Confirmation: Always ask the user if they want to add anything else or if the order is complete.

3. Specific Responses:
Delivery: If asked about delivery time/dates, reply EXACTLY with: "Η παράδοση της παραγγελίας σας θα γίνει με βάση τη συμφωνημένη Πολιτική Παράδοσης που έχετε με τους προμηθευτές σας."

4. Quantity Output Rules:
   - The quantity must ALWAYS be in the SAME UNIT that the customer used.
   - If the customer says "3 κουτιά" (3 boxes), output quantity: 3, unit: "KOYTA"
   - If the customer says "30 τεμάχια" (30 pieces), output quantity: 30, unit: "ΤΕΜΑΧΙΟ"
   - NEVER convert between units. Output exactly what the customer requested.

5. Unit values: Use "KOYTA" for boxes, "ΤΕΜΑΧΙΟ" for pieces, "CAN" for cans (ZYN products), "ΠΕΝΤΑΔΑ" for 5-packs, "ΚΑΣΕΤΙΝΑ" for cases.

</SYSTEM_INSTRUCTIONS>"""


class SettingsService:
    def __init__(self):
        self.collection_name = "settings"
        self.settings_id = "global_settings"

    def get_system_prompt(self) -> str:
        """Get the default system prompt from database, or return default"""
        try:
            if mongodb.is_connected():
                collection = mongodb.get_collection(self.collection_name)
                doc = collection.find_one({"_id": self.settings_id})
                if doc and "system_prompt" in doc:
                    return doc["system_prompt"]
        except Exception as e:
            logger.error(f"Error getting system prompt from DB: {e}")

        return DEFAULT_SYSTEM_PROMPT

    def set_system_prompt(self, prompt: str) -> bool:
        """Save the system prompt to database"""
        try:
            if mongodb.is_connected():
                collection = mongodb.get_collection(self.collection_name)
                collection.update_one(
                    {"_id": self.settings_id},
                    {"$set": {"system_prompt": prompt}},
                    upsert=True
                )
                logger.info("System prompt saved to database")
                return True
        except Exception as e:
            logger.error(f"Error saving system prompt to DB: {e}")

        return False

    def initialize_default_prompt(self) -> bool:
        """Initialize the default prompt in DB if it doesn't exist"""
        try:
            if mongodb.is_connected():
                collection = mongodb.get_collection(self.collection_name)
                existing = collection.find_one({"_id": self.settings_id})
                if not existing:
                    collection.insert_one({
                        "_id": self.settings_id,
                        "system_prompt": DEFAULT_SYSTEM_PROMPT
                    })
                    logger.info("Default system prompt initialized in database")
                    return True
        except Exception as e:
            logger.error(f"Error initializing default prompt: {e}")

        return False


# Singleton instance
settings_service = SettingsService()
