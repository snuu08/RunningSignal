const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "이메일을 입력해 주세요.";
  if (!EMAIL_RE.test(trimmed)) return "이메일 형식을 확인해 주세요.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  return null;
}

export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (trimmed.length < 2) return "닉네임은 2자 이상이어야 합니다.";
  if (trimmed.length > 12) return "닉네임은 12자 이하여야 합니다.";
  if (/\s{2,}/.test(trimmed)) return "연속 공백은 사용할 수 없습니다.";
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
