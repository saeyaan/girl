import React, { useState } from 'react';
import { MemoryItem } from '../utils/memoryMatcher.ts';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Edit2,
  Tag,
  Clock,
  Sparkles,
  BookOpen,
  User,
  CheckCircle,
  X,
} from 'lucide-react';

interface MemoryVaultProps {
  memories: MemoryItem[];
  onAddMemory: (item: Omit<MemoryItem, 'id' | 'timestamp'>) => void;
  onUpdateMemory: (id: string, updates: Partial<MemoryItem>) => void;
  onDeleteMemory: (id: string) => void;
  onClearAll: () => void;
}

export const MemoryVault: React.FC<MemoryVaultProps> = ({
  memories,
  onAddMemory,
  onUpdateMemory,
  onDeleteMemory,
  onClearAll,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    category: 'preference' as MemoryItem['category'],
    key: '',
    value: '',
    tags: '',
  });

  const categories = [
    { id: 'all', label: 'All Memories', icon: Brain },
    { id: 'profile', label: 'Profile & Identity', icon: User },
    { id: 'preference', label: 'Preferences', icon: Sparkles },
    { id: 'fact', label: 'Learned Facts', icon: BookOpen },
    { id: 'task', label: 'Active Tasks', icon: CheckCircle },
    { id: 'episodic', label: 'Episodic Summaries', icon: Clock },
  ];

  const filteredMemories = memories.filter((m) => {
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    const query = searchQuery.toLowerCase();
    const matchesQuery =
      !query ||
      m.key.toLowerCase().includes(query) ||
      m.value.toLowerCase().includes(query) ||
      m.tags.some((t) => t.toLowerCase().includes(query));
    return matchesCategory && matchesQuery;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.key.trim() || !formData.value.trim()) return;

    const tagsArray = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingId) {
      onUpdateMemory(editingId, {
        category: formData.category,
        key: formData.key.trim(),
        value: formData.value.trim(),
        tags: tagsArray,
      });
      setEditingId(null);
    } else {
      onAddMemory({
        category: formData.category,
        key: formData.key.trim(),
        value: formData.value.trim(),
        tags: tagsArray,
        confidence: 1.0,
      });
    }

    setFormData({ category: 'preference', key: '', value: '', tags: '' });
    setShowAddModal(false);
  };

  const startEdit = (item: MemoryItem) => {
    setEditingId(item.id);
    setFormData({
      category: item.category,
      key: item.key,
      value: item.value,
      tags: item.tags.join(', '),
    });
    setShowAddModal(true);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-purple-950/70 border border-purple-800/60 text-purple-400">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>Memory Vault</span>
              <span className="text-[10px] font-mono bg-purple-900/40 text-purple-300 border border-purple-800/50 px-2 py-0.5 rounded-full">
                {memories.length} stored
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Persistent short-term, long-term &amp; episodic memory retained across sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setFormData({ category: 'preference', key: '', value: '', tags: '' });
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Memory</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/60 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories, topics, preferences, or episodic tags..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memory Cards Grid */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredMemories.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500 space-y-2">
            <Brain className="w-8 h-8 mx-auto text-slate-600 opacity-60" />
            <p>No memories found matching your search or filter.</p>
          </div>
        ) : (
          filteredMemories.map((mem) => {
            const categoryBadgeColor: Record<string, string> = {
              profile: 'bg-blue-950/60 text-blue-300 border-blue-800/60',
              preference: 'bg-pink-950/60 text-pink-300 border-pink-800/60',
              fact: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
              task: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
              episodic: 'bg-purple-950/60 text-purple-300 border-purple-800/60',
            };

            return (
              <div
                key={mem.id}
                className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-all space-y-2 group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md border ${
                        categoryBadgeColor[mem.category] || 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {mem.category}
                    </span>
                    <h3 className="text-xs font-semibold text-slate-200">{mem.key}</h3>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(mem)}
                      aria-label={`Edit memory ${mem.key}`}
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                      title="Edit memory"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteMemory(mem.id)}
                      aria-label={`Delete memory ${mem.key}`}
                      className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                      title="Delete memory"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">{mem.value}</p>

                <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {mem.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>

                  <span className="text-[10px]">
                    {new Date(mem.timestamp).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Clear All Footer */}
      {memories.length > 0 && (
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Memories are stored in backend persistent JSON storage.</span>
          <button
            type="button"
            onClick={() => {
              if (confirm('Are you sure you want to clear all stored memories?')) {
                onClearAll();
              }
            }}
            className="text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
          >
            Clear All Memories
          </button>
        </div>
      )}

      {/* Add / Edit Memory Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-400" />
                <span>{editingId ? 'Edit Memory' : 'Store New Memory'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value as MemoryItem['category'] })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="profile">Profile &amp; Identity</option>
                  <option value="preference">User Preference</option>
                  <option value="fact">Fact / Knowledge</option>
                  <option value="task">Active Task</option>
                  <option value="episodic">Episodic Summary</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Key / Title</label>
                <input
                  type="text"
                  required
                  value={formData.key}
                  onChange={(e) => setFormData({ ...formData, key: e.target.value })}
                  placeholder="e.g. Favorite Drink, Sibling Name, Python Goal"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Value / Fact Content</label>
                <textarea
                  required
                  rows={3}
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder="Detailed information that Maya should remember during conversations..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="e.g. coffee, breakfast, personal"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-medium transition-colors"
                >
                  {editingId ? 'Save Changes' : 'Save Memory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
