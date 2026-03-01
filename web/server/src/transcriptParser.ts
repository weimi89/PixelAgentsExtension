import type { AgentContext } from './types.js';
import {
	cancelWaitingTimer,
	startWaitingTimer,
	clearAgentActivity,
	startPermissionTimer,
	cancelPermissionTimer,
	restartPermissionTimerOnProgress,
} from './timerManager.js';
import {
	TOOL_DONE_DELAY_MS,
	TEXT_IDLE_DELAY_MS,
	MAX_TRANSCRIPT_LOG,
	MAX_STATUS_HISTORY,
} from './constants.js';

/** Git branch 偵測正則：匹配 'On branch xxx' 或 '* branch-name' 模式 */
const GIT_BRANCH_ON_RE = /On branch\s+(\S+)/;
const GIT_BRANCH_STAR_RE = /^\*\s+(\S+)/m;
import { formatToolStatus, PERMISSION_EXEMPT_TOOLS } from 'pixel-agents-shared';
import { incrementToolCall } from './dashboardStats.js';

export { formatToolStatus, PERMISSION_EXEMPT_TOOLS };

/** 追加一筆精簡轉錄記錄到代理的 transcriptLog，並推送至客戶端 */
function appendTranscript(
	agentId: number,
	agent: { transcriptLog: Array<{ ts: number; role: 'user' | 'assistant' | 'system'; summary: string }> },
	role: 'user' | 'assistant' | 'system',
	summary: string,
	sender: import('./types.js').MessageSender | undefined,
): void {
	const entry = { ts: Date.now(), role, summary };
	agent.transcriptLog.push(entry);
	if (agent.transcriptLog.length > MAX_TRANSCRIPT_LOG) {
		agent.transcriptLog.splice(0, agent.transcriptLog.length - MAX_TRANSCRIPT_LOG);
	}
	sender?.postMessage({ type: 'agentTranscript', id: agentId, log: agent.transcriptLog });
}

/** 追加一筆狀態變更記錄到代理的 statusHistory，保留最近 MAX_STATUS_HISTORY 條 */
export function appendStatusHistory(
	agent: { statusHistory: Array<{ ts: number; status: string; detail?: string }> },
	status: string,
	detail?: string,
): void {
	const entry: { ts: number; status: string; detail?: string } = { ts: Date.now(), status };
	if (detail !== undefined) entry.detail = detail;
	agent.statusHistory.push(entry);
	if (agent.statusHistory.length > MAX_STATUS_HISTORY) {
		agent.statusHistory.splice(0, agent.statusHistory.length - MAX_STATUS_HISTORY);
	}
}

