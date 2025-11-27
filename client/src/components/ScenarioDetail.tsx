import React, { useState, useEffect, useRef } from 'react';
import { scenarioAPI } from '@/lib/scenario-api';
import { productAPI } from '@/lib/product-api';
import type { Scenario, ScenarioStep, CartItem, UpdateStepRequest, ExecutionStatusInfo, ScenarioComparisonResponse, ModelExecutionResult, MODELS_TO_EXECUTE } from '@/lib/scenario-types';
import type { Product } from '@/lib/product-types';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ArrowLeft, Upload, Save, Play, Plus, Trash2, ChevronsUpDown, Check, Mic, Square, Pause, PlayCircle, CheckCircle, Pencil, Copy, Eye, Loader2, Volume2, Layers, RotateCcw, FolderUp, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import Plot from 'react-plotly.js';
import { toast } from 'sonner';
import AudioWaveform from './AudioWaveform';
import AudioEqualizer from './AudioEqualizer';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';

// Models for comparison
const COMPARISON_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'];

// Model display names
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

// Model colors for charts
const MODEL_COLORS: Record<string, string> = {
  'gemini-2.5-pro': '#4285F4',
  'gemini-2.5-flash': '#34A853',
};

interface ScenarioDetailProps {
  scenario: Scenario;
  onBack: () => void;
  onUpdate: (scenario: Scenario) => void;
}

// Pricing configuration for different models (per 1M tokens in USD)
const MODEL_PRICING = {
  'gemini-2.5-pro': {
    input_small: 1.25,  // <= 200k tokens
    input_large: 2.50,  // > 200k tokens
    output_small: 10.00,
    output_large: 15.00,
  },
  'gemini-2.5-flash': {
    input_small: 0.30,  // text/image/video
    input_large: 0.30,  // same price
    output_small: 2.50, // including thinking tokens
    output_large: 2.50,
  },
};

// Calculate cost based on model and token usage
function calculateCost(inputTokens: number, outputTokens: number, modelName: string): number {
  if (!inputTokens || !outputTokens) return 0;

  const pricing = MODEL_PRICING[modelName as keyof typeof MODEL_PRICING] || MODEL_PRICING['gemini-2.5-pro'];

  // For simplicity, assume we're in the small tier (<=200k tokens)
  const inputCost = (inputTokens / 1_000_000) * pricing.input_small;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_small;

  return inputCost + outputCost;
}

// Calculate cost for a step based on model and token usage (legacy)
function calculateStepCost(step: ScenarioStep, modelName: string): number {
  if (!step.input_tokens || !step.output_tokens) return 0;
  return calculateCost(step.input_tokens, step.output_tokens, modelName);
}

// Calculate cost for model execution result
function calculateModelResultCost(result: ModelExecutionResult | undefined, modelName: string): number {
  if (!result?.input_tokens || !result?.output_tokens) return 0;
  return calculateCost(result.input_tokens, result.output_tokens, modelName);
}

// Compare cart items directly by product_id, quantity, and unit
function cartItemsMatch(gt: CartItem, pred: CartItem): boolean {
  return gt.product_id === pred.product_id &&
         gt.quantity === pred.quantity &&
         gt.unit === pred.unit;
}

// Detailed mismatch types
type MismatchType = 'exact_match' | 'quantity_mismatch' | 'unit_mismatch' | 'quantity_and_unit_mismatch' | 'extra_item' | 'missing_item';

interface MismatchDetail {
  type: MismatchType;
  productId: string;
  expectedQuantity?: number;
  actualQuantity?: number;
  expectedUnit?: string;
  actualUnit?: string;
}

// Find what type of mismatch exists for a predicted item
function getMismatchDetail(pred: CartItem, groundTruth: CartItem[]): MismatchDetail {
  const matchingProduct = groundTruth.find(gt => gt.product_id === pred.product_id);

  if (!matchingProduct) {
    return { type: 'extra_item', productId: pred.product_id };
  }

  const quantityMatches = matchingProduct.quantity === pred.quantity;
  const unitMatches = matchingProduct.unit === pred.unit;

  if (quantityMatches && unitMatches) {
    return { type: 'exact_match', productId: pred.product_id };
  }

  if (!quantityMatches && !unitMatches) {
    return {
      type: 'quantity_and_unit_mismatch',
      productId: pred.product_id,
      expectedQuantity: matchingProduct.quantity,
      actualQuantity: pred.quantity,
      expectedUnit: matchingProduct.unit,
      actualUnit: pred.unit
    };
  }

  if (!quantityMatches) {
    return {
      type: 'quantity_mismatch',
      productId: pred.product_id,
      expectedQuantity: matchingProduct.quantity,
      actualQuantity: pred.quantity,
      expectedUnit: matchingProduct.unit,
      actualUnit: pred.unit
    };
  }

  return {
    type: 'unit_mismatch',
    productId: pred.product_id,
    expectedQuantity: matchingProduct.quantity,
    actualQuantity: pred.quantity,
    expectedUnit: matchingProduct.unit,
    actualUnit: pred.unit
  };
}

// Get missing items from ground truth that are not in predictions
function getMissingItems(groundTruth: CartItem[], predictions: CartItem[]): CartItem[] {
  return groundTruth.filter(gt => !predictions.some(pred => pred.product_id === gt.product_id));
}

