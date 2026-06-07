import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { QuestionAnswer, QuestionPrompt } from '../../tools/question.js';

interface PendingQuestionProps {
  questions: QuestionPrompt[];
  onSubmit: (answers: QuestionAnswer[]) => void;
}

function PendingQuestion({ questions, onSubmit }: PendingQuestionProps) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState('');
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);

  const currentQuestion = questions[questionIndex];
  const allowCustom = currentQuestion.custom !== false;
  const optionCount = currentQuestion.options.length + (allowCustom ? 1 : 0);
  const selectedCustom = allowCustom && selectedIndex === currentQuestion.options.length;

  const selectedSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);

  const submitCurrent = () => {
    const answer = selectedCustom
      ? [customAnswer.trim()].filter(Boolean)
      : currentQuestion.multiple
        ? selectedLabels
        : [currentQuestion.options[selectedIndex]?.label].filter(Boolean);
    const nextAnswers = [...answers, answer];

    if (questionIndex === questions.length - 1) {
      onSubmit(nextAnswers);
      return;
    }

    setAnswers(nextAnswers);
    setQuestionIndex((index) => index + 1);
    setSelectedIndex(0);
    setSelectedLabels([]);
    setCustomAnswer('');
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(optionCount - 1, index + 1));
      return;
    }
    if (key.return) {
      submitCurrent();
      return;
    }
    if (key.backspace || key.delete) {
      if (selectedCustom) {
        setCustomAnswer((value) => value.slice(0, -1));
      }
      return;
    }
    if (input === ' ' && currentQuestion.multiple && !selectedCustom) {
      const label = currentQuestion.options[selectedIndex]?.label;
      if (label) {
        setSelectedLabels((labels) => labels.includes(label)
          ? labels.filter((item) => item !== label)
          : [...labels, label]);
      }
      return;
    }
    if (selectedCustom && input && !key.ctrl && !key.meta) {
      setCustomAnswer((value) => `${value}${input.replace(/[\r\n]+/g, ' ')}`);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>{currentQuestion.header}</Text>
      <Text>{currentQuestion.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        {currentQuestion.options.map((option, index) => {
          const selected = index === selectedIndex;
          const checked = currentQuestion.multiple && selectedSet.has(option.label);
          return (
            <Text key={option.label} color={selected ? 'black' : 'white'} backgroundColor={selected ? 'cyan' : undefined}>
              {selected ? '>' : ' '} {currentQuestion.multiple ? (checked ? '[x]' : '[ ]') : ''} {option.label} - {option.description}
            </Text>
          );
        })}
        {allowCustom && (
          <Text color={selectedCustom ? 'black' : 'white'} backgroundColor={selectedCustom ? 'cyan' : undefined}>
            {selectedCustom ? '>' : ' '} Custom answer: {customAnswer || '(type here)'}
          </Text>
        )}
      </Box>
      <Text color="gray">
        Enter to submit{currentQuestion.multiple ? ', Space to toggle' : ''}. Question {questionIndex + 1}/{questions.length}
      </Text>
    </Box>
  );
}

export default PendingQuestion;
