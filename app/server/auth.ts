import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, scrypt as rawScrypt, timingSafeEqual } from "node:crypto";

import { AppError } from "../core/model";

type Owner = { username: string; salt: string; hash: string };
export type Session = { id: string; csrf: string; expiresAt: number };
export class Auth {
  private owner?: Owner;
  private sessions = new Map<string, Session>();
  constructor(readonly state: string) {}
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
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    this.sessions.set(session.id, session);
    return session;
  }
  session(id?: string) {
    const s = id ? this.sessions.get(id) : undefined;
    if (s && s.expiresAt > Date.now()) return s;
    if (id) this.sessions.delete(id);
    return null;
  }
  logout(id: string) {
    this.sessions.delete(id);
  }
  private prune() {
    for (const [id, s] of this.sessions)
      if (s.expiresAt < Date.now()) this.sessions.delete(id);
    while (this.sessions.size > 1000)
      this.sessions.delete(this.sessions.keys().next().value!);
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
    for (const id of this.sessions.keys())
      if (id !== sessionId) this.sessions.delete(id);
    await fs.unlink(path.join(this.state, "initial-login.txt")).catch(() => {});
  }
}
