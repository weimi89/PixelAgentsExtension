import * as fs from 'fs';
import * as path from 'path';
import type { AgentState, MessageSender } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, clearAgentActivity } from './timerManager.js';
import { processTranscriptLine } from './transcriptParser.js';
import { FILE_WATCHER_POLL_INTERVAL_MS, PROJECT_SCAN_INTERVAL_MS, ACTIVE_JSONL_MAX_AGE_MS } from './constants.js';

export function startFileWatching(
	agentId: number,
	filePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
): void {
	// Primary: fs.watch
	try {
		const watcher = fs.watch(filePath, () => {
			readNewLines(agentId, agents, waitingTimers, permissionTimers, sender);
		});
		fileWatchers.set(agentId, watcher);
	} catch (e) {
		console.log(`[Pixel Agents] fs.watch failed for agent ${agentId}: ${e}`);
	}

	// Backup: poll every 2s
	const interval = setInterval(() => {
		if (!agents.has(agentId)) { clearInterval(interval); return; }
		readNewLines(agentId, agents, waitingTimers, permissionTimers, sender);
	}, FILE_WATCHER_POLL_INTERVAL_MS);
	pollingTimers.set(agentId, interval);
}

export function readNewLines(
	agentId: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;
	try {
		const stat = fs.statSync(agent.jsonlFile);
		if (stat.size <= agent.fileOffset) return;

		const buf = Buffer.alloc(stat.size - agent.fileOffset);
		const fd = fs.openSync(agent.jsonlFile, 'r');
		fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
		fs.closeSync(fd);
		agent.fileOffset = stat.size;

		const text = agent.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		agent.lineBuffer = lines.pop() || '';

		const hasLines = lines.some(l => l.trim());
		if (hasLines) {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			if (agent.permissionSent) {
				agent.permissionSent = false;
				sender?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
			}
		}

		for (const line of lines) {
			if (!line.trim()) continue;
			processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, sender);
		}
	} catch (e) {
		console.log(`[Pixel Agents] Read error for agent ${agentId}: ${e}`);
	}
}

/** Check if a JSONL file was recently modified (considered "active") */
function isRecentlyActive(filePath: string): boolean {
	try {
		const stat = fs.statSync(filePath);
		return (Date.now() - stat.mtimeMs) < ACTIVE_JSONL_MAX_AGE_MS;
	} catch {
		return false;
	}
}

/** Check if a JSONL file is already tracked by an existing agent */
function isTrackedByAgent(filePath: string, agents: Map<number, AgentState>): boolean {
	for (const agent of agents.values()) {
		if (agent.jsonlFile === filePath) return true;
	}
	return false;
}

export function ensureProjectScan(
	projectDirs: string[],
	knownJsonlFiles: Set<string>,
	projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	if (projectScanTimerRef.current) return;

	// Initial scan: adopt all active JSONL files across all project directories
	for (const dir of projectDirs) {
		scanAndAdopt(
			dir, knownJsonlFiles, nextAgentIdRef, agents,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			sender, persistAgents,
		);
	}

	// Periodic scan for new sessions
	projectScanTimerRef.current = setInterval(() => {
		for (const dir of projectDirs) {
			scanAndAdopt(
				dir, knownJsonlFiles, nextAgentIdRef, agents,
				fileWatchers, pollingTimers, waitingTimers, permissionTimers,
				sender, persistAgents,
			);
		}
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanAndAdopt(
	projectDir: string,
	knownJsonlFiles: Set<string>,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	let files: string[];
	try {
		files = fs.readdirSync(projectDir)
			.filter(f => f.endsWith('.jsonl'))
			.map(f => path.join(projectDir, f));
	} catch { return; }

	for (const file of files) {
		knownJsonlFiles.add(file);

		// Skip files already tracked by an agent
		if (isTrackedByAgent(file, agents)) continue;

		// Only adopt recently active files
		if (!isRecentlyActive(file)) continue;

		// Auto-adopt: create agent for this external Claude session
		const id = nextAgentIdRef.current++;
		const agent: AgentState = {
			id,
			process: null, // external process — not managed by us
			projectDir,
			jsonlFile: file,
			fileOffset: 0,
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
		persistAgents();
		console.log(`[Pixel Agents] Auto-adopted session: ${path.basename(file)} → Agent ${id}`);
		sender?.postMessage({ type: 'agentCreated', id });

		// Start watching the file immediately
		startFileWatching(id, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, sender);
		readNewLines(id, agents, waitingTimers, permissionTimers, sender);
	}

	// Check for stale agents (JSONL file no longer being written to)
	checkStaleAgents(agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, sender, persistAgents);
}

/** Remove agents whose JSONL file hasn't been updated recently and have no managed process */
function checkStaleAgents(
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	for (const [id, agent] of agents) {
		// Only check auto-adopted agents (no managed process)
		if (agent.process) continue;
		try {
			const stat = fs.statSync(agent.jsonlFile);
			const age = Date.now() - stat.mtimeMs;
			// If file hasn't been touched in 2× the threshold, consider stale
			if (age > ACTIVE_JSONL_MAX_AGE_MS * 2) {
				console.log(`[Pixel Agents] Agent ${id}: session stale (${Math.round(age / 1000)}s), removing`);
				fileWatchers.get(id)?.close();
				fileWatchers.delete(id);
				const pt = pollingTimers.get(id);
				if (pt) { clearInterval(pt); }
				pollingTimers.delete(id);
				cancelWaitingTimer(id, waitingTimers);
				cancelPermissionTimer(id, permissionTimers);
				agents.delete(id);
				persistAgents();
				sender?.postMessage({ type: 'agentClosed', id });
			}
		} catch {
			// File gone — remove agent
			fileWatchers.get(id)?.close();
			fileWatchers.delete(id);
			const pt = pollingTimers.get(id);
			if (pt) { clearInterval(pt); }
			pollingTimers.delete(id);
			cancelWaitingTimer(id, waitingTimers);
			cancelPermissionTimer(id, permissionTimers);
			agents.delete(id);
			persistAgents();
			sender?.postMessage({ type: 'agentClosed', id });
		}
	}
}

export function reassignAgentToFile(
	agentId: number,
	newFilePath: string,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
	persistAgents: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	fileWatchers.get(agentId)?.close();
	fileWatchers.delete(agentId);
	const pt = pollingTimers.get(agentId);
	if (pt) { clearInterval(pt); }
	pollingTimers.delete(agentId);

	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);
	clearAgentActivity(agent, agentId, permissionTimers, sender);

	agent.jsonlFile = newFilePath;
	agent.fileOffset = 0;
	agent.lineBuffer = '';
	persistAgents();

	startFileWatching(agentId, newFilePath, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, sender);
	readNewLines(agentId, agents, waitingTimers, permissionTimers, sender);
}
