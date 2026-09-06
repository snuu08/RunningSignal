import { RESET_TOKEN_TTL_MS } from "../../config/app.ts";
import { createToken, hashPassword, verifyPassword } from "../../domain/crypto.ts";
import type { AuthAccount, DemoMail, ResetToken } from "../../domain/models.ts";
import { normalizeEmail, validateEmail, validatePassword } from "../../domain/validation.ts";
import type { LocalStore } from "../../storage/local-store.ts";
import type { AuthProvider } from "../contracts/index.ts";

export function createMockAuth(store: LocalStore): AuthProvider {
  const readUsers = () => store.read<AuthAccount[]>("users", []);
  const writeUsers = (users: AuthAccount[]) => store.write("users", users);
  const readMails = () => store.read<DemoMail[]>("inbox", []);
  const writeMails = (mails: DemoMail[]) => store.write("inbox", mails);
  const readTokens = () => store.read<ResetToken[]>("resetTokens", []);
  const writeTokens = (tokens: ResetToken[]) => store.write("resetTokens", tokens);

  const persistSession = (account: AuthAccount | null, persist: boolean) => {
    if (!account) {
      store.remove("session");
      return;
    }
    store.write("session", { accountId: account.id, persist });
  };

  return {
    listAccounts() {
      return readUsers();
    },
    async signUp(email, password) {
      const emailError = validateEmail(email);
      if (emailError) throw new Error(emailError);
      const passwordError = validatePassword(password);
      if (passwordError) throw new Error(passwordError);
      const normalized = normalizeEmail(email);
      const users = readUsers();
      if (users.some((u) => u.email === normalized)) {
        throw new Error("이미 가입된 이메일입니다.");
      }
      const secret = await hashPassword(password);
      const account: AuthAccount = {
        id: crypto.randomUUID(),
        email: normalized,
        passwordSalt: secret.salt,
        passwordHash: secret.hash,
        createdAt: Date.now(),
        isDemoGuest: false,
      };
      writeUsers([...users, account]);
      persistSession(account, true);
      return account;
    },
    async login(email, password, persist) {
      const normalized = normalizeEmail(email);
      const account = readUsers().find((u) => u.email === normalized);
      if (!account) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
      const ok = await verifyPassword(password, account.passwordSalt, account.passwordHash);
      if (!ok) throw new Error("이메일 또는 비밀번호가 올바르지 않습니다.");
      persistSession(account, persist);
      return account;
    },
    async loginDemoGuest() {
      const users = readUsers();
      let account = users.find((u) => u.isDemoGuest);
      if (!account) {
        const secret = await hashPassword(createToken());
        account = {
          id: crypto.randomUUID(),
          email: "demo-guest@flowrun.local",
          passwordSalt: secret.salt,
          passwordHash: secret.hash,
          createdAt: Date.now(),
          isDemoGuest: true,
        };
        writeUsers([...users, account]);
      }
      persistSession(account, true);
      return account;
    },
    logout() {
      persistSession(null, false);
    },
    currentAccount() {
      const session = store.read<{ accountId: string } | null>("session", null);
      if (!session) return null;
      return readUsers().find((u) => u.id === session.accountId) ?? null;
    },
    async requestPasswordReset(email) {
      const normalized = normalizeEmail(email);
      const account = readUsers().find((u) => u.email === normalized);
      if (!account) {
        return { mail: null };
      }
      const token = createToken();
      const reset: ResetToken = {
        token,
        accountId: account.id,
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
        used: false,
      };
      writeTokens([...readTokens(), reset]);
      const mail: DemoMail = {
        id: crypto.randomUUID(),
        toEmail: account.email,
        subject: "비밀번호 재설정 (실제 메일은 발송되지 않습니다)",
        createdAt: Date.now(),
        resetToken: token,
      };
      writeMails([mail, ...readMails()]);
      return { mail };
    },
    async resetPassword(token, password) {
      const passwordError = validatePassword(password);
      if (passwordError) throw new Error(passwordError);
      const tokens = readTokens();
      const found = tokens.find((t) => t.token === token);
      if (!found) throw new Error("재설정 링크가 유효하지 않습니다.");
      if (found.used) throw new Error("이미 사용한 재설정 링크입니다.");
      if (found.expiresAt < Date.now()) throw new Error("재설정 링크가 만료되었습니다.");
      const secret = await hashPassword(password);
      writeUsers(
        readUsers().map((u) =>
          u.id === found.accountId
            ? { ...u, passwordSalt: secret.salt, passwordHash: secret.hash }
            : u,
        ),
      );
      writeTokens(tokens.map((t) => (t.token === token ? { ...t, used: true } : t)));
    },
    peekResetToken(token) {
      return readTokens().find((t) => t.token === token) ?? null;
    },
  };
}

export function readDemoInbox(store: LocalStore): DemoMail[] {
  return store.read<DemoMail[]>("inbox", []);
}
