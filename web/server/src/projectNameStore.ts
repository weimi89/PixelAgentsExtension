import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, PROJECT_NAMES_FILE_NAME, EXCLUDED_PROJECTS_FILE_NAME } from './constants.js';
import { atomicWriteJson } from './atomicWrite.js';
import { db } from './db/database.js';

function getFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, PROJECT_NAMES_FILE_NAME);
}

export function readProjectNames(): Record<string, string> {
	if (db) {
		return db.listProjectNames();
	}
	try {
		const filePath = getFilePath();
		if (!fs.existsSync(filePath)) return {};
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, string>;
	} catch {
		return {};
	}
}

function writeProjectNames(map: Record<string, string>): void {
	try {
		atomicWriteJson(getFilePath(), map);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write project names:', err);
	}
}

export function getCustomName(projectDir: string): string | undefined {
	const key = path.basename(projectDir);
	if (db) {
		return db.getProjectName(key);
	}
	const map = readProjectNames();
	return map[key];
}

export function setCustomName(projectDir: string, name: string): void {
	const key = path.basename(projectDir);
	if (db) {
		db.setProjectName(key, name);
		return;
	}
	const map = readProjectNames();
	map[key] = name;
	writeProjectNames(map);
}

// ── 排除專案清單 ──────────────────────────────────────

function getExcludedFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, EXCLUDED_PROJECTS_FILE_NAME);
}

export function readExcludedProjects(): string[] {
	if (db) {
		return db.listExcludedProjects();
	}
	try {
		const filePath = getExcludedFilePath();
		if (!fs.existsSync(filePath)) return [];
		const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

function writeExcludedProjects(list: string[]): void {
	try {
		atomicWriteJson(getExcludedFilePath(), list);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write excluded projects:', err);
	}
}

export function addExcludedProject(projectDir: string): void {
	const key = path.basename(projectDir);
	if (db) {
		db.addExcludedProject(key);
		return;
	}
	const list = readExcludedProjects();
	if (!list.includes(key)) {
		list.push(key);
		writeExcludedProjects(list);
	}
}

export function removeExcludedProject(projectDir: string): void {
	const key = path.basename(projectDir);
	if (db) {
		db.removeExcludedProject(key);
		return;
	}
	const list = readExcludedProjects();
	const idx = list.indexOf(key);
	if (idx !== -1) {
		list.splice(idx, 1);
		writeExcludedProjects(list);
	}
}

export function isProjectExcluded(projectDir: string): boolean {
	const key = path.basename(projectDir);
	if (db) {
		return db.listExcludedProjects().includes(key);
	}
	return readExcludedProjects().includes(key);
}
