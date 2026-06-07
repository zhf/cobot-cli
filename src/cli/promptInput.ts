export async function readStdinIfAvailable(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');

    let data = '';

    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    process.stdin.on('error', () => {
      resolve(data);
    });

    process.stdin.resume();
  });
}

export async function buildPromptWithStdin(prompt: string = ''): Promise<string> {
  const stdinInput = await readStdinIfAvailable();

  if (!stdinInput) {
    return prompt;
  }

  return prompt ? `${prompt}\n\n${stdinInput}` : stdinInput;
}
