/**
 * E2E Smoke Test — 輕量端對端測試
 *
 * 啟動伺服器（demo 模式），測試關鍵端點和 Socket.IO 連線。
 * 使用原生 fetch + child_process，不依賴重量級測試框架。
 *
 * 用法：npx tsx tests/e2e-smoke.ts
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'src', 'index.ts');
const PORT = 13099; // 使用非標準端口避免衝突
const BASE_URL = `http://localhost:${PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

let serverProcess: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}] ${msg}`);
}

function assert(name: string, condition: boolean, error?: string): void {
	if (condition) {
		passed++;
		results.push({ name, ok: true });
		log(`  PASS: ${name}`);
	} else {
		failed++;
		results.push({ name, ok: false, error });
		log(`  FAIL: ${name}${error ? ` — ${error}` : ''}`);
	}
}

/** 啟動伺服器子進程 */
function startServer(): ChildProcess {
	const child = spawn('npx', ['tsx', SERVER_ENTRY], {
		env: {
			...process.env,
			PORT: String(PORT),
			DEMO: '1',
			DEMO_AGENTS: '2',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		cwd: path.join(__dirname, '..'),
	});

	child.stdout?.on('data', (data: Buffer) => {
		const line = data.toString().trim();
		if (line) log(`  [server] ${line}`);
	});
	child.stderr?.on('data', (data: Buffer) => {
		const line = data.toString().trim();
		if (line && !line.includes('ExperimentalWarning')) {
			log(`  [server:err] ${line}`);
		}
	});

	return child;
}

/** 等待伺服器就緒（輪詢 /health） */
async function waitForServer(): Promise<boolean> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE_URL}/health`);
			if (res.ok) return true;
		} catch {
			// 伺服器尚未就緒
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	return false;
}

/** 安全關閉伺服器 */
function stopServer(): void {
	if (serverProcess && !serverProcess.killed) {
		serverProcess.kill('SIGTERM');
		// 給 2 秒優雅關閉
		setTimeout(() => {
			if (serverProcess && !serverProcess.killed) {
				serverProcess.kill('SIGKILL');
			}
		}, 2000);
	}
}

// ── 測試案例 ─────────────────────────────────────────────────

async function testHealth(): Promise<void> {
	try {
		const res = await fetch(`${BASE_URL}/health`);
		const data = await res.json() as Record<string, unknown>;
		assert('/health returns 200', res.status === 200);
		assert('/health has status ok', data.status === 'ok');
		assert('/health has uptime', typeof data.uptime === 'number');
	} catch (err) {
		assert('/health returns 200', false, String(err));
	}
}

async function testMetrics(): Promise<void> {
	try {
		const res = await fetch(`${BASE_URL}/api/metrics`);
		const data = await res.json() as Record<string, unknown>;
		assert('/api/metrics returns 200', res.status === 200);
		assert('/api/metrics has agents count', typeof data.agents === 'number');
		assert('/api/metrics has heapUsedMB', typeof data.heapUsedMB === 'number');
		assert('/api/metrics has uptimeSeconds', typeof data.uptimeSeconds === 'number');
	} catch (err) {
		assert('/api/metrics returns 200', false, String(err));
	}
}

async function testAuthLogin(): Promise<void> {
	try {
		// 測試缺少 body 的情況
		const res = await fetch(`${BASE_URL}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: '', password: '' }),
		});
		// 預期 4xx（無效登入）
		assert('/api/auth/login rejects empty credentials', res.status >= 400 && res.status < 500);
	} catch (err) {
		assert('/api/auth/login rejects empty credentials', false, String(err));
	}
}

async function testSocketIO(): Promise<void> {
	try {
		// Socket.IO 握手使用 GET /socket.io/?EIO=4&transport=polling
		const res = await fetch(`${BASE_URL}/socket.io/?EIO=4&transport=polling`);
		assert('Socket.IO handshake returns 200', res.status === 200);
		const text = await res.text();
		// Socket.IO 回應格式：數字前綴 + JSON（例如 "0{...}"）
		assert('Socket.IO handshake returns valid response', text.length > 0 && text.includes('sid'));
	} catch (err) {
		assert('Socket.IO handshake returns 200', false, String(err));
	}
}

async function testStaticFiles(): Promise<void> {
	try {
		// 如果 client dist 不存在，伺服器仍應回應（404 或 index.html）
		const res = await fetch(`${BASE_URL}/`);
		assert('Root path responds', res.status < 500, `status=${res.status}`);
	} catch (err) {
		assert('Root path responds', false, String(err));
	}
}

// ── 主程式 ─────────────────────────────────────────────────────

async function run(): Promise<void> {
	log('Starting E2E smoke test...');
	log(`Server entry: ${SERVER_ENTRY}`);
	log(`Port: ${PORT}`);

	// 啟動伺服器
	serverProcess = startServer();
	serverProcess.on('exit', (code) => {
		if (code !== null && code !== 0) {
			log(`Server exited with code ${code}`);
		}
	});

	// 確保退出時清理
	process.on('SIGINT', () => { stopServer(); process.exit(1); });
	process.on('SIGTERM', () => { stopServer(); process.exit(1); });
	process.on('uncaughtException', (err) => {
		log(`Uncaught exception: ${err}`);
		stopServer();
		process.exit(1);
	});

	// 等待伺服器就緒
	log('Waiting for server to start...');
	const ready = await waitForServer();
	if (!ready) {
		log('FATAL: Server did not start within timeout');
		stopServer();
		process.exit(1);
	}
	log('Server is ready');

	// 執行測試
	log('--- Running tests ---');
	await testHealth();
	await testMetrics();
	await testAuthLogin();
	await testSocketIO();
	await testStaticFiles();

	// 輸出結果
	log('--- Results ---');
	log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);

	if (failed > 0) {
		log('FAILED tests:');
		for (const r of results) {
			if (!r.ok) log(`  - ${r.name}${r.error ? `: ${r.error}` : ''}`);
		}
	}

	// 清理
	stopServer();

	// 等待伺服器完全關閉
	await new Promise((r) => setTimeout(r, 1000));

	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	log(`Fatal error: ${err}`);
	stopServer();
	process.exit(1);
});
