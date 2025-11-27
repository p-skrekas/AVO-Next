# Models package
from app.models.chat import ChatMessage, ChatRequest, ChatResponse, ChatHistory
from app.models.product import Product, ProductListResponse
from app.models.scenario import (
    StepStatus, CartItem, ModelExecutionResult, QuantityMismatch,
    CartComparisonResult, ScenarioStep, Scenario,
    CreateScenarioRequest, UpdateScenarioRequest,
    CreateStepRequest, UpdateStepRequest, UpdateStepModelResultRequest,
    ScenarioListResponse, ScenarioResponse,
    StepComparisonResponse, ScenarioComparisonResponse,
    MODELS_TO_EXECUTE
)

__all__ = [
    # Chat models
    "ChatMessage", "ChatRequest", "ChatResponse", "ChatHistory",
    # Product models
    "Product", "ProductListResponse",
    # Scenario models
    "StepStatus", "CartItem", "ModelExecutionResult", "QuantityMismatch",
    "CartComparisonResult", "ScenarioStep", "Scenario",
    "CreateScenarioRequest", "UpdateScenarioRequest",
    "CreateStepRequest", "UpdateStepRequest", "UpdateStepModelResultRequest",
    "ScenarioListResponse", "ScenarioResponse",
    "StepComparisonResponse", "ScenarioComparisonResponse",
    "MODELS_TO_EXECUTE",
]
