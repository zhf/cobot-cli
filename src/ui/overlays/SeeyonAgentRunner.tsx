import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { formatAgentResultForContext, SeeyonAgent, SeeyonChatClient } from '../../core/seeyon-chat.js';
import { useTheme } from '../hooks/useTheme.js';

interface SeeyonAgentRunnerProps {
  onSubmit: (contextMessage: string, displayMessage: string) => void;
  onCancel: () => void;
}

type RunnerStage = 'loading' | 'select' | 'prompt' | 'running' | 'error';

function SeeyonAgentRunner({ onSubmit, onCancel }: SeeyonAgentRunnerProps) {
  const { colors } = useTheme();
  const [stage, setStage] = useState<RunnerStage>('loading');
  const [agents, setAgents] = useState<SeeyonAgent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadAgents() {
      try {
        const client = SeeyonChatClient.fromConfig();
        const fetchedAgents = await client.listAgents();

        if (canceled) return;

        setAgents(fetchedAgents);
        setStage(fetchedAgents.length > 0 ? 'select' : 'error');
        if (fetchedAgents.length === 0) {
          setError('No Seeyon Chat agents are accessible for this account.');
        }
      } catch (caughtError) {
        if (canceled) return;

        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        setStage('error');
      }
    }

    loadAgents();

    return () => {
      canceled = true;
    };
  }, []);

  const selectedAgent = agents[selectedIndex];

  async function runSelectedAgent() {
    if (!selectedAgent || !prompt.trim()) {
      return;
    }

    try {
      setStage('running');
      const client = SeeyonChatClient.fromConfig();
      const result = await client.runAgent(selectedAgent._id, { input: prompt });
      const contextMessage = formatAgentResultForContext(selectedAgent, prompt, result.content);
      const displayMessage = `Seeyon Chat agent "${selectedAgent.name}" response:\n\n${result.content}`;

      onSubmit(contextMessage, displayMessage);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setStage('error');
    }
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (stage === 'select') {
      if (key.return) {
        setStage('prompt');
        return;
      }

      if (key.upArrow) {
        setSelectedIndex(previousIndex => Math.max(0, previousIndex - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex(previousIndex => Math.min(agents.length - 1, previousIndex + 1));
      }
    }

    if (stage === 'prompt') {
      if (key.return) {
        void runSelectedAgent();
        return;
      }

      if (key.backspace || key.delete) {
        setPrompt(previousPrompt => previousPrompt.slice(0, -1));
        return;
      }

      if (input && !key.meta && !key.ctrl) {
        setPrompt(previousPrompt => previousPrompt + input.replace(/[\r\n]+/g, ' '));
      }
    }
  });

  if (stage === 'loading') {
    return (
      <Box>
        <Text color={colors.muted}>Loading Seeyon Chat agents...</Text>
      </Box>
    );
  }

  if (stage === 'running') {
    return (
      <Box>
        <Text color={colors.muted}>Running Seeyon Chat agent...</Text>
      </Box>
    );
  }

  if (stage === 'error') {
    return (
      <Box flexDirection="column">
        <Text color={colors.error}>{error}</Text>
        <Text color={colors.muted}>Press Escape to close.</Text>
      </Box>
    );
  }

  if (stage === 'prompt') {
    return (
      <Box flexDirection="column">
        <Text color={colors.primary} bold>Prompt for {selectedAgent?.name}</Text>
        <Text color={colors.muted}>Press Enter to send, Escape to cancel.</Text>
        <Text color={colors.foreground}>
          {'>'} {prompt}
          <Text backgroundColor={colors.inputCursor} color={colors.inverse}> </Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={colors.primary} bold>Select Seeyon Chat Agent</Text>
      <Text color={colors.muted}>Press Enter to select, Escape to cancel.</Text>
      {agents.map((agent, index) => (
        <Box key={agent._id}>
          <Text color={index === selectedIndex ? colors.selectionForeground : colors.foreground} backgroundColor={index === selectedIndex ? colors.selectionBackground : undefined}>
            {index === selectedIndex ? '>' : ' '} {agent.name}{agent.public ? ' (public)' : ''}{agent.description ? ` - ${agent.description}` : ''}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export default SeeyonAgentRunner;
