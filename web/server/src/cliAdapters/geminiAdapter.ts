import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { CLIAdapter } from './index.js';

const binaryPath = (() => {
	try {
		return execSync('which gemini', { encoding: 'utf-8' }).trim();
	} catch {
		return 'gemini';
	}
})();

export const geminiAdapter: CLIAdapter = {
	name: 'gemini',

	getProjectsRoot() {
		return path.join(os.homedir(), '.gemini', 'projects');
	},

	isAvailable() {
		try {
			execSync('which gemini', { stdio: 'ignore' });
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
			if (key.startsWith('GEMINI') || key.startsWith('GOOGLE')) {
				delete cleanEnv[key];
			}
		}
		return cleanEnv;
	},

	ignoredDirPatterns() {
		return [];
	},
};
