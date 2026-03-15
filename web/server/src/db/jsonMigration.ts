// ── JSON -> SQLite Migration Script ─────────────────────────────────
//
// Reads existing JSON persistence files from ~/.pixel-agents/ and imports
// them into the SQLite database. Only runs if the DB is empty (no users,
// no building row) AND no .migrated marker exists. Wrapped in a single
// transaction for atomicity.
//

import * as fs from 'fs';
import * as path from 'path';
import type { Database } from './database.js';

/** Safely read and parse a JSON file, returning undefined on failure. */
function readJson<T>(filePath: string): T | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return undefined;
	}
}

/** Safely read a text file, returning undefined on failure. */
function readText(filePath: string): string | undefined {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		return fs.readFileSync(filePath, 'utf-8').trim();
	} catch {
		return undefined;
	}
}

// ── JSON file type interfaces (matching existing formats) ────────────

interface StoredUserJson {
	id: string;
	username: string;
	passwordHash: string;
	createdAt: string;
	mustChangePassword?: boolean;
	role?: 'admin' | 'viewer';
}

interface UsersDataJson {
	users: StoredUserJson[];
}

interface FloorConfigJson {
	id: string;
	name: string;
	order: number;
}

interface BuildingConfigJson {
	version: 1;
	defaultFloorId: string;
	floors: FloorConfigJson[];
}

interface PersistedAgentJson {
	id: number;
	sessionId: string;
	jsonlFile: string;
	projectDir: string;
	palette?: number;
	hueShift?: number;
	seatId?: string;
	tmuxSessionName?: string;
	floorId?: string;
	cliType?: string;
	xp?: number;
	toolCallCount?: number;
	sessionCount?: number;
	bashCallCount?: number;
	achievements?: string[];
}

interface DashboardStatsJson {
	totalToolCalls: number;
	toolDistribution: Record<string, number>;
}

/**
 * Migrate data from JSON files to SQLite.
 *
 * @param database - The Database instance (already initialized with schema)
 * @param dataDir  - The ~/.pixel-agents/ directory path
 * @returns true if migration was performed, false if skipped
 */
