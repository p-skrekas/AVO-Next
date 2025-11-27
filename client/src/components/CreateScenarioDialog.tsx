import { useState } from 'react';
import { X } from 'lucide-react';

interface CreateScenarioDialogProps {
  onClose: () => void;
  onCreate: (name: string, description: string, numSteps: number) => void;
}

export default function CreateScenarioDialog({ onClose, onCreate }: CreateScenarioDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [numSteps, setNumSteps] = useState(3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name, description, numSteps);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="group relative bg-[#121214] border border-[#2a2a2e] rounded-xl shadow-2xl shadow-black/50 w-full max-w-md p-6 overflow-hidden">
        {/* Shine effect overlay */}
        <div className="absolute top-0 -left-full w-full h-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-all duration-700 ease-out group-hover:left-full pointer-events-none" />

        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-[#fafafa]">Create New Scenario</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[#71717a] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#a1a1aa] mb-1">
                Scenario Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="e.g., Coffee Shop Order"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#a1a1aa] mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                placeholder="Describe this scenario..."
                rows={3}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#a1a1aa] mb-1">
                Number of Steps
              </label>
              <input
                type="number"
                value={numSteps}
                onChange={(e) => setNumSteps(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 bg-[#0a0a0b] border border-[#2a2a2e] rounded-lg text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                min="1"
                max="50"
                required
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-[#fafafa] font-medium rounded-lg border border-[#3f3f46] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-400 hover:via-purple-400 hover:to-pink-400 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all duration-200"
            >
              Create Scenario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
