import type { ExploreProgressEvent } from './types.js';

type ProgressPayload = Omit<ExploreProgressEvent, 'type'>;

export class ExploreProgressTracker {
	private readonly pipelineStartedAt = Date.now();
	private phaseStartedAt = Date.now();

	constructor(private readonly emit: (event: ExploreProgressEvent) => void) {}

	start(payload: ProgressPayload): void {
		this.phaseStartedAt = Date.now();
		this.emit({
			type: 'progress',
			status: 'started',
			...payload,
		});
	}

	complete(payload: ProgressPayload): void {
		this.emit({
			type: 'progress',
			status: 'completed',
			elapsedMs: Date.now() - this.phaseStartedAt,
			...payload,
		});
	}

	skipped(payload: ProgressPayload): void {
		this.emit({
			type: 'progress',
			status: 'skipped',
			...payload,
		});
	}

	event(payload: ProgressPayload): void {
		this.emit({
			type: 'progress',
			...payload,
		});
	}

	totalElapsedMs(): number {
		return Date.now() - this.pipelineStartedAt;
	}
}