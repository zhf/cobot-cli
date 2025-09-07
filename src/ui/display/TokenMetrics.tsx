import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../hooks/useTheme.js';

interface TokenMetricsProps {
  isActive: boolean;
  isPaused: boolean;
  startTime: Date | null;
  endTime: Date | null;
  pausedTime: number;
  completionTokens: number;
}

export default function TokenMetrics({
  isActive,
  isPaused,
  startTime,
  endTime,
  pausedTime,
  completionTokens,
}: TokenMetricsProps) {
  const { colors } = useTheme();
  const [displayTime, setDisplayTime] = useState('0.0s');
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const loadingMessages = ['Thinking', 'Processing', 'Coding'];

  // Update the display time every 100ms when active and not paused
  useEffect(() => {
    if (!isActive || isPaused) {
      return;
    }

    const updateDisplay = () => {
      if (!startTime) {
        setDisplayTime('0.0s');
        return;
      }

      // Calculate elapsed time minus paused time
      const currentElapsed = Date.now() - startTime.getTime() - pausedTime;
      setDisplayTime(`${(currentElapsed / 1000).toFixed(1)}s`);
    };

    // Update immediately, then set interval
    updateDisplay();

    const interval = setInterval(updateDisplay, 100);
    return () => clearInterval(interval);
  }, [isActive, isPaused, startTime, pausedTime]);

  // Reset loading message index when becoming active and not paused
  useEffect(() => {
    if (isActive && !isPaused) {
      setLoadingMessageIndex(0);
    }
  }, [isActive, isPaused]);

  // Cycle through loading messages every 2 seconds when active and not paused
  useEffect(() => {
    if (!isActive || isPaused) {
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prevIndex) => (prevIndex + 1) % loadingMessages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [isActive, isPaused, loadingMessages.length]);

  // Update display when request completes
  useEffect(() => {
    if (!isActive && endTime && startTime) {
      const finalElapsed = endTime.getTime() - startTime.getTime() - pausedTime;
      setDisplayTime(`${(finalElapsed / 1000).toFixed(1)}s`);
    }
  }, [isActive, endTime, startTime, pausedTime]);

  const getElapsedTime = (): string => displayTime;

  const getStatusText = (): string => {
    if (isPaused) return '⏸ Waiting for approval...';
    if (isActive) return `⚡ ${loadingMessages[loadingMessageIndex]}...`;
    return '';
  };

  // Don't show component if inactive and no tokens counted
  if (!isActive && completionTokens === 0) {
    return null;
  }

  return (
    <Box paddingX={1}>
      <Box gap={2}>
        <Text color={colors.primary}>{getElapsedTime()}</Text>
        <Text color={colors.success}>{completionTokens} tokens</Text>
        {(isActive || isPaused) && (
            <Text color={isPaused ? colors.warning : colors.secondary}>
              {getStatusText()}
            </Text>
        )}
      </Box>
    </Box>
  );
}
