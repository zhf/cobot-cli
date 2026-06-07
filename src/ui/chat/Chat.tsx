import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Text, useInput, useApp,
} from 'ink';
import { Agent } from '../../core/agent.js';
import {
  createEmptySessionStats,
  SessionRecord,
  SessionStore,
  shortSessionId,
  StoredChatMessage,
} from '../../core/session-store.js';
import { debugLog } from '../../core/logger.js';
import { ChatMessage, useAgent } from '../hooks/useAgent.js';
import useTokenMetrics from '../hooks/useTokenMetrics.js';
import useSessionStats from '../hooks/useSessionStats.js';
import { ThemeProvider, useTheme } from '../hooks/useTheme.js';
import ConfigManager from '../../config/ConfigManager.js';
import MessageHistory from './MessageHistory.js';
import MessageInput from './MessageInput.js';
import TokenMetrics from '../display/TokenMetrics.js';
import PendingToolApproval from '../overlays/PendingToolApproval.js';
import PendingQuestion from '../overlays/PendingQuestion.js';
import Login from '../overlays/Login.js';
import ModelSelector from '../overlays/ModelSelector.js';
import MaxIterationsContinue from '../overlays/MaxIterationsContinue.js';
import ErrorRetry from '../overlays/ErrorRetry.js';
import BaseURLSelector from '../overlays/BaseURLSelector.js';
import SeeyonAgentRunner from '../overlays/SeeyonAgentRunner.js';
import { handleSlashCommand } from '../../commands/index.js';
import { YOLO_AGENT_NAME } from '../../core/coding-agents.js';

interface ChatProps {
  agent: Agent;
  sessionStore: SessionStore;
  initialSession: SessionRecord;
}

function deserializeChatMessages(messages: StoredChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const timestamp = new Date(message.timestamp);

    return {
      ...message,
      timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    };
  });
}