/** 解析單行 JSONL 轉錄記錄，更新代理狀態並發送對應訊息 */
export function processTranscriptLine(
	agentId: number,
	line: string,
	ctx: AgentContext,
): void {
	const { agents, waitingTimers, permissionTimers, progressExtensions } = ctx;
	const agent = agents.get(agentId);
	if (!agent) return;
	const sender = ctx.floorSender(agent.floorId);
	try {
		const record = JSON.parse(line);

		if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
			// 從助手記錄中提取模型名稱
			const model = record.message?.model as string | undefined;
			if (model && agent.model !== model) {
				agent.model = model;
				sender?.postMessage({ type: 'agentModel', id: agentId, model });
			}

			const blocks = record.message.content as Array<{
				type: string; id?: string; name?: string; input?: Record<string, unknown>;
			}>;

			// 偵測 thinking 區塊
			const hasThinking = blocks.some(b => b.type === 'thinking');
			if (hasThinking) {
				sender?.postMessage({ type: 'agentThinking', id: agentId, thinking: true });
			}

			// 偵測 image 區塊 → 相機表情
			const hasImage = blocks.some(b => b.type === 'image');
			if (hasImage) {
				sender?.postMessage({ type: 'agentEmote', id: agentId, emote: 'camera' });
			}

			const hasToolUse = blocks.some(b => b.type === 'tool_use');

			if (hasToolUse) {
				cancelWaitingTimer(agentId, waitingTimers);
				agent.isWaiting = false;
				agent.hadToolsInTurn = true;
				// 工具使用開始時清除思考狀態
				sender?.postMessage({ type: 'agentThinking', id: agentId, thinking: false });
				sender?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
				appendStatusHistory(agent, 'active', 'tool_use');
				let hasNonExemptTool = false;
				for (const block of blocks) {
					if (block.type === 'tool_use' && block.id) {
						const toolName = block.name || '';
						const status = formatToolStatus(toolName, block.input || {});
						console.log(`[Pixel Agents] Agent ${agentId} tool start: ${block.id} ${status}`);
						agent.activeToolIds.add(block.id);
						agent.activeToolStatuses.set(block.id, status);
						agent.activeToolNames.set(block.id, toolName);
						if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
							hasNonExemptTool = true;
						}
						sender?.postMessage({
							type: 'agentToolStart',
							id: agentId,
							toolId: block.id,
							status,
						});
					}
				}
				if (hasNonExemptTool) {
					progressExtensions.delete(agentId); // 新工具開始，重設進度延長計數
					startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, sender);
				}
				// 轉錄：記錄工具呼叫
				const lastStatus = agent.activeToolStatuses.size > 0 ? [...agent.activeToolStatuses.values()].pop()! : 'Using tools';
				appendTranscript(agentId, agent, 'assistant', lastStatus, sender);
			} else if (hasThinking) {
				appendStatusHistory(agent, 'thinking');
				appendTranscript(agentId, agent, 'assistant', '[thinking]', sender);
			} else if (blocks.some(b => b.type === 'text') && !agent.hadToolsInTurn) {
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, sender);
				appendTranscript(agentId, agent, 'assistant', 'Responding...', sender);
			}
		} else if (record.type === 'progress') {
			processProgressRecord(agentId, record, ctx);
		} else if (record.type === 'user') {
			const content = record.message?.content;
			if (Array.isArray(content)) {
				const blocks = content as Array<{ type: string; tool_use_id?: string }>;
				const hasToolResult = blocks.some(b => b.type === 'tool_result');
				if (hasToolResult) {
					for (const block of blocks) {
						if (block.type === 'tool_result' && block.tool_use_id) {
							console.log(`[Pixel Agents] Agent ${agentId} tool done: ${block.tool_use_id}`);
							const completedToolId = block.tool_use_id as string;
							// Git branch 偵測：從 Bash tool_result 的輸出中搜尋
							const completedName = agent.activeToolNames.get(completedToolId);
							if (completedName === 'Bash') {
								const resultContent = (block as Record<string, unknown>).content;
								const text = typeof resultContent === 'string'
									? resultContent
									: Array.isArray(resultContent)
										? (resultContent as Array<{ text?: string }>).map(c => c.text || '').join('')
										: '';
								if (text) {
									const m1 = GIT_BRANCH_ON_RE.exec(text);
									const m2 = !m1 ? GIT_BRANCH_STAR_RE.exec(text) : null;
									const branch = m1?.[1] || m2?.[1];
									if (branch && branch !== agent.gitBranch) {
										agent.gitBranch = branch;
										sender?.postMessage({ type: 'agentGitBranch', id: agentId, branch });
									}
								}
							}
							if (agent.activeToolNames.get(completedToolId) === 'Task') {
								agent.activeSubagentToolIds.delete(completedToolId);
								agent.activeSubagentToolNames.delete(completedToolId);
								sender?.postMessage({
									type: 'subagentClear',
									id: agentId,
									parentToolId: completedToolId,
								});
							}
							const completedToolName = agent.activeToolNames.get(completedToolId);
							if (completedToolName) {
								incrementToolCall(completedToolName);
								appendStatusHistory(agent, 'tool_done', completedToolName);
							}
							agent.activeToolIds.delete(completedToolId);
							agent.activeToolStatuses.delete(completedToolId);
							agent.activeToolNames.delete(completedToolId);
							const toolId = completedToolId;
							setTimeout(() => {
								sender?.postMessage({
									type: 'agentToolDone',
									id: agentId,
									toolId,
								});
							}, TOOL_DONE_DELAY_MS);
						}
					}
					if (agent.activeToolIds.size === 0) {
						agent.hadToolsInTurn = false;
					}
					appendTranscript(agentId, agent, 'user', `Result: ${blocks.filter(b => b.type === 'tool_result').map(b => (b.tool_use_id || '').slice(0, 8)).join(', ')}`, sender);
				} else {
					cancelWaitingTimer(agentId, waitingTimers);
					clearAgentActivity(agent, agentId, permissionTimers, sender, progressExtensions);
					agent.hadToolsInTurn = false;
				}
			} else if (typeof content === 'string' && content.trim()) {
				cancelWaitingTimer(agentId, waitingTimers);
				clearAgentActivity(agent, agentId, permissionTimers, sender, progressExtensions);
				agent.hadToolsInTurn = false;
				appendStatusHistory(agent, 'user_prompt');
				const trimmed = content.trim();
				appendTranscript(agentId, agent, 'user', trimmed.length > 60 ? trimmed.slice(0, 60) + '\u2026' : trimmed, sender);
			}
		} else if (record.type === 'system' && record.subtype === 'compact_boundary') {
			sender?.postMessage({ type: 'agentEmote', id: agentId, emote: 'compress' });
			appendStatusHistory(agent, 'compact');
			appendTranscript(agentId, agent, 'system', 'Context compacted', sender);
		} else if (record.type === 'system' && record.subtype === 'turn_duration') {
			cancelWaitingTimer(agentId, waitingTimers);
			cancelPermissionTimer(agentId, permissionTimers);
			// 回合結束時清除思考狀態
			sender?.postMessage({ type: 'agentThinking', id: agentId, thinking: false });

			if (agent.activeToolIds.size > 0) {
				agent.activeToolIds.clear();
				agent.activeToolStatuses.clear();
				agent.activeToolNames.clear();
				agent.activeSubagentToolIds.clear();
				agent.activeSubagentToolNames.clear();
				sender?.postMessage({ type: 'agentToolsClear', id: agentId });
			}

			agent.isWaiting = true;
			agent.permissionSent = false;
			agent.hadToolsInTurn = false;
			sender?.postMessage({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
			appendStatusHistory(agent, 'waiting', 'turn_complete');
			appendTranscript(agentId, agent, 'system', 'Turn complete', sender);
		}
	} catch {
		// 忽略格式錯誤的行
	}
}

