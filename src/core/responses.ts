import type OpenAI from 'openai';
import type {
	Response as ModelResponse,
	ResponseCreateParamsNonStreaming,
	ResponseCreateParamsStreaming,
	ResponseInputItem,
	ResponseOutputItem,
} from 'openai/resources/responses/responses.js';
import ConfigManager from '../config/ConfigManager.js';
import type { ChatCompletionOptions } from './openai-helper.js';

export type ResponseCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk & {
	responseOutput?: ResponseOutputItem[];
};

function inputItems(messages: ChatCompletionOptions['messages']): ResponseInputItem[] {
	const input: ResponseInputItem[] = [];
	for (const message of messages) {
		const output = (message as typeof message & { responseOutput?: ResponseOutputItem[] }).responseOutput;
		if (message.role === 'assistant' && output?.length) {
			// Preserve the complete item sequence, including encrypted reasoning, across tool rounds.
			input.push(...output);
			continue;
		}
		if (message.role === 'tool') {
			input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: typeof message.content === 'string' ? message.content : message.content.map(p => p.text).join('\n') });
			continue;
		}
		if (message.role === 'function') throw new Error('Legacy function messages are not supported by Responses');
		if (message.content?.length) {
			const content = typeof message.content === 'string' ? message.content : message.content.map(part => {
				if (part.type === 'text') return { type: 'input_text' as const, text: part.text };
				if (part.type === 'image_url') return { type: 'input_image' as const, image_url: part.image_url.url, detail: part.image_url.detail ?? 'auto' as const };
				if (part.type === 'refusal') return { type: 'input_text' as const, text: part.refusal };
				throw new Error(`Unsupported Responses input content: ${part.type}`);
			});
			input.push({ role: message.role, content });
		}
		if (message.role === 'assistant') {
			for (const call of message.tool_calls ?? []) {
				if (call.type !== 'function') throw new Error('Cobot Responses supports function tools only');
				input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
			}
		}
	}
	return input;
}

export function buildResponsesPayload(options: ChatCompletionOptions): Record<string, unknown> {
	const extra = { ...(options.config ?? new ConfigManager()).getExtraRequest(), ...options.extraBody };
	// API-specific defaults must not leak Chat Completions fields into Responses.
	const { reasoning_effort, max_tokens: _max, max_completion_tokens: _completionMax,
		messages: _messages, stream_options: _streamOptions, thinking: _thinking,
		previous_response_id: _previous, conversation: _conversation,
		...defaults } = extra;
	const payload: Record<string, unknown> = {
		...defaults,
		...(reasoning_effort !== undefined && defaults.reasoning === undefined ? { reasoning: { effort: reasoning_effort } } : {}),
		model: options.model,
		input: inputItems(options.messages),
		max_output_tokens: options.max_tokens ?? 8000,
		// Own state locally, just as the Chat Completions path does.
		store: false,
		include: [...new Set([...(Array.isArray(extra.include) ? extra.include : []), 'reasoning.encrypted_content'])],
		stream: options.stream ?? false,
	};
	// Do not inherit the CLI's legacy temperature default. Reasoning models reject it.
	// A provider that supports sampling can opt in through extraRequest.temperature.
	if (options.tools) payload.tools = options.tools.map(tool => {
		if (tool.type !== 'function') throw new Error('Cobot Responses supports function tools only');
		return {
			type: 'function', ...tool.function,
			// Existing Cobot/MCP schemas have optional fields; Responses defaults to strict.
			strict: tool.function.strict ?? false,
		};
	});
	if (options.tool_choice) {
		if (typeof options.tool_choice === 'string') payload.tool_choice = options.tool_choice;
		else if (options.tool_choice.type === 'function') payload.tool_choice = { type: 'function', name: options.tool_choice.function.name };
		else throw new Error('Unsupported Responses tool choice');
	}
	return payload;
}

function usageOf(response: ModelResponse): OpenAI.Completions.CompletionUsage | undefined {
	const usage = response.usage;
	if (!usage) return undefined;
	return {
		prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens,
		prompt_tokens_details: usage.input_tokens_details,
		completion_tokens_details: usage.output_tokens_details,
	};
}

function assertCompleted(response: ModelResponse): void {
	if (response.status !== 'completed') {
		throw new Error(`Responses ${response.status}: ${response.error?.message ?? response.incomplete_details?.reason ?? 'response did not complete'}`);
	}
}

function outputText(response: ModelResponse): string {
	return response.output.flatMap(item => item.type === 'message'
		? item.content.map(part => part.type === 'output_text' ? part.text : part.refusal)
		: []).join('');
}

function toolCalls(response: ModelResponse): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] {
	return response.output.flatMap(item => item.type === 'function_call' ? [{
		id: item.call_id, type: 'function' as const, function: { name: item.name, arguments: item.arguments },
	}] : []);
}

export async function createResponseCompletion(client: OpenAI, options: ChatCompletionOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> {
	const response = await client.responses.create(buildResponsesPayload({ ...options, stream: false }) as unknown as ResponseCreateParamsNonStreaming, { signal: options.signal });
	assertCompleted(response);
	const calls = toolCalls(response);
	return {
		id: response.id, object: 'chat.completion', created: response.created_at, model: response.model,
		usage: usageOf(response),
		choices: [{ index: 0, logprobs: null, finish_reason: calls.length ? 'tool_calls' : 'stop', message: {
			role: 'assistant', content: outputText(response), refusal: null,
			...(calls.length ? { tool_calls: calls } : {}),
		} }],
	};
}

export async function* streamResponseCompletion(client: OpenAI, options: ChatCompletionOptions): AsyncGenerator<ResponseCompletionChunk> {
	const stream = await client.responses.create(buildResponsesPayload({ ...options, stream: true }) as unknown as ResponseCreateParamsStreaming, { signal: options.signal });
	let completed = false;
	let emittedText = '';
	const chunk = (delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta): ResponseCompletionChunk => ({
		id: '', object: 'chat.completion.chunk', created: 0, model: options.model,
		choices: [{ index: 0, delta, finish_reason: null }],
	});
	try {
		for await (const event of stream) {
			if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
				emittedText += event.delta;
				yield chunk({ content: event.delta });
			} else if (event.type === 'response.reasoning_summary_text.delta') {
				yield chunk({ reasoning_content: event.delta } as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta);
			} else if (event.type === 'response.completed') {
				assertCompleted(event.response);
				const text = outputText(event.response);
				// Some compatible endpoints only emit the completed event, without deltas.
				if (!emittedText && text) yield chunk({ content: text });
				const calls = toolCalls(event.response);
				const last = chunk({ tool_calls: calls.map((call, index) => ({ ...call, index })) });
				last.id = event.response.id; last.created = event.response.created_at; last.model = event.response.model;
				last.choices[0].finish_reason = calls.length ? 'tool_calls' : 'stop';
				last.usage = usageOf(event.response);
				last.responseOutput = event.response.output;
				completed = true;
				yield last;
				return;
			} else if (event.type === 'response.failed' || event.type === 'response.incomplete') {
				assertCompleted(event.response);
			} else if (event.type === 'error') {
				throw new Error(`Responses error: ${event.message}`);
			}
		}
		options.signal?.throwIfAborted();
		if (!completed) throw new Error('Responses stream ended before response.completed');
	} finally {
		// Also close the underlying request if a consumer stops iteration early.
		stream.controller.abort();
	}
}
