import { useState, useEffect } from 'react';
import { scenarioAPI } from '@/lib/scenario-api';
import type { Scenario, ScenarioComparisonResponse, ModelSummary } from '@/lib/scenario-types';
import { toast } from 'sonner';
import {
  BarChart3,
  TrendingUp,
  Clock,
  Coins,
  Target,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  Zap,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import Plot from 'react-plotly.js';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

// Metric definitions for hover cards
const METRIC_DEFINITIONS = {
  precision: {
    title: 'Precision',
    description: 'Of all items the model predicted, what percentage were correct?',
    formula: 'Precision = True Positives / (True Positives + False Positives)',
    example: 'If the model returns 10 items but only 8 are in the ground truth, precision = 80%',
    interpretation: 'High precision means few false positives (model rarely adds wrong items)',
  },
  recall: {
    title: 'Recall',
    description: 'Of all items that should be in the cart, what percentage did the model find?',
    formula: 'Recall = True Positives / (True Positives + False Negatives)',
    example: 'If the ground truth has 10 items but the model only returns 7 of them, recall = 70%',
    interpretation: 'High recall means few false negatives (model rarely misses items)',
  },
  f1: {
    title: 'F1 Score',
    description: 'The harmonic mean of precision and recall, providing a balanced measure.',
    formula: 'F1 = 2 × (Precision × Recall) / (Precision + Recall)',
    example: 'If precision is 80% and recall is 70%, F1 = 74.67%',
    interpretation: 'F1 balances both metrics - useful when you care equally about precision and recall',
  },
  exactMatch: {
    title: 'Exact Match',
    description: 'Did the model return exactly the same cart as the ground truth?',
    formula: 'Exact Match = 1 if predicted cart equals ground truth cart, else 0',
    example: 'Only counts as a match if all items, quantities, and units are identical',
    interpretation: 'The strictest metric - 100% means perfect cart prediction every time',
  },
};

// Pricing configuration for different models (per 1M tokens in USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': {
    input: 1.25,   // $1.25 per 1M input tokens
    output: 10.00, // $10.00 per 1M output tokens
  },
  'gemini-2.5-flash': {
    input: 0.15,   // $0.15 per 1M input tokens
    output: 0.60,  // $0.60 per 1M output tokens (non-thinking)
  },
};

