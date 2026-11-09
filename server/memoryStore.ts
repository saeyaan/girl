import fs from 'fs';
import path from 'path';

export interface MemoryItem {
  id: string;
  category: 'profile' | 'preference' | 'fact' | 'task' | 'episodic';
  key: string;
  value: string;
  confidence: number;
  timestamp: number;
  tags: string[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memories.json');

// Initial seed memories to make Maya feel warm, knowledgeable, and immediately personalized
const SEED_MEMORIES: MemoryItem[] = [
  {
    id: 'seed-profile-1',
    category: 'profile',
    key: 'Assistant Persona',
    value: 'Maya is a warm, empathetic, and witty female AI companion and browser navigator.',
    confidence: 1.0,
    timestamp: Date.now() - 86400000 * 3,
    tags: ['persona', 'identity', 'maya']
  },
  {
    id: 'seed-profile-2',
    category: 'profile',
    key: 'User Interests',
    value: 'Enjoys software engineering, modern web applications, AI research, and space exploration.',
    confidence: 0.95,
    timestamp: Date.now() - 86400000 * 2,
    tags: ['interests', 'tech', 'ai', 'space']
  },
  {
    id: 'seed-pref-1',
    category: 'preference',
    key: 'Voice & Interaction Style',
    value: 'Prefers natural conversational pacing with thoughtful explanations and clear answers.',
    confidence: 0.9,
    timestamp: Date.now() - 86400000 * 2,
    tags: ['voice', 'preference', 'pace']
  },
  {
    id: 'seed-pref-2',
    category: 'preference',
    key: 'Browser Habits',
    value: 'Frequently navigates to YouTube, GitHub, Google, and tech documentation.',
    confidence: 0.85,
    timestamp: Date.now() - 86400000 * 1,
    tags: ['browser', 'navigation', 'github', 'youtube']
  },
  {
    id: 'seed-task-1',
    category: 'task',
    key: 'Current Project',
    value: 'Exploring human-like voice interfaces and browser automation tools.',
    confidence: 0.9,
    timestamp: Date.now() - 3600000 * 5,
    tags: ['project', 'voice-assistant', 'automation']
  },
  {
    id: 'seed-episodic-1',
    category: 'episodic',
    key: 'Previous Session Summary',
    value: 'User discussed setting up multi-language voice support for English, Hindi, and Bengali.',
    confidence: 0.95,
    timestamp: Date.now() - 3600000 * 2,
    tags: ['summary', 'session', 'multilingual']
  }
];

class MemoryStore {
  private memories: MemoryItem[] = [];

  constructor() {
    this.ensureDataDir();
    this.load();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('Failed to create data directory:', err);
      }
    }
  }

  private load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
        this.memories = JSON.parse(raw);
      } else {
        this.memories = [...SEED_MEMORIES];
        this.save();
      }
    } catch (err) {
      console.warn('Could not read memory file, initializing default seed memories:', err);
      this.memories = [...SEED_MEMORIES];
    }
  }

  private save() {
    try {
      this.ensureDataDir();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memories, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save memories to disk:', err);
    }
  }

  public getAll(): MemoryItem[] {
    return [...this.memories].sort((a, b) => b.timestamp - a.timestamp);
  }

  public getById(id: string): MemoryItem | undefined {
    return this.memories.find(m => m.id === id);
  }

  public add(item: Omit<MemoryItem, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): MemoryItem {
    const memory: MemoryItem = {
      id: item.id || `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      category: item.category,
      key: item.key,
      value: item.value,
      confidence: item.confidence ?? 0.9,
      timestamp: item.timestamp ?? Date.now(),
      tags: item.tags || []
    };

    // Check if an item with the same key and category already exists; if so, update it
    const existingIndex = this.memories.findIndex(
      m => m.category === memory.category && m.key.toLowerCase() === memory.key.toLowerCase()
    );

    if (existingIndex >= 0) {
      this.memories[existingIndex] = {
        ...this.memories[existingIndex],
        value: memory.value,
        timestamp: Date.now(),
        tags: Array.from(new Set([...this.memories[existingIndex].tags, ...memory.tags]))
      };
      this.save();
      return this.memories[existingIndex];
    }

    this.memories.unshift(memory);
    this.save();
    return memory;
  }

  public update(id: string, updates: Partial<Omit<MemoryItem, 'id'>>): MemoryItem | null {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) return null;

    this.memories[index] = {
      ...this.memories[index],
      ...updates,
      timestamp: Date.now(),
    };
    this.save();
    return this.memories[index];
  }

  public delete(id: string): boolean {
    const initialLen = this.memories.length;
    this.memories = this.memories.filter(m => m.id !== id);
    if (this.memories.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public clearAll(): void {
    this.memories = [];
    this.save();
  }
}

export const memoryStore = new MemoryStore();
