from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from app.models.scenario import (
    CreateScenarioRequest, UpdateScenarioRequest,
    CreateStepRequest, UpdateStepRequest,
    ScenarioListResponse, ScenarioResponse, Scenario, CartItem, ScenarioStep,
    UpdateStepModelResultRequest, MODELS_TO_EXECUTE
)
from app.services.scenario import scenario_service
from app.services.chat import chat_service
from app.services.transcription import transcription_service
from app.services.order_generation import order_generation_service
from app.core.prompt_builder import build_system_prompt
import logging
import os
import asyncio
from pathlib import Path
from typing import Dict, Optional, List
from enum import Enum
from datetime import datetime
from collections import deque
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class QueuedScenario(BaseModel):
    scenario_id: str
    scenario_name: str
    queued_at: str
    priority: int = 0


class ExecutionQueueStatus(BaseModel):
    queue: List[QueuedScenario]
    currently_executing: Optional[str] = None
    is_batch_running: bool = False


# Track execution status for each scenario
execution_status: Dict[str, Dict] = {}
cancelled_scenarios: set = set()
execution_queue: deque = deque()
batch_execution_running = False
batch_execution_task = None
execution_logs: Dict[str, List[Dict]] = {}

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

# Create uploads directory
UPLOAD_DIR = Path("uploads/voice_files")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def add_execution_log(scenario_id: str, level: str, message: str, details: Optional[Dict] = None):
    """Add a log entry for scenario execution"""
    if scenario_id not in execution_logs:
        execution_logs[scenario_id] = []

    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": message,
        "details": details or {}
    }
    execution_logs[scenario_id].append(log_entry)

    if len(execution_logs[scenario_id]) > 100:
        execution_logs[scenario_id] = execution_logs[scenario_id][-100:]


def is_scenario_cancelled(scenario_id: str) -> bool:
    return scenario_id in cancelled_scenarios


@router.post("/", response_model=ScenarioResponse)
async def create_scenario(request: CreateScenarioRequest):
    """Create a new scenario"""
    try:
        scenario = scenario_service.create_scenario(request)
        return ScenarioResponse(scenario=scenario)
    except Exception as e:
        logger.error(f"Error creating scenario: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=ScenarioListResponse)
async def list_scenarios():
    """List all scenarios"""
    try:
        scenarios = scenario_service.list_scenarios()
        return ScenarioListResponse(scenarios=scenarios, total=len(scenarios))
    except Exception as e:
        logger.error(f"Error listing scenarios: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{scenario_id}", response_model=ScenarioResponse)
async def get_scenario(scenario_id: str):
    """Get a specific scenario"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return ScenarioResponse(scenario=scenario)


@router.put("/{scenario_id}", response_model=ScenarioResponse)
async def update_scenario(scenario_id: str, request: UpdateScenarioRequest):
    """Update scenario metadata"""
    scenario = scenario_service.update_scenario(scenario_id, request)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return ScenarioResponse(scenario=scenario)


@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str):
    """Delete a scenario"""
    success = scenario_service.delete_scenario(scenario_id)
    if not success:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"message": "Scenario deleted successfully"}


@router.post("/{scenario_id}/clone", response_model=ScenarioResponse)
async def clone_scenario(scenario_id: str, new_name: Optional[str] = None):
    """Clone/duplicate a scenario with all its steps"""
    scenario = scenario_service.clone_scenario(scenario_id, new_name)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return ScenarioResponse(scenario=scenario)


@router.post("/{scenario_id}/reset-prompt", response_model=ScenarioResponse)
async def reset_scenario_prompt(scenario_id: str):
    """Reset a scenario's system prompt to the current default"""
    from app.services.settings import settings_service

    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    default_prompt = settings_service.get_system_prompt()
    updated = scenario_service.update_scenario(
        scenario_id,
        UpdateScenarioRequest(system_prompt=default_prompt)
    )

    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update scenario prompt")

    logger.info(f"Reset system prompt for scenario {scenario_id}")
    return ScenarioResponse(scenario=updated)


@router.put("/{scenario_id}/steps/{step_id}", response_model=dict)
async def update_step(scenario_id: str, step_id: str, request: UpdateStepRequest):
    """Update a step in a scenario"""
    step = scenario_service.update_step(scenario_id, step_id, request)
    if not step:
        raise HTTPException(status_code=404, detail="Scenario or step not found")
    return {"step": step}


@router.post("/{scenario_id}/steps", response_model=dict)
async def add_step(scenario_id: str, request: CreateStepRequest):
    """Add a new step to a scenario"""
    step = scenario_service.add_step(scenario_id, request)
    if not step:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"step": step}


