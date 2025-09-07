import React, { useState, useContext, createContext, ReactNode } from 'react';
import { ThemeColors, getTheme } from '../theme.js';

interface ThemeContextType {
  isDarkTheme: boolean;
  toggleTheme: () => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
  initialDarkTheme?: boolean;
}

export function ThemeProvider({ children, initialDarkTheme = true }: ThemeProviderProps): React.ReactElement {
  const [isDarkTheme, setIsDarkTheme] = useState(initialDarkTheme);

  const toggleTheme = (): void => {
    setIsDarkTheme(!isDarkTheme);
  };

  const colors: ThemeColors = getTheme(isDarkTheme);

  const contextValue: ThemeContextType = {
    isDarkTheme,
    toggleTheme,
    colors,
  };

  return React.createElement(
    ThemeContext.Provider,
    { value: contextValue },
    children
  );
}