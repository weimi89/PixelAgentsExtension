import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, TEAM_NAMES_FILE_NAME } from './constants.js';
import { atomicWriteJson } from './atomicWrite.js';

function getFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, TEAM_NAMES_FILE_NAME);
}

function readTeamNames(): Record<string, string> {
	try {
		const filePath = getFilePath();
		if (!fs.existsSync(filePath)) return {};
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, string>;
	} catch {
		return {};
	}
}

function writeTeamNames(map: Record<string, string>): void {
	try {
		atomicWriteJson(getFilePath(), map);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write team names:', err);
	}
}

export function getTeamName(projectDir: string): string | null {
	const key = path.basename(projectDir);
	return readTeamNames()[key] ?? null;
}

export function setTeamName(projectDir: string, teamName: string | null): void {
	const key = path.basename(projectDir);
	const map = readTeamNames();
	if (teamName) {
		map[key] = teamName;
	} else {
		delete map[key];
	}
	writeTeamNames(map);
}
