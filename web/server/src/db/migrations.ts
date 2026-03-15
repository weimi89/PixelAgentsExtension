// ── SQLite Migration System ─────────────────────────────────────────
import type BetterSqlite3 from 'better-sqlite3';
import { SCHEMA_VERSION, INITIAL_SCHEMA } from './schema.js';

export interface Migration {
	version: number;
	up: string;
	description: string;
}

/**
 * Migration registry. Each entry's `up` SQL is executed inside a transaction.
 * Version numbers MUST be sequential starting from 1.
 */
export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		up: INITIAL_SCHEMA,
		description: 'Initial schema: all core tables and indexes',
	},
	// Future migrations go here:
	// { version: 2, up: 'ALTER TABLE ...', description: '...' },
];

/**
 * Returns the current schema version stored in the database.
 * Returns 0 if the schema_version table does not exist yet.
 */
function getCurrentVersion(db: BetterSqlite3.Database): number {
	try {
		const row = db.prepare(
			`SELECT MAX(version) AS version FROM schema_version`,
		).get() as { version: number | null } | undefined;
		return row?.version ?? 0;
	} catch {
		// Table does not exist yet
		return 0;
	}
}

/**
 * Apply all pending migrations in order.
 * Each migration is wrapped in a transaction for atomicity.
 */
export function runMigrations(db: BetterSqlite3.Database): void {
	const current = getCurrentVersion(db);

	if (current >= SCHEMA_VERSION) {
		return; // Already up to date
	}

	const pending = MIGRATIONS.filter(m => m.version > current);
	if (pending.length === 0) return;

	console.log(
		`[DB] Running ${pending.length} migration(s): v${current} -> v${SCHEMA_VERSION}`,
	);

	for (const migration of pending) {
		const applyMigration = db.transaction(() => {
			db.exec(migration.up);
			db.prepare(
				`INSERT OR REPLACE INTO schema_version (version) VALUES (?)`,
			).run(migration.version);
		});

		applyMigration();
		console.log(
			`[DB] Applied migration v${migration.version}: ${migration.description}`,
		);
	}
}
