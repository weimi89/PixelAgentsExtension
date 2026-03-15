import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME } from './constants.js';
import { atomicWriteJson } from './atomicWrite.js';
import { db } from './db/database.js';

/** 舊版 layout.json 的 settings key（用作 DB 備份） */
const LEGACY_LAYOUT_KEY = 'legacy_layout';

function getLayoutFilePath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
	// 優先從 DB settings 讀取（舊版佈局備份）
	if (db) {
		const raw = db.getSetting(LEGACY_LAYOUT_KEY);
		if (raw) {
			try {
				return JSON.parse(raw) as Record<string, unknown>;
			} catch {
				// 忽略解析錯誤，回退至檔案
			}
		}
	}

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
	// 寫入 DB（若可用）
	if (db) {
		try {
			db.setSetting(LEGACY_LAYOUT_KEY, JSON.stringify(layout));
		} catch (err) {
			console.error('[Pixel Agents] Failed to write layout to DB:', err);
		}
	}

	// 同時寫入檔案作為備份
	try {
		atomicWriteJson(getLayoutFilePath(), layout);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write layout file:', err);
	}
}

/**
 * 載入佈局：優先從檔案載入，然後回退至預設佈局。
 * Web 版本不需要 VS Code 工作區狀態遷移。
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
