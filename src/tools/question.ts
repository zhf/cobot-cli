import { ToolResult, createToolResponse } from './files.js';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionPrompt {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export type QuestionAnswer = string[];

export function validateQuestions(value: unknown): QuestionPrompt[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const questions: QuestionPrompt[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.question !== 'string' || typeof record.header !== 'string' || !Array.isArray(record.options)) {
      return null;
    }

    const options: QuestionOption[] = [];
    for (const option of record.options) {
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        return null;
      }
      const optionRecord = option as Record<string, unknown>;
      if (typeof optionRecord.label !== 'string' || typeof optionRecord.description !== 'string') {
        return null;
      }
      options.push({ label: optionRecord.label, description: optionRecord.description });
    }

    questions.push({
      question: record.question,
      header: record.header,
      options,
      multiple: typeof record.multiple === 'boolean' ? record.multiple : false,
      custom: typeof record.custom === 'boolean' ? record.custom : true,
    });
  }

  return questions;
}

export function formatQuestionResult(questions: QuestionPrompt[], answers: QuestionAnswer[]): ToolResult {
  const formatted = questions.map((question, index) => {
    const answer = answers[index] || [];
    return `"${question.question}"="${answer.length ? answer.join(', ') : 'Unanswered'}"`;
  }).join(', ');

  return createToolResponse(true, { questions, answers }, `User answered: ${formatted}`);
}
