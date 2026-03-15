// ── 結構化日誌模組 ──────────────────────────────────────────
// 輕量級日誌模組，無外部依賴。
// - 生產環境（NODE_ENV=production）：JSON 格式輸出
// - 開發環境：彩色人類可讀格式

const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: '\x1b[90m',   // 灰色
	info: '\x1b[36m',    // 青色
	warn: '\x1b[33m',    // 黃色
	error: '\x1b[31m',   // 紅色
};

const RESET = '\x1b[0m';

function getConfiguredLevel(): LogLevel {
	const env = process.env['LOG_LEVEL']?.toLowerCase();
	if (env && env in LOG_LEVELS) return env as LogLevel;
	return 'info';
}

function isProduction(): boolean {
	return process.env['NODE_ENV'] === 'production';
}

function formatTimestamp(): string {
	return new Date().toISOString();
}

function logJson(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
	const entry: Record<string, unknown> = {
		level,
		ts: formatTimestamp(),
		msg,
	};
	if (data !== undefined) {
		entry.data = data;
	}
	const output = JSON.stringify(entry);
	if (level === 'error') {
		process.stderr.write(output + '\n');
	} else {
		process.stdout.write(output + '\n');
	}
}

function logPretty(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
	const color = LEVEL_COLORS[level];
	const ts = formatTimestamp().slice(11, 23); // HH:MM:SS.mmm
	const tag = level.toUpperCase().padEnd(5);
	let line = `${color}${ts} [${tag}]${RESET} ${msg}`;
	if (data !== undefined) {
		line += ` ${JSON.stringify(data)}`;
	}
	if (level === 'error') {
		process.stderr.write(line + '\n');
	} else {
		process.stdout.write(line + '\n');
	}
}

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[getConfiguredLevel()];
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
	if (!shouldLog(level)) return;
	if (isProduction()) {
		logJson(level, msg, data);
	} else {
		logPretty(level, msg, data);
	}
}

export const logger = {
	debug(msg: string, data?: Record<string, unknown>): void {
		log('debug', msg, data);
	},
	info(msg: string, data?: Record<string, unknown>): void {
		log('info', msg, data);
	},
	warn(msg: string, data?: Record<string, unknown>): void {
		log('warn', msg, data);
	},
	error(msg: string, data?: Record<string, unknown>): void {
		log('error', msg, data);
	},
} as const;
