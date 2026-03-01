import nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { TERMINAL_DEFAULT_COLS, TERMINAL_DEFAULT_ROWS } from './constants.js';

/**
 * 為指定的 tmux 會話建立偽終端（pty），附加到該會話。
 * 返回 null 表示建立失敗。
 */
export function createTerminalPty(
	tmuxSessionName: string,
	cols?: number,
	rows?: number,
): IPty | null {
	try {
		return nodePty.spawn(
			'tmux',
			['attach-session', '-t', tmuxSessionName],
			{
				name: 'xterm-256color',
				cols: cols || TERMINAL_DEFAULT_COLS,
				rows: rows || TERMINAL_DEFAULT_ROWS,
			},
		);
	} catch (err) {
		console.error(`[Pixel Agents] Failed to create terminal for tmux session ${tmuxSessionName}:`, err);
		return null;
	}
}

/** 活躍的終端 pty 計數（用於除錯） */
const activePtys = new Set<IPty>();

export function trackPty(pty: IPty): void {
	activePtys.add(pty);
	pty.onExit(() => {
		activePtys.delete(pty);
	});
}

export function cleanupAllTerminals(): void {
	for (const p of activePtys) {
		try { p.kill(); } catch { /* ignore */ }
	}
	activePtys.clear();
}
