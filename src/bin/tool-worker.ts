#!/usr/bin/env node
import { runToolWorker } from '../tools/worker.js';

runToolWorker().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : 'Tool worker failed';
	console.error(message);
	process.exit(1);
});