@router.delete("/{scenario_id}/steps/{step_id}")
async def delete_step(scenario_id: str, step_id: str):
    """Delete a step from a scenario"""
    success = scenario_service.delete_step(scenario_id, step_id)
    if not success:
        raise HTTPException(status_code=404, detail="Scenario or step not found")
    return {"message": "Step deleted successfully"}


@router.post("/{scenario_id}/steps/{step_id}/voice")
async def upload_voice_file(
    scenario_id: str,
    step_id: str,
    file: UploadFile = File(...)
):
    """Upload a voice file for a step"""
    try:
        if not file.content_type.startswith("audio/"):
            raise HTTPException(status_code=400, detail="File must be an audio file")

        file_extension = os.path.splitext(file.filename)[1]
        filename = f"{scenario_id}_{step_id}{file_extension}"
        file_path = UPLOAD_DIR / filename

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        step = scenario_service.update_voice_file(scenario_id, step_id, str(file_path))
        if not step:
            os.remove(file_path)
            raise HTTPException(status_code=404, detail="Scenario or step not found")

        transcription = None
        try:
            logger.info(f"Transcribing audio file: {file_path}")
            transcription = await transcription_service.transcribe_audio_file(str(file_path))

            if transcription:
                scenario_service.update_step(
                    scenario_id,
                    step_id,
                    UpdateStepRequest(voice_text=transcription)
                )
                logger.info(f"Transcription saved: {transcription[:100]}...")
        except Exception as e:
            logger.error(f"Failed to transcribe audio: {e}")

        return {
            "message": "Voice file uploaded successfully",
            "file_path": str(file_path),
            "transcription": transcription,
            "step": step
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading voice file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def process_scenario_step_for_model(
    scenario_id: str,
    step: ScenarioStep,
    session_id: str,
    system_prompt_template: str,
    model_name: str,
    current_cart: Optional[List[CartItem]] = None
) -> Optional[List[CartItem]]:
    """Process a single scenario step for a specific model"""
    try:
        logger.info(f"Processing step {step.step_number} with model {model_name}, audio: {step.voice_file_path}")

        system_prompt = build_system_prompt(system_prompt_template, current_cart)
        logger.info(f"Built system prompt for step {step.step_number}, current cart has {len(current_cart) if current_cart else 0} items")

        response_text, cart_items, llm_transcription, input_tokens, output_tokens, latency_ms, raw_response = await chat_service.send_audio_with_cart(
            session_id,
            step.voice_file_path,
            system_prompt=system_prompt,
            model_name=model_name
        )

        logger.info(f"AI Response ({model_name}): {response_text[:100]}...")
        logger.info(f"Cart items extracted: {cart_items}")

        predicted_cart = []
        if cart_items:
            for item in cart_items:
                predicted_cart.append(CartItem(
                    product_id=item.get("product_id", ""),
                    product_name=item.get("product_name", ""),
                    quantity=item.get("quantity", 0),
                    unit=item.get("unit", "KOYTA")
                ))

        scenario_service.update_step_model_result(
            scenario_id,
            step.step_id,
            UpdateStepModelResultRequest(
                model_name=model_name,
                llm_transcription=llm_transcription,
                ai_response=response_text,
                raw_llm_response=raw_response,
                predicted_cart=predicted_cart,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms
            )
        )

        logger.info(f"Step {step.step_number} completed for {model_name}: {len(predicted_cart)} items in cart")
        return predicted_cart

    except Exception as e:
        logger.error(f"Error executing step {step.step_number} with {model_name}: {e}", exc_info=True)
        scenario_service.update_step_model_result(
            scenario_id,
            step.step_id,
            UpdateStepModelResultRequest(
                model_name=model_name,
                error=str(e)
            )
        )
        return None


async def execute_model_steps_sequential(
    scenario_id: str,
    model_name: str,
    steps_to_process: List[ScenarioStep],
    all_steps: List[ScenarioStep],
    system_prompt: str,
    step_ids: Optional[List[str]],
    model_progress: Dict[str, Dict]
) -> Dict:
    """Execute all steps sequentially for a single model"""
    result = {
        "model_name": model_name,
        "steps_processed": 0,
        "steps_failed": 0,
        "success": True,
        "error": None
    }

    try:
        session_id = f"scenario_{scenario_id}_model_{model_name}"
        chat_service.clear_session(session_id)

        logger.info(f"[{model_name}] Starting sequential execution of {len(steps_to_process)} steps")
        add_execution_log(scenario_id, "info", f"Starting model: {model_name} (parallel)",
                         {"model": model_name, "steps": len(steps_to_process)})

        current_cart: Optional[List[CartItem]] = None

        # Get initial cart from previous steps if re-running specific steps
        if step_ids and steps_to_process:
            first_step = steps_to_process[0]
            prev_steps = [s for s in all_steps if s.step_number < first_step.step_number]
            if prev_steps:
                last_prev = prev_steps[-1]
                if last_prev.model_results and model_name in last_prev.model_results:
                    current_cart = last_prev.model_results[model_name].predicted_cart
                    add_execution_log(scenario_id, "info",
                                     f"[{model_name}] Using cart from step {last_prev.step_number}",
                                     {"cart_items": len(current_cart) if current_cart else 0})

        for step_idx, step in enumerate(steps_to_process):
            if is_scenario_cancelled(scenario_id):
                result["success"] = False
                result["error"] = "Cancelled"
                add_execution_log(scenario_id, "warning", f"[{model_name}] Cancelled at step {step_idx + 1}")
                return result

            # Update progress for this model
            model_progress[model_name] = {
                "current_step": step_idx + 1,
                "total_steps": len(steps_to_process),
                "status": "running"
            }

            add_execution_log(scenario_id, "info", f"[{model_name}] Processing step {step.step_number}",
                             {"step_id": step.step_id, "model": model_name})

            predicted_cart = await process_scenario_step_for_model(
                scenario_id, step, session_id, system_prompt, model_name, current_cart
            )

            if predicted_cart is not None:
                result["steps_processed"] += 1
                current_cart = predicted_cart
                add_execution_log(scenario_id, "success", f"[{model_name}] Step {step.step_number} completed",
                                 {"cart_items": len(current_cart), "model": model_name})
                logger.info(f"[{model_name}] Step {step_idx + 1} completed with {len(current_cart)} items")
            else:
                result["steps_failed"] += 1
                add_execution_log(scenario_id, "error", f"[{model_name}] Step {step.step_number} failed",
                                 {"model": model_name})

        model_progress[model_name]["status"] = "completed"
        add_execution_log(scenario_id, "success", f"[{model_name}] Completed all steps")
        logger.info(f"[{model_name}] Completed execution")

    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        model_progress[model_name]["status"] = "failed"
        add_execution_log(scenario_id, "error", f"[{model_name}] Failed: {str(e)}")
        logger.error(f"[{model_name}] Error: {e}", exc_info=True)

    return result


async def execute_scenario_background(scenario_id: str, step_ids: Optional[List[str]] = None):
    """Background task to execute all steps in a scenario with all models IN PARALLEL"""
    try:
        cancelled_scenarios.discard(scenario_id)
        execution_logs[scenario_id] = []
        add_execution_log(scenario_id, "info", "Starting scenario execution (parallel models)")

        scenario = scenario_service.get_scenario(scenario_id)
        if not scenario:
            execution_status[scenario_id] = {
                "status": ExecutionStatus.FAILED,
                "error": "Scenario not found",
                "current_model": None,
                "current_model_index": 0,
                "total_models": 0,
                "current_step": 0,
                "total_steps": 0
            }
            add_execution_log(scenario_id, "error", "Scenario not found")
            return

        if step_ids is None:
            scenario_service.clear_step_model_results(scenario_id)
            add_execution_log(scenario_id, "info", "Cleared previous execution results")

        system_prompt = scenario.system_prompt
        all_steps = sorted(scenario.steps, key=lambda s: s.step_number)

        if step_ids:
            steps_to_process = [s for s in all_steps if s.step_id in step_ids and s.voice_file_path]
            add_execution_log(scenario_id, "info", f"Executing {len(steps_to_process)} specific step(s)")
        else:
            steps_to_process = [s for s in all_steps if s.voice_file_path]

        total_steps = len(steps_to_process)
        total_models = len(MODELS_TO_EXECUTE)

        # Track progress per model
        model_progress: Dict[str, Dict] = {
            model: {"current_step": 0, "total_steps": total_steps, "status": "pending"}
            for model in MODELS_TO_EXECUTE
        }

        execution_status[scenario_id] = {
            "status": ExecutionStatus.RUNNING,
            "current_model": "all (parallel)",
            "current_model_index": total_models,
            "total_models": total_models,
            "current_step": 0,
            "total_steps": total_steps,
            "steps_processed": 0,
            "steps_skipped": len(scenario.steps) - total_steps,
            "steps_failed": 0,
            "models_completed": 0,
            "model_progress": model_progress,
            "parallel_execution": True
        }

        add_execution_log(scenario_id, "info",
                         f"Processing {total_steps} steps with {total_models} models IN PARALLEL",
                         {"models": MODELS_TO_EXECUTE, "total_steps": total_steps})

        # Execute all models in parallel, but steps within each model are sequential
        tasks = [
            execute_model_steps_sequential(
                scenario_id=scenario_id,
                model_name=model_name,
                steps_to_process=steps_to_process,
                all_steps=all_steps,
                system_prompt=system_prompt,
                step_ids=step_ids,
                model_progress=model_progress
            )
            for model_name in MODELS_TO_EXECUTE
        ]

        # Run all model executions concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        total_processed = 0
        total_failed = 0
        models_completed = 0
        errors = []

        for i, result in enumerate(results):
            model_name = MODELS_TO_EXECUTE[i]
            if isinstance(result, Exception):
                errors.append(f"{model_name}: {str(result)}")
                total_failed += total_steps
                add_execution_log(scenario_id, "error", f"[{model_name}] Exception: {str(result)}")
            elif isinstance(result, dict):
                total_processed += result.get("steps_processed", 0)
                total_failed += result.get("steps_failed", 0)
                if result.get("success"):
                    models_completed += 1
                elif result.get("error") and result.get("error") != "Cancelled":
                    errors.append(f"{model_name}: {result.get('error')}")

        # Check if cancelled
        if is_scenario_cancelled(scenario_id):
            execution_status[scenario_id]["status"] = ExecutionStatus.CANCELLED
            add_execution_log(scenario_id, "warning", "Execution cancelled by user")
            logger.info(f"Scenario {scenario_id} execution cancelled")
            return

        # Update final status
        execution_status[scenario_id]["steps_processed"] = total_processed
        execution_status[scenario_id]["steps_failed"] = total_failed
        execution_status[scenario_id]["models_completed"] = models_completed

        if errors:
            execution_status[scenario_id]["status"] = ExecutionStatus.FAILED
            execution_status[scenario_id]["error"] = "; ".join(errors)
            add_execution_log(scenario_id, "error", f"Execution failed with errors: {'; '.join(errors)}")
        else:
            execution_status[scenario_id]["status"] = ExecutionStatus.COMPLETED
            add_execution_log(scenario_id, "success", "Scenario execution completed successfully (parallel)")

        logger.info(f"Scenario {scenario_id} parallel execution complete: {models_completed}/{total_models} models succeeded")

    except Exception as e:
        logger.error(f"Error executing scenario {scenario_id}: {e}", exc_info=True)
        add_execution_log(scenario_id, "error", f"Execution failed: {str(e)}")
        execution_status[scenario_id] = {
            "status": ExecutionStatus.FAILED,
            "error": str(e),
            "current_model": execution_status.get(scenario_id, {}).get("current_model"),
            "current_model_index": execution_status.get(scenario_id, {}).get("current_model_index", 0),
            "total_models": execution_status.get(scenario_id, {}).get("total_models", 0),
            "current_step": execution_status.get(scenario_id, {}).get("current_step", 0),
            "total_steps": execution_status.get(scenario_id, {}).get("total_steps", 0)
        }


@router.post("/{scenario_id}/execute")
async def execute_scenario(scenario_id: str, background_tasks: BackgroundTasks):
    """Start async execution of all steps in a scenario with all models"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    if scenario_id in execution_status and execution_status[scenario_id].get("status") == ExecutionStatus.RUNNING:
        return {
            "message": "Scenario execution already in progress",
            "status": execution_status[scenario_id]
        }

    steps_with_audio = len([s for s in scenario.steps if s.voice_file_path])

    if steps_with_audio == 0:
        raise HTTPException(
            status_code=400,
            detail="No steps have audio files. Please upload audio recordings before executing."
        )

    total_models = len(MODELS_TO_EXECUTE)
    execution_status[scenario_id] = {
        "status": ExecutionStatus.PENDING,
        "current_model": MODELS_TO_EXECUTE[0] if MODELS_TO_EXECUTE else None,
        "current_model_index": 0,
        "total_models": total_models,
        "current_step": 0,
        "total_steps": steps_with_audio,
        "steps_processed": 0,
        "steps_skipped": len(scenario.steps) - steps_with_audio,
        "steps_failed": 0,
        "models_completed": 0
    }

    execution_logs[scenario_id] = []
    add_execution_log(scenario_id, "info", "Execution queued, starting soon...")

    background_tasks.add_task(execute_scenario_background, scenario_id)

    return {
        "message": f"Scenario execution started with {total_models} models",
        "scenario_id": scenario_id,
        "models": MODELS_TO_EXECUTE,
        "status": execution_status[scenario_id]
    }


@router.get("/{scenario_id}/execute/status")
async def get_execution_status(scenario_id: str):
    """Get the current execution status of a scenario"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    status = execution_status.get(scenario_id, {
        "status": ExecutionStatus.PENDING,
        "current_model": None,
        "current_model_index": 0,
        "total_models": len(MODELS_TO_EXECUTE),
        "current_step": 0,
        "total_steps": 0,
        "message": "No execution started"
    })

    return {
        "scenario_id": scenario_id,
        "execution_status": status,
        "scenario": scenario
    }


