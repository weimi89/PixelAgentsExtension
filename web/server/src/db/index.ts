// ── Database Module Barrel Export ────────────────────────────────────
export { SCHEMA_VERSION, INITIAL_SCHEMA } from './schema.js';
export { MIGRATIONS, runMigrations } from './migrations.js';
export type { Migration } from './migrations.js';
export {
	Database,
	db,
	initDatabase,
} from './database.js';
export type {
	UserRow,
	PublicUserRow,
	BuildingRow,
	FloorRow,
	AgentAppearanceRow,
} from './database.js';
export { migrateFromJson } from './jsonMigration.js';

// ── Redis ────────────────────────────────────────────────────────────
export { redis, initRedis } from './redis.js';
export {
	cacheAgentState,
	getCachedAgentState,
	clearAgentCache,
	cacheJwtPayload,
	getCachedJwtPayload,
	incrementToolCallRedis,
	getRedisToolStats,
} from './redisCache.js';
export {
	publishFloorEvent,
	subscribeFloorEvents,
	publishAgentEvent,
	subscribeAgentEvents,
	publishGlobalEvent,
	getServerId,
} from './redisPubSub.js';
export {
	acquireLock,
	releaseLock,
	withLock,
} from './redisLock.js';
