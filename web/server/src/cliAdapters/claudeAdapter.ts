import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { CLIAdapter } from './index.js';
import { IGNORED_PROJECT_DIR_PATTERNS } from '../constants.js';

const binaryPath = (() => {
	try {
		return execSync('which claude', { encoding: 'utf-8' }).trim();
	} catch {
		return 'claude';
	}
})();

export const claudeAdapter: CLIAdapter = {
	name: 'claude',

	getProjectsRoot() {
		return path.join(os.homedir(), '.claude', 'projects');
	},

	isAvailable() {
		try {
			execSync('which claude', { stdio: 'ignore' });
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
			if (key.startsWith('CLAUDE')) {
				delete cleanEnv[key];
			}
		}
		return cleanEnv;
	},

	ignoredDirPatterns() {
		return [...IGNORED_PROJECT_DIR_PATTERNS];
	},
};
