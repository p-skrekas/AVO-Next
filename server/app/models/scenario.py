from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class StepStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


# Models to execute for comparison
MODELS_TO_EXECUTE = ["gemini-2.5-pro", "gemini-2.5-flash"]


class CartItem(BaseModel):
    product_id: str
    product_name: str
    quantity: int
    unit: str = Field(default="KOYTA", description="Unit type: KOYTA (package) or ΤΕΜΑΧΙΟ (piece)")


class ModelExecutionResult(BaseModel):
    """Results from executing a step with a specific model"""
    model_name: str
    llm_transcription: Optional[str] = None
    ai_response: Optional[str] = None
    raw_llm_response: Optional[str] = None
    predicted_cart: Optional[List[CartItem]] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    executed_at: Optional[datetime] = None
    error: Optional[str] = None


class QuantityMismatch(BaseModel):
    """Represents a quantity mismatch between ground truth and prediction"""
    product_id: str
    product_name: str
    expected_quantity: int
    actual_quantity: int
    unit: str


class CartComparisonResult(BaseModel):
    """Comparison metrics between ground truth and predicted cart"""
    model_name: str
    precision: float = Field(0.0, description="Correct items / predicted items")
    recall: float = Field(0.0, description="Correct items / ground truth items")
    f1_score: float = Field(0.0, description="Harmonic mean of precision and recall")
    exact_match: bool = Field(False, description="Whether predicted cart exactly matches ground truth")
    missing_items: List[CartItem] = Field(default_factory=list, description="Items in ground truth but not predicted")
    extra_items: List[CartItem] = Field(default_factory=list, description="Items predicted but not in ground truth")
    quantity_mismatches: List[QuantityMismatch] = Field(default_factory=list, description="Items with wrong quantities")


class ScenarioStep(BaseModel):
    step_id: str = Field(..., description="Unique step identifier")
    step_number: int = Field(..., description="Order of the step in the scenario")
    voice_file_path: Optional[str] = Field(None, description="Path to uploaded voice file")
    voice_text: Optional[str] = Field(None, description="Transcribed text from voice (user input / ground truth)")
    ground_truth_cart: List[CartItem] = Field(default_factory=list, description="Expected cart items")
    # Multi-model execution results
    model_results: Dict[str, ModelExecutionResult] = Field(default_factory=dict, description="Results per model")
    # Legacy single-model fields (kept for backward compatibility)
    llm_transcription: Optional[str] = Field(None, description="LLM's interpretation/transcription of the user input")
    ai_response: Optional[str] = Field(None, description="AI assistant's response to the user")
    raw_llm_response: Optional[str] = Field(None, description="Full raw response from LLM (including XML)")
    predicted_cart: Optional[List[CartItem]] = Field(None, description="AI predicted cart items")
    input_tokens: Optional[int] = Field(None, description="Number of input tokens used")
    output_tokens: Optional[int] = Field(None, description="Number of output tokens generated")
    latency_ms: Optional[int] = Field(None, description="Latency in milliseconds")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class Scenario(BaseModel):
    scenario_id: str = Field(..., description="Unique scenario identifier")
    name: str = Field(..., description="Scenario name")
    description: Optional[str] = Field(None, description="Scenario description")
    system_prompt: str = Field(
        default="You are a helpful voice ordering assistant for a tobacco shop. Listen to customer requests and help them build their shopping cart.",
        description="System prompt for the LLM"
    )
    model_name: str = Field(
        default="gemini-2.5-pro",
        description="LLM model to use for this scenario"
    )
    steps: List[ScenarioStep] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


# Request/Response models
class CreateScenarioRequest(BaseModel):
    name: str
    description: Optional[str] = None
    num_steps: int = Field(1, ge=1, le=50, description="Number of steps to create")


class UpdateScenarioRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model_name: Optional[str] = None


class CreateStepRequest(BaseModel):
    step_number: int
    ground_truth_cart: List[CartItem] = Field(default_factory=list)


class UpdateStepRequest(BaseModel):
    voice_text: Optional[str] = None
    llm_transcription: Optional[str] = None
    ai_response: Optional[str] = None
    raw_llm_response: Optional[str] = None
    ground_truth_cart: Optional[List[CartItem]] = None
    predicted_cart: Optional[List[CartItem]] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None


class UpdateStepModelResultRequest(BaseModel):
    """Request to update a specific model's execution result for a step"""
    model_name: str
    llm_transcription: Optional[str] = None
    ai_response: Optional[str] = None
    raw_llm_response: Optional[str] = None
    predicted_cart: Optional[List[CartItem]] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


class ScenarioListResponse(BaseModel):
    scenarios: List[Scenario]
    total: int


class ScenarioResponse(BaseModel):
    scenario: Scenario


class StepComparisonResponse(BaseModel):
    """Comparison results for a single step across all models"""
    step_id: str
    step_number: int
    ground_truth_cart: List[CartItem]
    comparisons: List[CartComparisonResult]


class ScenarioComparisonResponse(BaseModel):
    """Full comparison results for a scenario"""
    scenario_id: str
    scenario_name: str
    steps: List[StepComparisonResponse]
    summary: Dict[str, Any] = Field(default_factory=dict, description="Aggregate metrics per model")
