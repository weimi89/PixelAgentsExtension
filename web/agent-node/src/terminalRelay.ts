import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';

/** 預設終端欄位數 */
const DEFAULT_COLS = 80;
/** 預設終端行數 */
const DEFAULT_ROWS = 24;

interface ManagedTerminal {
	process: ChildProcess;
	sessionId: string;
	cols: number;
	rows: number;
}

export interface TerminalRelayCallbacks {
	onData: (sessionId: string, data: string) => void;
	onExit: (sessionId: string, code: number) => void;
	onReady: (sessionId: string) => void;
	onError: (sessionId: string, message: string) => void;
}

/**
 * 終端中繼 — 在 Agent Node 端管理多個 PTY/shell 進程，
 * 透過 child_process.spawn 避免 node-pty 原生模組依賴。
 *
 * 對於有 tmux 會話的代理：嘗試 `tmux attach-session -t {name}`。
 * 否則：在代理專案目錄中啟動 shell。
 */
export class TerminalRelay {
	private terminals = new Map<string, ManagedTerminal>();
	private callbacks: TerminalRelayCallbacks;
	/** 取得指定 sessionId 的專案目錄（由外部提供） */
	private getProjectDir: (sessionId: string) => string | undefined;

	constructor(callbacks: TerminalRelayCallbacks, getProjectDir: (sessionId: string) => string | undefined) {
		this.callbacks = callbacks;
		this.getProjectDir = getProjectDir;
	}

	/** 為指定代理建立終端進程 */
	attach(sessionId: string, cols: number, rows: number): void {
		// 如果已有同 sessionId 的終端，先清理
		if (this.terminals.has(sessionId)) {
			this.detach(sessionId);
		}

		const effectiveCols = cols || DEFAULT_COLS;
		const effectiveRows = rows || DEFAULT_ROWS;

		// 嘗試以 tmux attach 連接（遵循 pixel-agents-{sessionId} 命名慣例）
		const tmuxSessionName = `pixel-agents-${sessionId}`;
		const projectDir = this.getProjectDir(sessionId);
		const cwd = projectDir || os.homedir();

		// 先檢查 tmux session 是否存在
		const checkTmux = spawn('tmux', ['has-session', '-t', tmuxSessionName], {
			stdio: ['ignore', 'ignore', 'ignore'],
		});

		checkTmux.on('close', (code) => {
			if (code === 0) {
				// tmux session 存在 — 附加到它
				this.spawnTerminal(sessionId, 'tmux', ['attach-session', '-t', tmuxSessionName], cwd, effectiveCols, effectiveRows);
			} else {
				// 無 tmux session — 啟動普通 shell
				const shell = process.env.SHELL || '/bin/bash';
				this.spawnTerminal(sessionId, shell, [], cwd, effectiveCols, effectiveRows);
			}
		});

		checkTmux.on('error', () => {
			// tmux 不存在 — 啟動普通 shell
			const shell = process.env.SHELL || '/bin/bash';
			this.spawnTerminal(sessionId, shell, [], cwd, effectiveCols, effectiveRows);
		});
	}

	/** 終止並清理指定代理的終端 */
	detach(sessionId: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		this.terminals.delete(sessionId);

		try {
			terminal.process.kill('SIGTERM');
		} catch {
			// 進程可能已結束
		}
	}

	/** 向終端 stdin 寫入資料 */
	input(sessionId: string, data: string): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		terminal.process.stdin?.write(data);
	}

	/** 調整終端大小（使用 SIGWINCH + stty，受限於 child_process） */
	resize(sessionId: string, cols: number, rows: number): void {
		const terminal = this.terminals.get(sessionId);
		if (!terminal) return;
		terminal.cols = cols;
		terminal.rows = rows;
		// child_process.spawn 沒有原生 resize 支援，
		// 但如果底層是 tmux，可透過 tmux 命令調整
		const tmuxSessionName = `pixel-agents-${sessionId}`;
		try {
			spawn('tmux', ['resize-window', '-t', tmuxSessionName, '-x', String(cols), '-y', String(rows)], {
				stdio: 'ignore',
			});
		} catch {
			// 靜默忽略 — resize 不是關鍵操作
		}
	}

	/** 清理所有終端 */
	destroy(): void {
		for (const sessionId of [...this.terminals.keys()]) {
			this.detach(sessionId);
		}
	}

	/** 取得活躍終端數量 */
	get activeCount(): number {
		return this.terminals.size;
	}

	private spawnTerminal(
		sessionId: string,
		command: string,
		args: string[],
		cwd: string,
		cols: number,
		rows: number,
	): void {
		try {
			const child = spawn(command, args, {
				cwd,
				env: {
					...process.env,
					TERM: 'xterm-256color',
					COLUMNS: String(cols),
					LINES: String(rows),
				},
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			const terminal: ManagedTerminal = {
				process: child,
				sessionId,
				cols,
				rows,
			};
			this.terminals.set(sessionId, terminal);

			child.stdout?.on('data', (chunk: Buffer) => {
				this.callbacks.onData(sessionId, chunk.toString('utf-8'));
			});

			child.stderr?.on('data', (chunk: Buffer) => {
				// stderr 也作為 data 轉發（許多終端程式使用 stderr）
				this.callbacks.onData(sessionId, chunk.toString('utf-8'));
			});

			child.on('close', (code) => {
				this.terminals.delete(sessionId);
				this.callbacks.onExit(sessionId, code ?? 1);
			});

			child.on('error', (err) => {
				this.terminals.delete(sessionId);
				this.callbacks.onError(sessionId, err.message);
			});

			// 通知就緒
			this.callbacks.onReady(sessionId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.callbacks.onError(sessionId, `Failed to spawn terminal: ${message}`);
		}
	}
}
