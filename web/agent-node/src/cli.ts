#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { AgentNodeConnection } from './connection.js';
import { AgentTracker } from './agentTracker.js';
import { Scanner } from './scanner.js';
import { TerminalRelay } from './terminalRelay.js';

const CONFIG_DIR = path.join(os.homedir(), '.pixel-agents');
const CONFIG_FILE = path.join(CONFIG_DIR, 'node-config.json');

interface NodeConfig {
	server: string;
	token: string;
}

function readConfig(): NodeConfig | null {
	try {
		if (!fs.existsSync(CONFIG_FILE)) return null;
		return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as NodeConfig;
	} catch {
		return null;
	}
}

function writeConfig(config: NodeConfig): void {
	if (!fs.existsSync(CONFIG_DIR)) {
		fs.mkdirSync(CONFIG_DIR, { recursive: true });
	}
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

/** API Key 登入 — 使用 API Key 取得 JWT token */
async function loginWithApiKey(serverUrl: string): Promise<void> {
	const apiKey = await prompt('API Key: ');
	if (!apiKey) {
		console.error('API Key is required');
		process.exit(1);
	}

	try {
		const res = await fetch(`${serverUrl}/api/auth/login-key`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ apiKey }),
		});
		if (!res.ok) {
			const body = await res.json() as { error?: string };
			console.error(`Login failed: ${body.error || res.statusText}`);
			process.exit(1);
		}
		const data = await res.json() as { token: string; username: string };
		writeConfig({ server: serverUrl, token: data.token });
		console.log(`Logged in as ${data.username}. Config saved to ${CONFIG_FILE}`);
	} catch (err) {
		console.error('Login failed:', err instanceof Error ? err.message : err);
		process.exit(1);
	}
}

/** 帳號密碼登入 — 傳統登入模式 */
async function loginWithPassword(serverUrl: string): Promise<void> {
	const username = await prompt('Username: ');
	const password = await prompt('Password: ');

	try {
		const res = await fetch(`${serverUrl}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password }),
		});
		if (!res.ok) {
			const body = await res.json() as { error?: string };
			console.error(`Login failed: ${body.error || res.statusText}`);
			process.exit(1);
		}
		const data = await res.json() as { token: string; username: string };
		writeConfig({ server: serverUrl, token: data.token });
		console.log(`Logged in as ${data.username}. Config saved to ${CONFIG_FILE}`);
	} catch (err) {
		console.error('Login failed:', err instanceof Error ? err.message : err);
		process.exit(1);
	}
}

function start(serverUrl: string, token: string): void {
	const connection = new AgentNodeConnection({
		serverUrl,
		token,
		onAuthenticated(userId) {
			console.log(`[Agent Node] Authenticated as user ${userId}`);
		},
		onError(message) {
			console.error(`[Agent Node] Server error: ${message}`);
		},
		onAgentRegistered(sessionId, agentId) {
			console.log(`[Agent Node] Agent registered: session=${sessionId} → id=${agentId}`);
		},
		onReconnect() {
			// 重連後重新啟動掃描器（讓它重新偵測活躍的代理）
			console.log('[Agent Node] Reconnected — re-scanning...');
		},
	});

	const tracker = new AgentTracker((event) => {
		connection.sendEvent(event);
	});

	// 終端中繼 — 伺服器可透過 Agent Node 遠端開啟代理的終端
	const terminalRelay = new TerminalRelay(
		{
			onData(sessionId, data) {
				connection.sendEvent({ type: 'terminalData', sessionId, data });
			},
			onExit(sessionId, code) {
				connection.sendEvent({ type: 'terminalExit', sessionId, code });
			},
			onReady(sessionId) {
				connection.sendEvent({ type: 'terminalReady', sessionId });
			},
			onError(sessionId, message) {
				connection.sendEvent({ type: 'terminalError', sessionId, message });
			},
		},
		(sessionId) => tracker.getProjectDir(sessionId),
	);

	connection.setTerminalHandler({
		onAttach(sessionId, cols, rows) {
			terminalRelay.attach(sessionId, cols, rows);
		},
		onInput(sessionId, data) {
			terminalRelay.input(sessionId, data);
		},
		onResize(sessionId, cols, rows) {
			terminalRelay.resize(sessionId, cols, rows);
		},
		onDetach(sessionId) {
			terminalRelay.detach(sessionId);
		},
	});

	// 會話恢復處理器 — 伺服器可透過 Agent Node 遠端恢復 Claude 會話
	connection.setResumeHandler({
		onResumeSession(sessionId, projectDir) {
			console.log(`[Agent Node] Resuming session ${sessionId} in ${projectDir}`);
			try {
				const child = spawn('claude', ['--resume', sessionId], {
					cwd: projectDir,
					stdio: 'ignore',
					detached: true,
					env: { ...process.env },
				});
				child.unref();
				connection.sendEvent({
					type: 'sessionResumed',
					sessionId,
					success: true,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[Agent Node] Failed to resume session: ${message}`);
				connection.sendEvent({
					type: 'sessionResumed',
					sessionId,
					success: false,
					error: message,
				});
			}
		},
	});

	const scanner = new Scanner(tracker);

	connection.connect();
	scanner.start();

	// Graceful shutdown
	function shutdown(): void {
		console.log('\n[Agent Node] Shutting down...');
		scanner.stop();
		tracker.destroy();
		terminalRelay.destroy();
		connection.disconnect();
		process.exit(0);
	}
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	console.log('[Agent Node] Running. Press Ctrl+C to stop.');
}

// ── CLI 解析 ─────────────────────────────────────────
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command === 'login') {
		// 檢查是否使用 --password 旗標切換為帳號密碼登入模式
		const usePassword = args.includes('--password');
		// 從參數中提取 server URL（排除旗標）
		const serverUrl = args.slice(1).find(a => !a.startsWith('--'));
		if (!serverUrl) {
			console.error('Usage: pixel-agents-node login <server-url> [--password]');
			console.error('  預設使用 API Key 登入');
			console.error('  --password  使用帳號密碼登入');
			console.error('Example: pixel-agents-node login http://192.168.1.100:3000');
			process.exit(1);
		}
		const normalizedUrl = serverUrl.replace(/\/$/, '');
		if (usePassword) {
			await loginWithPassword(normalizedUrl);
		} else {
			await loginWithApiKey(normalizedUrl);
		}
		return;
	}

	if (command === 'start' || !command) {
		// 從參數或配置檔讀取
		let serverUrl: string | undefined;
		let token: string | undefined;

		for (let i = 1; i < args.length; i++) {
			if (args[i] === '--server' && args[i + 1]) {
				serverUrl = args[++i];
			} else if (args[i] === '--token' && args[i + 1]) {
				token = args[++i];
			}
		}

		if (!serverUrl || !token) {
			const config = readConfig();
			if (config) {
				serverUrl = serverUrl || config.server;
				token = token || config.token;
			}
		}

		if (!serverUrl || !token) {
			console.error('No server/token configured. Run:');
			console.error('  pixel-agents-node login <server-url>');
			console.error('Or:');
			console.error('  pixel-agents-node start --server <url> --token <jwt>');
			process.exit(1);
		}

		start(serverUrl, token);
		return;
	}

	console.error(`Unknown command: ${command}`);
	console.error('Usage:');
	console.error('  pixel-agents-node login <server-url>              API Key 登入（預設）');
	console.error('  pixel-agents-node login <server-url> --password   帳號密碼登入');
	console.error('  pixel-agents-node start                           Start scanning');
	console.error('  pixel-agents-node start --server <url> --token <jwt>');
	process.exit(1);
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
