import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getCommandNames } from '../../commands/index.js';
import SlashCommandSuggestions from '../overlays/SlashCommandSuggestions.js';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  userMessageHistory?: string[];
}

export default function MessageInput({
  value,
  onChange,
  onSubmit,
  placeholder = '... (Esc to clear, Ctrl+C to exit)',
  userMessageHistory = [],
}: MessageInputProps) {
  const [selectedSuggestionIndex, setSelectedCommandIndex] = useState(0);
  const [messageHistoryIndex, setHistoryIndex] = useState(-1);
  const [unsavedDraftMessage, setDraftMessage] = useState('');
  const [inputCursorPosition, setCursorPosition] = useState(value.length);

  const isInputSlashCommand = value.startsWith('/');
  const shouldShowCommandSuggestions = isInputSlashCommand;

  // Keep cursor position in bounds and reset to end when value is cleared
  useEffect(() => {
    if (value.length === 0) {
      setCursorPosition(0);
      // Clear draft and reset history when input is cleared (after sending message)
      setDraftMessage('');
      setHistoryIndex(-1);
    } else if (inputCursorPosition > value.length) {
      setCursorPosition(value.length);
    }
  }, [value]);

  useInput((input, key) => {
    if (key.return) {
      if (isInputSlashCommand) {
        // Auto-complete to selected command
        const searchTerm = value.slice(1).toLowerCase();
        const commands = getCommandNames();
        const filteredCommands = commands.filter((cmd) => cmd.toLowerCase().includes(searchTerm));
        if (filteredCommands.length > 0) {
          onSubmit(`/${filteredCommands[selectedSuggestionIndex] || filteredCommands[0]}`);
          return;
        }
      }
      onSubmit(value);
      return;
    }

    if (key.upArrow) {
      if (shouldShowCommandSuggestions) {
        setSelectedCommandIndex((prev) => Math.max(0, prev - 1));
      } else if (inputCursorPosition === 0 && userMessageHistory.length > 0) {
        // Store current input as draft when first navigating to history
        if (messageHistoryIndex === -1) {
          setDraftMessage(value);
        }
        // Navigate to message history when at 0th position
        const newIndex = Math.min(messageHistoryIndex + 1, userMessageHistory.length - 1);
        if (newIndex !== messageHistoryIndex) {
          setHistoryIndex(newIndex);
          const historicalMessage = userMessageHistory[userMessageHistory.length - 1 - newIndex];
          onChange(historicalMessage);
          setCursorPosition(historicalMessage.length);
        }
      } else {
        setCursorPosition(0);
      }
      return;
    }

    if (key.downArrow) {
      if (shouldShowCommandSuggestions) {
        const searchTerm = value.slice(1).toLowerCase();
        const commands = getCommandNames();
        const filteredCommands = commands.filter((cmd) => cmd.toLowerCase().includes(searchTerm));
        setSelectedCommandIndex((prev) => Math.min(filteredCommands.length - 1, prev + 1));
      } else if (inputCursorPosition === value.length && messageHistoryIndex >= 0) {
        // Navigate through message history when at last position
        const newIndex = messageHistoryIndex - 1;
        if (newIndex >= 0) {
          setHistoryIndex(newIndex);
          const historicalMessage = userMessageHistory[userMessageHistory.length - 1 - newIndex];
          onChange(historicalMessage);
          setCursorPosition(historicalMessage.length);
        } else {
          // Return to draft message (current input)
          setHistoryIndex(-1);
          onChange(unsavedDraftMessage);
          setCursorPosition(unsavedDraftMessage.length);
        }
      } else {
        setCursorPosition(value.length);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition((prev) => Math.min(value.length, prev + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (inputCursorPosition > 0) {
        const newValue = value.slice(0, inputCursorPosition - 1) + value.slice(inputCursorPosition);
        onChange(newValue);
        setCursorPosition((prev) => prev - 1);
      }
      setSelectedCommandIndex(0);
      setHistoryIndex(-1);
      return;
    }

    if (key.ctrl) {
      // Handle Ctrl+C in parent component
      return;
    }

    // Regular character input
    if (input && !key.meta && !key.ctrl) {
      const processedInput = input.replace(/[\r\n]+/g, ' ');
      const newValue = value.slice(0, inputCursorPosition) + processedInput + value.slice(inputCursorPosition);
      onChange(newValue);
      setCursorPosition((prev) => prev + processedInput.length);
      setSelectedCommandIndex(0);
      setHistoryIndex(-1);
    }
  });

  const displayValue = value || placeholder;
  const isPlaceholder = !value;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>{'>'} </Text>
        <Box flexGrow={1}>
          {isPlaceholder ? (
            <Text color="gray">
              <Text backgroundColor="cyan" color="white"> </Text>
              {placeholder}
            </Text>
          ) : (
            <Text color="gray">
              {value.slice(0, inputCursorPosition)}
              <Text backgroundColor="cyan" color="white">
                {inputCursorPosition < value.length ? value[inputCursorPosition] : ' '}
              </Text>
              {value.slice(inputCursorPosition + 1)}
            </Text>
          )}
        </Box>
      </Box>
      {shouldShowCommandSuggestions && (
        <SlashCommandSuggestions
          input={value}
          selectedIndex={selectedSuggestionIndex}
          onSelect={(command: string) => onSubmit(`/${command}`)}
        />
      )}
    </Box>
  );
}