export function migrateFromJson(database: Database, dataDir: string): boolean {
	const markerPath = path.join(dataDir, '.migrated');

	// Skip if already migrated
	if (fs.existsSync(markerPath)) {
		console.log('[DB Migration] Marker file found, skipping JSON migration');
		return false;
	}

	// Skip if DB already has data (users or building)
	const existingUsers = database.listUsers();
	const existingBuilding = database.getBuilding();
	if (existingUsers.length > 0 || existingBuilding) {
		console.log('[DB Migration] Database already has data, skipping JSON migration');
		return false;
	}

	// Check if any JSON files exist at all
	const hasAnyJsonFiles = [
		'users.json', 'building.json', 'agents.json', 'settings.json',
		'project-names.json', 'excluded-projects.json', 'project-floor-map.json',
		'team-names.json', 'jwt-secret.key',
	].some(f => fs.existsSync(path.join(dataDir, f)));

	if (!hasAnyJsonFiles) {
		console.log('[DB Migration] No JSON files found, nothing to migrate');
		return false;
	}

	console.log('[DB Migration] Starting JSON -> SQLite migration...');

	const rawDb = database.raw;
	const migrate = rawDb.transaction(() => {
		let count = 0;

		// ── 1. JWT Secret ────────────────────────────────────────
		const jwtSecret = readText(path.join(dataDir, 'jwt-secret.key'));
		if (jwtSecret) {
			database.setSetting('jwt_secret', jwtSecret);
			count++;
			console.log('[DB Migration]   jwt-secret.key -> settings.jwt_secret');
		}

		// ── 2. Users ─────────────────────────────────────────────
		const usersData = readJson<UsersDataJson>(path.join(dataDir, 'users.json'));
		if (usersData?.users?.length) {
			const stmt = rawDb.prepare(
				`INSERT OR IGNORE INTO users (id, username, password_hash, role, must_change_password, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			);
			for (const u of usersData.users) {
				stmt.run(
					u.id,
					u.username,
					u.passwordHash,
					u.role ?? 'admin',
					u.mustChangePassword ? 1 : 0,
					u.createdAt,
				);
			}
			count += usersData.users.length;
			console.log(`[DB Migration]   users.json -> ${usersData.users.length} user(s)`);
		}

		// ── 3. Building Config ───────────────────────────────────
		const building = readJson<BuildingConfigJson>(path.join(dataDir, 'building.json'));
		if (building) {
			database.saveBuilding(JSON.stringify(building), building.defaultFloorId);
			count++;
			console.log('[DB Migration]   building.json -> building table');

			// ── 4. Floor Layouts ─────────────────────────────────
			const floorsDir = path.join(dataDir, 'floors');
			if (fs.existsSync(floorsDir)) {
				for (const floor of building.floors) {
					const layoutPath = path.join(floorsDir, `${floor.id}.json`);
					const layout = readJson<Record<string, unknown>>(layoutPath);
					if (layout) {
						database.saveFloor(
							floor.id,
							floor.name,
							floor.order,
							JSON.stringify(layout),
						);
						count++;
						console.log(`[DB Migration]   floors/${floor.id}.json -> floors table`);
					}
				}
			}
		}

		// ── 5. Settings ──────────────────────────────────────────
		const settings = readJson<Record<string, unknown>>(path.join(dataDir, 'settings.json'));
		if (settings) {
			// Store each top-level key as a separate setting
			for (const [key, value] of Object.entries(settings)) {
				database.setSetting(key, JSON.stringify(value));
			}
			count += Object.keys(settings).length;
			console.log(`[DB Migration]   settings.json -> ${Object.keys(settings).length} setting(s)`);
		}

		// ── 6. Behavior Settings ─────────────────────────────────
		const behaviorSettings = readJson<Record<string, unknown>>(
			path.join(dataDir, 'behavior-settings.json'),
		);
		if (behaviorSettings) {
			// Store as a single prefixed key
			database.setSetting('behavior_settings', JSON.stringify(behaviorSettings));
			count++;
			console.log('[DB Migration]   behavior-settings.json -> settings.behavior_settings');
		}

		// ── 7. Persisted Agents ──────────────────────────────────
		const agents = readJson<PersistedAgentJson[]>(path.join(dataDir, 'agents.json'));
		if (agents?.length) {
			for (const a of agents) {
				// Use projectDir basename as agent_key for persistence
				const agentKey = path.basename(a.projectDir);
				database.saveAgentAppearance(agentKey, {
					palette: a.palette ?? 0,
					hueShift: a.hueShift ?? 0,
					seatId: a.seatId ?? null,
					floorId: a.floorId ?? '1F',
					cliType: a.cliType ?? 'claude',
					xp: a.xp ?? 0,
					toolCallCount: a.toolCallCount ?? 0,
					sessionCount: a.sessionCount ?? 0,
					bashCallCount: a.bashCallCount ?? 0,
					achievements: a.achievements ?? [],
				});
			}
			count += agents.length;
			console.log(`[DB Migration]   agents.json -> ${agents.length} agent appearance(s)`);
		}

		// ── 8. Project Names ─────────────────────────────────────
		const projectNames = readJson<Record<string, string>>(
			path.join(dataDir, 'project-names.json'),
		);
		if (projectNames) {
			const stmt = rawDb.prepare(
				`INSERT OR IGNORE INTO project_names (dir_basename, display_name) VALUES (?, ?)`,
			);
			for (const [basename, name] of Object.entries(projectNames)) {
				stmt.run(basename, name);
			}
			count += Object.keys(projectNames).length;
			console.log(`[DB Migration]   project-names.json -> ${Object.keys(projectNames).length} name(s)`);
		}

		// ── 9. Excluded Projects ─────────────────────────────────
		const excluded = readJson<string[]>(
			path.join(dataDir, 'excluded-projects.json'),
		);
		if (excluded?.length) {
			const stmt = rawDb.prepare(
				`INSERT OR IGNORE INTO excluded_projects (dir_basename) VALUES (?)`,
			);
			for (const basename of excluded) {
				stmt.run(basename);
			}
			count += excluded.length;
			console.log(`[DB Migration]   excluded-projects.json -> ${excluded.length} exclusion(s)`);
		}

		// ── 10. Project Floor Map ────────────────────────────────
		const floorMap = readJson<Record<string, string>>(
			path.join(dataDir, 'project-floor-map.json'),
		);
		if (floorMap) {
			const stmt = rawDb.prepare(
				`INSERT OR IGNORE INTO project_floor_map (project_key, floor_id) VALUES (?, ?)`,
			);
			for (const [key, floorId] of Object.entries(floorMap)) {
				stmt.run(key, floorId);
			}
			count += Object.keys(floorMap).length;
			console.log(`[DB Migration]   project-floor-map.json -> ${Object.keys(floorMap).length} mapping(s)`);
		}

		// ── 11. Team Names ───────────────────────────────────────
		const teamNames = readJson<Record<string, string>>(
			path.join(dataDir, 'team-names.json'),
		);
		if (teamNames) {
			const stmt = rawDb.prepare(
				`INSERT OR IGNORE INTO team_names (agent_key, team_name) VALUES (?, ?)`,
			);
			for (const [key, name] of Object.entries(teamNames)) {
				stmt.run(key, name);
			}
			count += Object.keys(teamNames).length;
			console.log(`[DB Migration]   team-names.json -> ${Object.keys(teamNames).length} team name(s)`);
		}

		// ── 12. Dashboard Stats ──────────────────────────────────
		const dashStats = readJson<DashboardStatsJson>(
			path.join(dataDir, 'dashboard-stats.json'),
		);
		if (dashStats) {
			// Store the total and distribution as settings for reference.
			// We don't expand distribution into individual tool_stats rows
			// because that could create millions of rows. Instead the stats
			// are stored as settings for the dashboard to merge with live data.
			database.setSetting('migrated_total_tool_calls', String(dashStats.totalToolCalls));
			database.setSetting('migrated_tool_distribution', JSON.stringify(dashStats.toolDistribution));
			count++;
			console.log(`[DB Migration]   dashboard-stats.json -> settings (aggregated stats preserved)`);
		}

		console.log(`[DB Migration] Migration complete: ${count} item(s) imported`);
	});

	try {
		migrate();

		// Write marker file to prevent re-migration
		fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
		console.log('[DB Migration] Marker file written: .migrated');
		return true;
	} catch (err) {
		console.error('[DB Migration] Migration failed (transaction rolled back):', err);
		return false;
	}
}