export default function ScenarioDetail({ scenario, onBack, onUpdate }: ScenarioDetailProps) {
  const [activeTab, setActiveTab] = useState<'setup' | 'results' | 'cost'>('setup');
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [stepData, setStepData] = useState<Record<string, Partial<UpdateStepRequest>>>({});
  const [cartTextData, setCartTextData] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [viewingRawResponse, setViewingRawResponse] = useState<ScenarioStep | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState<Record<string, boolean>>({});
  const [recordingStepId, setRecordingStepId] = useState<string | null>(null);
  const [localSystemPrompt, setLocalSystemPrompt] = useState(scenario.system_prompt);
  const [savingSettings, setSavingSettings] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatusInfo | null>(null);
  const [comparison, setComparison] = useState<ScenarioComparisonResponse | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [selectedModelForRawResponse, setSelectedModelForRawResponse] = useState<string | null>(null);
  const [playingAudioStepId, setPlayingAudioStepId] = useState<string | null>(null);
  const [generatingOrderStepId, setGeneratingOrderStepId] = useState<string | null>(null);
  const [deleteStepDialogOpen, setDeleteStepDialogOpen] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<ScenarioStep | null>(null);
  const [rerunningStepId, setRerunningStepId] = useState<string | null>(null);
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchUploadProgress, setBatchUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceRecorder = useVoiceRecorder();

  useEffect(() => {
    loadProducts();
    checkExecutionStatus();

    // Auto-load comparison if scenario has been executed (has model_results)
    const hasResults = scenario.steps.some(step =>
      step.model_results && Object.keys(step.model_results).length > 0
    );
    if (hasResults) {
      loadComparison();
    }

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
      // Stop any playing audio on unmount
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const checkExecutionStatus = async () => {
    try {
      const response = await scenarioAPI.getExecutionStatus(scenario.scenario_id);
      if (response.execution_status.status === 'running') {
        setExecutionStatus(response.execution_status);
        setExecuting(true);
        startPolling();
      }
    } catch (err) {
      // Ignore - no execution in progress
    }
  };

  const startPolling = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }

    const poll = async () => {
      try {
        const response = await scenarioAPI.getExecutionStatus(scenario.scenario_id);
        console.log('Poll response:', response.execution_status);
        setExecutionStatus(response.execution_status);
        onUpdate(response.scenario);

        if (response.execution_status.status === 'completed' || response.execution_status.status === 'failed' || response.execution_status.status === 'cancelled') {
          if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
          }
          setExecuting(false);
          setRerunningStepId(null);

          if (response.execution_status.status === 'completed') {
            toast.success('Execution completed successfully!');
            // Load comparison data
            loadComparison();
            setTimeout(() => {
              setActiveTab('results');
            }, 1500);
          } else if (response.execution_status.status === 'cancelled') {
            toast.info('Execution cancelled');
          } else {
            toast.error(`Execution failed: ${response.execution_status.error || 'Unknown error'}`);
          }
        }
      } catch (err) {
        console.error('Error polling execution status:', err);
      }
    };

    // Poll immediately, then every 1 second for more responsive updates
    poll();
    pollingInterval.current = setInterval(poll, 1000);
  };

  useEffect(() => {
    setLocalSystemPrompt(scenario.system_prompt);
  }, [scenario.scenario_id]);

  const loadComparison = async () => {
    setLoadingComparison(true);
    try {
      const data = await scenarioAPI.getComparison(scenario.scenario_id);
      setComparison(data);
    } catch (err) {
      console.error('Error loading comparison:', err);
    } finally {
      setLoadingComparison(false);
    }
  };

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const response = await productAPI.listProducts();
      setProducts(response.products);
    } catch (err) {
      console.error('Error loading products:', err);
      toast.error('Failed to load products');
    } finally {
      setLoadingProducts(false);
    }
  };

  // Helper function to get product name from ID
  const getProductName = (productId: string, fallbackName?: string): string => {
    const product = products.find(p => p.product_id === productId);
    if (product) return product.title;
    if (fallbackName && fallbackName !== `Product ${productId}`) return fallbackName;
    return `Product ${productId}`;
  };

  const handleStepUpdate = async (stepId: string) => {
    try {
      const updates = stepData[stepId];
      if (!updates) return;

      const response = await scenarioAPI.updateStep(scenario.scenario_id, stepId, updates);

      // Update the scenario with the new step data
      const updatedScenario = {
        ...scenario,
        steps: scenario.steps.map(s =>
          s && s.step_id === stepId ? response.step : s
        ).filter(s => s !== null && s !== undefined)
      };

      onUpdate(updatedScenario);
      setEditingStep(null);
      setStepData(prev => {
        const newData = { ...prev };
        delete newData[stepId];
        return newData;
      });
      setCartTextData(prev => {
        const newData = { ...prev };
        delete newData[stepId];
        return newData;
      });
      toast.success('Step updated successfully');
    } catch (err: any) {
      console.error('Error updating step:', err);
      toast.error(err.response?.data?.detail || 'Failed to update step');
    }
  };

  const handleVoiceUpload = async (stepId: string, file: File) => {
    setUploading(stepId);
    try {
      await scenarioAPI.uploadVoiceFile(scenario.scenario_id, stepId, file);

      // Reload the scenario to get updated step
      const response = await scenarioAPI.getScenario(scenario.scenario_id);
      onUpdate(response.scenario);
      toast.success('Voice file uploaded successfully');
    } catch (err: any) {
      console.error('Error uploading voice file:', err);
      toast.error(err.response?.data?.detail || 'Failed to upload voice file');
    } finally {
      setUploading(null);
    }
  };

  const handleSaveRecording = async (stepId: string) => {
    if (!voiceRecorder.audioBlob) return;

    setUploading(stepId);
    try {
      // Convert blob to file
      const file = new File([voiceRecorder.audioBlob], `recording-${Date.now()}.webm`, {
        type: 'audio/webm',
      });

      await scenarioAPI.uploadVoiceFile(scenario.scenario_id, stepId, file);

      // Reload the scenario to get updated step
      const response = await scenarioAPI.getScenario(scenario.scenario_id);
      onUpdate(response.scenario);

      // Clear recording
      voiceRecorder.clearRecording();
      setRecordingStepId(null);
      toast.success('Recording saved successfully');
    } catch (err: any) {
      console.error('Error saving recording:', err);
      toast.error(err.response?.data?.detail || 'Failed to save recording');
    } finally {
      setUploading(null);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getAudioUrl = (voiceFilePath: string): string => {
    // Convert the stored path to a URL that can be served by the backend
    // voice_file_path is like "uploads/voice_files/filename.webm"
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    return `${baseUrl}/${voiceFilePath}`;
  };

  const handlePlayAudio = (stepId: string, voiceFilePath: string) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingAudioStepId === stepId) {
      // If clicking on the same step, just stop
      setPlayingAudioStepId(null);
      return;
    }

    const audioUrl = getAudioUrl(voiceFilePath);
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onended = () => {
      setPlayingAudioStepId(null);
      audioRef.current = null;
    };

    audio.onerror = () => {
      toast.error('Failed to play audio file');
      setPlayingAudioStepId(null);
      audioRef.current = null;
    };

    audio.play();
    setPlayingAudioStepId(stepId);
  };

  const handleExecuteScenario = async () => {
    setExecuting(true);
    try {
      const response = await scenarioAPI.executeScenario(scenario.scenario_id);
      console.log('Execute response:', response);
      setExecutionStatus(response.status);
      toast.info('Execution started. You can navigate away - progress will be tracked.');
      startPolling();
    } catch (err: any) {
      console.error('Error executing scenario:', err);
      toast.error(err.response?.data?.detail || 'Failed to execute scenario');
      setExecuting(false);
    }
  };

  const updateStepField = (stepId: string, field: keyof UpdateStepRequest, value: any) => {
    setStepData(prev => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        [field]: value
      }
    }));
  };

  const getEditingCart = (step: ScenarioStep): CartItem[] => {
    const currentData = stepData[step.step_id];
    if (currentData?.ground_truth_cart) {
      return currentData.ground_truth_cart;
    }
    return step.ground_truth_cart || [];
  };

  const addCartItem = (stepId: string) => {
    const currentCart = stepData[stepId]?.ground_truth_cart || [];
    const newItem: CartItem = {
      product_id: '',
      product_name: '',
      quantity: 1,
      unit: 'KOYTA', // Default to package
    };
    updateStepField(stepId, 'ground_truth_cart', [...currentCart, newItem]);
  };

  const updateCartItem = (stepId: string, index: number, field: keyof CartItem, value: any) => {
    const currentCart = stepData[stepId]?.ground_truth_cart || [];
    const updatedCart = [...currentCart];

    if (field === 'product_id' && value) {
      // Find the product and update both ID and name
      const product = products.find(p => p.product_id === value);
      if (product) {
        updatedCart[index] = {
          ...updatedCart[index],
          product_id: value,
          product_name: product.title,
        };
      }
    } else {
      updatedCart[index] = {
        ...updatedCart[index],
        [field]: value,
      };
    }

    updateStepField(stepId, 'ground_truth_cart', updatedCart);
  };

  const removeCartItem = (stepId: string, index: number) => {
    const currentCart = stepData[stepId]?.ground_truth_cart || [];
    const updatedCart = currentCart.filter((_, i) => i !== index);
    updateStepField(stepId, 'ground_truth_cart', updatedCart);
  };

  const cloneCartFromPreviousStep = (currentStep: ScenarioStep) => {
    // Find the previous step (by step_number)
    const previousStep = scenario.steps
      .filter(s => s && s.step_number < currentStep.step_number)
      .sort((a, b) => b.step_number - a.step_number)[0];

    if (previousStep && previousStep.ground_truth_cart) {
      // Clone the cart items from previous step
      const clonedCart = JSON.parse(JSON.stringify(previousStep.ground_truth_cart));
      updateStepField(currentStep.step_id, 'ground_truth_cart', clonedCart);
      toast.success(`Cloned ${clonedCart.length} items from Step ${previousStep.step_number}`);
    }
  };

  const handleGenerateOrder = async (stepId: string) => {
    setGeneratingOrderStepId(stepId);
    try {
      const response = await scenarioAPI.generateOrder(scenario.scenario_id, stepId);

      // Update the local step data with the generated cart and transcription
      if (response.cart_items) {
        updateStepField(stepId, 'ground_truth_cart', response.cart_items);
      }
      if (response.transcription) {
        updateStepField(stepId, 'voice_text', response.transcription);
      }

      // Update the scenario with the response
      if (response.scenario) {
        onUpdate(response.scenario);
      }

      toast.success(`Generated transcription and ${response.cart_items?.length || 0} cart items using AI`);
    } catch (err: any) {
      console.error('Error generating order:', err);
      toast.error(err.response?.data?.detail || 'Failed to generate order');
    } finally {
      setGeneratingOrderStepId(null);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await scenarioAPI.updateScenario(scenario.scenario_id, {
        system_prompt: localSystemPrompt,
      });
      onUpdate({
        ...scenario,
        system_prompt: localSystemPrompt,
      });
      toast.success('Settings saved successfully');
    } catch (err) {
      console.error('Error saving settings:', err);
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddStep = async () => {
    try {
      const nextStepNumber = scenario.steps.length + 1;
      await scenarioAPI.addStep(scenario.scenario_id, nextStepNumber);

      // Reload the scenario to get the new step
      const response = await scenarioAPI.getScenario(scenario.scenario_id);
      onUpdate(response.scenario);
      toast.success('Step added successfully');
    } catch (err: any) {
      console.error('Error adding step:', err);
      toast.error(err.response?.data?.detail || 'Failed to add step');
    }
  };

  const openDeleteStepDialog = (step: ScenarioStep) => {
    setStepToDelete(step);
    setDeleteStepDialogOpen(true);
  };

  const handleRerunStep = async (stepId: string) => {
    setRerunningStepId(stepId);
    try {
      await scenarioAPI.executeStep(scenario.scenario_id, stepId);
      toast.info('Re-running step with all models...');
      startPolling();
    } catch (err: any) {
      console.error('Error re-running step:', err);
      toast.error(err.response?.data?.detail || 'Failed to re-run step');
      setRerunningStepId(null);
    }
  };

  const handleBatchAudioUpload = async (files: FileList) => {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
      toast.error('No audio files selected');
      return;
    }

    // Sort files by name to maintain order
    audioFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const stepsWithoutAudio = scenario.steps
      .filter(s => !s.voice_file_path)
      .sort((a, b) => a.step_number - b.step_number);

    if (stepsWithoutAudio.length === 0) {
      toast.error('All steps already have audio files');
      return;
    }

    const uploadCount = Math.min(audioFiles.length, stepsWithoutAudio.length);

    if (audioFiles.length > stepsWithoutAudio.length) {
      toast.warning(`Only ${stepsWithoutAudio.length} steps available. ${audioFiles.length - stepsWithoutAudio.length} files will be skipped.`);
    }

    setBatchUploading(true);
    setBatchUploadProgress({ current: 0, total: uploadCount });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < uploadCount; i++) {
      const file = audioFiles[i];
      const step = stepsWithoutAudio[i];

      setBatchUploadProgress({ current: i + 1, total: uploadCount });

      try {
        await scenarioAPI.uploadVoiceFile(scenario.scenario_id, step.step_id, file);
        successCount++;
      } catch (err: any) {
        console.error(`Error uploading ${file.name}:`, err);
        failCount++;
      }
    }

    // Refresh scenario
    try {
      const response = await scenarioAPI.getScenario(scenario.scenario_id);
      onUpdate(response.scenario);
    } catch (err) {
      console.error('Error refreshing scenario:', err);
    }

    setBatchUploading(false);
    setBatchUploadProgress(null);

    if (failCount === 0) {
      toast.success(`Uploaded ${successCount} audio files successfully!`);
    } else {
      toast.warning(`Uploaded ${successCount} files, ${failCount} failed`);
    }
  };

  const handleDeleteStep = async () => {
    if (!stepToDelete) return;

    try {
      await scenarioAPI.deleteStep(scenario.scenario_id, stepToDelete.step_id);

      // Reload the scenario to get updated steps
      const response = await scenarioAPI.getScenario(scenario.scenario_id);
      onUpdate(response.scenario);
      toast.success('Step deleted successfully');
    } catch (err: any) {
      console.error('Error deleting step:', err);
      toast.error(err.response?.data?.detail || 'Failed to delete step');
    } finally {
      setDeleteStepDialogOpen(false);
      setStepToDelete(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-[#fafafa]">{scenario.name}</h1>
            {scenario.description && (
              <p className="text-sm text-[#71717a]">{scenario.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-[#71717a] px-3 py-1 bg-[#27272a] rounded-lg">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span className="text-[#a1a1aa] font-medium">{scenario.steps.length}</span>
            </div>

            <button
              onClick={handleExecuteScenario}
              disabled={executing}
              className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-green-500/25 transition-all duration-200 flex items-center justify-center gap-2"
            >
              {executing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('setup')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'setup'
                ? 'border-indigo-500 text-[#fafafa]'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            Setup & Configuration
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'results'
                ? 'border-indigo-500 text-[#fafafa]'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            Results
          </button>
          <button
            onClick={() => setActiveTab('cost')}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'cost'
                ? 'border-indigo-500 text-[#fafafa]'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            Cost & Latency
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === 'setup' && (
          <>
        {/* Batch Upload Section */}
        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 rounded-xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#fafafa] mb-1">Batch Audio Upload</h3>
              <p className="text-xs text-[#71717a]">
                Upload multiple audio files at once. Files will be assigned to steps in alphabetical order.
                {scenario.steps.filter(s => !s.voice_file_path).length > 0 && (
                  <span className="text-indigo-400 ml-1">
                    ({scenario.steps.filter(s => !s.voice_file_path).length} steps without audio)
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {batchUploadProgress && (
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span className="text-[#a1a1aa]">
                    Uploading {batchUploadProgress.current}/{batchUploadProgress.total}
                  </span>
                </div>
              )}
              <input
                ref={batchFileInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleBatchAudioUpload(e.target.files);
                    e.target.value = ''; // Reset input
                  }
                }}
                className="hidden"
              />
              <button
                onClick={() => batchFileInputRef.current?.click()}
                disabled={batchUploading || scenario.steps.filter(s => !s.voice_file_path).length === 0}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center gap-2"
              >
                <FolderUp className="w-4 h-4" />
                {batchUploading ? 'Uploading...' : 'Select Files'}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {scenario.steps.filter(step => step && step.step_id).map((step, index) => {
            const isEditing = editingStep === step.step_id;
            const currentData = stepData[step.step_id] || {};

            return (
              <div
                key={step.step_id}
                className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6"
              >
                {/* Step Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center justify-center font-semibold text-sm">
                      {step.step_number}
                    </div>
                    <h3 className="text-lg font-semibold text-[#fafafa]">Step {step.step_number}</h3>
                  </div>
                  <div className="flex gap-2">
                    {!isEditing && (
                      <>
                        {/* Re-run Step Button */}
                        {step.voice_file_path && step.model_results && Object.keys(step.model_results).length > 0 && (
                          <button
                            onClick={() => handleRerunStep(step.step_id)}
                            disabled={rerunningStepId === step.step_id || executing}
                            title="Re-run this step with all models"
                            className={`p-2 rounded-lg transition-colors ${
                              rerunningStepId === step.step_id
                                ? 'text-indigo-400 bg-indigo-500/10'
                                : 'text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10'
                            }`}
                          >
                            {rerunningStepId === step.step_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingStep(step.step_id);
                            // Initialize cart data for editing
                            if (!stepData[step.step_id]?.ground_truth_cart) {
                              updateStepField(step.step_id, 'ground_truth_cart', step.ground_truth_cart || []);
                            }
                          }}
                          className="p-2 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openDeleteStepDialog(step)}
                          className="p-2 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Voice Recording/Upload */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                    Voice Recording
                  </label>

                  {recordingStepId === step.step_id ? (
                    <div className="border border-[#2a2a2e] bg-[#1a1a1d] rounded-lg p-4 space-y-3">
                      {/* Recording Controls */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {!voiceRecorder.isRecording && !voiceRecorder.audioBlob && (
                            <button
                              onClick={voiceRecorder.startRecording}
                              className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 text-white font-medium rounded-lg shadow-lg shadow-red-500/25 transition-all duration-200 flex items-center gap-2"
                            >
                              <Mic className="w-4 h-4" />
                              Start Recording
                            </button>
                          )}

                          {voiceRecorder.isRecording && (
                            <>
                              <button
                                onClick={voiceRecorder.stopRecording}
                                className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center gap-2"
                              >
                                <Square className="w-4 h-4" />
                                Stop
                              </button>

                              {!voiceRecorder.isPaused ? (
                                <button
                                  onClick={voiceRecorder.pauseRecording}
                                  className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center gap-2"
                                >
                                  <Pause className="w-4 h-4" />
                                  Pause
                                </button>
                              ) : (
                                <button
                                  onClick={voiceRecorder.resumeRecording}
                                  className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center gap-2"
                                >
                                  <PlayCircle className="w-4 h-4" />
                                  Resume
                                </button>
                              )}

                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${voiceRecorder.isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                                <span className="text-sm font-mono text-[#fafafa]">{formatTime(voiceRecorder.recordingTime)}</span>
                              </div>
                            </>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            voiceRecorder.clearRecording();
                            setRecordingStepId(null);
                          }}
                          className="px-3 py-1.5 text-sm text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>

                      {/* Audio Equalizer Visualization */}
                      {voiceRecorder.isRecording && voiceRecorder.analyserNode && (
                        <div className="flex justify-center py-2">
                          <AudioEqualizer
                            analyserNode={voiceRecorder.analyserNode}
                            isPaused={voiceRecorder.isPaused}
                            barCount={40}
                            className="w-full max-w-md"
                          />
                        </div>
                      )}

                      {/* Audio Player for recorded audio */}
                      {voiceRecorder.audioUrl && !voiceRecorder.isRecording && (
                        <div className="space-y-2">
                          <audio src={voiceRecorder.audioUrl} controls className="w-full" />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveRecording(step.step_id)}
                              disabled={uploading === step.step_id}
                              className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow-md shadow-indigo-500/25 transition-all duration-200 flex items-center gap-1.5"
                            >
                              <Save className="w-3.5 h-3.5" />
                              {uploading === step.step_id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={voiceRecorder.clearRecording}
                              className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-[#fafafa] text-sm font-medium rounded-lg border border-[#3f3f46] transition-colors"
                            >
                              Record Again
                            </button>
                          </div>
                        </div>
                      )}

                      {voiceRecorder.error && (
                        <p className="text-sm text-red-400">{voiceRecorder.error}</p>
                      )}
                    </div>
                  ) : step.voice_file_path ? (
                    <div className="bg-[#1a1a1d] border border-[#2a2a2e] rounded-lg p-4 space-y-3">
                      {/* File info header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          <span className="font-medium">{step.voice_file_path.split(/[/\\]/).pop()}</span>
                        </div>
                        {isEditing && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setRecordingStepId(step.step_id)}
                              className="px-3 py-1.5 text-sm text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] rounded-lg transition-colors flex items-center gap-1"
                            >
                              <Mic className="w-4 h-4" />
                              Record New
                            </button>
                            <input
                              type="file"
                              accept="audio/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleVoiceUpload(step.step_id, file);
                              }}
                              className="hidden"
                              id={`voice-replace-${step.step_id}`}
                              disabled={uploading === step.step_id}
                            />
                            <label htmlFor={`voice-replace-${step.step_id}`}>
                              <span className="px-3 py-1.5 text-sm text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] rounded-lg transition-colors flex items-center gap-1 cursor-pointer">
                                <Upload className="w-4 h-4" />
                                {uploading === step.step_id ? 'Uploading...' : 'Upload New'}
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                      {/* Waveform Player */}
                      <AudioWaveform
                        src={`http://localhost:8000/${step.voice_file_path.replace(/\\/g, '/')}`}
                        onPlay={() => setPlayingAudioStepId(step.step_id)}
                        onPause={() => setPlayingAudioStepId(null)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRecordingStepId(step.step_id)}
                        className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center gap-2"
                      >
                        <Mic className="w-4 h-4" />
                        Record Audio
                      </button>

                      <span className="text-[#52525b]">or</span>

                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleVoiceUpload(step.step_id, file);
                        }}
                        className="hidden"
                        id={`voice-upload-${step.step_id}`}
                        disabled={uploading === step.step_id}
                      />
                      <label htmlFor={`voice-upload-${step.step_id}`}>
                        <span className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center gap-2 cursor-pointer">
                          <Upload className="w-4 h-4" />
                          {uploading === step.step_id ? 'Uploading...' : 'Upload File'}
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Voice Text */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                    Ground Truth Transcription
                  </label>
                  {isEditing ? (
                    <textarea
                      className="w-full px-3 py-2 bg-[#1a1a1d] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                      rows={3}
                      value={currentData.voice_text ?? step.voice_text ?? ''}
                      onChange={(e) => updateStepField(step.step_id, 'voice_text', e.target.value)}
                      placeholder="Enter voice transcription..."
                    />
                  ) : (
                    <p className="text-sm text-[#a1a1aa]">
                      {step.voice_text || <span className="text-[#52525b]">No transcription</span>}
                    </p>
                  )}
                </div>

                {/* Ground Truth Cart */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[#a1a1aa]">
                      Ground Truth Cart
                    </label>
                    {isEditing && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleGenerateOrder(step.step_id)}
                          disabled={generatingOrderStepId === step.step_id}
                          title="Generate test order using AI"
                          className="px-3 py-1.5 text-sm bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors disabled:opacity-50 flex items-center"
                        >
                          {generatingOrderStepId === step.step_id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-1" />
                              Generate with AI
                            </>
                          )}
                        </button>
                        {step.step_number > 1 && (
                          <button
                            onClick={() => cloneCartFromPreviousStep(step)}
                            className="px-3 py-1.5 text-sm bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center"
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Clone from Step {step.step_number - 1}
                          </button>
                        )}
                        <button
                          onClick={() => addCartItem(step.step_id)}
                          className="px-3 py-1.5 text-sm bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors flex items-center"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add Item
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-3">
                      {getEditingCart(step).length === 0 ? (
                        <p className="text-sm text-[#52525b] text-center py-4 border border-dashed border-[#3f3f46] rounded-lg bg-[#1a1a1d]">
                          No items in cart. Click "Add Item" to start.
                        </p>
                      ) : (
                        getEditingCart(step).map((item, idx) => (
                          <div key={idx} className="border border-[#2a2a2e] rounded-lg p-3 bg-[#1a1a1d]">
                            <div className="grid grid-cols-12 gap-2 items-center">
                              {/* Product Selector - Combobox */}
                              <div className="col-span-6">
                                <label className="block text-xs text-[#71717a] mb-1">Product</label>
                                <Popover
                                  open={comboboxOpen[`${step.step_id}-${idx}`]}
                                  onOpenChange={(open) => setComboboxOpen(prev => ({ ...prev, [`${step.step_id}-${idx}`]: open }))}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      role="combobox"
                                      aria-expanded={comboboxOpen[`${step.step_id}-${idx}`]}
                                      className="w-full flex items-center justify-between px-3 py-2 text-sm bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] hover:bg-[#1a1a1d] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                      <span className={item.product_id ? 'text-[#fafafa]' : 'text-[#52525b]'}>
                                        {item.product_id
                                          ? products.find(p => p.product_id === item.product_id)?.title || "Select product..."
                                          : "Select product..."}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-[#71717a]" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[400px] p-0 bg-[#1a1a1d] border border-[#2a2a2e]">
                                    <Command className="bg-[#1a1a1d]">
                                      <CommandInput placeholder="Search products..." className="text-[#fafafa] placeholder:text-[#52525b]" />
                                      <CommandList className="max-h-[300px]">
                                        <CommandEmpty className="text-[#71717a] text-sm py-6 text-center">No product found.</CommandEmpty>
                                        <CommandGroup>
                                          {products.map(product => (
                                            <CommandItem
                                              key={product.product_id}
                                              value={product.title}
                                              onSelect={() => {
                                                updateCartItem(step.step_id, idx, 'product_id', product.product_id);
                                                setComboboxOpen(prev => ({ ...prev, [`${step.step_id}-${idx}`]: false }));
                                              }}
                                              className="text-[#fafafa] hover:bg-[#27272a] cursor-pointer"
                                            >
                                              <Check
                                                className={cn(
                                                  "mr-2 h-4 w-4 text-indigo-500",
                                                  item.product_id === product.product_id ? "opacity-100" : "opacity-0"
                                                )}
                                              />
                                              {product.title}
                                              <span className="ml-auto text-xs text-[#71717a]">ID: {product.product_id}</span>
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>

                              {/* Quantity */}
                              <div className="col-span-2">
                                <label className="block text-xs text-[#71717a] mb-1">Quantity</label>
                                <input
                                  type="number"
                                  min="1"
                                  className="w-full px-2 py-1.5 text-sm bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  value={item.quantity}
                                  onChange={(e) => updateCartItem(step.step_id, idx, 'quantity', parseInt(e.target.value) || 1)}
                                />
                              </div>

                              {/* Unit */}
                              <div className="col-span-3">
                                <label className="block text-xs text-[#71717a] mb-1">Unit</label>
                                <select
                                  className="w-full px-2 py-1.5 text-sm bg-[#121214] border border-[#2a2a2e] rounded-lg text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  value={item.unit || 'KOYTA'}
                                  onChange={(e) => updateCartItem(step.step_id, idx, 'unit', e.target.value)}
                                >
                                  <option value="KOYTA">KOYTA (Package)</option>
                                  <option value="ΤΕΜΑΧΙΟ">ΤΕΜΑΧΙΟ (Piece)</option>
                                </select>
                              </div>

                              {/* Remove Button */}
                              <div className="col-span-1 flex items-end justify-center pb-1">
                                <button
                                  onClick={() => removeCartItem(step.step_id, idx)}
                                  className="h-8 w-8 p-0 flex items-center justify-center rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                      {step.ground_truth_cart && step.ground_truth_cart.length > 0 ? (
                        step.ground_truth_cart.map((item, idx) => (
                          <div key={idx} className="bg-[#1a1a1d] p-2.5 rounded-lg border border-[#2a2a2e] text-xs">
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                                #{item.product_id}
                              </span>
                            </div>
                            <div className="font-medium text-[#e4e4e7] leading-tight line-clamp-2 mb-1.5">
                              {getProductName(item.product_id, item.product_name)}
                            </div>
                            <div className="flex items-center gap-2">
                              <span><span className="text-[#a1a1aa]">Qty:</span> <span className="font-semibold text-[#d4d4d8]">{item.quantity}</span></span>
                              <span><span className="text-[#a1a1aa]">Unit:</span> <span className="font-semibold text-[#d4d4d8]">{item.unit}</span></span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[#52525b] text-center py-4 col-span-full">No items in cart</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                {isEditing && (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => handleStepUpdate(step.step_id)}
                      className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </button>
                    <button
                      onClick={() => {
                        setEditingStep(null);
                        setStepData(prev => {
                          const newData = { ...prev };
                          delete newData[step.step_id];
                          return newData;
                        });
                        setCartTextData(prev => {
                          const newData = { ...prev };
                          delete newData[step.step_id];
                          return newData;
                        });
                      }}
                      className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Step Button */}
          <div className="mt-4">
            <button
              onClick={handleAddStep}
              className="w-full px-4 py-3 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-xl border border-dashed border-[#3f3f46] hover:border-[#52525b] transition-all duration-200 flex items-center justify-center"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add New Step
            </button>
          </div>
        </div>
          </>
        )}

        {activeTab === 'results' && (
          <div className="space-y-6">
            {/* Load Comparison Button */}
            {!comparison && !loadingComparison && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6 text-center">
                <p className="text-[#a1a1aa] mb-4">Load comparison results to see model performance</p>
                <button
                  onClick={loadComparison}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200"
                >
                  Load Comparison
                </button>
              </div>
            )}

            {loadingComparison && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                <p className="text-[#a1a1aa]">Loading comparison data...</p>
              </div>
            )}

            {/* Summary Metrics */}
            {comparison && comparison.summary && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-[#fafafa] mb-4">Model Comparison Summary</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#2a2a2e]">
                        <th className="text-left py-3 px-4 text-sm font-medium text-[#a1a1aa]">Model</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">
                          <HoverCard openDelay={200}>
                            <HoverCardTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">
                                Avg Precision
                                <HelpCircle className="w-3.5 h-3.5 text-[#71717a]" />
                              </span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#a1a1aa]" side="bottom">
                              <div className="space-y-2">
                                <h4 className="font-semibold text-[#fafafa]">Precision</h4>
                                <p className="text-sm">
                                  Measures the accuracy of the model's predictions. It answers: <em>"Of all items the model predicted, how many were correct?"</em>
                                </p>
                                <div className="bg-[#121214] rounded p-2 text-xs font-mono">
                                  Precision = Correct Items / Total Predicted Items
                                </div>
                                <p className="text-xs text-[#71717a]">
                                  High precision means fewer false positives (extra items in the cart that shouldn't be there).
                                </p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">
                          <HoverCard openDelay={200}>
                            <HoverCardTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">
                                Avg Recall
                                <HelpCircle className="w-3.5 h-3.5 text-[#71717a]" />
                              </span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#a1a1aa]" side="bottom">
                              <div className="space-y-2">
                                <h4 className="font-semibold text-[#fafafa]">Recall</h4>
                                <p className="text-sm">
                                  Measures completeness. It answers: <em>"Of all items that should be in the cart, how many did the model find?"</em>
                                </p>
                                <div className="bg-[#121214] rounded p-2 text-xs font-mono">
                                  Recall = Correct Items / Total Ground Truth Items
                                </div>
                                <p className="text-xs text-[#71717a]">
                                  High recall means fewer false negatives (missing items that should be in the cart).
                                </p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">
                          <HoverCard openDelay={200}>
                            <HoverCardTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">
                                Avg F1
                                <HelpCircle className="w-3.5 h-3.5 text-[#71717a]" />
                              </span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#a1a1aa]" side="bottom">
                              <div className="space-y-2">
                                <h4 className="font-semibold text-[#fafafa]">F1 Score</h4>
                                <p className="text-sm">
                                  The harmonic mean of Precision and Recall. It provides a single balanced metric that considers both false positives and false negatives.
                                </p>
                                <div className="bg-[#121214] rounded p-2 text-xs font-mono">
                                  F1 = 2 × (Precision × Recall) / (Precision + Recall)
                                </div>
                                <p className="text-xs text-[#71717a]">
                                  F1 is useful when you need a balance between precision and recall. A high F1 score indicates both low false positives and low false negatives.
                                </p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">
                          <HoverCard openDelay={200}>
                            <HoverCardTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">
                                Exact Matches
                                <HelpCircle className="w-3.5 h-3.5 text-[#71717a]" />
                              </span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#a1a1aa]" side="bottom">
                              <div className="space-y-2">
                                <h4 className="font-semibold text-[#fafafa]">Exact Matches</h4>
                                <p className="text-sm">
                                  Counts steps where the predicted cart <strong>exactly matches</strong> the ground truth cart - same products, same quantities, same units.
                                </p>
                                <div className="bg-[#121214] rounded p-2 text-xs font-mono">
                                  Exact Match Rate = Exact Matches / Total Steps
                                </div>
                                <p className="text-xs text-[#71717a]">
                                  This is the strictest metric. Even one wrong quantity or missing item means the step is not an exact match.
                                </p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        </th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">Total Latency</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-[#a1a1aa]">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON_MODELS.map((modelName) => {
                        const summary = comparison.summary[modelName];
                        if (!summary) return null;
                        const totalCost = calculateCost(
                          summary.total_input_tokens,
                          summary.total_output_tokens,
                          modelName
                        );
                        return (
                          <tr key={modelName} className="border-b border-[#1f1f23] hover:bg-[#1a1a1d] transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: MODEL_COLORS[modelName] }}
                                />
                                <span className="font-medium text-[#fafafa]">{MODEL_DISPLAY_NAMES[modelName]}</span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-4 text-sm text-[#a1a1aa]">
                              {(summary.avg_precision * 100).toFixed(1)}%
                            </td>
                            <td className="text-right py-3 px-4 text-sm text-[#a1a1aa]">
                              {(summary.avg_recall * 100).toFixed(1)}%
                            </td>
                            <td className="text-right py-3 px-4 text-sm font-medium text-[#fafafa]">
                              {(summary.avg_f1 * 100).toFixed(1)}%
                            </td>
                            <td className="text-right py-3 px-4 text-sm text-[#a1a1aa]">
                              {summary.exact_matches}/{summary.total_steps}
                              <span className="text-[#71717a] ml-1">
                                ({(summary.exact_match_rate * 100).toFixed(0)}%)
                              </span>
                            </td>
                            <td className="text-right py-3 px-4 text-sm text-[#a1a1aa]">
                              {(summary.total_latency_ms / 1000).toFixed(2)}s
                            </td>
                            <td className="text-right py-3 px-4 text-sm font-medium text-green-400">
                              ${totalCost.toFixed(4)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Plotly Charts for Latency and Cost Comparison */}
            {comparison && comparison.summary && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Latency Comparison Chart */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Total Latency by Model</h3>
                  <Plot
                    data={[
                      {
                        x: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_DISPLAY_NAMES[m]),
                        y: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => comparison.summary[m].total_latency_ms / 1000),
                        type: 'bar',
                        marker: {
                          color: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_COLORS[m]),
                        },
                        text: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => `${(comparison.summary[m].total_latency_ms / 1000).toFixed(2)}s`),
                        textposition: 'auto' as const,
                        textfont: { color: '#fafafa' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 80, l: 60, r: 20 },
                      yaxis: { title: 'Latency (seconds)', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { tickangle: -15, color: '#a1a1aa' },
                      showlegend: false,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Cost Comparison Chart */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Total Cost by Model</h3>
                  <Plot
                    data={[
                      {
                        x: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_DISPLAY_NAMES[m]),
                        y: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m =>
                          calculateCost(comparison.summary[m].total_input_tokens, comparison.summary[m].total_output_tokens, m)
                        ),
                        type: 'bar',
                        marker: {
                          color: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_COLORS[m]),
                        },
                        text: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m =>
                          `$${calculateCost(comparison.summary[m].total_input_tokens, comparison.summary[m].total_output_tokens, m).toFixed(4)}`
                        ),
                        textposition: 'auto' as const,
                        textfont: { color: '#fafafa' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 80, l: 60, r: 20 },
                      yaxis: { title: 'Cost (USD)', tickformat: '$.4f', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { tickangle: -15, color: '#a1a1aa' },
                      showlegend: false,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* F1 Score Comparison Chart */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Average F1 Score by Model</h3>
                  <Plot
                    data={[
                      {
                        x: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_DISPLAY_NAMES[m]),
                        y: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => comparison.summary[m].avg_f1 * 100),
                        type: 'bar',
                        marker: {
                          color: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_COLORS[m]),
                        },
                        text: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => `${(comparison.summary[m].avg_f1 * 100).toFixed(1)}%`),
                        textposition: 'auto' as const,
                        textfont: { color: '#fafafa' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 80, l: 60, r: 20 },
                      yaxis: { title: 'F1 Score (%)', range: [0, 100], color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { tickangle: -15, color: '#a1a1aa' },
                      showlegend: false,
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Token Usage Comparison Chart */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Token Usage by Model</h3>
                  <Plot
                    data={[
                      {
                        name: 'Input Tokens',
                        x: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_DISPLAY_NAMES[m]),
                        y: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => comparison.summary[m].total_input_tokens),
                        type: 'bar',
                        marker: { color: 'rgba(99, 102, 241, 0.8)' },
                      },
                      {
                        name: 'Output Tokens',
                        x: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => MODEL_DISPLAY_NAMES[m]),
                        y: COMPARISON_MODELS.filter(m => comparison.summary[m]).map(m => comparison.summary[m].total_output_tokens),
                        type: 'bar',
                        marker: { color: 'rgba(34, 197, 94, 0.8)' },
                      },
                    ]}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 80, l: 70, r: 20 },
                      yaxis: { title: 'Token Count', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { tickangle: -15, color: '#a1a1aa' },
                      barmode: 'group',
                      legend: { orientation: 'h', y: 1.15, font: { color: '#a1a1aa' } },
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {/* Per-Step Results */}
            {scenario.steps.filter(step => step && step.step_id).map((step) => (
              <div
                key={step.step_id}
                className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6"
              >
                {/* Step Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center justify-center font-semibold text-sm">
                      {step.step_number}
                    </div>
                    <h3 className="text-lg font-semibold text-[#fafafa]">Step {step.step_number}</h3>
                  </div>
                  {step.voice_file_path && (
                    <button
                      onClick={() => handlePlayAudio(step.step_id, step.voice_file_path!)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1 ${
                        playingAudioStepId === step.step_id
                          ? 'text-blue-400 bg-blue-500/10 border border-blue-500/30'
                          : 'text-[#71717a] hover:text-[#fafafa] bg-[#27272a] hover:bg-[#3f3f46] border border-[#3f3f46]'
                      }`}
                    >
                      {playingAudioStepId === step.step_id ? (
                        <>
                          <Square className="w-4 h-4" />
                          Stop Audio
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" />
                          Play Audio
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Ground Truth Transcription */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                    Ground Truth Transcription (User Input)
                  </label>
                  <div className="bg-[#1a1a1d] border border-[#2a2a2e] rounded-lg p-3">
                    <p className="text-sm text-[#a1a1aa]">
                      {step.voice_text || <span className="text-[#52525b]">No transcription</span>}
                    </p>
                  </div>
                </div>

                {/* Model Transcriptions */}
                {step.model_results && Object.keys(step.model_results).length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                      Model Transcriptions
                    </label>
                    <div className="space-y-2">
                      {COMPARISON_MODELS.map((modelName) => {
                        const result = step.model_results?.[modelName];
                        if (!result) return null;

                        return (
                          <div key={modelName} className="border border-[#2a2a2e] bg-[#1a1a1d] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: MODEL_COLORS[modelName] }}
                              />
                              <span className="text-xs font-medium text-[#71717a]">
                                {MODEL_DISPLAY_NAMES[modelName]}
                              </span>
                            </div>
                            <p className="text-sm text-[#a1a1aa]">
                              {result.llm_transcription || <span className="text-[#52525b]">No transcription</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Model AI Responses */}
                {step.model_results && Object.keys(step.model_results).length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                      AI Response
                    </label>
                    <div className="space-y-2">
                      {COMPARISON_MODELS.map((modelName) => {
                        const result = step.model_results?.[modelName];
                        if (!result) return null;

                        return (
                          <div key={modelName} className="border border-indigo-500/30 bg-indigo-500/10 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: MODEL_COLORS[modelName] }}
                              />
                              <span className="text-xs font-medium text-[#71717a]">
                                {MODEL_DISPLAY_NAMES[modelName]}
                              </span>
                            </div>
                            <p className="text-sm text-[#fafafa] whitespace-pre-wrap">
                              {result.ai_response || <span className="text-[#52525b]">No AI response</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Ground Truth Cart - Grid Layout */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                    Ground Truth Cart ({step.ground_truth_cart?.length || 0} items)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {step.ground_truth_cart && step.ground_truth_cart.length > 0 ? (
                      step.ground_truth_cart.map((item, idx) => (
                        <div key={idx} className="bg-[#1a1a1d] p-2.5 rounded-lg border border-[#2a2a2e] text-xs">
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                              #{item.product_id}
                            </span>
                          </div>
                          <div className="font-medium text-[#e4e4e7] leading-tight line-clamp-2 mb-1.5">
                            {getProductName(item.product_id, item.product_name)}
                          </div>
                          <div className="flex items-center gap-2">
                            <span><span className="text-[#a1a1aa]">Qty:</span> <span className="font-semibold text-[#d4d4d8]">{item.quantity}</span></span>
                            <span><span className="text-[#a1a1aa]">Unit:</span> <span className="font-semibold text-[#d4d4d8]">{item.unit}</span></span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[#52525b] text-center py-4 col-span-full">No items in cart</p>
                    )}
                  </div>
                </div>

                {/* Model Predicted Carts */}
                {step.model_results && Object.keys(step.model_results).length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                      Model Predictions
                    </label>
                    <div className="space-y-4">
                      {COMPARISON_MODELS.map((modelName) => {
                        const result = step.model_results?.[modelName];
                        if (!result) return (
                          <div key={modelName} className="border border-[#2a2a2e] bg-[#1a1a1d] rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[modelName] }} />
                              <span className="font-medium text-[#fafafa]">{MODEL_DISPLAY_NAMES[modelName]}</span>
                              <span className="text-[#52525b] text-sm">- Not executed</span>
                            </div>
                          </div>
                        );

                        // Check for exact match
                        const gtItems = step.ground_truth_cart || [];
                        const predItems = result.predicted_cart || [];
                        const isExactMatch = gtItems.length === predItems.length &&
                          gtItems.every(gt => predItems.some(pred => cartItemsMatch(gt, pred)));

                        return (
                          <div key={modelName} className="border border-[#2a2a2e] bg-[#1a1a1d] rounded-lg p-4">
                            {/* Model Header */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[modelName] }} />
                                <span className="font-medium text-[#fafafa]">{MODEL_DISPLAY_NAMES[modelName]}</span>
                                {isExactMatch ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                    <Check className="w-3 h-3 mr-1" />
                                    Match
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                    Mismatch
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-[#71717a]">
                                <span>Latency: {result.latency_ms ? `${(result.latency_ms / 1000).toFixed(2)}s` : '-'}</span>
                                <span>Tokens: {result.input_tokens && result.output_tokens
                                  ? `${result.input_tokens.toLocaleString()} / ${result.output_tokens.toLocaleString()}`
                                  : '-'}</span>
                                <button
                                  onClick={() => {
                                    setViewingRawResponse(step);
                                    setSelectedModelForRawResponse(modelName);
                                  }}
                                  className="px-2 py-1 text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] rounded transition-colors flex items-center"
                                >
                                  <Eye className="w-4 h-4 mr-1" />
                                  Raw
                                </button>
                              </div>
                            </div>

                            {/* Predicted Cart Items - Grid Layout */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                              {result.predicted_cart && result.predicted_cart.length > 0 ? (
                                result.predicted_cart.map((item, idx) => {
                                  const mismatchDetail = getMismatchDetail(item, step.ground_truth_cart || []);
                                  const isCorrect = mismatchDetail.type === 'exact_match';
                                  const isPartialMatch = mismatchDetail.type === 'quantity_mismatch' ||
                                                         mismatchDetail.type === 'unit_mismatch' ||
                                                         mismatchDetail.type === 'quantity_and_unit_mismatch';

                                  // Color scheme based on mismatch type
                                  const getBgColor = () => {
                                    if (isCorrect) return 'bg-green-500/10 border-green-500/30';
                                    if (isPartialMatch) return 'bg-amber-500/10 border-amber-500/30';
                                    return 'bg-red-500/10 border-red-500/30'; // extra_item
                                  };

                                  const getIdBadgeColor = () => {
                                    if (isCorrect) return 'bg-green-500/20 text-green-400';
                                    if (isPartialMatch) return 'bg-amber-500/20 text-amber-400';
                                    return 'bg-red-500/20 text-red-400';
                                  };

                                  const getTextColor = () => {
                                    if (isCorrect) return 'text-green-200';
                                    if (isPartialMatch) return 'text-amber-200';
                                    return 'text-red-200';
                                  };

                                  const getLabelColor = () => {
                                    if (isCorrect) return 'text-green-400/70';
                                    if (isPartialMatch) return 'text-amber-400/70';
                                    return 'text-red-400/70';
                                  };

                                  const getValueColor = () => {
                                    if (isCorrect) return 'text-green-300';
                                    if (isPartialMatch) return 'text-amber-300';
                                    return 'text-red-300';
                                  };

                                  // Mismatch badge text
                                  const getMismatchBadge = () => {
                                    switch (mismatchDetail.type) {
                                      case 'quantity_mismatch':
                                        return 'Qty';
                                      case 'unit_mismatch':
                                        return 'Unit';
                                      case 'quantity_and_unit_mismatch':
                                        return 'Qty+Unit';
                                      case 'extra_item':
                                        return 'Extra';
                                      default:
                                        return null;
                                    }
                                  };

                                  return (
                                    <div
                                      key={idx}
                                      className={`p-2.5 rounded-lg border text-xs ${getBgColor()}`}
                                    >
                                      <div className="flex items-start justify-between gap-1 mb-1">
                                        <span className={`font-mono text-[10px] px-1 py-0.5 rounded ${getIdBadgeColor()}`}>
                                          #{item.product_id}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          {getMismatchBadge() && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                              mismatchDetail.type === 'extra_item'
                                                ? 'bg-red-500/30 text-red-300'
                                                : 'bg-amber-500/30 text-amber-300'
                                            }`}>
                                              {getMismatchBadge()}
                                            </span>
                                          )}
                                          {isCorrect && <Check className="w-3 h-3 text-green-400 flex-shrink-0" />}
                                        </div>
                                      </div>
                                      <div className={`font-medium leading-tight line-clamp-2 mb-1.5 ${getTextColor()}`}>
                                        {getProductName(item.product_id, item.product_name)}
                                      </div>
                                      <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-1">
                                          <span className={getLabelColor()}>Qty:</span>
                                          <span className={`font-semibold ${
                                            mismatchDetail.type === 'quantity_mismatch' || mismatchDetail.type === 'quantity_and_unit_mismatch'
                                              ? 'text-amber-300 line-through'
                                              : getValueColor()
                                          }`}>{item.quantity}</span>
                                          {(mismatchDetail.type === 'quantity_mismatch' || mismatchDetail.type === 'quantity_and_unit_mismatch') && (
                                            <span className="text-green-400 font-semibold">→{mismatchDetail.expectedQuantity}</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className={getLabelColor()}>Unit:</span>
                                          <span className={`font-semibold ${
                                            mismatchDetail.type === 'unit_mismatch' || mismatchDetail.type === 'quantity_and_unit_mismatch'
                                              ? 'text-amber-300 line-through'
                                              : getValueColor()
                                          }`}>{item.unit}</span>
                                          {(mismatchDetail.type === 'unit_mismatch' || mismatchDetail.type === 'quantity_and_unit_mismatch') && (
                                            <span className="text-green-400 font-semibold">→{mismatchDetail.expectedUnit}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-sm text-[#52525b] text-center py-4 col-span-full">Empty cart</p>
                              )}
                            </div>

                            {/* Missing Items Section */}
                            {(() => {
                              const missingItems = getMissingItems(step.ground_truth_cart || [], result.predicted_cart || []);
                              if (missingItems.length === 0) return null;

                              return (
                                <div className="mt-3 pt-3 border-t border-[#2a2a2e]">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-medium text-red-400">Missing Items ({missingItems.length})</span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                    {missingItems.map((item, idx) => (
                                      <div
                                        key={idx}
                                        className="p-2.5 rounded-lg border text-xs bg-red-500/5 border-red-500/20 border-dashed"
                                      >
                                        <div className="flex items-start justify-between gap-1 mb-1">
                                          <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">
                                            #{item.product_id}
                                          </span>
                                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-red-500/30 text-red-300">
                                            Missing
                                          </span>
                                        </div>
                                        <div className="font-medium leading-tight line-clamp-2 mb-1.5 text-red-200/70">
                                          {getProductName(item.product_id, item.product_name)}
                                        </div>
                                        <div className="flex flex-col gap-0.5 text-red-400/70">
                                          <span>Qty: <span className="font-semibold text-red-300/70">{item.quantity}</span></span>
                                          <span>Unit: <span className="font-semibold text-red-300/70">{item.unit}</span></span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Fallback for legacy single-model results */}
                {(!step.model_results || Object.keys(step.model_results).length === 0) && step.ai_response && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[#a1a1aa] mb-2">
                      AI Response (Legacy Single Model)
                    </label>
                    <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-3">
                      <p className="text-sm text-[#fafafa] whitespace-pre-wrap">{step.ai_response}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'cost' && (
          <div className="space-y-6">
            {/* Load Comparison Button */}
            {!comparison && !loadingComparison && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6 text-center">
                <p className="text-[#a1a1aa] mb-4">Load comparison data to see cost and latency breakdown by model</p>
                <button
                  onClick={loadComparison}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200"
                >
                  Load Cost Data
                </button>
              </div>
            )}

            {loadingComparison && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                <p className="text-[#a1a1aa]">Loading cost data...</p>
              </div>
            )}

            {/* Multi-Model Summary Cards */}
            {comparison && comparison.summary && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-[#fafafa] mb-4">Cost & Latency Summary by Model</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {COMPARISON_MODELS.map((modelName) => {
                    const summary = comparison.summary[modelName];
                    if (!summary) return null;
                    const totalCost = calculateCost(summary.total_input_tokens, summary.total_output_tokens, modelName);
                    return (
                      <div key={modelName} className="border border-[#2a2a2e] bg-[#1a1a1d] rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[modelName] }} />
                          <h3 className="font-semibold text-[#fafafa]">{MODEL_DISPLAY_NAMES[modelName]}</h3>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-[#71717a]">Input Tokens:</span>
                            <span className="font-medium text-[#a1a1aa]">{summary.total_input_tokens.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-[#71717a]">Output Tokens:</span>
                            <span className="font-medium text-[#a1a1aa]">{summary.total_output_tokens.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-[#71717a]">Total Latency:</span>
                            <span className="font-medium text-[#a1a1aa]">{(summary.total_latency_ms / 1000).toFixed(2)}s</span>
                          </div>
                          <div className="flex justify-between text-sm pt-2 border-t border-[#2a2a2e]">
                            <span className="text-[#a1a1aa] font-medium">Total Cost:</span>
                            <span className="font-bold text-green-400">${totalCost.toFixed(4)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Plotly Charts for Cost Tab */}
            {comparison && comparison.summary && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cost per Step by Model */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Latency per Step by Model</h3>
                  <Plot
                    data={COMPARISON_MODELS.filter(m => comparison.summary[m]).map((modelName) => ({
                      name: MODEL_DISPLAY_NAMES[modelName],
                      x: scenario.steps
                        .filter(s => s && s.step_id && s.model_results?.[modelName])
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(s => `Step ${s.step_number}`),
                      y: scenario.steps
                        .filter(s => s && s.step_id && s.model_results?.[modelName])
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(s => (s.model_results?.[modelName]?.latency_ms || 0) / 1000),
                      type: 'scatter' as const,
                      mode: 'lines+markers' as const,
                      marker: { color: MODEL_COLORS[modelName] },
                      line: { color: MODEL_COLORS[modelName] },
                    }))}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 60, l: 60, r: 20 },
                      yaxis: { title: 'Latency (seconds)', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { color: '#a1a1aa' },
                      legend: { orientation: 'h', y: 1.15, font: { color: '#a1a1aa' } },
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Cost per Step by Model */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Cost per Step by Model</h3>
                  <Plot
                    data={COMPARISON_MODELS.filter(m => comparison.summary[m]).map((modelName) => ({
                      name: MODEL_DISPLAY_NAMES[modelName],
                      x: scenario.steps
                        .filter(s => s && s.step_id && s.model_results?.[modelName])
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(s => `Step ${s.step_number}`),
                      y: scenario.steps
                        .filter(s => s && s.step_id && s.model_results?.[modelName])
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(s => calculateModelResultCost(s.model_results?.[modelName], modelName)),
                      type: 'scatter' as const,
                      mode: 'lines+markers' as const,
                      marker: { color: MODEL_COLORS[modelName] },
                      line: { color: MODEL_COLORS[modelName] },
                    }))}
                    layout={{
                      autosize: true,
                      height: 300,
                      margin: { t: 20, b: 60, l: 70, r: 20 },
                      yaxis: { title: 'Cost (USD)', tickformat: '$.5f', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { color: '#a1a1aa' },
                      legend: { orientation: 'h', y: 1.15, font: { color: '#a1a1aa' } },
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>

                {/* Cumulative Cost Over Steps */}
                <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6 lg:col-span-2">
                  <h3 className="text-md font-semibold text-[#fafafa] mb-4">Cumulative Cost Over Steps</h3>
                  <Plot
                    data={COMPARISON_MODELS.filter(m => comparison.summary[m]).map((modelName) => {
                      const sortedSteps = scenario.steps
                        .filter(s => s && s.step_id && s.model_results?.[modelName])
                        .sort((a, b) => a.step_number - b.step_number);

                      let cumulativeCost = 0;
                      const cumulativeCosts = sortedSteps.map(s => {
                        cumulativeCost += calculateModelResultCost(s.model_results?.[modelName], modelName);
                        return cumulativeCost;
                      });

                      return {
                        name: MODEL_DISPLAY_NAMES[modelName],
                        x: sortedSteps.map(s => `Step ${s.step_number}`),
                        y: cumulativeCosts,
                        type: 'scatter' as const,
                        mode: 'lines+markers' as const,
                        fill: 'tozeroy' as const,
                        marker: { color: MODEL_COLORS[modelName] },
                        line: { color: MODEL_COLORS[modelName] },
                      };
                    })}
                    layout={{
                      autosize: true,
                      height: 350,
                      margin: { t: 20, b: 60, l: 70, r: 20 },
                      yaxis: { title: 'Cumulative Cost (USD)', tickformat: '$.4f', color: '#a1a1aa', gridcolor: '#2a2a2e' },
                      xaxis: { color: '#a1a1aa' },
                      legend: { orientation: 'h', y: 1.1, font: { color: '#a1a1aa' } },
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                      font: { color: '#a1a1aa' },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}

            {/* Per-Step Breakdown Table */}
            {comparison && comparison.summary && (
              <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl p-6">
                <h2 className="text-lg font-semibold text-[#fafafa] mb-4">Per-Step Cost & Latency Breakdown</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#2a2a2e]">
                        <th className="text-left py-3 px-3 font-medium text-[#a1a1aa]">Step</th>
                        {COMPARISON_MODELS.filter(m => comparison.summary[m]).map(modelName => (
                          <th key={modelName} className="text-center py-3 px-3 font-medium text-[#a1a1aa]" colSpan={3}>
                            <div className="flex items-center justify-center gap-1">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[modelName] }} />
                              {MODEL_DISPLAY_NAMES[modelName]}
                            </div>
                          </th>
                        ))}
                      </tr>
                      <tr className="border-b border-[#2a2a2e] bg-[#1a1a1d]">
                        <th className="text-left py-2 px-3 text-xs text-[#71717a]"></th>
                        {COMPARISON_MODELS.filter(m => comparison.summary[m]).map(modelName => (
                          <React.Fragment key={modelName}>
                            <th className="text-right py-2 px-2 text-xs text-[#71717a]">Tokens (I/O)</th>
                            <th className="text-right py-2 px-2 text-xs text-[#71717a]">Latency</th>
                            <th className="text-right py-2 px-2 text-xs text-[#71717a]">Cost</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scenario.steps
                        .filter(step => step && step.step_id)
                        .sort((a, b) => a.step_number - b.step_number)
                        .map(step => (
                          <tr key={step.step_id} className="border-b border-[#1f1f23] hover:bg-[#1a1a1d] transition-colors">
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center justify-center text-xs font-semibold">
                                  {step.step_number}
                                </div>
                              </div>
                            </td>
                            {COMPARISON_MODELS.filter(m => comparison.summary[m]).map(modelName => {
                              const result = step.model_results?.[modelName];
                              if (!result) {
                                return (
                                  <React.Fragment key={modelName}>
                                    <td className="text-right py-3 px-2 text-[#52525b]">-</td>
                                    <td className="text-right py-3 px-2 text-[#52525b]">-</td>
                                    <td className="text-right py-3 px-2 text-[#52525b]">-</td>
                                  </React.Fragment>
                                );
                              }
                              const stepCost = calculateModelResultCost(result, modelName);
                              return (
                                <React.Fragment key={modelName}>
                                  <td className="text-right py-3 px-2 text-[#71717a] text-xs">
                                    {result.input_tokens?.toLocaleString()}/{result.output_tokens?.toLocaleString()}
                                  </td>
                                  <td className="text-right py-3 px-2 text-[#a1a1aa]">
                                    {result.latency_ms ? `${(result.latency_ms / 1000).toFixed(2)}s` : '-'}
                                  </td>
                                  <td className="text-right py-3 px-2 font-medium text-green-400">
                                    ${stepCost.toFixed(5)}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      {/* Totals Row */}
                      <tr className="bg-[#1a1a1d] font-semibold">
                        <td className="py-3 px-3 text-[#fafafa]">Total</td>
                        {COMPARISON_MODELS.filter(m => comparison.summary[m]).map(modelName => {
                          const summary = comparison.summary[modelName];
                          const totalCost = calculateCost(summary.total_input_tokens, summary.total_output_tokens, modelName);
                          return (
                            <React.Fragment key={modelName}>
                              <td className="text-right py-3 px-2 text-xs text-[#a1a1aa]">
                                {summary.total_input_tokens.toLocaleString()}/{summary.total_output_tokens.toLocaleString()}
                              </td>
                              <td className="text-right py-3 px-2 text-[#fafafa]">
                                {(summary.total_latency_ms / 1000).toFixed(2)}s
                              </td>
                              <td className="text-right py-3 px-2 text-green-400">
                                ${totalCost.toFixed(4)}
                              </td>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pricing Information */}
            <div className="bg-[#1a1a1d] border border-[#2a2a2e] rounded-xl p-6">
              <h3 className="text-md font-semibold text-[#fafafa] mb-3">Pricing Information (per 1M tokens)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {COMPARISON_MODELS.map(modelName => (
                  <div key={modelName} className="bg-[#121214] border border-[#2a2a2e] rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[modelName] }} />
                      <span className="font-medium text-sm text-[#fafafa]">{MODEL_DISPLAY_NAMES[modelName]}</span>
                    </div>
                    {MODEL_PRICING[modelName as keyof typeof MODEL_PRICING] && (
                      <div className="text-xs text-[#71717a] space-y-1">
                        <div className="flex justify-between">
                          <span>Input:</span>
                          <span className="text-[#a1a1aa]">${MODEL_PRICING[modelName as keyof typeof MODEL_PRICING].input_small}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Output:</span>
                          <span className="text-[#a1a1aa]">${MODEL_PRICING[modelName as keyof typeof MODEL_PRICING].output_small}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-[#52525b] mt-3">
                Note: Costs are calculated assuming small tier (≤200k tokens). Actual costs may vary.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Raw LLM Response Dialog */}
      <Dialog open={viewingRawResponse !== null} onOpenChange={(open) => {
        if (!open) {
          setViewingRawResponse(null);
          setSelectedModelForRawResponse(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-[#121214] border border-[#2a2a2e]">
          <DialogHeader>
            <DialogTitle className="text-[#fafafa]">
              Full LLM Response - Step {viewingRawResponse?.step_number}
              {selectedModelForRawResponse && (
                <span className="ml-2 text-sm font-normal text-[#71717a]">
                  ({MODEL_DISPLAY_NAMES[selectedModelForRawResponse] || selectedModelForRawResponse})
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-[#71717a]">
              Complete raw response from the language model, including all XML tags and formatting.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="bg-[#0a0a0b] text-[#a1a1aa] rounded-lg p-4 font-mono text-sm overflow-x-auto border border-[#2a2a2e]">
              <pre className="whitespace-pre-wrap break-words">
                {selectedModelForRawResponse && viewingRawResponse?.model_results?.[selectedModelForRawResponse]?.raw_llm_response
                  ? viewingRawResponse.model_results[selectedModelForRawResponse].raw_llm_response
                  : viewingRawResponse?.raw_llm_response || 'No raw response available'}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => {
                setViewingRawResponse(null);
                setSelectedModelForRawResponse(null);
              }}
              className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                const rawResponse = selectedModelForRawResponse && viewingRawResponse?.model_results?.[selectedModelForRawResponse]?.raw_llm_response
                  ? viewingRawResponse.model_results[selectedModelForRawResponse].raw_llm_response
                  : viewingRawResponse?.raw_llm_response;
                if (rawResponse) {
                  navigator.clipboard.writeText(rawResponse);
                  toast.success('Copied to clipboard');
                }
              }}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all duration-200 flex items-center"
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy to Clipboard
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Step Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteStepDialogOpen}
        onOpenChange={setDeleteStepDialogOpen}
        onConfirm={handleDeleteStep}
        title="Delete Step"
        description={`Are you sure you want to delete Step ${stepToDelete?.step_number}? This action cannot be undone.`}
      />
    </div>
  );
}
