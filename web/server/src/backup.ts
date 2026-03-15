import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
	BACKUP_INTERVAL_MS,
	BACKUP_MAX_KEEP,
	BACKUP_DIR_NAME,
	LAYOUT_FILE_DIR,
	FLOOR_LAYOUT_DIR,
	AUDIT_LOG_FILE_NAME,
} from './constants.js';

/** 不備份的檔案（過大或敏感） */
const EXCLUDED_FILES = new Set([
	AUDIT_LOG_FILE_NAME,
	'node-config.json',
]);

let backupTimer: ReturnType<typeof setInterval> | null = null;

/** 取得預設資料目錄 */
function getDefaultDataDir(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR);
}

/** 取得預設備份目錄 */
function getDefaultBackupDir(): string {
	return path.join(getDefaultDataDir(), BACKUP_DIR_NAME);
}

/** 產生 YYYYMMDD-HHMMSS 格式的時間戳 */
function formatTimestamp(date: Date): string {
	const y = date.getFullYear();
	const mo = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	const h = String(date.getHours()).padStart(2, '0');
	const mi = String(date.getMinutes()).padStart(2, '0');
	const s = String(date.getSeconds()).padStart(2, '0');
	return `${y}${mo}${d}-${h}${mi}${s}`;
}

/** 遞迴複製目錄 */
async function copyDir(src: string, dest: string): Promise<void> {
	await fs.mkdir(dest, { recursive: true });
	const entries = await fs.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath);
		} else {
			await fs.copyFile(srcPath, destPath);
		}
	}
}

/**
 * 執行一次備份。
 * 複製 dataDir 中的 .json 檔案（排除敏感/過大檔案）和 floors/ 目錄。
 */
export async function runBackupNow(
	dataDir?: string,
	backupDir?: string,
): Promise<string | null> {
	const resolvedDataDir = dataDir ?? getDefaultDataDir();
	const resolvedBackupDir = backupDir ?? getDefaultBackupDir();

	try {
		// 確認資料目錄存在
		await fs.access(resolvedDataDir);
	} catch {
		console.warn('[Backup] Data directory does not exist, skipping backup:', resolvedDataDir);
		return null;
	}

	const timestamp = formatTimestamp(new Date());
	const targetDir = path.join(resolvedBackupDir, timestamp);

	try {
		await fs.mkdir(targetDir, { recursive: true });

		// 複製 .json 檔案（排除清單中的檔案）
		const entries = await fs.readdir(resolvedDataDir, { withFileTypes: true });
		let copiedCount = 0;

		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith('.json')) continue;
			if (EXCLUDED_FILES.has(entry.name)) continue;

			const srcPath = path.join(resolvedDataDir, entry.name);
			const destPath = path.join(targetDir, entry.name);
			await fs.copyFile(srcPath, destPath);
			copiedCount++;
		}

		// 複製 floors/ 目錄
		const floorsDir = path.join(resolvedDataDir, FLOOR_LAYOUT_DIR);
		try {
			await fs.access(floorsDir);
			await copyDir(floorsDir, path.join(targetDir, FLOOR_LAYOUT_DIR));
			console.log(`[Backup] Copied ${FLOOR_LAYOUT_DIR}/ directory`);
		} catch {
			// floors/ 可能不存在，跳過
		}

		console.log(`[Backup] Created backup: ${timestamp} (${copiedCount} json files)`);

		// 清理過舊的備份
		await pruneOldBackups(resolvedBackupDir);

		return targetDir;
	} catch (err) {
		console.error('[Backup] Failed to create backup:', err);
		return null;
	}
}

/** 保留最近 N 個備份，刪除最舊的 */
async function pruneOldBackups(backupDir: string): Promise<void> {
	try {
		const entries = await fs.readdir(backupDir, { withFileTypes: true });
		const dirs = entries
			.filter((e) => e.isDirectory())
			// 只匹配 YYYYMMDD-HHMMSS 格式
			.filter((e) => /^\d{8}-\d{6}$/.test(e.name))
			.map((e) => e.name)
			.sort();

		if (dirs.length <= BACKUP_MAX_KEEP) return;

		const toRemove = dirs.slice(0, dirs.length - BACKUP_MAX_KEEP);
		for (const dir of toRemove) {
			const fullPath = path.join(backupDir, dir);
			await fs.rm(fullPath, { recursive: true, force: true });
			console.log(`[Backup] Pruned old backup: ${dir}`);
		}
	} catch (err) {
		console.error('[Backup] Failed to prune old backups:', err);
	}
}

/**
 * 啟動自動備份計時器。
 * 首次備份在啟動後延遲 intervalMs 執行（避免影響啟動速度）。
 */
export function startAutoBackup(
	dataDir?: string,
	backupDir?: string,
	intervalMs?: number,
): void {
	if (backupTimer) {
		console.warn('[Backup] Auto backup already running');
		return;
	}

	const interval = intervalMs ?? BACKUP_INTERVAL_MS;
	const resolvedDataDir = dataDir ?? getDefaultDataDir();
	const resolvedBackupDir = backupDir ?? getDefaultBackupDir();

	console.log(`[Backup] Auto backup enabled (interval: ${Math.round(interval / 3_600_000 * 10) / 10}h, dir: ${resolvedBackupDir})`);

	backupTimer = setInterval(() => {
		runBackupNow(resolvedDataDir, resolvedBackupDir).catch((err) => {
			console.error('[Backup] Auto backup failed:', err);
		});
	}, interval);

	// 不阻止進程退出
	backupTimer.unref();
}

/** 停止自動備份計時器 */
export function stopAutoBackup(): void {
	if (backupTimer) {
		clearInterval(backupTimer);
		backupTimer = null;
		console.log('[Backup] Auto backup stopped');
	}
}