@router.get("/{scenario_id}/comparison")
async def get_scenario_comparison(scenario_id: str):
    """Get comparison results for all models in a scenario"""
    comparison = scenario_service.get_scenario_comparison(scenario_id)
    if not comparison:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return comparison


@router.post("/{scenario_id}/steps/{step_id}/generate-order")
async def generate_order_for_step(scenario_id: str, step_id: str):
    """Generate simulated ground truth order for a step using AI"""
    try:
        scenario = scenario_service.get_scenario(scenario_id)
        if not scenario:
            raise HTTPException(status_code=404, detail="Scenario not found")

        current_step = None
        previous_steps = []

        for step in sorted(scenario.steps, key=lambda s: s.step_number):
            if step.step_id == step_id:
                current_step = step
                break
            previous_steps.append(step)

        if not current_step:
            raise HTTPException(status_code=404, detail="Step not found")

        logger.info(f"Generating order for step {current_step.step_number} with {len(previous_steps)} previous steps")

        transcription, cart_items = await order_generation_service.generate_order(
            step_number=current_step.step_number,
            previous_steps=previous_steps
        )

        scenario_service.update_step(
            scenario_id,
            step_id,
            UpdateStepRequest(
                voice_text=transcription,
                ground_truth_cart=cart_items
            )
        )

        updated_scenario = scenario_service.get_scenario(scenario_id)

        return {
            "message": f"Generated transcription and {len(cart_items)} cart items",
            "transcription": transcription,
            "cart_items": [item.model_dump() for item in cart_items],
            "scenario": updated_scenario
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating order for step: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{scenario_id}/execute/cancel")
async def cancel_scenario_execution(scenario_id: str):
    """Cancel a running scenario execution"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    current_status = execution_status.get(scenario_id, {})
    if current_status.get("status") != ExecutionStatus.RUNNING:
        return {
            "message": "Scenario is not currently running",
            "status": current_status
        }

    cancelled_scenarios.add(scenario_id)
    add_execution_log(scenario_id, "warning", "Cancellation requested by user")

    return {
        "message": "Cancellation requested. Execution will stop after current step.",
        "scenario_id": scenario_id
    }


@router.post("/{scenario_id}/steps/{step_id}/execute")
async def execute_single_step(scenario_id: str, step_id: str, background_tasks: BackgroundTasks):
    """Execute a single step (re-run) for all models"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    step = next((s for s in scenario.steps if s.step_id == step_id), None)
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    if not step.voice_file_path:
        raise HTTPException(status_code=400, detail="Step has no audio file")

    if scenario_id in execution_status and execution_status[scenario_id].get("status") == ExecutionStatus.RUNNING:
        return {
            "message": "Scenario execution already in progress",
            "status": execution_status[scenario_id]
        }

    total_models = len(MODELS_TO_EXECUTE)
    execution_status[scenario_id] = {
        "status": ExecutionStatus.PENDING,
        "current_model": MODELS_TO_EXECUTE[0] if MODELS_TO_EXECUTE else None,
        "current_model_index": 0,
        "total_models": total_models,
        "current_step": 0,
        "total_steps": 1,
        "steps_processed": 0,
        "steps_skipped": 0,
        "steps_failed": 0,
        "models_completed": 0,
        "is_single_step": True,
        "step_id": step_id
    }

    background_tasks.add_task(execute_scenario_background, scenario_id, [step_id])

    return {
        "message": f"Single step execution started with {total_models} models",
        "scenario_id": scenario_id,
        "step_id": step_id,
        "models": MODELS_TO_EXECUTE,
        "status": execution_status[scenario_id]
    }


@router.get("/{scenario_id}/execute/logs")
async def get_execution_logs(scenario_id: str, limit: int = 50):
    """Get execution logs for a scenario"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    logs = execution_logs.get(scenario_id, [])
    return {
        "scenario_id": scenario_id,
        "logs": logs[-limit:] if limit else logs,
        "total_logs": len(logs)
    }


@router.get("/{scenario_id}/execute/logs/stream")
async def stream_execution_logs(scenario_id: str):
    """Get execution logs with current status for a scenario"""
    scenario = scenario_service.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    logs = execution_logs.get(scenario_id, [])
    status = execution_status.get(scenario_id, {})

    return {
        "scenario_id": scenario_id,
        "logs": logs,
        "total_logs": len(logs),
        "execution_status": status,
        "all_scenario_ids_with_logs": list(execution_logs.keys())
    }


async def process_execution_queue():
    """Process scenarios in the execution queue one by one"""
    global batch_execution_running

    while execution_queue:
        queued = execution_queue.popleft()
        scenario_id = queued.scenario_id

        if scenario_id in cancelled_scenarios:
            cancelled_scenarios.discard(scenario_id)
            continue

        logger.info(f"Processing queued scenario: {queued.scenario_name}")
        await execute_scenario_background(scenario_id)

    batch_execution_running = False
    logger.info("Batch execution queue completed")


@router.post("/batch/execute")
async def batch_execute_scenarios(
    scenario_ids: List[str],
    background_tasks: BackgroundTasks
):
    """Add multiple scenarios to execution queue"""
    global batch_execution_running

    added = []
    skipped = []

    for scenario_id in scenario_ids:
        scenario = scenario_service.get_scenario(scenario_id)
        if not scenario:
            skipped.append({"scenario_id": scenario_id, "reason": "Not found"})
            continue

        steps_with_audio = len([s for s in scenario.steps if s.voice_file_path])
        if steps_with_audio == 0:
            skipped.append({"scenario_id": scenario_id, "reason": "No audio files"})
            continue

        already_queued = any(q.scenario_id == scenario_id for q in execution_queue)
        currently_running = execution_status.get(scenario_id, {}).get("status") == ExecutionStatus.RUNNING

        if already_queued or currently_running:
            skipped.append({"scenario_id": scenario_id, "reason": "Already queued or running"})
            continue

        execution_queue.append(QueuedScenario(
            scenario_id=scenario_id,
            scenario_name=scenario.name,
            queued_at=datetime.now().isoformat(),
            priority=0
        ))

        execution_status[scenario_id] = {
            "status": ExecutionStatus.PENDING,
            "current_model": None,
            "current_model_index": 0,
            "total_models": len(MODELS_TO_EXECUTE),
            "current_step": 0,
            "total_steps": steps_with_audio,
            "queued": True,
            "queue_position": len(execution_queue)
        }

        added.append({"scenario_id": scenario_id, "name": scenario.name})

    if not batch_execution_running and execution_queue:
        batch_execution_running = True
        background_tasks.add_task(process_execution_queue)

    return {
        "message": f"Added {len(added)} scenarios to queue, skipped {len(skipped)}",
        "added": added,
        "skipped": skipped,
        "queue_length": len(execution_queue)
    }


@router.get("/batch/queue")
async def get_execution_queue():
    """Get current execution queue status"""
    currently_executing = None
    for sid, status in execution_status.items():
        if status.get("status") == ExecutionStatus.RUNNING:
            scenario = scenario_service.get_scenario(sid)
            currently_executing = {
                "scenario_id": sid,
                "scenario_name": scenario.name if scenario else "Unknown",
                "status": status
            }
            break

    return ExecutionQueueStatus(
        queue=list(execution_queue),
        currently_executing=currently_executing["scenario_id"] if currently_executing else None,
        is_batch_running=batch_execution_running
    )


@router.post("/batch/queue/remove/{scenario_id}")
async def remove_from_queue(scenario_id: str):
    """Remove a scenario from the execution queue"""
    global execution_queue

    original_len = len(execution_queue)
    execution_queue = deque(q for q in execution_queue if q.scenario_id != scenario_id)

    if len(execution_queue) == original_len:
        raise HTTPException(status_code=404, detail="Scenario not in queue")

    if scenario_id in execution_status:
        del execution_status[scenario_id]

    return {
        "message": "Scenario removed from queue",
        "scenario_id": scenario_id,
        "queue_length": len(execution_queue)
    }


@router.post("/batch/queue/reorder")
async def reorder_queue(scenario_ids: List[str]):
    """Reorder the execution queue"""
    global execution_queue

    new_queue = deque()
    remaining = {q.scenario_id: q for q in execution_queue}

    for sid in scenario_ids:
        if sid in remaining:
            new_queue.append(remaining.pop(sid))

    for q in remaining.values():
        new_queue.append(q)

    execution_queue = new_queue

    for idx, q in enumerate(execution_queue):
        if q.scenario_id in execution_status:
            execution_status[q.scenario_id]["queue_position"] = idx + 1

    return {
        "message": "Queue reordered",
        "queue": list(execution_queue)
    }


@router.post("/batch/cancel")
async def cancel_batch_execution():
    """Cancel all queued and running executions"""
    global batch_execution_running, execution_queue

    cancelled_count = 0

    for scenario_id, status in execution_status.items():
        if status.get("status") == ExecutionStatus.RUNNING:
            cancelled_scenarios.add(scenario_id)
            cancelled_count += 1

    queue_count = len(execution_queue)
    execution_queue.clear()
    batch_execution_running = False

    return {
        "message": f"Cancelled {cancelled_count} running and {queue_count} queued scenarios",
        "cancelled_running": cancelled_count,
        "cleared_queue": queue_count
    }
