import { useState, useCallback } from 'react';
import { createEmptySessionStats, SessionStatsSnapshot } from '../../core/session-store.js';

interface ApiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_time?: number;
}

function useSessionStats(initialStats: SessionStatsSnapshot = createEmptySessionStats()) {
  const [sessionStats, setSessionStats] = useState<SessionStatsSnapshot>(initialStats);

  // Add tokens from an API response to the cumulative session totals
  const addSessionTokens = useCallback((usage: ApiUsage) => {
    setSessionStats((prev) => ({
      promptTokens: prev.promptTokens + usage.prompt_tokens,
      completionTokens: prev.completionTokens + usage.completion_tokens,
      totalTokens: prev.totalTokens + usage.total_tokens,
      totalRequests: prev.totalRequests + 1, // Increment request count
      totalTime: prev.totalTime + (usage.total_time || 0), // Accumulate processing time
    }));
  }, []);

  // Clear session stats (called when chat history is cleared)
  const clearSessionStats = useCallback(() => {
    setSessionStats(createEmptySessionStats());
  }, []);

  const setSessionStatsSnapshot = useCallback((nextStats: SessionStatsSnapshot) => {
    setSessionStats(nextStats);
  }, []);

  return {
    sessionStats,
    addSessionTokens,
    clearSessionStats,
    setSessionStatsSnapshot,
  };
}

export default useSessionStats;
