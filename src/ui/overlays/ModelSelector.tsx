import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ModelSelectorProps {
  onSubmit: (model: string) => void;
  onCancel: () => void;
  currentModel?: string;
}

const AVAILABLE_MODELS = [
  { id: 'gpt-5-chat', name: 'GPT-5 Chat', description: 'Latest high-intelligence model' },
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Advanced model for complex, multi-step tasks' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: 'Affordable small model for fast, lightweight tasks' },
];

export default function ModelSelector({ onSubmit, onCancel, currentModel }: ModelSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const currentIndex = AVAILABLE_MODELS.findIndex((model) => model.id === currentModel);
    return currentIndex >= 0 ? currentIndex : 0;
  });

  useInput((input, key) => {
    if (key.return) {
      onSubmit(AVAILABLE_MODELS[selectedIndex].id);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(AVAILABLE_MODELS.length - 1, prev + 1));
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan" bold>Select Model</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Choose a model for your conversation. The chat will be cleared when you switch models.
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Visit <Text underline>https://platform.openai.com/docs/models</Text> for more information.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {AVAILABLE_MODELS.map((model, index) => (
          <Box key={model.id} marginBottom={index === AVAILABLE_MODELS.length - 1 ? 0 : 1}>
            <Text
              color={index === selectedIndex ? 'black' : 'white'}
              backgroundColor={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? <Text bold>{'>'}</Text> : '  '} {''}
              {model.name}
              {model.id === currentModel ? ' (current)' : ''}
            </Text>
            {index === selectedIndex && (
              <Box marginLeft={4} marginTop={0}>
                <Text color="gray" dimColor>
                  {model.description}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
