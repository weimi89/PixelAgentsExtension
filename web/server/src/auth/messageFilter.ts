/**
 * 訊息權限過濾 — 控制不同角色用戶可接收的訊息類型。
 * admin 可接收所有訊息；member 可接收自己代理的所有訊息，他人代理不收敏感訊息；
 * anonymous 僅接收非敏感訊息。
 */

/** anonymous 用戶不應收到的敏感訊息類型 */
export const SENSITIVE_MESSAGE_TYPES = new Set([
	'agentToolStart',
	'agentToolDone',
	'agentToolClear',
	'agentToolPermission',
	'agentToolPermissionClear',
	'subagentToolStart',
	'subagentToolDone',
	'subagentClear',
	'agentModel',
	'agentTranscript',
	'agentThinking',
	'agentGrowth',
]);

/** 檢查訊息是否應發送給該角色的 socket（舊版 API，保持向下相容） */
export function shouldSendMessage(socketRole: string, msgType: string): boolean {
	if (socketRole === 'admin' || socketRole === 'member') return true;
	// anonymous 不收敏感訊息
	return !SENSITIVE_MESSAGE_TYPES.has(msgType);
}

/**
 * 檢查代理相關訊息是否應發送給該 socket（P3.3 擴展版）。
 * member 只收自己代理的敏感訊息，他人的代理不收敏感訊息。
 * @param socketRole - socket 的角色
 * @param socketUserId - socket 使用者的 userId
 * @param msgType - 訊息類型
 * @param agentOwnerId - 代理所有者的 userId（可選，用於 member 級別過濾）
 */
export function shouldSendAgentMessage(
	socketRole: string,
	socketUserId: string | undefined,
	msgType: string,
	agentOwnerId?: string | null,
): boolean {
	if (socketRole === 'admin') return true;
	if (socketRole === 'anonymous') return !SENSITIVE_MESSAGE_TYPES.has(msgType);
	// member：非敏感訊息一律通過
	if (!SENSITIVE_MESSAGE_TYPES.has(msgType)) return true;
	// member：自己的代理收所有訊息，他人的代理不收敏感訊息
	if (socketRole === 'member') {
		// ownerId 為 null 的代理（本地掃描、未指派）→ 所有 member 都可收敏感訊息
		if (agentOwnerId == null) return true;
		return socketUserId != null && agentOwnerId === socketUserId;
	}
	return false;
}