function serializeChatMessages(messages: ChatMessage[]): StoredChatMessage[] {
  return messages.map((message) => ({
    ...message,
    timestamp: message.timestamp.toISOString(),
  }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ChatContent({ agent, sessionStore, initialSession }: ChatProps) {
  const { colors, isDarkTheme, toggleTheme } = useTheme();
  const [activeSession, setActiveSession] = useState<SessionRecord>(initialSession);
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
    setSessionStatsSnapshot,
  } = useSessionStats(initialSession.sessionStats);

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
    {
      messages: deserializeChatMessages(initialSession.uiMessages),
      userMessageHistory: initialSession.userMessageHistory,
    },
  );

  const {
    messages,
    userMessageHistory,
    isProcessing,
    currentToolExecution,
    pendingApproval,
    pendingQuestion,
    pendingMaxIterations,
    pendingError,
    sessionAutoApprove,
    showReasoning,
    sendMessage,
    approveToolExecution,
    respondToQuestion,
    respondToMaxIterations,
    respondToError,
    addMessage,
    setApiKey,
    clearHistory,
    replaceHistory,
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
  const [showSeeyonAgentRunner, setShowSeeyonAgentRunner] = useState(false);

	useEffect(() => {
		try {
			sessionStore.saveSessionState(activeSession.id, {
				model: agent.getCurrentModel(),
				temperature: agent.getTemperature(),
				agentMessages: agent.exportMessages(),
				baseAgentMessages: agent.exportBaseMessages(),
				uiMessages: serializeChatMessages(messages),
				userMessageHistory,
				sessionStats,
			});
		} catch (error) {
			debugLog('Failed to save session state:', error);
		}
	}, [activeSession.id, agent, messages, sessionStats, sessionStore, userMessageHistory]);

	const handleStartNewSession = useCallback((title?: string) => {
		agent.clearHistory();
		const nextSession = sessionStore.createSession({
			title,
			model: agent.getCurrentModel(),
			temperature: agent.getTemperature(),
			agentMessages: agent.exportMessages(),
			baseAgentMessages: agent.exportBaseMessages(),
			sessionStats: createEmptySessionStats(),
		});

		replaceHistory([], []);
		setSessionStatsSnapshot(createEmptySessionStats());
		setActiveSession(nextSession);
		addMessage({
			role: 'system',
			content: `Started new session ${shortSessionId(nextSession.id)}: ${nextSession.title}`,
		});
	}, [addMessage, agent, replaceHistory, sessionStore, setSessionStatsSnapshot]);

	const handleResumeSession = useCallback((reference?: string) => {
		try {
			const sessionReference = reference?.trim();
			const previousSession = sessionStore.listSessions().find((savedSession) => savedSession.id !== activeSession.id);
			const session = sessionReference
				? sessionStore.loadSession(sessionReference)
				: previousSession
					? sessionStore.loadSession(previousSession.id)
					: null;

			if (!session) {
				addMessage({
					role: 'system',
					content: 'No previous session to resume.',
				});
				return;
			}

			agent.loadSessionState(
				session.model,
				session.temperature,
				session.agentMessages,
				session.baseAgentMessages,
			);
			replaceHistory(deserializeChatMessages(session.uiMessages), session.userMessageHistory);
			setSessionStatsSnapshot(session.sessionStats);
			setActiveSession(session);
			addMessage({
				role: 'system',
				content: `Resumed session ${shortSessionId(session.id)}: ${session.title}`,
			});
		} catch (error) {
			addMessage({
				role: 'system',
				content: `Failed to resume session: ${getErrorMessage(error)}`,
			});
		}
	}, [activeSession.id, addMessage, agent, replaceHistory, sessionStore, setSessionStatsSnapshot]);

	const handleDeleteSession = useCallback((reference: string) => {
		try {
			const deletedSessionId = sessionStore.deleteSession(reference);

			if (deletedSessionId === activeSession.id) {
				agent.clearHistory();
				const nextSession = sessionStore.createSession({
					model: agent.getCurrentModel(),
					temperature: agent.getTemperature(),
					agentMessages: agent.exportMessages(),
					baseAgentMessages: agent.exportBaseMessages(),
					sessionStats: createEmptySessionStats(),
				});

				replaceHistory([], []);
				setSessionStatsSnapshot(createEmptySessionStats());
				setActiveSession(nextSession);
				addMessage({
					role: 'system',
					content: `Deleted active session ${shortSessionId(deletedSessionId)} and started ${shortSessionId(nextSession.id)}.`,
				});
				return;
			}

			addMessage({
				role: 'system',
				content: `Deleted session ${shortSessionId(deletedSessionId)}.`,
			});
		} catch (error) {
			addMessage({
				role: 'system',
				content: `Failed to delete session: ${getErrorMessage(error)}`,
			});
		}
	}, [activeSession.id, addMessage, agent, replaceHistory, sessionStore, setSessionStatsSnapshot]);

  const handleSwitchCodingAgent = useCallback((agentName: string) => {
    agent.switchCodingAgent(agentName);
    const nextSession = sessionStore.createSession({
      title: `${agentName} session`,
      model: agent.getCurrentModel(),
      temperature: agent.getTemperature(),
      agentMessages: agent.exportMessages(),
      baseAgentMessages: agent.exportBaseMessages(),
      sessionStats: createEmptySessionStats(),
    });

    replaceHistory([], []);
    setSessionStatsSnapshot(createEmptySessionStats());
    setActiveSession(nextSession);
  }, [agent, replaceHistory, sessionStore, setSessionStatsSnapshot]);

  const handleCycleCodingAgent = useCallback(() => {
    const agents = agent.listCodingAgents().filter((item) => item.mode !== 'subagent');
    if (agents.length <= 1) {
      return;
    }

    const activeAgentName = agent.getActiveCodingAgent().name;
    const activeIndex = agents.findIndex((item) => item.name === activeAgentName);
    const nextAgent = agents[(activeIndex + 1) % agents.length] || agents[0];

    handleSwitchCodingAgent(nextAgent.name);
    addMessage({
      role: 'system',
      content: `Switched to coding agent: ${nextAgent.name}. Chat history has been cleared.`,
    });
  }, [addMessage, agent, handleSwitchCodingAgent]);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exitApplication();
    }
    if (key.shift && key.tab) {
      if (!isProcessing && !pendingApproval && !pendingQuestion && !pendingError && !showApiLogin && !showModelSelector && !showBaseURLSelector && !showSeeyonAgentRunner) {
        handleCycleCodingAgent();
      }
      return;
    }
    if (key.tab && !inputValue.trim()) {
      if (!isProcessing && !pendingApproval && !pendingQuestion && !pendingError && !showApiLogin && !showModelSelector && !showBaseURLSelector && !showSeeyonAgentRunner) {
        toggleAutoApprove();
      }
      return;
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
      else if (pendingQuestion) {
        respondToQuestion(pendingQuestion.questions.map(() => []));
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

  // Hide input when processing, waiting for approval, error retry, or showing overlays
  useEffect(() => {
    setShowInput(!isProcessing && !pendingApproval && !pendingQuestion && !pendingError && !showApiLogin && !showModelSelector && !showBaseURLSelector && !showSeeyonAgentRunner);
  }, [isProcessing, pendingApproval, pendingQuestion, pendingError, showApiLogin, showModelSelector, showBaseURLSelector, showSeeyonAgentRunner]);

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
          setShowSeeyonAgentRunner,
					startNewSession: handleStartNewSession,
					listSessions: () => sessionStore.listSessions(),
					resumeSession: handleResumeSession,
					deleteSession: handleDeleteSession,
          listCodingAgents: () => agent.listCodingAgents(),
          switchCodingAgent: handleSwitchCodingAgent,
          activeCodingAgentName: agent.getActiveCodingAgent().name,
					activeSessionId: activeSession.id,
          toggleReasoning,
          showReasoning,
          toggleTheme,
          isDarkTheme,
          sessionStats,
        });
        return;
      }

      // The agent will handle starting request tracking
      const updatedTitle = sessionStore.updateAutoTitleFromUserMessage(activeSession.id, message);
      if (updatedTitle) {
				setActiveSession((session) => (
					session.id === activeSession.id
						? { ...session, title: updatedTitle, titleSource: 'auto' }
						: session
				));
      }

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

  const handleSeeyonAgentResult = (contextMessage: string, displayMessage: string) => {
    setShowSeeyonAgentRunner(false);
    agent.addContextMessage(contextMessage);
    addMessage({
      role: 'assistant',
      content: displayMessage,
    });
  };

  const handleSeeyonAgentCancel = () => {
    setShowSeeyonAgentRunner(false);
    addMessage({
      role: 'system',
      content: 'Seeyon Chat agent selection canceled.',
    });
  };

  const activeCodingAgentName = agent.getActiveCodingAgent().name;
  const approvalStatus = activeCodingAgentName === YOLO_AGENT_NAME
    ? 'YOLO mode is on'
    : sessionAutoApprove
      ? 'auto-approval is on'
      : '';

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
        ) : pendingQuestion ? (
          <PendingQuestion
            questions={pendingQuestion.questions}
            onSubmit={respondToQuestion}
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
        ) : showSeeyonAgentRunner ? (
          <SeeyonAgentRunner
            onSubmit={handleSeeyonAgentResult}
            onCancel={handleSeeyonAgentCancel}
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
            <Text color={colors.muted}>Processing...</Text>
          </Box>
        )}
      </Box>

      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text color={colors.primary} bold>
            {approvalStatus}
          </Text>
        </Box>
        <Box>
          <Text color={colors.muted}>
            {isDarkTheme ? '🌙 dark' : '☀️ light'} theme | {activeCodingAgentName} agent | {agent.getCurrentModel?.() || ''}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export default function Chat({ agent, sessionStore, initialSession }: ChatProps) {
  const configManager = new ConfigManager();
  const savedTheme = configManager.getTheme();
  const initialDarkTheme = savedTheme === 'dark';

  return (
    <ThemeProvider initialDarkTheme={initialDarkTheme}>
      <ChatContent
				agent={agent}
				sessionStore={sessionStore}
				initialSession={initialSession}
      />
    </ThemeProvider>
  );
}
