import type { AgentContext, AgentState, FloorId } from './types.js';
import { DEFAULT_FLOOR_ID, STRESS_TEST_TOOL_INTERVAL_MS, STRESS_TEST_METRICS_INTERVAL_MS } from './constants.js';

/** 壓力測試用的工具名稱池 */
const STRESS_TOOL_NAMES = [
	'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
	'WebFetch', 'WebSearch', 'Task', 'ListFiles',
] as const;

/** 壓力測試用的工具狀態模板 */
const STRESS_TOOL_STATUSES: Record<string, string[]> = {
	Read: ['Reading index.ts', 'Reading config.json', 'Reading utils.ts'],
	Edit: ['Editing main.ts', 'Editing App.tsx', 'Editing types.ts'],
	Write: ['Writing output.json', 'Writing report.md'],
	Bash: ['Running: npm test', 'Running: tsc --noEmit', 'Running: eslint .'],
	Glob: ['Searching **/*.ts', 'Searching src/**/*.tsx'],
	Grep: ['Searching for "TODO"', 'Searching for "import"'],
	WebFetch: ['Fetching https://example.com', 'Fetching API docs'],
	WebSearch: ['Searching: typescript patterns', 'Searching: node.js best practices'],
	Task: ['Subtask: Analyze codebase', 'Subtask: Run tests'],
	ListFiles: ['Listing src/', 'Listing web/server/'],
};

interface StressAgent {
	id: number;
	toolTimer: ReturnType<typeof setInterval> | null;
	currentToolId: string | null;
	toolCounter: number;
}

const stressAgents: StressAgent[] = [];
let metricsTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function randomItem<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function createStressAgent(id: number, ctx: AgentContext): StressAgent {
	const floorId: FloorId = ctx.building.floors.length > 0
		? ctx.building.floors[Math.floor(Math.random() * ctx.building.floors.length)].id
		: DEFAULT_FLOOR_ID;

	// 建立模擬的 AgentState
	const agentState: AgentState = {
		id,
		process: null,
		projectDir: `/tmp/stress-test-project-${id}`,
		jsonlFile: '',
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
		model: 'stress-test',
		tmuxSessionName: null,
		isDetached: false,
		transcriptLog: [],
		floorId,
		isRemote: false,
		owner: null,
		ownerId: null,
		remoteSessionId: null,
		gitBranch: null,
		statusHistory: [],
		teamName: null,
		cliType: 'claude',
		startedAt: Date.now(),
		growth: { xp: 0, toolCallCount: 0, sessionCount: 0, bashCallCount: 0, achievements: [] },
	};

	ctx.agents.set(id, agentState);
	ctx.incrementFloorCount(floorId);

	// 通知客戶端
	ctx.floorSender(floorId).postMessage({
		type: 'agentCreated',
		id,
		projectName: `stress-${id}`,
		floorId,
		startedAt: agentState.startedAt,
	});
	ctx.floorSender(floorId).postMessage({
		type: 'agentModel',
		id,
		model: 'stress-test',
	});

	return {
		id,
		toolTimer: null,
		currentToolId: null,
		toolCounter: 0,
	};
}

function runToolCycle(agent: StressAgent, ctx: AgentContext): void {
	const agentState = ctx.agents.get(agent.id);
	if (!agentState) return;

	// 如果有進行中的工具，先完成它
	if (agent.currentToolId) {
		agentState.activeToolIds.delete(agent.currentToolId);
		agentState.activeToolNames.delete(agent.currentToolId);
		agentState.activeToolStatuses.delete(agent.currentToolId);
		ctx.floorSender(agentState.floorId).postMessage({
			type: 'agentToolDone',
			id: agent.id,
			toolId: agent.currentToolId,
		});
		agent.currentToolId = null;
	}

	// 偶爾進入等待狀態（10% 機率）
	if (Math.random() < 0.1) {
		ctx.floorSender(agentState.floorId).postMessage({
			type: 'agentStatus',
			id: agent.id,
			status: 'waiting',
		});
		return;
	}

	// 啟動新工具
	const toolName = randomItem(STRESS_TOOL_NAMES);
	const statuses = STRESS_TOOL_STATUSES[toolName] || ['Working...'];
	const status = randomItem(statuses);
	const toolId = `stress-${agent.id}-${agent.toolCounter++}`;

	agent.currentToolId = toolId;
	agentState.activeToolIds.add(toolId);
	agentState.activeToolNames.set(toolId, toolName);
	agentState.activeToolStatuses.set(toolId, status);
	agentState.hadToolsInTurn = true;

	ctx.floorSender(agentState.floorId).postMessage({
		type: 'agentToolStart',
		id: agent.id,
		toolId,
		status,
	});
	ctx.floorSender(agentState.floorId).postMessage({
		type: 'agentStatus',
		id: agent.id,
		status: 'active',
	});
}

function logMetrics(agentCount: number): void {
	const mem = process.memoryUsage();
	console.log(
		`[Stress Test] agents=${agentCount}` +
		` heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB` +
		` rss=${Math.round(mem.rss / 1024 / 1024)}MB` +
		` uptime=${Math.round(process.uptime())}s`,
	);
}

/** 啟動壓力測試：建立 count 個模擬代理並以高頻率循環工具事件 */
export function startStressTest(count: number, ctx: AgentContext): void {
	if (running) {
		console.warn('[Stress Test] Already running');
		return;
	}
	running = true;
	console.log(`[Stress Test] Starting with ${count} simulated agents (interval=${STRESS_TEST_TOOL_INTERVAL_MS}ms)`);

	// 以交錯時間建立代理（每個間隔 100ms 避免瞬間衝擊）
	for (let i = 0; i < count; i++) {
		const agentId = 9000 + i; // 使用高 ID 區段避免與真實代理衝突
		setTimeout(() => {
			if (!running) return;
			const agent = createStressAgent(agentId, ctx);
			stressAgents.push(agent);

			// 為每個代理啟動工具循環計時器
			agent.toolTimer = setInterval(() => {
				if (!running) return;
				runToolCycle(agent, ctx);
			}, STRESS_TEST_TOOL_INTERVAL_MS);
		}, i * 100);
	}

	// 定期記錄指標
	metricsTimer = setInterval(() => {
		logMetrics(stressAgents.length);
	}, STRESS_TEST_METRICS_INTERVAL_MS);

	// 初始指標
	logMetrics(0);
}

/** 停止壓力測試並清理所有模擬代理 */
export function stopStressTest(): void {
	if (!running) return;
	running = false;

	if (metricsTimer) {
		clearInterval(metricsTimer);
		metricsTimer = null;
	}

	for (const agent of stressAgents) {
		if (agent.toolTimer) {
			clearInterval(agent.toolTimer);
			agent.toolTimer = null;
		}
	}
	stressAgents.length = 0;
	console.log('[Stress Test] Stopped');
}