// Calculate cost based on model and token usage
function calculateCost(inputTokens: number, outputTokens: number, modelName: string): number {
  const pricing = MODEL_PRICING[modelName] || MODEL_PRICING['gemini-2.5-pro'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

interface AggregatedModelMetrics {
  model_name: string;
  total_scenarios: number;
  total_steps: number;
  avg_precision: number;
  avg_recall: number;
  avg_f1: number;
  exact_match_rate: number;
  total_exact_matches: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_latency_ms: number;
  avg_latency_ms: number;
  total_cost: number;
  avg_cost_per_step: number;
}

interface DashboardMetrics {
  total_scenarios: number;
  total_executed_scenarios: number;
  total_steps: number;
  models: Record<string, AggregatedModelMetrics>;
}

// Reusable MetricHoverCard component
function MetricHoverCard({
  metric,
  children
}: {
  metric: keyof typeof METRIC_DEFINITIONS;
  children: React.ReactNode;
}) {
  const def = METRIC_DEFINITIONS[metric];

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="cursor-help inline-flex items-center gap-1">
          {children}
          <HelpCircle className="w-3 h-3 text-[#52525b] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#fafafa]"
        side="top"
      >
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-[#fafafa]">{def.title}</h4>
            <p className="text-xs text-[#a1a1aa] mt-1">{def.description}</p>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-indigo-400">Formula</p>
              <p className="text-xs text-[#71717a] font-mono">{def.formula}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-purple-400">Example</p>
              <p className="text-xs text-[#71717a]">{def.example}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-emerald-400">Interpretation</p>
              <p className="text-xs text-[#71717a]">{def.interpretation}</p>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Get all scenarios
      const response = await scenarioAPI.listScenarios();
      const scenarios = response.scenarios;

      // Initialize aggregated metrics
      const aggregatedMetrics: DashboardMetrics = {
        total_scenarios: scenarios.length,
        total_executed_scenarios: 0,
        total_steps: 0,
        models: {},
      };

      // Fetch comparison data for each scenario
      for (const scenario of scenarios) {
        // Check if scenario has been executed (has model results)
        const hasResults = scenario.steps.some(
          (step) => step.model_results && Object.keys(step.model_results).length > 0
        );

        if (!hasResults) continue;

        aggregatedMetrics.total_executed_scenarios++;
        aggregatedMetrics.total_steps += scenario.steps.length;

        try {
          const comparison = await scenarioAPI.getComparison(scenario.scenario_id);

          // Aggregate metrics for each model
          for (const [modelName, summary] of Object.entries(comparison.summary)) {
            if (!aggregatedMetrics.models[modelName]) {
              aggregatedMetrics.models[modelName] = {
                model_name: modelName,
                total_scenarios: 0,
                total_steps: 0,
                avg_precision: 0,
                avg_recall: 0,
                avg_f1: 0,
                exact_match_rate: 0,
                total_exact_matches: 0,
                total_input_tokens: 0,
                total_output_tokens: 0,
                total_latency_ms: 0,
                avg_latency_ms: 0,
                total_cost: 0,
                avg_cost_per_step: 0,
              };
            }

            const modelMetrics = aggregatedMetrics.models[modelName];
            modelMetrics.total_scenarios++;
            modelMetrics.total_steps += summary.total_steps;
            modelMetrics.total_exact_matches += summary.exact_matches;
            modelMetrics.total_input_tokens += summary.total_input_tokens;
            modelMetrics.total_output_tokens += summary.total_output_tokens;
            modelMetrics.total_latency_ms += summary.total_latency_ms;
            // Calculate cost from tokens using model pricing
            modelMetrics.total_cost += calculateCost(
              summary.total_input_tokens,
              summary.total_output_tokens,
              modelName
            );

            // Weighted average for precision, recall, f1
            const weight = summary.total_steps;
            modelMetrics.avg_precision += summary.avg_precision * weight;
            modelMetrics.avg_recall += summary.avg_recall * weight;
            modelMetrics.avg_f1 += summary.avg_f1 * weight;
          }
        } catch (err) {
          console.error(`Error fetching comparison for scenario ${scenario.scenario_id}:`, err);
        }
      }

      // Calculate final averages
      for (const modelMetrics of Object.values(aggregatedMetrics.models)) {
        if (modelMetrics.total_steps > 0) {
          modelMetrics.avg_precision /= modelMetrics.total_steps;
          modelMetrics.avg_recall /= modelMetrics.total_steps;
          modelMetrics.avg_f1 /= modelMetrics.total_steps;
          modelMetrics.exact_match_rate = modelMetrics.total_exact_matches / modelMetrics.total_steps;
          modelMetrics.avg_latency_ms = modelMetrics.total_latency_ms / modelMetrics.total_steps;
          modelMetrics.avg_cost_per_step = modelMetrics.total_cost / modelMetrics.total_steps;
        }
      }

      setMetrics(aggregatedMetrics);
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatNumber = (num: number, decimals = 2) => {
    return num.toFixed(decimals);
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const formatLatency = (ms: number) => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms.toFixed(0)}ms`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(2)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  const modelColors: Record<string, string> = {
    'gemini-2.5-pro': '#6366f1',
    'gemini-2.5-flash': '#a855f7',
    'gemini-3-pro-preview': '#ec4899',
  };

  const getModelColor = (modelName: string, index: number) => {
    return modelColors[modelName] || ['#6366f1', '#a855f7', '#ec4899', '#f59e0b'][index % 4];
  };

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0b]">
        <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
          <h1 className="text-2xl font-semibold text-[#fafafa]">Dashboard</h1>
          <p className="text-sm text-[#71717a]">Cumulative analytics from all executed scenarios</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-[#71717a]">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading dashboard data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics || metrics.total_executed_scenarios === 0) {
    return (
      <div className="flex flex-col h-screen bg-[#0a0a0b]">
        <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
          <h1 className="text-2xl font-semibold text-[#fafafa]">Dashboard</h1>
          <p className="text-sm text-[#71717a]">Cumulative analytics from all executed scenarios</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <BarChart3 className="w-16 h-16 text-[#3f3f46] mx-auto mb-4" />
            <p className="text-lg text-[#a1a1aa]">No executed scenarios yet</p>
            <p className="text-sm text-[#71717a] mt-2">Execute some scenarios to see analytics here</p>
          </div>
        </div>
      </div>
    );
  }

  const modelNames = Object.keys(metrics.models);
  const modelMetricsList = Object.values(metrics.models);

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-[#fafafa]">Dashboard</h1>
            <p className="text-xs sm:text-sm text-[#71717a]">Cumulative analytics from all executed scenarios</p>
          </div>
          <button
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            className="px-3 sm:px-4 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-lg border border-[#2a2a2e] transition-all duration-200 flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-[#71717a] truncate">Total Scenarios</p>
                <p className="text-lg sm:text-2xl font-bold text-[#fafafa]">{metrics.total_scenarios}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500" />
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-[#71717a] truncate">Executed</p>
                <p className="text-lg sm:text-2xl font-bold text-[#fafafa]">{metrics.total_executed_scenarios}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-500 to-orange-500" />
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-pink-500/20 flex items-center justify-center flex-shrink-0">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-pink-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-[#71717a] truncate">Total Steps</p>
                <p className="text-lg sm:text-2xl font-bold text-[#fafafa]">{metrics.total_steps}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-500 to-yellow-500" />
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-[#71717a] truncate">Models Compared</p>
                <p className="text-lg sm:text-2xl font-bold text-[#fafafa]">{modelNames.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Model Comparison Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {modelMetricsList.map((model, index) => (
            <div
              key={model.model_name}
              className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl overflow-hidden"
            >
              <div
                className="h-1 w-full"
                style={{ background: `linear-gradient(to right, ${getModelColor(model.model_name, index)}, ${getModelColor(model.model_name, index)}aa)` }}
              />
              <div className="p-3 sm:p-5">
                <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                  <div
                    className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getModelColor(model.model_name, index) }}
                  />
                  <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] truncate">{model.model_name}</h3>
                  <span className="text-[10px] sm:text-xs text-[#71717a] bg-[#1a1a1d] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full ml-auto flex-shrink-0">
                    {model.total_scenarios} scenarios
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                  <div className="bg-[#0a0a0b] rounded-lg sm:rounded-xl p-2 sm:p-3 group">
                    <MetricHoverCard metric="f1">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                        <Target className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
                        <span className="text-[10px] sm:text-xs text-[#71717a]">Avg F1</span>
                      </div>
                    </MetricHoverCard>
                    <p className="text-base sm:text-xl font-bold text-emerald-400">
                      {formatNumber(model.avg_f1 * 100)}%
                    </p>
                  </div>

                  <div className="bg-[#0a0a0b] rounded-lg sm:rounded-xl p-2 sm:p-3 group">
                    <MetricHoverCard metric="exactMatch">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                        <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4 text-blue-400" />
                        <span className="text-[10px] sm:text-xs text-[#71717a]">Exact Match</span>
                      </div>
                    </MetricHoverCard>
                    <p className="text-base sm:text-xl font-bold text-blue-400">
                      {formatNumber(model.exact_match_rate * 100)}%
                    </p>
                  </div>

                  <div className="bg-[#0a0a0b] rounded-lg sm:rounded-xl p-2 sm:p-3">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400" />
                      <span className="text-[10px] sm:text-xs text-[#71717a]">Avg Latency</span>
                    </div>
                    <p className="text-base sm:text-xl font-bold text-amber-400">
                      {formatLatency(model.avg_latency_ms)}
                    </p>
                  </div>

                  <div className="bg-[#0a0a0b] rounded-lg sm:rounded-xl p-2 sm:p-3">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <Coins className="w-3 h-3 sm:w-4 sm:h-4 text-purple-400" />
                      <span className="text-[10px] sm:text-xs text-[#71717a]">Total Cost</span>
                    </div>
                    <p className="text-base sm:text-xl font-bold text-purple-400">
                      {formatCost(model.total_cost)}
                    </p>
                  </div>

                  <div className="bg-[#0a0a0b] rounded-lg sm:rounded-xl p-2 sm:p-3">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <Coins className="w-3 h-3 sm:w-4 sm:h-4 text-pink-400" />
                      <span className="text-[10px] sm:text-xs text-[#71717a]">Avg/Step</span>
                    </div>
                    <p className="text-base sm:text-xl font-bold text-pink-400">
                      {formatCost(model.avg_cost_per_step)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-[#2a2a2e]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
                    <div className="group flex sm:block justify-between">
                      <MetricHoverCard metric="precision">
                        <span className="text-[#71717a]">Precision: </span>
                      </MetricHoverCard>
                      <span className="text-[#fafafa] font-medium">{formatNumber(model.avg_precision * 100)}%</span>
                    </div>
                    <div className="group flex sm:block justify-between">
                      <MetricHoverCard metric="recall">
                        <span className="text-[#71717a]">Recall: </span>
                      </MetricHoverCard>
                      <span className="text-[#fafafa] font-medium">{formatNumber(model.avg_recall * 100)}%</span>
                    </div>
                    <div className="flex sm:block justify-between">
                      <span className="text-[#71717a]">Tokens: </span>
                      <span className="text-[#fafafa] font-medium">
                        {formatTokens(model.total_input_tokens + model.total_output_tokens)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Charts */}
        {modelMetricsList.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {/* Accuracy Comparison Chart */}
            <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5">
              <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] mb-3 sm:mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
                <span className="truncate">Accuracy Metrics</span>
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button className="ml-1">
                      <HelpCircle className="w-4 h-4 text-[#52525b] hover:text-[#71717a] transition-colors" />
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#fafafa]" side="right">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Understanding the Chart</h4>
                      <p className="text-xs text-[#a1a1aa]">
                        This chart compares three key accuracy metrics across models:
                      </p>
                      <ul className="text-xs text-[#71717a] space-y-1 list-disc list-inside">
                        <li><span className="text-indigo-400">Precision</span>: How accurate are predictions</li>
                        <li><span className="text-purple-400">Recall</span>: How complete are predictions</li>
                        <li><span className="text-pink-400">F1 Score</span>: Balance of both</li>
                      </ul>
                      <p className="text-xs text-[#52525b] mt-2">Hover over metric labels for detailed definitions.</p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </h3>
              <Plot
                data={[
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.avg_precision * 100),
                    name: 'Precision',
                    type: 'bar',
                    marker: { color: '#6366f1' },
                  },
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.avg_recall * 100),
                    name: 'Recall',
                    type: 'bar',
                    marker: { color: '#a855f7' },
                  },
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.avg_f1 * 100),
                    name: 'F1 Score',
                    type: 'bar',
                    marker: { color: '#ec4899' },
                  },
                ]}
                layout={{
                  barmode: 'group',
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  font: { color: '#a1a1aa', size: 12 },
                  margin: { l: 50, r: 20, t: 20, b: 60 },
                  xaxis: {
                    gridcolor: '#2a2a2e',
                    tickangle: -15,
                  },
                  yaxis: {
                    gridcolor: '#2a2a2e',
                    title: 'Percentage (%)',
                    range: [0, 100],
                  },
                  legend: {
                    orientation: 'h',
                    y: -0.2,
                    x: 0.5,
                    xanchor: 'center',
                  },
                  showlegend: true,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: 250 }}
                useResizeHandler={true}
              />
            </div>

            {/* Cost & Performance Chart */}
            <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5">
              <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] mb-3 sm:mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
                <span className="truncate">Cost vs Performance</span>
              </h3>
              <Plot
                data={[
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.avg_latency_ms),
                    name: 'Avg Latency (ms)',
                    type: 'bar',
                    marker: { color: '#f59e0b' },
                    yaxis: 'y',
                  },
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.total_cost * 1000),
                    name: 'Total Cost (x1000)',
                    type: 'scatter',
                    mode: 'lines+markers',
                    marker: { color: '#10b981', size: 10 },
                    line: { color: '#10b981', width: 2 },
                    yaxis: 'y2',
                  },
                ]}
                layout={{
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  font: { color: '#a1a1aa', size: 12 },
                  margin: { l: 50, r: 50, t: 20, b: 60 },
                  xaxis: {
                    gridcolor: '#2a2a2e',
                    tickangle: -15,
                  },
                  yaxis: {
                    gridcolor: '#2a2a2e',
                    title: 'Latency (ms)',
                    side: 'left',
                  },
                  yaxis2: {
                    title: 'Cost ($) x1000',
                    overlaying: 'y',
                    side: 'right',
                    gridcolor: 'transparent',
                  },
                  legend: {
                    orientation: 'h',
                    y: -0.2,
                    x: 0.5,
                    xanchor: 'center',
                  },
                  showlegend: true,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: 250 }}
                useResizeHandler={true}
              />
            </div>

            {/* Token Usage Chart */}
            <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5">
              <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] mb-3 sm:mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-pink-400" />
                <span className="truncate">Token Usage</span>
              </h3>
              <Plot
                data={[
                  {
                    values: modelMetricsList.map((m) => m.total_input_tokens + m.total_output_tokens),
                    labels: modelNames,
                    type: 'pie',
                    hole: 0.5,
                    marker: {
                      colors: modelNames.map((name, i) => getModelColor(name, i)),
                    },
                    textinfo: 'percent',
                    textfont: { color: '#fafafa' },
                  },
                ]}
                layout={{
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  font: { color: '#a1a1aa', size: 12 },
                  margin: { l: 20, r: 20, t: 20, b: 20 },
                  showlegend: true,
                  legend: {
                    orientation: 'h',
                    y: -0.1,
                    x: 0.5,
                    xanchor: 'center',
                  },
                  annotations: [
                    {
                      text: formatTokens(
                        modelMetricsList.reduce(
                          (sum, m) => sum + m.total_input_tokens + m.total_output_tokens,
                          0
                        )
                      ),
                      showarrow: false,
                      font: { size: 20, color: '#fafafa' },
                    },
                  ],
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: 250 }}
                useResizeHandler={true}
              />
            </div>

            {/* Radar/Spider Chart - Model Comparison */}
            <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5">
              <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] mb-3 sm:mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
                <span className="truncate">Model Comparison Radar</span>
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button className="ml-1">
                      <HelpCircle className="w-4 h-4 text-[#52525b] hover:text-[#71717a] transition-colors" />
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#fafafa]" side="right">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Radar Chart</h4>
                      <p className="text-xs text-[#a1a1aa]">
                        Compare multiple metrics across all models at a glance. Each axis represents a different metric, scaled 0-100%.
                      </p>
                      <ul className="text-xs text-[#71717a] space-y-1 list-disc list-inside">
                        <li>Larger area = better overall performance</li>
                        <li>Balanced shapes = consistent across metrics</li>
                        <li>Spikes = strength in specific metrics</li>
                      </ul>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </h3>
              <Plot
                data={modelMetricsList.map((model, index) => ({
                  type: 'scatterpolar',
                  r: [
                    model.avg_precision * 100,
                    model.avg_recall * 100,
                    model.avg_f1 * 100,
                    model.exact_match_rate * 100,
                    model.avg_precision * 100, // Close the polygon
                  ],
                  theta: ['Precision', 'Recall', 'F1 Score', 'Exact Match', 'Precision'],
                  fill: 'toself',
                  fillcolor: `${getModelColor(model.model_name, index)}20`,
                  line: { color: getModelColor(model.model_name, index), width: 2 },
                  name: model.model_name,
                  hovertemplate: '%{theta}: %{r:.1f}%<extra>' + model.model_name + '</extra>',
                }))}
                layout={{
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  font: { color: '#a1a1aa', size: 11 },
                  margin: { l: 60, r: 60, t: 30, b: 30 },
                  polar: {
                    bgcolor: 'transparent',
                    radialaxis: {
                      visible: true,
                      range: [0, 100],
                      gridcolor: '#2a2a2e',
                      linecolor: '#2a2a2e',
                      tickfont: { size: 10, color: '#71717a' },
                      ticksuffix: '%',
                    },
                    angularaxis: {
                      gridcolor: '#2a2a2e',
                      linecolor: '#2a2a2e',
                      tickfont: { size: 11, color: '#a1a1aa' },
                    },
                  },
                  legend: {
                    orientation: 'h',
                    y: -0.15,
                    x: 0.5,
                    xanchor: 'center',
                    font: { size: 11 },
                  },
                  showlegend: true,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: 280 }}
                useResizeHandler={true}
              />
            </div>

            {/* Input vs Output Tokens Breakdown */}
            <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl p-3 sm:p-5">
              <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa] mb-3 sm:mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-pink-400" />
                <span className="truncate">Token Usage Breakdown</span>
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button className="ml-1">
                      <HelpCircle className="w-4 h-4 text-[#52525b] hover:text-[#71717a] transition-colors" />
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#fafafa]" side="left">
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Token Breakdown</h4>
                      <p className="text-xs text-[#a1a1aa]">
                        Shows input vs output tokens per model to understand cost drivers.
                      </p>
                      <ul className="text-xs text-[#71717a] space-y-1 list-disc list-inside">
                        <li><span className="text-cyan-400">Input tokens</span>: Prompts + context sent to model</li>
                        <li><span className="text-orange-400">Output tokens</span>: Model responses (usually more expensive)</li>
                      </ul>
                      <p className="text-xs text-[#52525b] mt-2">
                        Output tokens typically cost 4-8x more than input tokens.
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </h3>
              <Plot
                data={[
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.total_input_tokens),
                    name: 'Input Tokens',
                    type: 'bar',
                    marker: { color: '#22d3ee' },
                    hovertemplate: '%{x}<br>Input: %{y:,.0f} tokens<extra></extra>',
                  },
                  {
                    x: modelNames,
                    y: modelMetricsList.map((m) => m.total_output_tokens),
                    name: 'Output Tokens',
                    type: 'bar',
                    marker: { color: '#fb923c' },
                    hovertemplate: '%{x}<br>Output: %{y:,.0f} tokens<extra></extra>',
                  },
                ]}
                layout={{
                  barmode: 'group',
                  paper_bgcolor: 'transparent',
                  plot_bgcolor: 'transparent',
                  font: { color: '#a1a1aa', size: 12 },
                  margin: { l: 60, r: 20, t: 20, b: 60 },
                  xaxis: {
                    gridcolor: '#2a2a2e',
                    tickangle: -15,
                  },
                  yaxis: {
                    gridcolor: '#2a2a2e',
                    title: 'Tokens',
                    tickformat: ',.0f',
                  },
                  legend: {
                    orientation: 'h',
                    y: -0.2,
                    x: 0.5,
                    xanchor: 'center',
                  },
                  showlegend: true,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: 250 }}
                useResizeHandler={true}
              />
              {/* Token Summary */}
              <div className="mt-3 pt-3 border-t border-[#2a2a2e] grid grid-cols-2 gap-4">
                {modelMetricsList.map((model, index) => {
                  const inputPct = (model.total_input_tokens / (model.total_input_tokens + model.total_output_tokens)) * 100;
                  const outputPct = 100 - inputPct;
                  return (
                    <div key={model.model_name} className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getModelColor(model.model_name, index) }}
                        />
                        <span className="text-[#a1a1aa] truncate">{model.model_name}</span>
                      </div>
                      <div className="flex gap-3 text-[#71717a]">
                        <span><span className="text-cyan-400">{inputPct.toFixed(0)}%</span> in</span>
                        <span><span className="text-orange-400">{outputPct.toFixed(0)}%</span> out</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Stats Table */}
        <div className="bg-[#121214] border border-[#2a2a2e] rounded-xl sm:rounded-2xl overflow-hidden">
          <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-[#2a2a2e] flex items-center gap-2">
            <h3 className="text-sm sm:text-lg font-semibold text-[#fafafa]">Detailed Model Statistics</h3>
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <button>
                  <HelpCircle className="w-4 h-4 text-[#52525b] hover:text-[#71717a] transition-colors" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80 bg-[#1a1a1d] border-[#2a2a2e] text-[#fafafa]" side="right">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Table Columns Explained</h4>
                  <ul className="text-xs text-[#71717a] space-y-1">
                    <li><span className="text-[#fafafa]">Precision</span>: Correctness of predicted items</li>
                    <li><span className="text-[#fafafa]">Recall</span>: Completeness of predicted items</li>
                    <li><span className="text-emerald-400">F1 Score</span>: Harmonic mean of precision & recall</li>
                    <li><span className="text-blue-400">Exact Match</span>: Perfect cart predictions rate</li>
                    <li><span className="text-amber-400">Avg Latency</span>: Response time per step</li>
                    <li><span className="text-purple-400">Total Cost</span>: API costs based on token usage</li>
                  </ul>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-[#0a0a0b]">
                  <th className="text-left px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Model</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Scenarios</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Steps</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">
                    <MetricHoverCard metric="precision">
                      <span>Precision</span>
                    </MetricHoverCard>
                  </th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">
                    <MetricHoverCard metric="recall">
                      <span>Recall</span>
                    </MetricHoverCard>
                  </th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">
                    <MetricHoverCard metric="f1">
                      <span>F1</span>
                    </MetricHoverCard>
                  </th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">
                    <MetricHoverCard metric="exactMatch">
                      <span>Match</span>
                    </MetricHoverCard>
                  </th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Latency</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Tokens</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">Cost</th>
                  <th className="text-right px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-sm font-medium text-[#71717a] whitespace-nowrap">$/Step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2e]">
                {modelMetricsList.map((model, index) => (
                  <tr key={model.model_name} className="hover:bg-[#1a1a1d] transition-colors">
                    <td className="px-3 sm:px-5 py-3 sm:py-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getModelColor(model.model_name, index) }}
                        />
                        <span className="text-[#fafafa] font-medium text-xs sm:text-sm whitespace-nowrap">{model.model_name}</span>
                      </div>
                    </td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-[#a1a1aa] text-xs sm:text-sm">{model.total_scenarios}</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-[#a1a1aa] text-xs sm:text-sm">{model.total_steps}</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-[#a1a1aa] text-xs sm:text-sm">{formatNumber(model.avg_precision * 100)}%</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-[#a1a1aa] text-xs sm:text-sm">{formatNumber(model.avg_recall * 100)}%</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-emerald-400 font-medium text-xs sm:text-sm">{formatNumber(model.avg_f1 * 100)}%</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-blue-400 font-medium text-xs sm:text-sm">{formatNumber(model.exact_match_rate * 100)}%</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-amber-400 text-xs sm:text-sm">{formatLatency(model.avg_latency_ms)}</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-[#a1a1aa] text-xs sm:text-sm">{formatTokens(model.total_input_tokens + model.total_output_tokens)}</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-purple-400 font-medium text-xs sm:text-sm">{formatCost(model.total_cost)}</td>
                    <td className="text-right px-3 sm:px-5 py-3 sm:py-4 text-pink-400 font-medium text-xs sm:text-sm">{formatCost(model.avg_cost_per_step)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
