import { useState, useEffect, useRef } from 'react';
import { scenarioAPI } from '@/lib/scenario-api';
import type { Scenario, ExecutionStatusInfo, QueuedScenario } from '@/lib/scenario-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, Save, Loader2, Copy, FileText, Calendar, Layers, Package, Play, CheckSquare, Square, PlayCircle, XCircle, ListOrdered, ChevronUp, ChevronDown, X, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import CreateScenarioDialog from './CreateScenarioDialog';
import ScenarioDetail from './ScenarioDetail';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';

export default function Scenarios() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNumSteps, setEditNumSteps] = useState(1);
  const [executionStatuses, setExecutionStatuses] = useState<Record<string, ExecutionStatusInfo>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scenarioToDelete, setScenarioToDelete] = useState<Scenario | null>(null);
  const pollingIntervals = useRef<Record<string, NodeJS.Timeout>>({});
  const completedScenarios = useRef<Set<string>>(new Set()); // Track scenarios that have already shown completion toast

  // Batch execution state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(new Set());
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [executionQueue, setExecutionQueue] = useState<QueuedScenario[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [currentlyExecuting, setCurrentlyExecuting] = useState<string | null>(null);


  useEffect(() => {
    loadScenarios();
    loadQueueStatus();

    // Cleanup polling intervals on unmount
    return () => {
      Object.values(pollingIntervals.current).forEach(clearInterval);
    };
  }, []);

  // Load execution queue status
  const loadQueueStatus = async () => {
    try {
      const status = await scenarioAPI.getExecutionQueue();
      setExecutionQueue(status.queue);
      setIsBatchRunning(status.is_batch_running);
      setCurrentlyExecuting(status.currently_executing);
    } catch (err) {
      console.error('Error loading queue status:', err);
    }
  };

  // Toggle scenario selection
  const toggleScenarioSelection = (scenarioId: string) => {
    setSelectedScenarios(prev => {
      const newSet = new Set(prev);
      if (newSet.has(scenarioId)) {
        newSet.delete(scenarioId);
      } else {
        newSet.add(scenarioId);
      }
      return newSet;
    });
  };

  // Select all scenarios
  const selectAllScenarios = () => {
    const allIds = scenarios.map(s => s.scenario_id);
    setSelectedScenarios(new Set(allIds));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedScenarios(new Set());
    setSelectionMode(false);
  };

  // Handle batch execution
  const handleBatchExecute = async () => {
    if (selectedScenarios.size === 0) {
      toast.error('No scenarios selected');
      return;
    }

    try {
      const result = await scenarioAPI.batchExecute(Array.from(selectedScenarios));
      toast.success(result.message);

      if (result.skipped.length > 0) {
        result.skipped.forEach(skip => {
          toast.warning(`Skipped: ${skip.scenario_id} - ${skip.reason}`);
        });
      }

      // Refresh queue status
      await loadQueueStatus();
      setShowQueuePanel(true);

      // Start polling for execution updates
      result.added.forEach(item => {
        startPolling(item.scenario_id, item.name);
      });

      // Clear selection
      clearSelection();
    } catch (err: any) {
      console.error('Error starting batch execution:', err);
      toast.error(err.response?.data?.detail || 'Failed to start batch execution');
    }
  };

  // Cancel scenario execution
  const handleCancelExecution = async (scenarioId: string) => {
    try {
      await scenarioAPI.cancelExecution(scenarioId);
      toast.info('Cancellation requested');
    } catch (err: any) {
      console.error('Error cancelling execution:', err);
      toast.error(err.response?.data?.detail || 'Failed to cancel execution');
    }
  };

  // Remove from queue
  const handleRemoveFromQueue = async (scenarioId: string) => {
    try {
      await scenarioAPI.removeFromQueue(scenarioId);
      await loadQueueStatus();
      toast.success('Removed from queue');
    } catch (err: any) {
      console.error('Error removing from queue:', err);
      toast.error(err.response?.data?.detail || 'Failed to remove from queue');
    }
  };

  // Cancel all batch executions
  const handleCancelBatch = async () => {
    try {
      const result = await scenarioAPI.cancelBatch();
      toast.info(result.message);
      await loadQueueStatus();
    } catch (err: any) {
      console.error('Error cancelling batch:', err);
      toast.error(err.response?.data?.detail || 'Failed to cancel batch');
    }
  };

  // Reorder queue
  const handleMoveInQueue = async (scenarioId: string, direction: 'up' | 'down') => {
    const currentIndex = executionQueue.findIndex(q => q.scenario_id === scenarioId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= executionQueue.length) return;

    const newOrder = [...executionQueue];
    [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];

    try {
      await scenarioAPI.reorderQueue(newOrder.map(q => q.scenario_id));
      await loadQueueStatus();
    } catch (err: any) {
      console.error('Error reordering queue:', err);
      toast.error(err.response?.data?.detail || 'Failed to reorder queue');
    }
  };

  // Start polling for execution status
  const startPolling = (scenarioId: string, scenarioName?: string) => {
    // Clear existing interval if any
    if (pollingIntervals.current[scenarioId]) {
      clearInterval(pollingIntervals.current[scenarioId]);
    }

    const poll = async () => {
      try {
        const response = await scenarioAPI.getExecutionStatus(scenarioId);
        setExecutionStatuses(prev => ({
          ...prev,
          [scenarioId]: response.execution_status
        }));

        // Stop polling when execution is complete, failed, or cancelled
        if (response.execution_status.status === 'completed' || response.execution_status.status === 'failed' || response.execution_status.status === 'cancelled') {
          // Clear interval immediately to prevent duplicate polls
          if (pollingIntervals.current[scenarioId]) {
            clearInterval(pollingIntervals.current[scenarioId]);
            delete pollingIntervals.current[scenarioId];
          }

          // Only show toast if we haven't already shown one for this scenario
          if (!completedScenarios.current.has(scenarioId)) {
            completedScenarios.current.add(scenarioId);

            // Show toast notification
            const name = scenarioName || scenarios.find(s => s.scenario_id === scenarioId)?.name || 'Scenario';
            if (response.execution_status.status === 'completed') {
              toast.success(`"${name}" completed successfully`);
            } else if (response.execution_status.status === 'cancelled') {
              toast.info(`"${name}" was cancelled`);
            } else {
              toast.error(`"${name}" failed: ${response.execution_status.error || 'Unknown error'}`);
            }

            // Clear the execution status after a short delay
            setTimeout(() => {
              setExecutionStatuses(prev => {
                const newStatuses = { ...prev };
                delete newStatuses[scenarioId];
                return newStatuses;
              });
              // Remove from completed set after status is cleared (allow future executions)
              completedScenarios.current.delete(scenarioId);
            }, 3000);

            // Refresh scenarios to get updated data (without loading indicator)
            loadScenarios(false);
          }
        }
      } catch (err) {
        console.error('Error polling execution status:', err);
      }
    };

    // Poll immediately and then every 2 seconds
    poll();
    pollingIntervals.current[scenarioId] = setInterval(poll, 2000);
  };

  // Execute scenario from card
  const handleExecuteScenario = async (scenarioId: string, scenarioName: string) => {
    // Get total steps for this scenario
    const scenario = scenarios.find(s => s.scenario_id === scenarioId);
    const totalSteps = scenario?.steps.length || 0;

    // Clear from completed set to allow toast on this execution
    completedScenarios.current.delete(scenarioId);

    // Immediately set status to running (optimistic update)
    setExecutionStatuses(prev => ({
      ...prev,
      [scenarioId]: {
        status: 'running',
        current_step: 0,
        total_steps: totalSteps,
        current_model: '',
      }
    }));

    try {
      await scenarioAPI.executeScenario(scenarioId);
      toast.info(`Executing "${scenarioName}"...`);
      startPolling(scenarioId, scenarioName);
    } catch (err: any) {
      console.error('Error executing scenario:', err);
      // Clear the optimistic status on error
      setExecutionStatuses(prev => {
        const newStatuses = { ...prev };
        delete newStatuses[scenarioId];
        return newStatuses;
      });
      toast.error(err.response?.data?.detail || 'Failed to start execution');
    }
  };

  // Check execution status for all scenarios - only start polling for running ones
  const checkAllExecutionStatuses = async (scenarioList: Scenario[]) => {
    for (const scenario of scenarioList) {
      // Skip if we already have a polling interval for this scenario
      if (pollingIntervals.current[scenario.scenario_id]) {
        continue;
      }

      try {
        const response = await scenarioAPI.getExecutionStatus(scenario.scenario_id);
        // Only start polling for scenarios that are actually running
        if (response.execution_status.status === 'running') {
          setExecutionStatuses(prev => ({
            ...prev,
            [scenario.scenario_id]: response.execution_status
          }));
          startPolling(scenario.scenario_id);
        }
        // Don't show completed/failed status on initial load - only when we were actively polling
      } catch (err) {
        // Ignore errors for scenarios without execution status
      }
    }
  };

  const loadScenarios = async (showLoading = true) => {
    // Only show loading indicator if we don't have scenarios yet
    if (showLoading && scenarios.length === 0) {
      setLoading(true);
    }
    try {
      const response = await scenarioAPI.listScenarios();
      setScenarios(response.scenarios);
      // Check execution statuses after loading scenarios
      checkAllExecutionStatuses(response.scenarios);
    } catch (err: any) {
      console.error('Error loading scenarios:', err);
      toast.error(err.response?.data?.detail || 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateScenario = async (name: string, description: string, numSteps: number) => {
    try {
      await scenarioAPI.createScenario({ name, description, num_steps: numSteps });
      await loadScenarios();
      setShowCreateDialog(false);
      toast.success('Scenario created successfully');
    } catch (err: any) {
      console.error('Error creating scenario:', err);
      toast.error(err.response?.data?.detail || 'Failed to create scenario');
    }
  };

  const handleDeleteScenario = async () => {
    if (!scenarioToDelete) return;

    try {
      await scenarioAPI.deleteScenario(scenarioToDelete.scenario_id);
      await loadScenarios();
      if (selectedScenario?.scenario_id === scenarioToDelete.scenario_id) {
        setSelectedScenario(null);
      }
      toast.success('Scenario deleted successfully');
    } catch (err: any) {
      console.error('Error deleting scenario:', err);
      toast.error(err.response?.data?.detail || 'Failed to delete scenario');
    } finally {
      setDeleteDialogOpen(false);
      setScenarioToDelete(null);
    }
  };

  const openDeleteDialog = (scenario: Scenario) => {
    setScenarioToDelete(scenario);
    setDeleteDialogOpen(true);
  };

  const handleCloneScenario = async (scenarioId: string, scenarioName: string) => {
    try {
      await scenarioAPI.cloneScenario(scenarioId);
      await loadScenarios(false);
      toast.success(`Scenario "${scenarioName}" cloned successfully`);
    } catch (err: any) {
      console.error('Error cloning scenario:', err);
      toast.error(err.response?.data?.detail || 'Failed to clone scenario');
    }
  };

  const handleEditScenario = async () => {
    if (!editingScenario) return;

    try {
      // Update scenario metadata
      await scenarioAPI.updateScenario(editingScenario.scenario_id, {
        name: editName,
        description: editDescription,
      });

      // Handle step count changes
      const currentStepCount = editingScenario.steps.length;
      const newStepCount = editNumSteps;

      if (newStepCount > currentStepCount) {
        // Add new steps
        for (let i = currentStepCount + 1; i <= newStepCount; i++) {
          await scenarioAPI.addStep(editingScenario.scenario_id, i);
        }
      } else if (newStepCount < currentStepCount) {
        // Remove steps from the end
        const stepsToRemove = editingScenario.steps
          .sort((a, b) => b.step_number - a.step_number)
          .slice(0, currentStepCount - newStepCount);

        for (const step of stepsToRemove) {
          await scenarioAPI.deleteStep(editingScenario.scenario_id, step.step_id);
        }
      }

      await loadScenarios();
      setEditingScenario(null);
      toast.success('Scenario updated successfully');
    } catch (err: any) {
      console.error('Error updating scenario:', err);
      toast.error(err.response?.data?.detail || 'Failed to update scenario');
    }
  };

  if (selectedScenario) {
    return (
      <ScenarioDetail
        scenario={selectedScenario}
        onBack={() => {
          setSelectedScenario(null);
          loadScenarios(false); // Don't show loading when coming back
        }}
        onUpdate={(updated) => {
          setSelectedScenario(updated);
          // Also update the scenarios list so changes persist when navigating back
          setScenarios(prev => prev.map(s =>
            s.scenario_id === updated.scenario_id ? updated : s
          ));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#fafafa]">Voice Ordering Scenarios</h1>
            <p className="text-sm text-[#71717a]">Create and manage test scenarios for voice ordering</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Selection Mode Toggle */}
            {selectionMode ? (
              <>
                <span className="text-sm text-[#a1a1aa]">
                  {selectedScenarios.size} selected
                </span>
                <button
                  onClick={selectAllScenarios}
                  className="px-3 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] text-sm font-medium rounded-lg border border-[#2a2a2e] transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={handleBatchExecute}
                  disabled={selectedScenarios.size === 0}
                  className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-green-500/25 transition-all duration-200 flex items-center gap-2"
                >
                  <PlayCircle className="w-4 h-4" />
                  Execute Selected
                </button>
                <button
                  onClick={clearSelection}
                  className="px-3 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] text-sm font-medium rounded-lg border border-[#2a2a2e] transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {/* Queue Button */}
                <button
                  onClick={() => setShowQueuePanel(!showQueuePanel)}
                  className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 ${
                    showQueuePanel || executionQueue.length > 0
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                      : 'bg-[#1a1a1d] border-[#2a2a2e] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#27272a]'
                  }`}
                >
                  <ListOrdered className="w-4 h-4" />
                  Queue
                  {executionQueue.length > 0 && (
                    <span className="px-1.5 py-0.5 text-xs bg-indigo-500 text-white rounded-full">
                      {executionQueue.length}
                    </span>
                  )}
                </button>

                {/* Batch Select Button */}
                <button
                  onClick={() => setSelectionMode(true)}
                  className="px-3 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] text-sm font-medium rounded-lg border border-[#2a2a2e] transition-colors flex items-center gap-2"
                >
                  <CheckSquare className="w-4 h-4" />
                  Select
                </button>

                <button
                  onClick={() => setShowCreateDialog(true)}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-200 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  New Scenario
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Execution Queue Panel */}
      {showQueuePanel && (
        <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-[#fafafa]">Execution Queue</h3>
              {isBatchRunning && (
                <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Running
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(executionQueue.length > 0 || isBatchRunning) && (
                <button
                  onClick={handleCancelBatch}
                  className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-1"
                >
                  <StopCircle className="w-4 h-4" />
                  Cancel All
                </button>
              )}
              <button
                onClick={() => setShowQueuePanel(false)}
                className="p-1.5 text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {executionQueue.length === 0 && !currentlyExecuting ? (
            <p className="text-sm text-[#52525b] text-center py-4">
              No scenarios in queue. Select scenarios and click "Execute Selected" to add them.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Currently Executing */}
              {currentlyExecuting && (
                <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
                    <div>
                      <span className="text-sm font-medium text-green-400">Currently Running</span>
                      <p className="text-xs text-[#71717a]">
                        {scenarios.find(s => s.scenario_id === currentlyExecuting)?.name || currentlyExecuting}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCancelExecution(currentlyExecuting)}
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Queued Items */}
              {executionQueue.map((item, index) => (
                <div
                  key={item.scenario_id}
                  className="flex items-center justify-between p-3 bg-[#1a1a1d] border border-[#2a2a2e] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center bg-[#27272a] rounded-full text-xs text-[#71717a]">
                      {index + 1}
                    </span>
                    <span className="text-sm text-[#a1a1aa]">{item.scenario_name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMoveInQueue(item.scenario_id, 'up')}
                      disabled={index === 0}
                      className="p-1 text-[#71717a] hover:text-[#fafafa] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleMoveInQueue(item.scenario_id, 'down')}
                      disabled={index === executionQueue.length - 1}
                      className="p-1 text-[#71717a] hover:text-[#fafafa] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRemoveFromQueue(item.scenario_id)}
                      className="p-1 text-red-400 hover:text-red-300 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="text-center text-[#71717a] mt-20">Loading scenarios...</div>
        ) : scenarios.length === 0 ? (
          <div className="text-center text-[#71717a] mt-20">
            <p className="text-lg text-[#a1a1aa]">No scenarios yet</p>
            <p className="text-sm mt-2">Create your first scenario to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scenarios.map((scenario) => {
              const execStatus = executionStatuses[scenario.scenario_id];
              const isExecuting = execStatus?.status === 'running';
              const isSelected = selectedScenarios.has(scenario.scenario_id);

              // Calculate unique products from ground truth carts
              const uniqueProductIds = new Set<string>();
              scenario.steps.forEach(step => {
                step.ground_truth_cart?.forEach(item => {
                  if (item.product_id) {
                    uniqueProductIds.add(item.product_id);
                  }
                });
              });
              const uniqueProductCount = uniqueProductIds.size;

              return (
              <div
                key={scenario.scenario_id}
                onClick={() => {
                  if (selectionMode) {
                    toggleScenarioSelection(scenario.scenario_id);
                  } else {
                    setSelectedScenario(scenario);
                  }
                }}
                className={`group relative bg-[#121214] border rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/10 cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500 shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-500/50'
                    : isExecuting
                    ? 'border-indigo-500/50 shadow-lg shadow-indigo-500/20'
                    : 'border-[#2a2a2e] hover:border-[#3f3f46]'
                }`}
              >
                {/* Gradient top accent bar */}
                <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

                {/* Selection Checkbox (shown in selection mode) */}
                {selectionMode && (
                  <div className="absolute top-3 left-3 z-10">
                    <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-indigo-500 border-indigo-500'
                        : 'bg-[#1a1a1d] border-[#3f3f46] hover:border-indigo-400'
                    }`}>
                      {isSelected && <CheckSquare className="w-4 h-4 text-white" />}
                    </div>
                  </div>
                )}

                {/* Shine effect overlay */}
                <div className="absolute top-0 -left-full w-full h-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-all duration-500 ease-out group-hover:left-full pointer-events-none" />

                <div className={`p-5 ${selectionMode ? 'pl-12' : ''}`}>
                  {/* Header with icon and actions */}
                  <div className="flex items-start gap-3 mb-4">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center ${
                      isExecuting
                        ? 'bg-blue-500/20 border-blue-500/30'
                        : 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-indigo-500/20'
                    }`}>
                      {isExecuting ? (
                        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                      ) : (
                        <FileText className="w-5 h-5 text-indigo-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-[#fafafa] truncate leading-tight">{scenario.name}</h3>
                      {isExecuting ? (
                        <p className="text-sm text-blue-400 mt-1 flex items-center gap-2 animate-pulse">
                          <span>Executing</span>
                          {execStatus?.current_model && (
                            <span className="text-[#71717a]">({execStatus.current_model})</span>
                          )}
                        </p>
                      ) : scenario.description ? (
                        <p className="text-sm text-[#71717a] mt-1 line-clamp-2">{scenario.description}</p>
                      ) : null}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <Dialog
                        open={editingScenario?.scenario_id === scenario.scenario_id}
                        onOpenChange={(open) => {
                          if (open) {
                            setEditingScenario(scenario);
                            setEditName(scenario.name);
                            setEditDescription(scenario.description || '');
                            setEditNumSteps(scenario.steps.length);
                          } else {
                            setEditingScenario(null);
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <button className="p-1.5 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[500px] bg-[#1a1a1d] border-[#2a2a2e]">
                          <DialogHeader>
                            <DialogTitle className="text-[#fafafa]">Edit Scenario</DialogTitle>
                            <DialogDescription className="text-[#71717a]">
                              Update the scenario name and description.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <label htmlFor="edit-name" className="text-sm font-medium text-[#a1a1aa]">
                                Name
                              </label>
                              <input
                                id="edit-name"
                                type="text"
                                className="w-full px-3 py-2 bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Scenario name"
                              />
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="edit-description" className="text-sm font-medium text-[#a1a1aa]">
                                Description
                              </label>
                              <textarea
                                id="edit-description"
                                className="w-full px-3 py-2 bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                rows={3}
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="Description (optional)"
                              />
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="edit-num-steps" className="text-sm font-medium text-[#a1a1aa]">
                                Number of Steps
                              </label>
                              <input
                                id="edit-num-steps"
                                type="number"
                                min="1"
                                max="50"
                                className="w-full px-3 py-2 bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                value={editNumSteps}
                                onChange={(e) => setEditNumSteps(parseInt(e.target.value) || 1)}
                              />
                              <p className="text-xs text-[#71717a]">
                                Increasing will add empty steps. Decreasing will remove steps from the end.
                              </p>
                            </div>
                          </div>
                          <DialogFooter>
                            <button
                              onClick={() => setEditingScenario(null)}
                              className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleEditScenario}
                              className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center gap-2"
                            >
                              <Save className="w-4 h-4" />
                              Save Changes
                            </button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <button
                        onClick={() => handleCloneScenario(scenario.scenario_id, scenario.name)}
                        title="Clone scenario"
                        className="p-1.5 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {isExecuting ? (
                        <button
                          onClick={() => handleCancelExecution(scenario.scenario_id)}
                          title="Cancel execution"
                          className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleExecuteScenario(scenario.scenario_id, scenario.name)}
                          title="Execute scenario"
                          className="p-1.5 rounded-lg text-green-400 hover:text-green-300 hover:bg-green-500/10 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => openDeleteDialog(scenario)}
                        title="Delete scenario"
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-gradient-to-r from-transparent via-[#2a2a2e] to-transparent mb-4" />

                  {/* Stats row */}
                  <div className="flex items-center justify-between text-sm mb-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-[#71717a]">
                        <Layers className="w-4 h-4 text-indigo-400" />
                        <span className="text-[#a1a1aa] font-medium">{scenario.steps.length}</span>
                        <span>steps</span>
                      </div>
                      {uniqueProductCount > 0 && (
                        <div className="flex items-center gap-1.5 text-[#71717a]">
                          <Package className="w-4 h-4 text-pink-400" />
                          <span className="text-[#a1a1aa] font-medium">{uniqueProductCount}</span>
                          <span>products</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[#71717a]">
                        <Calendar className="w-4 h-4 text-purple-400" />
                        <span>{new Date(scenario.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreateScenarioDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateScenario}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteScenario}
        title="Delete Scenario"
        description={`Are you sure you want to delete "${scenarioToDelete?.name}"? This action cannot be undone and all steps will be permanently removed.`}
      />
    </div>
  );
}
