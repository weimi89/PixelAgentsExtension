/** 密碼最小長度 */
const PASSWORD_MIN_LENGTH = 8;

export interface PasswordValidationResult {
	valid: boolean;
	error?: string;
}

/** 驗證密碼強度：至少 8 字元，含大小寫字母及數字 */
export function validatePassword(password: string): PasswordValidationResult {
	if (password.length < PASSWORD_MIN_LENGTH) {
		return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
	}
	if (!/[A-Z]/.test(password)) {
		return { valid: false, error: 'Password must contain at least one uppercase letter' };
	}
	if (!/[a-z]/.test(password)) {
		return { valid: false, error: 'Password must contain at least one lowercase letter' };
	}
	if (!/[0-9]/.test(password)) {
		return { valid: false, error: 'Password must contain at least one digit' };
	}
	return { valid: true };
}
