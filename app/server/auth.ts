import fs from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as rawScrypt,
  timingSafeEqual,
} from "node:crypto";

import { AppError } from "../core/model";

type Owner = { username: string; salt: string; hash: string };
export type Session = { id: string; csrf: string; expiresAt: number };
type StoredSession = { csrf: string; expiresAt: number };
export type TokenInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};
type StoredToken = TokenInfo & { sha256: string };
export const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class Auth {
  private owner?: Owner;
  // Keyed by a hash of the cookie value so the saved file cannot be replayed.
  private sessions = new Map<string, StoredSession>();
  // The expiry each session has in sessions.json, to know when to rewrite it.
  private savedExpiry = new Map<string, number>();
  private tokens: StoredToken[] = [];
  private writes = Promise.resolve();
  constructor(
    readonly state: string,
    private clock: () => number = Date.now,
  ) {}
  // Session and token files are conveniences: an unreadable file means
  // "signed out" and "no agents connected", never a server that cannot start.
  private async readJson(name: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.state, name), "utf8"));
    } catch {
      return null;
    }
  }
  private async loadSessionsAndTokens() {
    const sessions = await this.readJson("sessions.json");
    this.sessions.clear();
    if (sessions && typeof sessions === "object")
      for (const [key, value] of Object.entries(sessions)) {
        const s = value as StoredSession;
        if (
          /^[a-f0-9]{64}$/.test(key) &&
          typeof s?.csrf === "string" &&
          typeof s?.expiresAt === "number" &&
          s.expiresAt > this.clock()
        )
          this.sessions.set(key, { csrf: s.csrf, expiresAt: s.expiresAt });
      }
    this.savedExpiry = new Map(
      [...this.sessions].map(([key, s]) => [key, s.expiresAt]),
    );
    const tokens = await this.readJson("tokens.json");
    this.tokens = Array.isArray(tokens)
      ? tokens.filter(
          (t: StoredToken) =>
            typeof t?.id === "string" &&
            typeof t?.name === "string" &&
            /^[a-f0-9]{64}$/.test(t?.sha256),
        )
      : [];
  }
  private save(name: string, value: unknown) {
    const file = path.join(this.state, name);
    this.writes = this.writes
      .then(async () => {
        const temp = file + "." + randomBytes(8).toString("hex") + ".tmp";
        await fs.writeFile(temp, JSON.stringify(value) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
        await fs.rename(temp, file);
      })
      .catch((error) =>
        console.error(`Todo could not save ${name}: ${(error as Error).message}`),
      );
  }
  private saveSessions() {
    this.savedExpiry = new Map(
      [...this.sessions].map(([key, s]) => [key, s.expiresAt]),
    );
    this.save("sessions.json", Object.fromEntries(this.sessions));
  }
  private saveTokens() {
    this.save("tokens.json", this.tokens);
  }
  /** Wait for pending session/token writes (tests and shutdown). */
  flush() {
    return this.writes;
  }
  private async validateState() {
    const stat = await fs.lstat(this.state);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Owner state must be an ordinary folder, not a symlink.");
  }
  async load() {
    await this.validateState();
    const file = path.join(this.state, "owner.json");
    const st = await fs.lstat(file);
    if (st.isSymbolicLink())
      throw new Error("Owner configuration cannot be a symlink.");
    const owner = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      typeof owner.username !== "string" ||
      typeof owner.salt !== "string" ||
      !/^([a-f0-9]{48})$/.test(owner.salt) ||
      typeof owner.hash !== "string" ||
      !/^([a-f0-9]{128})$/.test(owner.hash)
    )
      throw new Error("Invalid owner configuration.");
    this.owner = owner;
    await this.loadSessionsAndTokens();
  }
  private async digest(password: string, salt: string) {
    return new Promise<Buffer>((resolve, reject) =>
      rawScrypt(
        password,
        salt,
        64,
        { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  }
  async initialize() {
    await fs.mkdir(this.state, { recursive: true, mode: 0o700 });
    await this.validateState();
    try {
      await this.load();
      return null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const password = randomBytes(24).toString("base64url");
    const salt = randomBytes(24).toString("hex");
    const hash = (await this.digest(password, salt)).toString("hex");
    const owner = { username: "owner", salt, hash };
    const loginFile = path.join(this.state, "initial-login.txt");
    // Do not leave an owner account whose generated password was never saved.
    // An orphan login file also needs explicit repair rather than being replaced.
    try {
      await fs.writeFile(
        loginFile,
        `Todo self-hosted owner login\nUsername: owner\nPassword: ${password}\n\nChange this password in Settings → Vault & connection after signing in.\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error(
          "An initial-login.txt file exists without owner.json. Restore the account state from backup or move the orphan login file aside before restarting.",
        );
      throw error;
    }
    try {
      await fs.writeFile(
        path.join(this.state, "owner.json"),
        JSON.stringify(owner) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      await fs.unlink(loginFile).catch(() => {});
      throw error;
    }
    this.owner = owner;
    return loginFile;
  }
  async login(username: string, password: string) {
    if (!this.owner)
      throw new AppError(
        503,
        "OWNER_NOT_CONFIGURED",
        "The server owner account is not configured.",
      );
    const actual = await this.digest(password, this.owner.salt);
    const expected = Buffer.from(this.owner.hash, "hex");
    const correct =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!correct || username !== this.owner.username)
      throw new AppError(
        401,
        "LOGIN_FAILED",
        "Check your username and password. Your workspace has not changed.",
      );
    this.prune();
    const session = {
      id: randomBytes(32).toString("hex"),
      csrf: randomBytes(32).toString("hex"),
      expiresAt: this.clock() + WEEK,
    };
    this.sessions.set(sha256(session.id), {
      csrf: session.csrf,
      expiresAt: session.expiresAt,
    });
    this.saveSessions();
    return session;
  }
  /** A valid session is extended to a week from now each time it is used. */
  session(id?: string): Session | null {
    if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
    const key = sha256(id);
    const s = this.sessions.get(key);
    const now = this.clock();
    if (!s || s.expiresAt <= now) {
      if (s) {
        this.sessions.delete(key);
        this.saveSessions();
      }
      return null;
    }
    const expiresAt = now + WEEK;
    s.expiresAt = expiresAt;
    // Rewrite the file at most hourly, measured against what it holds.
    if (expiresAt - (this.savedExpiry.get(key) ?? 0) > HOUR) this.saveSessions();
    return { id, csrf: s.csrf, expiresAt };
  }
  logout(id: string) {
    if (id && this.sessions.delete(sha256(id))) this.saveSessions();
  }
  private prune() {
    for (const [id, s] of this.sessions)
      if (s.expiresAt < this.clock()) this.sessions.delete(id);
    while (this.sessions.size > 1000)
      this.sessions.delete(this.sessions.keys().next().value!);
  }
  listTokens(): TokenInfo[] {
    return this.tokens.map(({ sha256: _, ...info }) => info);
  }
  async createToken(name: string) {
    if (this.tokens.length >= 20)
      throw new AppError(
        400,
        "TOKEN_LIMIT",
        "Revoke an unused agent token before creating another.",
      );
    const token = "todo_pat_" + randomBytes(32).toString("base64url");
    const stored: StoredToken = {
      id: randomUUID(),
      name: name.trim() || "Agent",
      sha256: sha256(token),
      createdAt: new Date(this.clock()).toISOString(),
      lastUsedAt: null,
    };
    this.tokens.push(stored);
    this.saveTokens();
    await this.flush();
    const { sha256: _, ...info } = stored;
    return { token, info };
  }
  async revokeToken(id: string) {
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((t) => t.id !== id);
    if (this.tokens.length === before)
      throw new AppError(404, "TOKEN_NOT_FOUND", "This agent token no longer exists.");
    this.saveTokens();
    await this.flush();
  }
  /** Accepts an `Authorization: Bearer todo_pat_…` header value. */
  verifyToken(header?: string): TokenInfo | null {
    const match = /^Bearer (todo_pat_[A-Za-z0-9_-]{43})$/.exec(header ?? "");
    if (!match) return null;
    const digest = Buffer.from(sha256(match[1]), "hex");
    const found = this.tokens.find((t) =>
      timingSafeEqual(Buffer.from(t.sha256, "hex"), digest),
    );
    if (!found) return null;
    const now = this.clock();
    if (!found.lastUsedAt || now - Date.parse(found.lastUsedAt) > 60_000) {
      found.lastUsedAt = new Date(now).toISOString();
      this.saveTokens();
    }
    const { sha256: _, ...info } = found;
    return info;
  }
  async changePassword(sessionId: string, current: string, password: string) {
    if (!this.owner)
      throw new AppError(
        503,
        "OWNER_NOT_CONFIGURED",
        "The server owner account is not configured.",
      );
    const actual = await this.digest(current, this.owner.salt);
    const expected = Buffer.from(this.owner.hash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new AppError(
        400,
        "PASSWORD_INCORRECT",
        "The current password does not match.",
      );
    const salt = randomBytes(24).toString("hex");
    const owner = {
      username: this.owner.username,
      salt,
      hash: (await this.digest(password, salt)).toString("hex"),
    };
    const file = path.join(this.state, "owner.json");
    const temp = file + "." + randomBytes(8).toString("hex") + ".tmp";
    await fs.writeFile(temp, JSON.stringify(owner) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temp, file);
    this.owner = owner;
    const keep = sha256(sessionId);
    for (const id of this.sessions.keys())
      if (id !== keep) this.sessions.delete(id);
    // A password change is what someone does after a leak: disconnect agents too.
    this.tokens = [];
    this.saveSessions();
    this.saveTokens();
    await this.flush();
    await fs.unlink(path.join(this.state, "initial-login.txt")).catch(() => {});
  }
}
