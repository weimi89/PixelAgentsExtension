import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BuildingConfig, FloorId } from './types.js';
import { LAYOUT_FILE_DIR, PROJECT_FLOOR_MAP_FILE_NAME, DEFAULT_FLOOR_ID } from './constants.js';
import { atomicWriteJson } from './atomicWrite.js';
import { db } from './db/database.js';

const userDir = path.join(os.homedir(), LAYOUT_FILE_DIR);

function getMapFilePath(): string {
	return path.join(userDir, PROJECT_FLOOR_MAP_FILE_NAME);
}

/** 讀取專案 → 樓層映射 */
export function readProjectFloorMap(): Record<string, FloorId> {
	if (db) {
		return db.listProjectFloorMap();
	}
	try {
		const filePath = getMapFilePath();
		if (!fs.existsSync(filePath)) return {};
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, FloorId>;
	} catch {
		return {};
	}
}

/** 寫入專案 → 樓層映射（僅非 DB 模式使用） */
export function writeProjectFloorMap(map: Record<string, FloorId>): void {
	try {
		atomicWriteJson(getMapFilePath(), map);
	} catch (err) {
		console.error('[Pixel Agents] Failed to write project floor map:', err);
	}
}

/** 設定特定專案的樓層映射 */
export function setProjectFloor(projectDir: string, floorId: FloorId): void {
	const key = path.basename(projectDir);
	if (db) {
		db.setProjectFloor(key, floorId);
		return;
	}
	const map = readProjectFloorMap();
	map[key] = floorId;
	writeProjectFloorMap(map);
}

/** 解析專案所屬的樓層（查映射，無則回傳預設樓層） */
export function resolveFloorForProject(projectDir: string, _building: BuildingConfig): FloorId {
	const key = path.basename(projectDir);
	if (db) {
		return db.getProjectFloor(key) ?? DEFAULT_FLOOR_ID;
	}
	const map = readProjectFloorMap();
	return map[key] || DEFAULT_FLOOR_ID;
}
