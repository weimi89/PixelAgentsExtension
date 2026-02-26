import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import type { AgentState, MessageSender } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer } from './timerManager.js';
import { startFileWatching, readNewLines } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS } from './constants.js';

// Resolve full path to claude binary at startup
const CLAUDE_BIN = (() => {
	try {
		return execSync('which claude', { encoding: 'utf-8' }).trim();
	} catch {
		return 'claude'; // fallback
	}
})();

export function getProjectDirPath(cwd: string): string {
	const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

export function getAllProjectDirs(): string[] {
	const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
	try {
		const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
		return entries
			.filter(e => e.isDirectory())
			.map(e => path.join(projectsRoot, e.name));
	} catch {
		return [];
	}
}

// ── Shared spawn logic ──────────────────────────────────────

function spawnClaudeAgent(
	args: string[],
	cwd: string,
	expectedFile: string,
	label: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	const projectDir = path.dirname(expectedFile);
	knownJsonlFiles.add(expectedFile);

	const cleanEnv = { ...process.env };
	for (const key of Object.keys(cleanEnv)) {
		if (key.startsWith('CLAUDE')) {
			delete cleanEnv[key];
		}
	}
	console.log(`[Pixel Agents] Using claude binary: ${CLAUDE_BIN}`);
	const proc = spawn(CLAUDE_BIN, args, {
		cwd,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: cleanEnv,
	});

	proc.stdout?.on('data', (data: Buffer) => {
		const text = data.toString().replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
		if (text) console.log(`[Pixel Agents] Agent stdout: ${text.slice(0, 200)}`);
	});
	proc.stderr?.on('data', (data: Buffer) => {
		const text = data.toString().replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
		if (text) console.log(`[Pixel Agents] Agent stderr: ${text.slice(0, 200)}`);
	});

	const id = nextAgentIdRef.current++;
	// For resumed sessions, skip existing content (read only new lines)
	let fileOffset = 0;
	try {
		if (fs.existsSync(expectedFile)) {
			fileOffset = fs.statSync(expectedFile).size;
		}
	} catch { /* ignore */ }

	const agent: AgentState = {
		id,
		process: proc,
		projectDir,
		jsonlFile: expectedFile,
		fileOffset,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};

	agents.set(id, agent);
	activeAgentIdRef.current = id;
	persistAgents();
	console.log(`[Pixel Agents] Agent ${id}: ${label}`);
	sender?.postMessage({ type: 'agentCreated', id });

	proc.on('exit', (code) => {
		console.log(`[Pixel Agents] Agent ${id}: process exited with code ${code}`);
		removeAgent(
			id, agents,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			jsonlPollTimers, persistAgents,
		);
		sender?.postMessage({ type: 'agentClosed', id });
	});

	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, sender);
				readNewLines(id, agents, waitingTimers, permissionTimers, sender);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

export function launchNewAgent(
	cwd: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	const sessionId = crypto.randomUUID();
	const projectDir = getProjectDirPath(cwd);
	const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);

	spawnClaudeAgent(
		['--session-id', sessionId], cwd, expectedFile,
		`spawned claude --session-id ${sessionId}`,
		nextAgentIdRef, agents, activeAgentIdRef, knownJsonlFiles,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		jsonlPollTimers, sender, persistAgents,
	);
}

export function resumeSession(
	sessionId: string,
	sessionProjectDir: string,
	cwd: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	activeAgentIdRef: { current: number | null },
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	const expectedFile = path.join(sessionProjectDir, `${sessionId}.jsonl`);

	spawnClaudeAgent(
		['--resume', sessionId], cwd, expectedFile,
		`resumed session ${sessionId}`,
		nextAgentIdRef, agents, activeAgentIdRef, knownJsonlFiles,
		fileWatchers, pollingTimers, waitingTimers, permissionTimers,
		jsonlPollTimers, sender, persistAgents,
	);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);

	agents.delete(agentId);
	persistAgents();
}

export function closeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Kill the process
	if (agent.process && !agent.process.killed) {
		agent.process.kill('SIGTERM');
	}

	removeAgent(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
	sender?.postMessage({ type: 'agentClosed', id: agentId });
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	agentMeta: Record<string, { palette?: number; hueShift?: number; seatId?: string }>,
	sender: MessageSender | undefined,
): void {
	if (!sender) return;
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	sender.postMessage({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta,
	});

	// Re-send current states
	for (const [agentId, agent] of agents) {
		for (const [toolId, status] of agent.activeToolStatuses) {
			sender.postMessage({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		if (agent.isWaiting) {
			sender.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	}
}
