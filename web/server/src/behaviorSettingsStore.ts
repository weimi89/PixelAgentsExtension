import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { LAYOUT_FILE_DIR } from './constants.js';
import { atomicWriteJson } from './atomicWrite.js';
import { db } from './db/database.js';

const BEHAVIOR_SETTINGS_FILE = 'behavior-settings.json';
const BEHAVIOR_SETTINGS_DB_KEY = 'behavior_settings';

export interface BehaviorSettings {
	wanderWeightIdleLook: number;
	wanderWeightRandom: number;
	wanderWeightFurniture: number;
	wanderWeightChat: number;
	wanderWeightWall: number;
	wanderWeightMeeting: number;
	wanderWeightReturnSeat: number;
	wanderPauseMin: number;
	wanderPauseMax: number;
	seatRestMin: number;
	seatRestMax: number;
	sleepTrigger: number;
	stretchTrigger: number;
	chatDurationMin: number;
	chatDurationMax: number;
	furnitureCooldown: number;
}

export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettings = {
	wanderWeightIdleLook: 30,
	wanderWeightRandom: 30,
	wanderWeightFurniture: 15,
	wanderWeightChat: 10,
	wanderWeightWall: 10,
	wanderWeightMeeting: 8,
	wanderWeightReturnSeat: 5,
	wanderPauseMin: 3,
	wanderPauseMax: 12,
	seatRestMin: 120,
	seatRestMax: 240,
	sleepTrigger: 300,
	stretchTrigger: 180,
	chatDurationMin: 3,
	chatDurationMax: 8,
	furnitureCooldown: 180,
};

function getBehaviorSettingsPath(): string {
	const dir = join(homedir(), LAYOUT_FILE_DIR);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, BEHAVIOR_SETTINGS_FILE);
}

export function readBehaviorSettings(): BehaviorSettings {
	// 優先從 DB 讀取
	if (db) {
		const raw = db.getSetting(BEHAVIOR_SETTINGS_DB_KEY);
		if (raw) {
			try {
				const data = JSON.parse(raw) as Partial<BehaviorSettings>;
				return { ...DEFAULT_BEHAVIOR_SETTINGS, ...data };
			} catch {
				// 忽略解析錯誤，回退至預設值
			}
		}
		return { ...DEFAULT_BEHAVIOR_SETTINGS };
	}

	// 回退至 JSON 檔案
	const filePath = getBehaviorSettingsPath();
	try {
		const data = JSON.parse(readFileSync(filePath, 'utf-8'));
		return { ...DEFAULT_BEHAVIOR_SETTINGS, ...data };
	} catch {
		return { ...DEFAULT_BEHAVIOR_SETTINGS };
	}
}

export function writeBehaviorSettings(settings: Partial<BehaviorSettings>): BehaviorSettings {
	const merged = { ...DEFAULT_BEHAVIOR_SETTINGS, ...settings };

	// 寫入 DB（若可用）
	if (db) {
		db.setSetting(BEHAVIOR_SETTINGS_DB_KEY, JSON.stringify(merged));
		return merged;
	}

	// 回退至 JSON 檔案
	atomicWriteJson(getBehaviorSettingsPath(), merged);
	return merged;
}
