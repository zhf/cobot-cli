import React, { useState, useEffect } from 'react';
import {
  Box, Text, useInput, useApp,
} from 'ink';
import { Agent } from '../../core/agent.js';
import { useAgent } from '../hooks/useAgent.js';
import useTokenMetrics from '../hooks/useTokenMetrics.js';
import useSessionStats from '../hooks/useSessionStats.js';
import { ThemeProvider, useTheme } from '../hooks/useTheme.js';
import ConfigManager from '../../config/ConfigManager.js';
import MessageHistory from './MessageHistory.js';
import MessageInput from './MessageInput.js';
import TokenMetrics from '../display/TokenMetrics.js';
import PendingToolApproval from '../overlays/PendingToolApproval.js';
import Login from '../overlays/Login.js';
import ModelSelector from '../overlays/ModelSelector.js';
import MaxIterationsContinue from '../overlays/MaxIterationsContinue.js';
import ErrorRetry from '../overlays/ErrorRetry.js';
import BaseURLSelector from '../overlays/BaseURLSelector.js';
import { handleSlashCommand } from '../../commands/index.js';

interface ChatProps {
  agent: Agent;
}

function ChatContent({ agent }: ChatProps) {
  const { colors, isDarkTheme, toggleTheme } = useTheme();
  const {
    completionTokens: currentCompletionTokens,
    startTime,
    endTime,
    pausedTime,
    isPaused,
    isActive,
    startRequest,
    addApiTokens,
    pauseMetrics,
    resumeMetrics,
    completeRequest,
    resetMetrics,
  } = useTokenMetrics();

  const {
    sessionStats,
    addSessionTokens,
    clearSessionStats,
  } = useSessionStats();

  // Wrapper function to add tokens to both per-request and session totals
  const handleApiTokens = (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => {
    addApiTokens(usage); // Add to current request metrics
    addSessionTokens(usage); // Add to cumulative session stats
  };

  const agentHook = useAgent(
    agent,
    startRequest, // Start tracking on new request
    handleApiTokens, // Add API usage tokens to both request and session totals
    pauseMetrics, // Pause during approval
    resumeMetrics, // Resume after approval
    completeRequest, // Complete when agent is done
  );

  const {
    messages,
    userMessageHistory,
    isProcessing,
    currentToolExecution,
    pendingApproval,
    pendingMaxIterations,
    pendingError,
    sessionAutoApprove,
    showReasoning,
    sendMessage,
    approveToolExecution,
    respondToMaxIterations,
    respondToError,
    addMessage,
    setApiKey,
    clearHistory,
    toggleAutoApprove,
    toggleReasoning,
    interruptRequest,
  } = agentHook;

  const { exit: exitApplication } = useApp();
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput] = useState(true);
  const [showApiLogin, setShowApiLogin] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showBaseURLSelector, setShowBaseURLSelector] = useState(false);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exitApplication();
    }
    if (key.shift && key.tab) {
      toggleAutoApprove();
    }
    if (key.escape) {
      // If waiting for error retry decision, cancel retry
      if (pendingError) {
        handleErrorCancel();
      }
      // If waiting for tool approval, reject the tool
      else if (pendingApproval) {
        handleToolApprovalDecision(false);
      }
      // If model is actively processing (but not waiting for approval or executing tools after approval)
      else if (isProcessing && !currentToolExecution) {
        interruptRequest();
      }
      // If user is typing and nothing else is happening, clear the input
      else if (showInput && inputValue.trim()) {
        setInputValue('');
      }
    }

    // Handle error retry keys
    if (pendingError) {
      if (input.toLowerCase() === 'r') {
        handleErrorRetry();
      } else if (input.toLowerCase() === 'c') {
        handleErrorCancel();
      }
    }
  });

  // Hide input when processing, waiting for approval, error retry, or showing login/model selector/baseurl selector
  useEffect(() => {
    setShowInput(!isProcessing && !pendingApproval && !pendingError && !showApiLogin && !showModelSelector && !showBaseURLSelector);
  }, [isProcessing, pendingApproval, pendingError, showApiLogin, showModelSelector, showBaseURLSelector]);

  const handleUserMessageSubmission = async (message: string) => {
    if (message.trim() && !isProcessing) {
      setInputValue('');

      // Handle slash commands
      if (message.startsWith('/')) {
        handleSlashCommand(message, {
          addMessage: (msg: unknown) => addMessage(msg as any),
          clearHistory: () => {
            clearHistory();
            clearSessionStats();
          },
          setShowLogin: setShowApiLogin,
          setShowModelSelector,
          setShowBaseURLSelector,
          toggleReasoning,
          showReasoning,
          toggleTheme,
          isDarkTheme,
          sessionStats,
        });
        return;
      }

      // The agent will handle starting request tracking
      await sendMessage(message);
    }
  };

  const handleToolApprovalDecision = (approved: boolean, autoApproveSession?: boolean) => {
    approveToolExecution(approved, autoApproveSession);
  };

  const handleErrorRetry = () => {
    respondToError(true);
  };

  const handleErrorCancel = () => {
    respondToError(false);
  };

  const handleLogin = (apiKey: string) => {
    setShowApiLogin(false);
    // Save the API key persistently
    agent.saveApiKey(apiKey);
    addMessage({
      role: 'system',
      content: 'API key saved successfully. You can now start chatting with the assistant.',
    });
  };

  const handleLoginCancel = () => {
    setShowApiLogin(false);
    addMessage({
      role: 'system',
      content: 'API key entry canceled.',
    });
  };

  const handleModelSelect = (model: string) => {
    setShowModelSelector(false);
    // Clear chat history and session stats when switching models
    clearHistory();
    clearSessionStats();
    // Set the new model on the agent
    agent.setModel(model);
    addMessage({
      role: 'system',
      content: `Switched to model: ${model}. Chat history has been cleared.`,
    });
  };

  const handleModelCancel = () => {
    setShowModelSelector(false);
    addMessage({
      role: 'system',
      content: 'Model selection canceled.',
    });
  };

  const handleBaseURLSelect = (baseURL: string) => {
    setShowBaseURLSelector(false);
    // Set the new base URL on the agent
    agent.saveBaseURL(baseURL);
    addMessage({
      role: 'system',
      content: `Base URL set to: ${baseURL}`,
    });
  };

  const handleBaseURLCancel = () => {
    setShowBaseURLSelector(false);
    addMessage({
      role: 'system',
      content: 'Base URL selection canceled.',
    });
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Chat messages area */}
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <MessageHistory
          messages={messages}
          showReasoning={showReasoning}
          usageData={{
            prompt_tokens: sessionStats.promptTokens,
            completion_tokens: sessionStats.completionTokens,
            total_tokens: sessionStats.totalTokens,
            total_requests: sessionStats.totalRequests,
            total_time: sessionStats.totalTime,
            queue_time: 0,
            prompt_time: 0,
            completion_time: 0,
          }}
        />
      </Box>

      {/* Token metrics */}
      <TokenMetrics
        isActive={isActive}
        isPaused={isPaused}
        startTime={startTime}
        endTime={endTime}
        pausedTime={pausedTime}
        completionTokens={currentCompletionTokens}
      />

      {/* Input area */}
      <Box borderStyle="round" borderColor="white" paddingX={1}>
        {pendingApproval ? (
          <PendingToolApproval
            toolName={pendingApproval.toolName}
            toolArgs={pendingApproval.toolArgs}
            onApprove={() => handleToolApprovalDecision(true, false)}
            onReject={() => handleToolApprovalDecision(false, false)}
            onApproveWithAutoSession={() => handleToolApprovalDecision(true, true)}
          />
        ) : pendingMaxIterations ? (
          <MaxIterationsContinue
            maxIterations={pendingMaxIterations.maxIterations}
            onContinue={() => respondToMaxIterations(true)}
            onStop={() => respondToMaxIterations(false)}
          />
        ) : pendingError ? (
          <ErrorRetry
            error={pendingError.error}
            onRetry={handleErrorRetry}
            onCancel={handleErrorCancel}
          />
        ) : showApiLogin ? (
          <Login
            onSubmit={handleLogin}
            onCancel={handleLoginCancel}
            currentApiKey={agent.getApiKey() || undefined}
          />
        ) : showModelSelector ? (
          <ModelSelector
            onSubmit={handleModelSelect}
            onCancel={handleModelCancel}
            currentModel={agent.getCurrentModel?.() || undefined}
            agent={agent}
          />
        ) : showBaseURLSelector ? (
          <BaseURLSelector
            onSubmit={handleBaseURLSelect}
            onCancel={handleBaseURLCancel}
            currentBaseURL={agent.getBaseURL?.() || undefined}
          />
        ) : showInput ? (
          <MessageInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleUserMessageSubmission}
            placeholder="... (Esc to clear, Ctrl+C to exit)"
            userMessageHistory={userMessageHistory}
          />
        ) : (
          <Box>
            <Text color={colors.muted} dimColor>Processing...</Text>
          </Box>
        )}
      </Box>

      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text color={colors.primary} bold>
            {sessionAutoApprove ? 'auto-approve edits is on' : ''}
          </Text>
        </Box>
        <Box>
          <Text color={colors.muted} dimColor>
            {isDarkTheme ? '🌙 dark' : '☀️ light'} theme | {agent.getCurrentModel?.() || ''}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export default function Chat({ agent }: ChatProps) {
  const configManager = new ConfigManager();
  const savedTheme = configManager.getTheme();
  const initialDarkTheme = savedTheme === 'dark';

  return (
    <ThemeProvider initialDarkTheme={initialDarkTheme}>
      <ChatContent agent={agent} />
    </ThemeProvider>
  );
}
