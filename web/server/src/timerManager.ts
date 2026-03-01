import type { AgentState, MessageSender } from './types.js';
import {
	PERMISSION_TIMER_DELAY_MS,
	PERMISSION_TIMER_BASH_MS,
	PERMISSION_TIMER_READ_MS,
	PERMISSION_TIMER_MCP_MS,
	PERMISSION_TIMER_MAX_PROGRESS_EXTENSIONS,
} from './constants.js';

export function clearAgentActivity(
	agent: AgentState | undefined,
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
	progressExtensions?: Map<number, number>,
): void {
	if (!agent) return;
	agent.activeToolIds.clear();
	agent.activeToolStatuses.clear();
	agent.activeToolNames.clear();
	agent.activeSubagentToolIds.clear();
	agent.activeSubagentToolNames.clear();
	agent.isWaiting = false;
	agent.permissionSent = false;
	cancelPermissionTimer(agentId, permissionTimers);
	progressExtensions?.delete(agentId);
	sender?.postMessage({ type: 'agentToolsClear', id: agentId });
	sender?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(
	agentId: number,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = waitingTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		waitingTimers.delete(agentId);
	}
}

export function startWaitingTimer(
	agentId: number,
	delayMs: number,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	sender: MessageSender | undefined,
): void {
	cancelWaitingTimer(agentId, waitingTimers);
	const timer = setTimeout(() => {
		waitingTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (agent) {
			agent.isWaiting = true;
		}
		sender?.postMessage({
			type: 'agentStatus',
			id: agentId,
			status: 'waiting',
		});
	}, delayMs);
	waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
	const timer = permissionTimers.get(agentId);
	if (timer) {
		clearTimeout(timer);
		permissionTimers.delete(agentId);
	}
}

/** 根據工具名稱取得適應性權限計時器延遲（毫秒） */
export function getPermissionDelay(toolName: string): number {
	if (toolName === 'Bash') return PERMISSION_TIMER_BASH_MS;
	if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return PERMISSION_TIMER_READ_MS;
	if (toolName.startsWith('mcp_') || toolName.startsWith('mcp__')) return PERMISSION_TIMER_MCP_MS;
	return PERMISSION_TIMER_DELAY_MS;
}

/** 計算代理所有活躍工具中的最大權限延遲 */
function getMaxDelayForAgent(agent: AgentState, permissionExemptTools: Set<string>): number {
	let maxDelay = 0;
	for (const [, toolName] of agent.activeToolNames) {
		if (!permissionExemptTools.has(toolName)) {
			maxDelay = Math.max(maxDelay, getPermissionDelay(toolName));
		}
	}
	for (const [, subToolNames] of agent.activeSubagentToolNames) {
		for (const [, toolName] of subToolNames) {
			if (!permissionExemptTools.has(toolName)) {
				maxDelay = Math.max(maxDelay, getPermissionDelay(toolName));
			}
		}
	}
	return maxDelay || PERMISSION_TIMER_DELAY_MS;
}

export function startPermissionTimer(
	agentId: number,
	agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionExemptTools: Set<string>,
	sender: MessageSender | undefined,
): void {
	cancelPermissionTimer(agentId, permissionTimers);
	const agent = agents.get(agentId);
	const delayMs = agent ? getMaxDelayForAgent(agent, permissionExemptTools) : PERMISSION_TIMER_DELAY_MS;
	const timer = setTimeout(() => {
		permissionTimers.delete(agentId);
		const ag = agents.get(agentId);
		if (!ag) return;

		let hasNonExempt = false;
		for (const toolId of ag.activeToolIds) {
			const toolName = ag.activeToolNames.get(toolId);
			if (!permissionExemptTools.has(toolName || '')) {
				hasNonExempt = true;
				break;
			}
		}

		const stuckSubagentParentToolIds: string[] = [];
		for (const [parentToolId, subToolNames] of ag.activeSubagentToolNames) {
			for (const [, toolName] of subToolNames) {
				if (!permissionExemptTools.has(toolName)) {
					stuckSubagentParentToolIds.push(parentToolId);
					hasNonExempt = true;
					break;
				}
			}
		}

		if (hasNonExempt) {
			ag.permissionSent = true;
			console.log(`[Pixel Agents] Agent ${agentId}: possible permission wait detected (delay=${delayMs}ms)`);
			sender?.postMessage({
				type: 'agentToolPermission',
				id: agentId,
			});
			for (const parentToolId of stuckSubagentParentToolIds) {
				sender?.postMessage({
					type: 'subagentToolPermission',
					id: agentId,
					parentToolId,
				});
			}
		}
	}, delayMs);
	permissionTimers.set(agentId, timer);
}

/**
 * 進度訊號觸發的計時器重啟（限制最多 N 次延長）。
 * 回傳 true 表示計時器已重啟；false 表示已達延長上限。
 */
export function restartPermissionTimerOnProgress(
	agentId: number,
	agents: Map<number, AgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionExemptTools: Set<string>,
	sender: MessageSender | undefined,
	progressExtensions: Map<number, number>,
): boolean {
	const count = progressExtensions.get(agentId) || 0;
	if (count >= PERMISSION_TIMER_MAX_PROGRESS_EXTENSIONS) return false;
	progressExtensions.set(agentId, count + 1);
	startPermissionTimer(agentId, agents, permissionTimers, permissionExemptTools, sender);
	return true;
}
