import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import type { AgentState, MessageSender } from './types.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
	loadDefaultLayout,
} from './assetLoader.js';
import type { LoadedAssets, LoadedFloorTiles, LoadedWallTiles, LoadedCharacterSprites } from './assetLoader.js';
import { writeLayoutToFile, loadLayout } from './layoutPersistence.js';
import { launchNewAgent, closeAgent, sendExistingAgents, getAllProjectDirs, resumeSession } from './agentManager.js';
import { scanAllSessions } from './sessionScanner.js';
import { ensureProjectScan } from './fileWatcher.js';
import {
	DEFAULT_PORT,
	LAYOUT_FILE_DIR,
	SETTINGS_FILE_NAME,
	AGENT_SEATS_FILE_NAME,
} from './constants.js';
import { isDemoEnabled, startDemoMode, stopDemoMode } from './demoMode.js';

// ── State ────────────────────────────────────────────────────

const agents = new Map<number, AgentState>();
const nextAgentIdRef = { current: 1 };
const activeAgentIdRef = { current: null as number | null };
const knownJsonlFiles = new Set<string>();
const projectScanTimerRef = { current: null as ReturnType<typeof setInterval> | null };

// Per-agent timers
const fileWatchers = new Map<number, fs.FSWatcher>();
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Loaded assets (cached at startup)
let cachedCharSprites: LoadedCharacterSprites | null = null;
let cachedFloorTiles: LoadedFloorTiles | null = null;
let cachedWallTiles: LoadedWallTiles | null = null;
let cachedFurnitureAssets: LoadedAssets | null = null;
let defaultLayout: Record<string, unknown> | null = null;

// ── Persistence helpers ──────────────────────────────────────

const userDir = path.join(os.homedir(), LAYOUT_FILE_DIR);

function getSettingsPath(): string {
	return path.join(userDir, SETTINGS_FILE_NAME);
}

function getAgentSeatsPath(): string {
	return path.join(userDir, AGENT_SEATS_FILE_NAME);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (!fs.existsSync(filePath)) return fallback;
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return fallback;
	}
}

function writeJsonFile(filePath: string, data: unknown): void {
	try {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
	} catch (err) {
		console.error(`[Pixel Agents] Failed to write ${filePath}:`, err);
	}
}

function persistAgents(): void {
	// For Phase 1 we don't persist agents across restarts
}

// ── Determine working directory ──────────────────────────────

