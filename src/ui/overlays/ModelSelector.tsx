import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Agent } from '../../core/agent.js';

interface ModelSelectorProps {
  onSubmit: (model: string) => void;
  onCancel: () => void;
  currentModel?: string;
  agent: Agent;
}

interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

const FALLBACK_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Advanced model for complex, multi-step tasks' },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: 'Affordable small model for fast, lightweight tasks' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and capable model for most tasks' },
];

export default function ModelSelector({ onSubmit, onCancel, currentModel, agent }: ModelSelectorProps) {
  const [models, setModels] = useState<OpenAIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emptyResults, setEmptyResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customModel, setCustomModel] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showCurrentModel, setShowCurrentModel] = useState(true);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        setLoading(true);
        setError(null);
        setEmptyResults(false);
        
        const baseURL = agent.getBaseURL() || 'https://api.openai.com/v1';
        const apiKey = agent.getApiKey();
        
        if (!apiKey) {
          throw new Error('No API key available');
        }

        const response = await fetch(`${baseURL}/models`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('DEBUG: Raw models response:', data);
        
        // Show all models returned by the API - no filtering needed
        const availableModels = data.data;
        
        console.log('DEBUG: Available models:', availableModels);
        
        setModels(availableModels);
        setEmptyResults(availableModels.length === 0);
        
        // Set selected index to current model or first available
        if (currentModel) {
          const currentIndex = availableModels.findIndex((model: OpenAIModel) => model.id === currentModel);
          setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
        } else {
          setSelectedIndex(0);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch models');
        // Use fallback models
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, [agent, currentModel]);

  useInput((input, key) => {
    if (showCustomInput) {
      if (key.return) {
        if (customModel.trim()) {
          onSubmit(customModel.trim());
        } else if (currentModel && showCurrentModel) {
          // User pressed Enter without typing, keep current model
          onSubmit(currentModel);
        }
        return;
      }

      if (key.escape) {
        setShowCustomInput(false);
        setCustomModel('');
        setShowCurrentModel(true); // Show current model again when canceling
        return;
      }

      if (key.backspace) {
        setCustomModel(prev => prev.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setCustomModel(prev => prev + input);
        setShowCurrentModel(false); // Hide current model when user starts typing
        return;
      }

      if (key.ctrl && input === 'c') {
        onCancel();
      }
      return;
    }

    if (key.return) {
      const selectedModels = error ? FALLBACK_MODELS : models;
      if (selectedIndex < selectedModels.length) {
        onSubmit(selectedModels[selectedIndex].id);
      } else {
        // Custom model option
        setShowCustomInput(true);
        setCustomModel(currentModel || '');
        setShowCurrentModel(false); // Hide current model when entering custom
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      const maxIndex = (error ? FALLBACK_MODELS.length : models.length) + 1; // +1 for custom option
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      const maxIndex = (error ? FALLBACK_MODELS.length : models.length) + 1; // +1 for custom option
      setSelectedIndex(prev => Math.min(maxIndex - 1, prev + 1));
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
          <Text color="cyan" bold>Enter Custom Model</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Enter the model name (e.g., gpt-4, claude-3-sonnet-20240229, gemini-pro)
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="white">
            Model: <Text color="yellow">{customModel}</Text>
            <Text color="white" inverse>_</Text>
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            Press Enter to {customModel.trim() ? 'save' : currentModel ? 'keep current' : 'save'}, Escape to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  const displayModels = error && error !== 'No API key available' ? FALLBACK_MODELS : models;
  const showFallbackOnly = error === 'No API key available';
  const displayOptions = [
    ...(showFallbackOnly ? FALLBACK_MODELS : displayModels).map(model => ({
      id: model.id,
      name: model.id,
      description: 'owned_by' in model ? model.owned_by : model.description,
      isCustom: false,
    })),
    {
      id: 'custom',
      name: 'Enter custom model...',
      description: 'Manually enter a model name',
      isCustom: true,
    },
  ];

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

      {currentModel && showCurrentModel && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color="gray" dimColor>
              Current Model:{' '}
              <Text color="yellow">{currentModel}</Text>{' '}
              <Text color="green">(current)</Text>
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              Start typing to enter a new model, or press Enter to keep current
            </Text>
          </Box>
        </Box>
      )}

      {loading && (
        <Box marginBottom={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow" bold>Fetching models...</Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              Loading available models from {agent.getBaseURL() || "https://api.openai.com/v1"}
            </Text>
          </Box>
        </Box>
      )}

      {error && (
        <Box marginBottom={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="red">
              {error === 'No API key available' 
                ? 'No API key configured' 
                : `Could not fetch models: ${error}`
              }
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              {error === 'No API key available'
                ? 'Please set your API key first using /apikey command'
                : 'Using fallback models'
              }
            </Text>
          </Box>
        </Box>
      )}

      {!loading && !error && emptyResults && (
        <Box marginBottom={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="yellow" bold>No models available</Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              The API request succeeded but returned no models.
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              This might indicate an issue with your API key or the service.
            </Text>
          </Box>
        </Box>
      )}

      {error && error === 'No API key available' && (
        <Box marginBottom={1}>
          <Text color="yellow" bold>Recommended actions:</Text>
          <Text color="gray" dimColor>1. Press Escape to cancel and return to chat</Text>
          <Text color="gray" dimColor>2. Type /apikey to set your API key</Text>
          <Text color="gray" dimColor>3. Then use /model again to select from available models</Text>
        </Box>
      )}

      {showFallbackOnly && (
        <Box marginBottom={1}>
          <Text color="yellow" bold>Note:</Text>
          <Text color="gray" dimColor>
            Showing common models below. You can still select a model, but you will need to set your API key before using the assistant.
          </Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        {displayOptions.map((option, index) => (
          <Box key={option.id} marginBottom={index === displayOptions.length - 1 ? 0 : 1}>
            <Text
              color={index === selectedIndex ? 'black' : 'white'}
              backgroundColor={index === selectedIndex ? 'cyan' : undefined}
              bold={index === selectedIndex}
            >
              {index === selectedIndex ? <Text bold>{'>'}</Text> : '  '} {''}
              {option.name}
              {!option.isCustom && option.id === currentModel ? ' (current)' : ''}
            </Text>
            {index === selectedIndex && (
              <Box marginLeft={4} marginTop={0}>
                <Text color="gray" dimColor>
                  {option.description}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Press Enter to {showCustomInput ? 'save' : currentModel && showCurrentModel ? 'keep current' : 'select'}, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
}
