import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME } from './constants.js';

function getLayoutFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
	const filePath = getLayoutFilePath();
	try {
		if (!fs.existsSync(filePath)) return null;
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		console.error('[Pixel Agents] Failed to read layout file:', err);
		return null;
	}
}

export function writeLayoutToFile(layout: Record<string, unknown>): void {
	const filePath = getLayoutFilePath();
	const dir = path.dirname(filePath);
	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const json = JSON.stringify(layout, null, 2);
		const tmpPath = filePath + '.tmp';
		fs.writeFileSync(tmpPath, json, 'utf-8');
		fs.renameSync(tmpPath, filePath);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write layout file:', err);
	}
}

/**
 * Load layout: file first, then fall back to default layout.
 * No VS Code workspace state migration needed in web version.
 */
export function loadLayout(
	defaultLayout?: Record<string, unknown> | null,
): Record<string, unknown> | null {
	const fromFile = readLayoutFromFile();
	if (fromFile) {
		console.log('[Pixel Agents] Layout loaded from file');
		return fromFile;
	}

	if (defaultLayout) {
		console.log('[Pixel Agents] Writing bundled default layout to file');
		writeLayoutToFile(defaultLayout);
		return defaultLayout;
	}

	return null;
}
