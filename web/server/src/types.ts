import type { ChildProcess } from 'child_process';
import type { FSWatcher } from 'fs';

export interface MessageSender {
	postMessage(msg: unknown): void;
}

export interface AgentState {
	id: number;
	process: ChildProcess | null;
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>;
	activeSubagentToolNames: Map<string, Map<string, string>>;
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	model: string | null;
	/** tmux 會話名稱，如果作為直接子進程執行則為 null */
	tmuxSessionName: string | null;
	/** 此代理的 tmux 會話是否存活但伺服器剛重啟（尚未重新連接） */
	isDetached: boolean;
}

export interface PersistedAgent {
	id: number;
	sessionId: string;
	jsonlFile: string;
	projectDir: string;
	palette?: number;
	hueShift?: number;
	seatId?: string;
	tmuxSessionName?: string;
}

/** 代理上下文 — 集中管理所有共享狀態與計時器，避免函式傳遞大量參數 */
export interface AgentContext {
	agents: Map<number, AgentState>;
	nextAgentIdRef: { current: number };
	activeAgentIdRef: { current: number | null };
	knownJsonlFiles: Set<string>;
	fileWatchers: Map<number, FSWatcher>;
	pollingTimers: Map<number, ReturnType<typeof setInterval>>;
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
	sender: MessageSender | undefined;
	persistAgents: () => void;
}