/** 處理 progress 類型記錄（子代理工具啟動/完成、bash/mcp 進度） */
function processProgressRecord(
	agentId: number,
	record: Record<string, unknown>,
	ctx: AgentContext,
): void {
	const { agents, permissionTimers, progressExtensions } = ctx;
	const agent = agents.get(agentId);
	if (!agent) return;
	const sender = ctx.floorSender(agent.floorId);

	const parentToolId = record.parentToolUseID as string | undefined;
	if (!parentToolId) return;

	const data = record.data as Record<string, unknown> | undefined;
	if (!data) return;

	const dataType = data.type as string | undefined;
	if (dataType === 'waiting_for_task') {
		sender?.postMessage({ type: 'agentEmote', id: agentId, emote: 'eye' });
		return;
	}
	if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
		if (agent.activeToolIds.has(parentToolId)) {
			restartPermissionTimerOnProgress(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, sender, progressExtensions);
		}
		return;
	}

	if (agent.activeToolNames.get(parentToolId) !== 'Task') return;

	const msg = data.message as Record<string, unknown> | undefined;
	if (!msg) return;

	const msgType = msg.type as string;
	const innerMsg = msg.message as Record<string, unknown> | undefined;
	const content = innerMsg?.content;
	if (!Array.isArray(content)) return;

	if (msgType === 'assistant') {
		let hasNonExemptSubTool = false;
		for (const block of content) {
			if (block.type === 'tool_use' && block.id) {
				const toolName = block.name || '';
				const status = formatToolStatus(toolName, block.input || {});
				console.log(`[Pixel Agents] Agent ${agentId} subagent tool start: ${block.id} ${status} (parent: ${parentToolId})`);

				let subTools = agent.activeSubagentToolIds.get(parentToolId);
				if (!subTools) {
					subTools = new Set();
					agent.activeSubagentToolIds.set(parentToolId, subTools);
				}
				subTools.add(block.id);

				let subNames = agent.activeSubagentToolNames.get(parentToolId);
				if (!subNames) {
					subNames = new Map();
					agent.activeSubagentToolNames.set(parentToolId, subNames);
				}
				subNames.set(block.id, toolName);

				if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
					hasNonExemptSubTool = true;
				}

				sender?.postMessage({
					type: 'subagentToolStart',
					id: agentId,
					parentToolId,
					toolId: block.id,
					status,
				});
			}
		}
		if (hasNonExemptSubTool) {
			progressExtensions.delete(agentId); // 子代理新工具開始，重設進度延長計數
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, sender);
		}
	} else if (msgType === 'user') {
		for (const block of content) {
			if (block.type === 'tool_result' && block.tool_use_id) {
				console.log(`[Pixel Agents] Agent ${agentId} subagent tool done: ${block.tool_use_id} (parent: ${parentToolId})`);

				const subTools = agent.activeSubagentToolIds.get(parentToolId);
				if (subTools) {
					subTools.delete(block.tool_use_id);
				}
				const subNames = agent.activeSubagentToolNames.get(parentToolId);
				if (subNames) {
					subNames.delete(block.tool_use_id);
				}

				const toolId = block.tool_use_id;
				setTimeout(() => {
					sender?.postMessage({
						type: 'subagentToolDone',
						id: agentId,
						parentToolId,
						toolId,
					});
				}, TOOL_DONE_DELAY_MS);
			}
		}
		let stillHasNonExempt = false;
		for (const [, subNames] of agent.activeSubagentToolNames) {
			for (const [, toolName] of subNames) {
				if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
					stillHasNonExempt = true;
					break;
				}
			}
			if (stillHasNonExempt) break;
		}
		if (stillHasNonExempt) {
			startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, sender);
		}
	}
}
