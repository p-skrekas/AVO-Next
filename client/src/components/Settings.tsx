import { useState, useEffect } from 'react';
import { settingsAPI } from '@/lib/settings-api';
import { Save, RefreshCw, RotateCcw, MessageSquare, Info } from 'lucide-react';
import { toast } from 'sonner';

// Default system prompt (synced with server/app/settings_service.py)
const DEFAULT_SYSTEM_PROMPT = `<SYSTEM_INSTRUCTIONS>
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

</SYSTEM_INSTRUCTIONS>`;

export default function Settings() {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSystemPrompt();
  }, []);

  const loadSystemPrompt = async () => {
    setLoading(true);
    try {
      const prompt = await settingsAPI.getSystemPrompt();
      setSystemPrompt(prompt);
      setOriginalPrompt(prompt);
    } catch (err: any) {
      console.error('Error loading system prompt:', err);
      toast.error(err.response?.data?.detail || 'Failed to load system prompt');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsAPI.updateSystemPrompt(systemPrompt);
      setOriginalPrompt(systemPrompt);
      toast.success('System prompt saved successfully!');
    } catch (err: any) {
      console.error('Error saving system prompt:', err);
      toast.error(err.response?.data?.detail || 'Failed to save system prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = () => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    toast.info('Reset to default prompt. Click Save to apply.');
  };

  const hasChanges = systemPrompt !== originalPrompt;
  const isDefault = systemPrompt.trim() === DEFAULT_SYSTEM_PROMPT.trim();

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-[#2a2a2e] px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#fafafa]">Settings</h1>
            <p className="text-sm text-[#71717a]">Configure global application settings</p>
          </div>
          <button
            onClick={loadSystemPrompt}
            disabled={loading}
            className="px-4 py-2 bg-[#1a1a1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] font-medium rounded-lg border border-[#2a2a2e] transition-all duration-200 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Info Banner */}
          <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
                <Info className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-[#fafafa] mb-1">About the System Prompt</h3>
                <p className="text-sm text-[#a1a1aa] leading-relaxed">
                  The system prompt defines how the AI assistant behaves during voice ordering tests.
                  It uses placeholders that are automatically replaced:
                </p>
                <div className="flex flex-wrap gap-3 mt-3">
                  <code className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">{"{{catalog}}"}</code>
                  <span className="text-xs text-[#71717a]">→ Product catalog CSV</span>
                  <code className="text-xs text-purple-400 bg-purple-500/10 px-2 py-1 rounded">{"{{current_cart_json}}"}</code>
                  <span className="text-xs text-[#71717a]">→ Current cart state</span>
                </div>
              </div>
            </div>
          </div>

          {/* System Prompt Card */}
          <div className="bg-[#121214] border border-[#2a2a2e] rounded-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-[#fafafa]">Default System Prompt</h2>
                    <p className="text-sm text-[#71717a]">
                      {isDefault ? 'Using default prompt' : 'Custom prompt'}
                    </p>
                  </div>
                </div>
                {!isDefault && (
                  <button
                    onClick={handleResetToDefault}
                    className="px-3 py-1.5 text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset to Default
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <RefreshCw className="w-6 h-6 text-[#71717a] animate-spin" />
                </div>
              ) : (
                <>
                  <textarea
                    className="w-full px-4 py-3 bg-[#0a0a0b] border border-[#2a2a2e] rounded-xl text-[#a1a1aa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm transition-all resize-none"
                    rows={24}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Enter system prompt..."
                  />

                  <div className="flex justify-between items-center mt-4 pt-4 border-t border-[#2a2a2e]">
                    <div className="flex items-center gap-3">
                      {hasChanges && (
                        <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          Unsaved changes
                        </span>
                      )}
                      <span className="text-xs text-[#52525b]">
                        {systemPrompt.length.toLocaleString()} characters
                      </span>
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={saving || !hasChanges}
                      className={`px-4 py-2 font-medium rounded-lg shadow-lg transition-all duration-200 flex items-center gap-2 ${
                        hasChanges
                          ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40'
                          : 'bg-[#27272a] text-[#52525b] cursor-not-allowed'
                      }`}
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
