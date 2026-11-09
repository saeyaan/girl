/**
 * Long-Term and Episodic Memory Matcher & Extractor
 * Pure logic for semantic scoring, category filtering, and memory relevance ranking.
 */

export interface MemoryItem {
  id: string;
  category: 'profile' | 'preference' | 'fact' | 'task' | 'episodic';
  key: string;
  value: string;
  confidence: number;
  timestamp: number;
  tags: string[];
}

/**
 * Common stopwords to exclude from basic token intersection
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'about', 'by', 'and', 'or', 'so', 'it', 'my', 'your', 'i', 'you',
  'me', 'we', 'they', 'this', 'that', 'please', 'can', 'what', 'how', 'when', 'who'
]);

/**
 * Tokenizes text into lowercase keywords
 */
export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOPWORDS.has(token));
}

/**
 * Calculates a match score between a user query and a memory item.
 * Higher score indicates stronger semantic relevance.
 */
export function scoreMemoryRelevance(query: string, memory: MemoryItem): number {
  const queryTokens = extractKeywords(query);
  if (queryTokens.length === 0) return 0;

  const memoryText = `${memory.key} ${memory.value} ${memory.tags.join(' ')}`;
  const memoryTokens = new Set(extractKeywords(memoryText));

  let matchedCount = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) {
      matchedCount += 1;
    } else {
      // Partial prefix match (e.g. "python" matching "pythonic")
      for (const mToken of memoryTokens) {
        if (mToken.includes(token) || token.includes(mToken)) {
          matchedCount += 0.5;
          break;
        }
      }
    }
  }

  // Bonus for profile category when user asks personal questions
  let categoryBonus = 0;
  if (/who am i|my name|my favorite|what do i like|remember/i.test(query)) {
    if (memory.category === 'profile' || memory.category === 'preference') {
      categoryBonus = 0.5;
    }
  }

  // Recency weight: slightly favor newer memories
  const daysOld = (Date.now() - memory.timestamp) / (1000 * 60 * 60 * 24);
  const recencyMultiplier = Math.max(0.7, 1 - daysOld * 0.01);

  const baseScore = (matchedCount / queryTokens.length) * (memory.confidence || 1);
  return (baseScore + categoryBonus) * recencyMultiplier;
}

/**
 * Ranks and retrieves the top-K relevant memories for a user prompt
 */
export function findRelevantMemories(
  query: string,
  memories: MemoryItem[],
  threshold = 0.2,
  limit = 5
): MemoryItem[] {
  const scored = memories.map(mem => ({
    mem,
    score: scoreMemoryRelevance(query, mem),
  }));

  return scored
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.mem);
}

/**
 * Detects if a user input has explicit or implicit memory triggers
 * (e.g. "My name is John", "I love sci-fi novels", "Remember that...")
 */
export function detectMemoryIntent(input: string): {
  shouldRemember: boolean;
  category?: MemoryItem['category'];
  suggestedKey?: string;
  extractedValue?: string;
} {
  const trimmed = input.trim();

  // "Remember that X" or "Please remember X"
  const rememberMatch = trimmed.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i);
  if (rememberMatch) {
    return {
      shouldRemember: true,
      category: 'fact',
      suggestedKey: 'Important Note',
      extractedValue: rememberMatch[1].trim(),
    };
  }

  // "My name is [Name]" or "Call me [Name]"
  const nameMatch = trimmed.match(/(?:my name is|call me|i am called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (nameMatch) {
    return {
      shouldRemember: true,
      category: 'profile',
      suggestedKey: 'User Name',
      extractedValue: nameMatch[1].trim(),
    };
  }

  // "I love/like/prefer [X]"
  const preferenceMatch = trimmed.match(/(?:i love|i really like|i prefer|my favorite\s+(?:\w+\s+)?is)\s+([^.!?]+)/i);
  if (preferenceMatch) {
    return {
      shouldRemember: true,
      category: 'preference',
      suggestedKey: 'User Preference',
      extractedValue: preferenceMatch[0].trim(),
    };
  }

  return { shouldRemember: false };
}
