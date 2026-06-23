import ConfigManager, { ExploreRerankConfig, ExploreThinkingConfig, ExploreAdaptiveConfig, ExploreScanConfig } from '../../config/ConfigManager.js';
import { debugLog } from '../logger.js';
import { DEFAULT_IGNORE_DIRS } from './constants.js';
import type { ExploreOptions } from './types.js';
import { truncate } from './text-utils.js';

export function resolveExploreOptions(searchInput?: string): ExploreOptions {
	let rerankConfig: ExploreRerankConfig | null = null;
	let thinkingConfig: ExploreThinkingConfig = { worker: 'default', synthesis: 'default' };
	let adaptiveConfig: ExploreAdaptiveConfig = {};
	let scanConfig: Required<ExploreScanConfig> = {
		maxFiles: 60000,
		recentFirst: true,
		multiRepoMinDirs: 8,
		perRepoMaxFiles: 1500,
		ignoreDirs: [...DEFAULT_IGNORE_DIRS],
		honorGitignore: true,
	};

	try {
		const manager = new ConfigManager();
		rerankConfig = manager.getExploreRerankConfig();
		thinkingConfig = manager.getExploreThinkingConfig();
		adaptiveConfig = manager.getExploreAdaptiveConfig();
		scanConfig = manager.getExploreScanConfig();
	} catch (error) {
		debugLog('Failed to load explore config:', error);
	}

	const rerankPlan = rerankConfig && rerankConfig.model && rerankConfig.apiKey && searchInput
		? { config: rerankConfig, query: truncate(searchInput.replace(/\s+/g, ' '), 4000) }
		: null;

	return {
		rerankPlan,
		thinkingPlan: {
			worker: thinkingConfig.worker ?? 'default',
			synthesis: thinkingConfig.synthesis ?? 'default',
		},
		adaptiveConfig,
		scanConfig,
	};
}

export function thinkingExtraBody(mode: ExploreThinkingConfig['worker'] | ExploreThinkingConfig['synthesis'] | undefined): Record<string, unknown> | undefined {
	if (mode === 'disabled') {
		return { thinking: { type: 'disabled' } };
	}
	return undefined;
}