function findGitRoot(startDir: string): string | null {
	let dir = startDir;
	while (true) {
		if (fs.existsSync(path.join(dir, '.git'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

const cwd = process.argv[2] || findGitRoot(process.cwd()) || process.cwd();
console.log(`[Pixel Agents] Working directory: ${cwd}`);

// ── Resolve assets root ──────────────────────────────────────

function findAssetsRoot(): string {
	// Check 1: web/client/public/ (dev mode)
	const clientPublic = path.join(__dirname, '..', '..', 'client', 'public');
	if (fs.existsSync(path.join(clientPublic, 'assets'))) {
		return clientPublic;
	}
	// Check 2: web/client/dist/ (production build)
	const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
	if (fs.existsSync(path.join(clientDist, 'assets'))) {
		return clientDist;
	}
	// Check 3: project root's webview-ui/public/
	const webviewPublic = path.join(__dirname, '..', '..', '..', 'webview-ui', 'public');
	if (fs.existsSync(path.join(webviewPublic, 'assets'))) {
		return webviewPublic;
	}
	// Fallback: current directory
	return cwd;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
	const port = parseInt(process.env['PORT'] || String(DEFAULT_PORT), 10);

	// Load assets
	const assetsRoot = findAssetsRoot();
	console.log(`[Pixel Agents] Assets root: ${assetsRoot}`);

	defaultLayout = loadDefaultLayout(assetsRoot);
	cachedCharSprites = await loadCharacterSprites(assetsRoot);
	cachedFloorTiles = await loadFloorTiles(assetsRoot);
	cachedWallTiles = await loadWallTiles(assetsRoot);
	cachedFurnitureAssets = await loadFurnitureAssets(assetsRoot);

	// Setup Express + Socket.IO
	const app = express();
	const httpServer = createServer(app);
	const io = new Server(httpServer, {
		cors: { origin: '*' },
		maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for large asset payloads
	});

	// Serve client static files (production)
	const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
	if (fs.existsSync(clientDistPath)) {
		app.use(express.static(clientDistPath));
	}

	// Socket.IO connection handler
	io.on('connection', (socket) => {
		console.log(`[Pixel Agents] Client connected: ${socket.id}`);

		const sender: MessageSender = {
			postMessage(msg: unknown) {
				socket.emit('message', msg);
			},
		};

		socket.on('message', (msg: Record<string, unknown>) => {
			handleClientMessage(msg, sender);
		});

		socket.on('disconnect', () => {
			console.log(`[Pixel Agents] Client disconnected: ${socket.id}`);
			if (isDemoEnabled()) {
				stopDemoMode();
			}
		});
	});

	httpServer.listen(port, () => {
		console.log(`\n  Pixel Agents Web running at http://localhost:${port}\n`);
	});
}

function handleClientMessage(msg: Record<string, unknown>, sender: MessageSender): void {
	console.log(`[Pixel Agents] Received message: ${msg.type}`);
	switch (msg.type) {
		case 'webviewReady': {
			// Send assets in sequence
			if (cachedCharSprites) {
				sender.postMessage({
					type: 'characterSpritesLoaded',
					characters: cachedCharSprites.characters,
				});
			}
			if (cachedFloorTiles) {
				sender.postMessage({
					type: 'floorTilesLoaded',
					sprites: cachedFloorTiles.sprites,
				});
			}
			if (cachedWallTiles) {
				sender.postMessage({
					type: 'wallTilesLoaded',
					sprites: cachedWallTiles.sprites,
				});
			}
			if (cachedFurnitureAssets) {
				const spritesObj: Record<string, string[][]> = {};
				for (const [id, spriteData] of cachedFurnitureAssets.sprites) {
					spritesObj[id] = spriteData;
				}
				sender.postMessage({
					type: 'furnitureAssetsLoaded',
					catalog: cachedFurnitureAssets.catalog,
					sprites: spritesObj,
				});
			}

			// Send layout
			const layout = loadLayout(defaultLayout);
			sender.postMessage({ type: 'layoutLoaded', layout });

			// Send settings
			const settings = readJsonFile<{ soundEnabled?: boolean }>(getSettingsPath(), {});
			sender.postMessage({ type: 'settingsLoaded', soundEnabled: settings.soundEnabled ?? true });

			// Send existing agents
			const agentMeta = readJsonFile<Record<string, { palette?: number; hueShift?: number; seatId?: string }>>(
				getAgentSeatsPath(), {},
			);
			sendExistingAgents(agents, agentMeta, sender);

			// Demo mode or real auto-detection
			if (isDemoEnabled()) {
				const demoCount = parseInt(process.env['DEMO_AGENTS'] || '3', 10);
				startDemoMode(sender, demoCount);
			} else {
				// Start project scan — auto-detect running Claude sessions across ALL projects
				const projectDirs = getAllProjectDirs();
				ensureProjectScan(
					projectDirs, knownJsonlFiles, projectScanTimerRef,
					nextAgentIdRef, agents,
					fileWatchers, pollingTimers, waitingTimers, permissionTimers,
					sender, persistAgents,
				);
			}
			break;
		}
		case 'openClaude': {
			launchNewAgent(
				cwd,
				nextAgentIdRef, agents, activeAgentIdRef, knownJsonlFiles,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				jsonlPollTimers,
				sender, persistAgents,
			);
			break;
		}
		case 'closeAgent': {
			const id = msg.id as number;
			closeAgent(
				id, agents,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				jsonlPollTimers, sender, persistAgents,
			);
			break;
		}
		case 'focusAgent': {
			// Web version: just visual selection, no terminal to focus
			break;
		}
		case 'saveAgentSeats': {
			writeJsonFile(getAgentSeatsPath(), msg.seats);
			break;
		}
		case 'saveLayout': {
			writeLayoutToFile(msg.layout as Record<string, unknown>);
			break;
		}
		case 'setSoundEnabled': {
			const current = readJsonFile<Record<string, unknown>>(getSettingsPath(), {});
			current.soundEnabled = msg.enabled;
			writeJsonFile(getSettingsPath(), current);
			break;
		}
		case 'listSessions': {
			const sessions = scanAllSessions(agents);
			sender.postMessage({ type: 'sessionsList', sessions });
			break;
		}
		case 'resumeSession': {
			const sessionId = msg.sessionId as string;
			const sessionProjectDir = msg.projectDir as string;
			resumeSession(
				sessionId, sessionProjectDir, cwd,
				nextAgentIdRef, agents, activeAgentIdRef, knownJsonlFiles,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				jsonlPollTimers, sender, persistAgents,
			);
			break;
		}
		// exportLayout / importLayout are handled client-side in web version
	}
}

main().catch((err) => {
	console.error('[Pixel Agents] Failed to start:', err);
	process.exit(1);
});
