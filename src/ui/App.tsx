import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Agent } from '../core/agent.js';
import { SessionRecord, SessionStore } from '../core/session-store.js';
import Chat from './chat/Chat.js';

interface AppProps {
  agent: Agent;
  sessionStore: SessionStore;
  initialSession: SessionRecord;
}

export default function App({ agent, sessionStore, initialSession }: AppProps) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  return (
    <Box flexDirection="column" height="100%">
      {isReady ? (
				<Chat
					agent={agent}
					sessionStore={sessionStore}
					initialSession={initialSession}
				/>
      ) : (
        <Box justifyContent="center" alignItems="center" height="100%">
          <Text>Initializing agent...</Text>
        </Box>
      )}
    </Box>
  );
}
