import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../src/db/database.js';

describe('Database (in-memory SQLite)', () => {
	let database: Database;

	beforeEach(() => {
		database = new Database(':memory:');
	});

	afterEach(() => {
		database.close();
	});

	// ── Settings ──────────────────────────────────────────────

	describe('settings', () => {
		it('returns undefined for missing key', () => {
			expect(database.getSetting('nonexistent')).toBeUndefined();
		});

		it('stores and retrieves a setting', () => {
			database.setSetting('theme', 'dark');
			expect(database.getSetting('theme')).toBe('dark');
		});

		it('overwrites existing setting', () => {
			database.setSetting('theme', 'dark');
			database.setSetting('theme', 'light');
			expect(database.getSetting('theme')).toBe('light');
		});
	});

	// ── Users ─────────────────────────────────────────────────

	describe('users', () => {
		it('creates and retrieves user by username', () => {
			database.createUser({
				id: 'u1',
				username: 'alice',
				passwordHash: '$2a$10$hash',
				role: 'admin',
				mustChangePassword: false,
			});
			const user = database.getUserByUsername('alice');
			expect(user).toBeDefined();
			expect(user!.username).toBe('alice');
			expect(user!.role).toBe('admin');
			expect(user!.must_change_password).toBe(0);
		});

		it('retrieves user by id', () => {
			database.createUser({
				id: 'u2',
				username: 'bob',
				passwordHash: '$2a$10$hash',
				role: 'viewer',
				mustChangePassword: true,
			});
			const user = database.getUserById('u2');
			expect(user).toBeDefined();
			expect(user!.username).toBe('bob');
			expect(user!.must_change_password).toBe(1);
		});

		it('returns undefined for missing user', () => {
			expect(database.getUserByUsername('nobody')).toBeUndefined();
			expect(database.getUserById('x')).toBeUndefined();
		});

		it('lists users without password hash', () => {
			database.createUser({ id: 'u1', username: 'a', passwordHash: 'secret', role: 'admin', mustChangePassword: false });
			database.createUser({ id: 'u2', username: 'b', passwordHash: 'secret', role: 'viewer', mustChangePassword: false });
			const list = database.listUsers();
			expect(list).toHaveLength(2);
			// PublicUserRow should not have password_hash
			expect((list[0] as Record<string, unknown>)['password_hash']).toBeUndefined();
		});

		it('updates password', () => {
			database.createUser({ id: 'u1', username: 'alice', passwordHash: 'old', role: 'admin', mustChangePassword: false });
			database.updateUserPassword('alice', 'new');
			const user = database.getUserByUsername('alice');
			expect(user!.password_hash).toBe('new');
		});

		it('clears mustChangePassword flag', () => {
			database.createUser({ id: 'u1', username: 'alice', passwordHash: 'h', role: 'admin', mustChangePassword: true });
			expect(database.getUserByUsername('alice')!.must_change_password).toBe(1);
			database.clearMustChangePassword('alice');
			expect(database.getUserByUsername('alice')!.must_change_password).toBe(0);
		});

		it('updates user role', () => {
			database.createUser({ id: 'u1', username: 'alice', passwordHash: 'h', role: 'admin', mustChangePassword: false });
			database.updateUserRole('u1', 'viewer');
			expect(database.getUserByUsername('alice')!.role).toBe('viewer');
		});

		it('deletes user', () => {
			database.createUser({ id: 'u1', username: 'alice', passwordHash: 'h', role: 'admin', mustChangePassword: false });
			database.deleteUser('u1');
			expect(database.getUserByUsername('alice')).toBeUndefined();
		});

		it('rejects duplicate username', () => {
			database.createUser({ id: 'u1', username: 'alice', passwordHash: 'h', role: 'admin', mustChangePassword: false });
			expect(() => {
				database.createUser({ id: 'u2', username: 'alice', passwordHash: 'h2', role: 'viewer', mustChangePassword: false });
			}).toThrow();
		});
	});

	// ── Building & Floors ─────────────────────────────────────

	describe('building & floors', () => {
		it('returns undefined when no building exists', () => {
			expect(database.getBuilding()).toBeUndefined();
		});

		it('saves and retrieves building config', () => {
			const config = JSON.stringify({ version: 1, defaultFloorId: '1F', floors: [] });
			database.saveBuilding(config);
			const row = database.getBuilding();
			expect(row).toBeDefined();
			expect(row!.config).toBe(config);
		});

		it('saves and retrieves floor', () => {
			const layout = JSON.stringify({ version: 1, cols: 20, rows: 11, tiles: [] });
			database.saveFloor('1F', 'Ground Floor', 1, layout);
			const floor = database.getFloor('1F');
			expect(floor).toBeDefined();
			expect(floor!.name).toBe('Ground Floor');
			expect(floor!.layout).toBe(layout);
		});

		it('lists all floors sorted by order', () => {
			database.saveFloor('2F', 'Second', 2, '{}');
			database.saveFloor('1F', 'First', 1, '{}');
			const floors = database.listFloors();
			expect(floors).toHaveLength(2);
			expect(floors[0].id).toBe('1F');
			expect(floors[1].id).toBe('2F');
		});

		it('deletes floor', () => {
			database.saveFloor('1F', 'First', 1, '{}');
			database.deleteFloor('1F');
			expect(database.getFloor('1F')).toBeUndefined();
		});

		it('updates existing floor', () => {
			database.saveFloor('1F', 'Old Name', 1, '{}');
			database.saveFloor('1F', 'New Name', 1, '{"updated":true}');
			const floor = database.getFloor('1F');
			expect(floor!.name).toBe('New Name');
			expect(floor!.layout).toBe('{"updated":true}');
		});
	});

	// ── Agent Appearances ─────────────────────────────────────

	describe('agent appearances', () => {
		it('saves and retrieves agent appearance', () => {
			database.saveAgentAppearance('agent-1', {
				palette: 2,
				hueShift: 45,
				seatId: 'chair-1',
				floorId: '1F',
				cliType: 'claude',
				xp: 100,
				toolCallCount: 50,
				sessionCount: 3,
				bashCallCount: 10,
				achievements: ['first_tool'],
			});
			const row = database.getAgentAppearance('agent-1');
			expect(row).toBeDefined();
			expect(row!.palette).toBe(2);
			expect(row!.hue_shift).toBe(45);
			expect(row!.xp).toBe(100);
			expect(JSON.parse(row!.achievements)).toContain('first_tool');
		});

		it('lists all agent appearances', () => {
			database.saveAgentAppearance('a1', { palette: 0, hueShift: 0, seatId: null, floorId: '1F', cliType: 'claude', xp: 0, toolCallCount: 0, sessionCount: 0, bashCallCount: 0, achievements: [] });
			database.saveAgentAppearance('a2', { palette: 1, hueShift: 0, seatId: null, floorId: '2F', cliType: 'codex', xp: 0, toolCallCount: 0, sessionCount: 0, bashCallCount: 0, achievements: [] });
			expect(database.listAgentAppearances()).toHaveLength(2);
		});
	});

	// ── Project Names & Exclusions ────────────────────────────

	describe('project names', () => {
		it('sets and gets project name', () => {
			database.setProjectName('my-project', 'My Cool Project');
			expect(database.getProjectName('my-project')).toBe('My Cool Project');
		});

		it('returns undefined for unknown project', () => {
			expect(database.getProjectName('unknown')).toBeUndefined();
		});

		it('lists all project names', () => {
			database.setProjectName('a', 'Alpha');
			database.setProjectName('b', 'Beta');
			const names = database.listProjectNames();
			expect(names['a']).toBe('Alpha');
			expect(names['b']).toBe('Beta');
		});
	});

	describe('excluded projects', () => {
		it('adds and lists excluded projects', () => {
			database.addExcludedProject('unwanted');
			database.addExcludedProject('temp');
			expect(database.listExcludedProjects()).toContain('unwanted');
			expect(database.listExcludedProjects()).toContain('temp');
		});

		it('removes excluded project', () => {
			database.addExcludedProject('temp');
			database.removeExcludedProject('temp');
			expect(database.listExcludedProjects()).not.toContain('temp');
		});

		it('handles duplicate add gracefully', () => {
			database.addExcludedProject('x');
			database.addExcludedProject('x'); // should not throw
			expect(database.listExcludedProjects().filter(p => p === 'x')).toHaveLength(1);
		});
	});

	// ── Project Floor Map ─────────────────────────────────────

	describe('project floor map', () => {
		it('sets and gets project floor', () => {
			database.setProjectFloor('proj-hash', '2F');
			expect(database.getProjectFloor('proj-hash')).toBe('2F');
		});

		it('lists all mappings', () => {
			database.setProjectFloor('a', '1F');
			database.setProjectFloor('b', '2F');
			const map = database.listProjectFloorMap();
			expect(map['a']).toBe('1F');
			expect(map['b']).toBe('2F');
		});
	});

	// ── Tool Stats ────────────────────────────────────────────

	describe('tool stats', () => {
		it('increments and retrieves stats', () => {
			database.incrementToolStat('Read', 'agent-1', '1F');
			database.incrementToolStat('Read', 'agent-1', '1F');
			database.incrementToolStat('Bash', 'agent-2', '1F');
			const stats = database.getToolStats();
			expect(stats.totalCalls).toBe(3);
			expect(stats.toolCounts['Read']).toBe(2);
			expect(stats.toolCounts['Bash']).toBe(1);
		});

		it('returns zero stats when empty', () => {
			const stats = database.getToolStats();
			expect(stats.totalCalls).toBe(0);
			expect(Object.keys(stats.toolCounts)).toHaveLength(0);
		});
	});

	// ── Agent History ─────────────────────────────────────────

	describe('agent history', () => {
		it('adds history entries', () => {
			database.addAgentHistory('agent-1', 'online', 'Project X');
			database.addAgentHistory('agent-1', 'offline');
			// No getter exposed yet, but should not throw
		});
	});

	// ── Audit Log ─────────────────────────────────────────────

	describe('audit log', () => {
		it('adds audit entries', () => {
			database.addAuditEntry('login', 'u1', 'success', '127.0.0.1');
			database.addAuditEntry('login_failed', undefined, 'bad password');
			// No getter exposed yet, but should not throw
		});
	});

	// ── Close ─────────────────────────────────────────────────

	describe('close', () => {
		it('can be called multiple times without error', () => {
			database.close();
			// Second close should not throw
		});
	});
});
