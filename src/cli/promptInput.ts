export async function readStdinIfAvailable(options?: { timeoutMs?: number }): Promise<string> {
	if (process.stdin.isTTY) {
		return '';
	}

	return new Promise((resolve) => {
		process.stdin.setEncoding('utf8');

		let data = '';
		let settled = false;

		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(data);
		};

		process.stdin.on('data', (chunk: string) => {
			data += chunk;
		});

		process.stdin.on('end', finish);
		process.stdin.on('error', finish);
		process.stdin.resume();

		if (options?.timeoutMs !== undefined) {
			setTimeout(finish, options.timeoutMs);
		}
	});
}

export async function buildPromptWithStdin(prompt: string = ''): Promise<string> {
	// When a prompt argument is already present, only briefly poll non-TTY stdin so
	// piped extras can still merge, without hanging forever in agent shells.
	const stdinInput = await readStdinIfAvailable({
		timeoutMs: prompt.trim() ? 50 : undefined,
	});

	if (!stdinInput) {
		return prompt;
	}

	return prompt ? `${prompt}\n\n${stdinInput}` : stdinInput;
}
