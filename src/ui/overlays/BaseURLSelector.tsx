import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface BaseURLSelectorProps {
  onSubmit: (baseURL: string) => void;
  onCancel: () => void;
  currentBaseURL?: string;
}

const PRESET_BASE_URLS = [
  { 
    id: 'https://api.openai.com/v1', 
    name: 'Official OpenAI API', 
    description: 'Default OpenAI API endpoint' 
  },
  { 
    id: 'custom', 
    name: 'Custom URL', 
    description: 'Enter a custom base URL' 
  },
];

export default function BaseURLSelector({ onSubmit, onCancel, currentBaseURL }: BaseURLSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const currentIndex = PRESET_BASE_URLS.findIndex((url) => url.id === currentBaseURL);
    return currentIndex >= 0 ? currentIndex : 0;
  });
  const [customURL, setCustomURL] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showCurrentURL, setShowCurrentURL] = useState(true);

  useInput((input, key) => {
    if (showCustomInput) {
      if (key.return) {
        if (customURL.trim()) {
          onSubmit(customURL.trim());
        } else if (currentBaseURL && showCurrentURL) {
          // User pressed Enter without typing, keep current URL
          onSubmit(currentBaseURL);
        }
        return;
      }

      if (key.escape) {
        setShowCustomInput(false);
        setCustomURL('');
        return;
      }

      if (key.backspace || key.delete) {
        setCustomURL(prev => prev.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setCustomURL(prev => prev + input);
        setShowCurrentURL(false); // Hide current URL when user starts typing
        return;
      }

      if (key.ctrl && input === 'c') {
        onCancel();
      }
      return;
    }

    if (key.return) {
      const selected = PRESET_BASE_URLS[selectedIndex];
      if (selected.id === 'custom') {
        setShowCustomInput(true);
        setCustomURL(currentBaseURL || '');
        setShowCurrentURL(false); // Hide current URL when entering custom
      } else {
        onSubmit(selected.id);
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(PRESET_BASE_URLS.length - 1, prev + 1));
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
    }
  });

  if (showCustomInput) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="cyan" bold>Enter Custom Base URL</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Enter the base URL for your OpenAI-compatible API endpoint
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Example: https://api.example.com/v1
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="white">
            URL: <Text color="yellow">{customURL}</Text>
            <Text color="white" inverse>_</Text>
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Press Enter to {customURL.trim() ? 'save' : currentBaseURL ? 'keep current' : 'save'}, Escape to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>Set Base URL</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Choose a base URL for the OpenAI API. This allows you to use custom endpoints.
        </Text>
      </Box>

      {currentBaseURL && showCurrentURL && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color="gray" dimColor>
              Current Base URL:{' '}
              <Text color="yellow">{currentBaseURL}</Text>{' '}
              <Text color="green">(current)</Text>
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              Start typing to enter a new URL, or press Enter to keep current
            </Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        {PRESET_BASE_URLS.map((url, index) => (
          <Box key={url.id} marginBottom={index === PRESET_BASE_URLS.length - 1 ? 0 : 1}>
            <Text
              color={index === selectedIndex ? 'black' : 'white'}
              backgroundColor={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? <Text bold>{'>'}</Text> : '  '} {''}
              {url.name}
              {url.id === currentBaseURL ? ' (current)' : ''}
            </Text>
            {index === selectedIndex && (
              <Box marginLeft={4} marginTop={0}>
                <Text color="gray" dimColor>
                  {url.description}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Press Enter to {showCustomInput ? 'save' : currentBaseURL && showCurrentURL ? 'keep current' : 'select'}, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
}