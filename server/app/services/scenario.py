from typing import Dict, List, Optional, Any
from app.models.scenario import (
    Scenario, ScenarioStep, CreateScenarioRequest,
    UpdateScenarioRequest, CreateStepRequest, UpdateStepRequest,
    ModelExecutionResult, CartItem, CartComparisonResult, QuantityMismatch,
    UpdateStepModelResultRequest, MODELS_TO_EXECUTE
)
from app.core.database import mongodb
from app.services.settings import settings_service
import uuid
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class ScenarioService:
    def __init__(self):
        self.collection_name = "scenarios"
        self.scenarios: Dict[str, Scenario] = {}
        self.use_mongodb = mongodb.is_connected()

        if self.use_mongodb:
            logger.info("Using MongoDB for scenario storage")
        else:
            logger.warning("Using in-memory storage for scenarios")

    def create_scenario(self, request: CreateScenarioRequest) -> Scenario:
        """Create a new scenario with specified number of steps"""
        scenario_id = str(uuid.uuid4())

        steps = []
        for i in range(request.num_steps):
            step = ScenarioStep(
                step_id=str(uuid.uuid4()),
                step_number=i + 1,
                ground_truth_cart=[]
            )
            steps.append(step)

        default_system_prompt = settings_service.get_system_prompt()

        scenario = Scenario(
            scenario_id=scenario_id,
            name=request.name,
            description=request.description,
            system_prompt=default_system_prompt,
            steps=steps
        )

        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            collection.insert_one(scenario.model_dump(mode='json'))
        else:
            self.scenarios[scenario_id] = scenario

        logger.info(f"Created scenario {scenario_id} with {request.num_steps} steps")
        return scenario

    def get_scenario(self, scenario_id: str) -> Optional[Scenario]:
        """Get a scenario by ID"""
        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            doc = collection.find_one({"scenario_id": scenario_id})
            if doc:
                doc.pop('_id', None)
                scenario = Scenario.model_validate(doc)
                return scenario
            return None
        else:
            return self.scenarios.get(scenario_id)

    def list_scenarios(self) -> List[Scenario]:
        """List all scenarios"""
        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            scenarios = []
            for doc in collection.find():
                doc.pop('_id', None)
                scenarios.append(Scenario.model_validate(doc))
            return scenarios
        else:
            return list(self.scenarios.values())

    def update_scenario(self, scenario_id: str, request: UpdateScenarioRequest) -> Optional[Scenario]:
        """Update scenario metadata"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        if request.name:
            scenario.name = request.name
        if request.description is not None:
            scenario.description = request.description
        if request.system_prompt is not None:
            scenario.system_prompt = request.system_prompt
        if request.model_name is not None:
            scenario.model_name = request.model_name

        scenario.updated_at = datetime.now()

        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            collection.update_one(
                {"scenario_id": scenario_id},
                {"$set": scenario.model_dump(mode='json')}
            )
        else:
            self.scenarios[scenario_id] = scenario

        logger.info(f"Updated scenario {scenario_id}")
        return scenario

    def delete_scenario(self, scenario_id: str) -> bool:
        """Delete a scenario"""
        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            result = collection.delete_one({"scenario_id": scenario_id})
            if result.deleted_count > 0:
                logger.info(f"Deleted scenario {scenario_id}")
                return True
            return False
        else:
            if scenario_id in self.scenarios:
                del self.scenarios[scenario_id]
                logger.info(f"Deleted scenario {scenario_id}")
                return True
            return False

    def get_step(self, scenario_id: str, step_id: str) -> Optional[ScenarioStep]:
        """Get a specific step from a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        for step in scenario.steps:
            if step.step_id == step_id:
                return step
        return None

    def update_step(self, scenario_id: str, step_id: str, request: UpdateStepRequest) -> Optional[ScenarioStep]:
        """Update a step in a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        for step in scenario.steps:
            if step.step_id == step_id:
                if request.voice_text is not None:
                    step.voice_text = request.voice_text
                if request.llm_transcription is not None:
                    step.llm_transcription = request.llm_transcription
                if request.ai_response is not None:
                    step.ai_response = request.ai_response
                if request.raw_llm_response is not None:
                    step.raw_llm_response = request.raw_llm_response
                if request.ground_truth_cart is not None:
                    step.ground_truth_cart = request.ground_truth_cart
                if request.predicted_cart is not None:
                    step.predicted_cart = request.predicted_cart
                if request.input_tokens is not None:
                    step.input_tokens = request.input_tokens
                if request.output_tokens is not None:
                    step.output_tokens = request.output_tokens
                if request.latency_ms is not None:
                    step.latency_ms = request.latency_ms

                step.updated_at = datetime.now()
                scenario.updated_at = datetime.now()

                if self.use_mongodb:
                    collection = mongodb.get_collection(self.collection_name)
                    collection.update_one(
                        {"scenario_id": scenario_id},
                        {"$set": scenario.model_dump(mode='json')}
                    )
                else:
                    self.scenarios[scenario_id] = scenario

                logger.info(f"Updated step {step_id} in scenario {scenario_id}")
                return step

        return None

    def add_step(self, scenario_id: str, request: CreateStepRequest) -> Optional[ScenarioStep]:
        """Add a new step to a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        step = ScenarioStep(
            step_id=str(uuid.uuid4()),
            step_number=request.step_number,
            ground_truth_cart=request.ground_truth_cart
        )

        scenario.steps.append(step)
        scenario.steps.sort(key=lambda x: x.step_number)
        scenario.updated_at = datetime.now()

        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            collection.update_one(
                {"scenario_id": scenario_id},
                {"$set": scenario.model_dump(mode='json')}
            )
        else:
            self.scenarios[scenario_id] = scenario

        logger.info(f"Added step to scenario {scenario_id}")
        return step

    def delete_step(self, scenario_id: str, step_id: str) -> bool:
        """Delete a step from a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return False

        for i, step in enumerate(scenario.steps):
            if step.step_id == step_id:
                scenario.steps.pop(i)
                scenario.updated_at = datetime.now()

                if self.use_mongodb:
                    collection = mongodb.get_collection(self.collection_name)
                    collection.update_one(
                        {"scenario_id": scenario_id},
                        {"$set": scenario.model_dump(mode='json')}
                    )
                else:
                    self.scenarios[scenario_id] = scenario

                logger.info(f"Deleted step {step_id} from scenario {scenario_id}")
                return True

        return False

    def update_voice_file(self, scenario_id: str, step_id: str, file_path: str) -> Optional[ScenarioStep]:
        """Update the voice file path for a step"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        for step in scenario.steps:
            if step.step_id == step_id:
                step.voice_file_path = file_path
                step.updated_at = datetime.now()
                scenario.updated_at = datetime.now()

                if self.use_mongodb:
                    collection = mongodb.get_collection(self.collection_name)
                    collection.update_one(
                        {"scenario_id": scenario_id},
                        {"$set": scenario.model_dump(mode='json')}
                    )
                else:
                    self.scenarios[scenario_id] = scenario

                logger.info(f"Updated voice file for step {step_id}")
                return step

        return None

    def clone_scenario(self, scenario_id: str, new_name: Optional[str] = None) -> Optional[Scenario]:
        """Clone/duplicate a scenario with all its steps"""
        original = self.get_scenario(scenario_id)
        if not original:
            return None

        new_scenario_id = str(uuid.uuid4())
        now = datetime.now()

        cloned_steps = []
        for step in original.steps:
            cloned_step = ScenarioStep(
                step_id=str(uuid.uuid4()),
                step_number=step.step_number,
                voice_file_path=step.voice_file_path,
                voice_text=step.voice_text,
                llm_transcription=None,
                ai_response=None,
                raw_llm_response=None,
                ground_truth_cart=step.ground_truth_cart.copy() if step.ground_truth_cart else [],
                predicted_cart=None,
                model_results={},
                input_tokens=None,
                output_tokens=None,
                latency_ms=None,
                created_at=now,
                updated_at=now
            )
            cloned_steps.append(cloned_step)

        cloned_scenario = Scenario(
            scenario_id=new_scenario_id,
            name=new_name or f"{original.name} (Copy)",
            description=original.description,
            system_prompt=original.system_prompt,
            model_name=original.model_name,
            steps=cloned_steps,
            created_at=now,
            updated_at=now
        )

        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            collection.insert_one(cloned_scenario.model_dump(mode='json'))
        else:
            self.scenarios[new_scenario_id] = cloned_scenario

        logger.info(f"Cloned scenario {scenario_id} to {new_scenario_id}")
        return cloned_scenario

    def update_step_model_result(
        self,
        scenario_id: str,
        step_id: str,
        request: UpdateStepModelResultRequest
    ) -> Optional[ScenarioStep]:
        """Update a specific model's execution result for a step"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        for step in scenario.steps:
            if step.step_id == step_id:
                model_result = ModelExecutionResult(
                    model_name=request.model_name,
                    llm_transcription=request.llm_transcription,
                    ai_response=request.ai_response,
                    raw_llm_response=request.raw_llm_response,
                    predicted_cart=request.predicted_cart,
                    input_tokens=request.input_tokens,
                    output_tokens=request.output_tokens,
                    latency_ms=request.latency_ms,
                    executed_at=datetime.now(),
                    error=request.error
                )

                step.model_results[request.model_name] = model_result
                step.updated_at = datetime.now()
                scenario.updated_at = datetime.now()

                if self.use_mongodb:
                    collection = mongodb.get_collection(self.collection_name)
                    scenario_data = scenario.model_dump(mode='json')
                    collection.update_one(
                        {"scenario_id": scenario_id},
                        {"$set": scenario_data}
                    )
                else:
                    self.scenarios[scenario_id] = scenario

                logger.info(f"Updated model result for {request.model_name} in step {step_id}")
                return step

        return None

    def clear_step_model_results(self, scenario_id: str) -> bool:
        """Clear all model execution results for a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return False

        for step in scenario.steps:
            step.model_results = {}
            step.llm_transcription = None
            step.ai_response = None
            step.raw_llm_response = None
            step.predicted_cart = None
            step.input_tokens = None
            step.output_tokens = None
            step.latency_ms = None
            step.updated_at = datetime.now()

        scenario.updated_at = datetime.now()

        if self.use_mongodb:
            collection = mongodb.get_collection(self.collection_name)
            collection.update_one(
                {"scenario_id": scenario_id},
                {"$set": scenario.model_dump(mode='json')}
            )
        else:
            self.scenarios[scenario_id] = scenario

        logger.info(f"Cleared all model results for scenario {scenario_id}")
        return True

    @staticmethod
    def compare_carts(
        ground_truth: List[CartItem],
        predicted: Optional[List[CartItem]],
        model_name: str
    ) -> CartComparisonResult:
        """Compare predicted cart against ground truth and calculate metrics"""
        if not predicted:
            predicted = []

        gt_dict = {item.product_id: item for item in ground_truth}
        pred_dict = {item.product_id: item for item in predicted}

        correct_count = 0
        missing_items = []
        extra_items = []
        quantity_mismatches = []

        for product_id, gt_item in gt_dict.items():
            if product_id in pred_dict:
                pred_item = pred_dict[product_id]

                logger.debug(f"Comparing {product_id}: GT={gt_item.quantity} {gt_item.unit}, "
                           f"Pred={pred_item.quantity} {pred_item.unit}")

                if pred_item.quantity == gt_item.quantity:
                    correct_count += 1
                else:
                    quantity_mismatches.append(QuantityMismatch(
                        product_id=product_id,
                        product_name=gt_item.product_name,
                        expected_quantity=gt_item.quantity,
                        actual_quantity=pred_item.quantity,
                        unit=gt_item.unit
                    ))
            else:
                missing_items.append(gt_item)

        for product_id, pred_item in pred_dict.items():
            if product_id not in gt_dict:
                extra_items.append(pred_item)

        total_gt = len(ground_truth)
        total_pred = len(predicted)

        precision = correct_count / total_pred if total_pred > 0 else 0.0
        recall = correct_count / total_gt if total_gt > 0 else 0.0
        f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

        exact_match = (
            len(missing_items) == 0 and
            len(extra_items) == 0 and
            len(quantity_mismatches) == 0 and
            total_gt == total_pred
        )

        return CartComparisonResult(
            model_name=model_name,
            precision=round(precision, 4),
            recall=round(recall, 4),
            f1_score=round(f1_score, 4),
            exact_match=exact_match,
            missing_items=missing_items,
            extra_items=extra_items,
            quantity_mismatches=quantity_mismatches
        )

    def get_scenario_comparison(self, scenario_id: str) -> Optional[Dict[str, Any]]:
        """Get comparison results for all steps and models in a scenario"""
        scenario = self.get_scenario(scenario_id)
        if not scenario:
            return None

        steps_comparison = []
        model_summaries: Dict[str, Dict[str, Any]] = {
            model: {
                "total_precision": 0.0,
                "total_recall": 0.0,
                "total_f1": 0.0,
                "exact_matches": 0,
                "total_steps": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_latency_ms": 0,
                "total_cost": 0.0
            }
            for model in MODELS_TO_EXECUTE
        }

        for step in sorted(scenario.steps, key=lambda s: s.step_number):
            if not step.ground_truth_cart:
                continue

            step_comparisons = []
            for model_name in MODELS_TO_EXECUTE:
                model_result = step.model_results.get(model_name)
                predicted_cart = model_result.predicted_cart if model_result else None

                comparison = self.compare_carts(
                    step.ground_truth_cart,
                    predicted_cart,
                    model_name
                )
                step_comparisons.append(comparison)

                if model_result:
                    model_summaries[model_name]["total_precision"] += comparison.precision
                    model_summaries[model_name]["total_recall"] += comparison.recall
                    model_summaries[model_name]["total_f1"] += comparison.f1_score
                    model_summaries[model_name]["exact_matches"] += 1 if comparison.exact_match else 0
                    model_summaries[model_name]["total_steps"] += 1
                    model_summaries[model_name]["total_input_tokens"] += model_result.input_tokens or 0
                    model_summaries[model_name]["total_output_tokens"] += model_result.output_tokens or 0
                    model_summaries[model_name]["total_latency_ms"] += model_result.latency_ms or 0

            steps_comparison.append({
                "step_id": step.step_id,
                "step_number": step.step_number,
                "ground_truth_cart": [item.model_dump() for item in step.ground_truth_cart],
                "comparisons": [c.model_dump() for c in step_comparisons]
            })

        for model_name, summary in model_summaries.items():
            total = summary["total_steps"]
            if total > 0:
                summary["avg_precision"] = round(summary["total_precision"] / total, 4)
                summary["avg_recall"] = round(summary["total_recall"] / total, 4)
                summary["avg_f1"] = round(summary["total_f1"] / total, 4)
                summary["exact_match_rate"] = round(summary["exact_matches"] / total, 4)
            else:
                summary["avg_precision"] = 0.0
                summary["avg_recall"] = 0.0
                summary["avg_f1"] = 0.0
                summary["exact_match_rate"] = 0.0

        return {
            "scenario_id": scenario_id,
            "scenario_name": scenario.name,
            "steps": steps_comparison,
            "summary": model_summaries
        }


# Singleton instance
scenario_service = ScenarioService()
