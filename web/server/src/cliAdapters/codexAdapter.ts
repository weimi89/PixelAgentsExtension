import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { CLIAdapter } from './index.js';

const binaryPath = (() => {
	try {
		return execSync('which codex', { encoding: 'utf-8' }).trim();
	} catch {
		return 'codex';
	}
})();

export const codexAdapter: CLIAdapter = {
	name: 'codex',

	getProjectsRoot() {
		return path.join(os.homedir(), '.codex', 'projects');
	},

	isAvailable() {
		try {
			execSync('which codex', { stdio: 'ignore' });
			return true;
		} catch {
			return false;
		}
	},

	getBinaryPath() {
		return binaryPath;
	},

	buildResumeArgs(sessionId: string) {
		return ['--resume', sessionId];
	},

	buildCleanEnv() {
		const cleanEnv = { ...process.env };
		for (const key of Object.keys(cleanEnv)) {
			if (key.startsWith('CODEX') || key.startsWith('OPENAI')) {
				delete cleanEnv[key];
			}
		}
		return cleanEnv;
	},

	ignoredDirPatterns() {
		return [];
	},
};
