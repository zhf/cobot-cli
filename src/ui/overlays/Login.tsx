import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../hooks/useTheme.js';

interface LoginProps {
  onSubmit: (apiKey: string) => void;
  onCancel: () => void;
  currentApiKey?: string;
}

export default function Login({ onSubmit, onCancel, currentApiKey }: LoginProps) {
  const { colors } = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [showCurrentKey, setShowCurrentKey] = useState(true);

  useInput((input, key) => {
    if (key.return) {
      if (apiKey.trim()) {
        onSubmit(apiKey.trim());
      } else if (currentApiKey && showCurrentKey) {
        // User pressed Enter without typing, keep current key
        onSubmit(currentApiKey);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.backspace || key.delete) {
      setApiKey((prev) => prev.slice(0, -1));
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    // Regular character input
    if (input && !key.meta && !key.ctrl) {
      setApiKey((prev) => prev + input);
      setShowCurrentKey(false); // Hide current key when user starts typing
    }
  });

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text color={colors.primary} bold>Set API Key</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={colors.muted}>
          Enter your OpenAI API key to continue. You can get one from <Text underline>https://platform.openai.com/api-keys</Text>
        </Text>
      </Box>

      {currentApiKey && showCurrentKey && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color={colors.muted} dimColor>
              Current API Key:{' '}
              <Text color={colors.warning}>
          {currentApiKey.length > 4 ? '*'.repeat(currentApiKey.length - 4) + currentApiKey.slice(-4) : currentApiKey}
              </Text>{' '}
              <Text color={colors.success}>(current)</Text>
            </Text>
          </Box>
          <Box>
            <Text color={colors.muted} dimColor>
              Start typing to enter a new key, or press Enter to keep current
            </Text>
          </Box>
        </Box>
      )}

      <Box>
        <Text color={colors.primary}>API Key: </Text>
        <Text>
          {'*'.repeat(Math.min(apiKey.length, 20))}
          {apiKey.length > 20 && '...'}
        </Text>
        <Text backgroundColor={colors.inputCursor} color={colors.inverse}>▌</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={colors.muted} dimColor>
          Press Enter to {apiKey.trim() ? 'save' : 'keep current'}, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
}
