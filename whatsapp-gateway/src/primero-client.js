function setCookies(headers) {
  return typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
}

function cookieNamed(headers, name) {
  return setCookies(headers).map((v) => v.split(";", 1)[0]).find((v) => v.startsWith(`${name}=`)) || "";
}

function csrfToken(value) {
  return decodeURIComponent(String(value || "").split("=").slice(1).join("=") || String(value || ""));
}

export class PrimeroClient {
  constructor(config) { this.config = config; }

  async #fetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.primeroTimeoutMs);
    try { return await fetch(`${this.config.primeroBaseUrl}${path}`, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  async login(username, password) {
    const preflight = await this.#fetch("/identity_providers", { headers: { Accept: "application/json" } });
    const csrfCookie = cookieNamed(preflight.headers, "CSRF-TOKEN");
    const sessionCookie = cookieNamed(preflight.headers, "_app_session");
    if (!csrfCookie || !sessionCookie) throw new Error("Could not establish a SWIMS login session");
    const csrf = csrfToken(csrfCookie);
    const login = await this.#fetch("/tokens", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrf, Cookie: `${csrfCookie}; ${sessionCookie}` },
      body: JSON.stringify({ user: { user_name: username, password } })
    });
    if (!login.ok) throw new Error("Incorrect SWIMS username or password");
    const user = await login.json();
    const authenticatedCookie = cookieNamed(login.headers, "_app_session") || sessionCookie;
    const refresh = await this.#fetch("/identity_providers", { headers: { Cookie: authenticatedCookie } });
    const freshCsrf = cookieNamed(refresh.headers, "CSRF-TOKEN") || csrfCookie;
    return { cookie: authenticatedCookie, csrf: freshCsrf, user };
  }

  async request(session, method, path, body, query) {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== ""))}` : "";
    const headers = { Accept: "application/json", Cookie: session.cookie };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = csrfToken(session.csrf);
    return this.#fetch(`${path}${qs}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  async validate(session) { return this.request(session, "GET", "/cases", undefined, { per: 1 }); }
}

export class SessionManager {
  constructor(config, store) {
    this.config = config; this.store = store; this.client = new PrimeroClient(config); this.anon = null; this.owner = null;
  }

  async anonymous() {
    if (!this.config.primeroAnonUsername || !this.config.primeroAnonPassword) throw new Error("Anonymous SWIMS account is not configured");
    if (this.anon) {
      const check = await this.client.validate(this.anon);
      if (check.ok) return this.anon;
    }
    this.anon = await this.client.login(this.config.primeroAnonUsername, this.config.primeroAnonPassword);
    return this.anon;
  }

  // The worker that owns anonymous reports — the only account that can write attachments to
  // them (Primero scopes record access to the owner/assignee). Returns null if not configured
  // so callers can fall back to the anon account in local dev.
  async defaultOwner() {
    if (!this.config.primeroOwnerUsername || !this.config.primeroOwnerPassword) return null;
    if (this.owner) {
      const check = await this.client.validate(this.owner);
      if (check.ok) return this.owner;
    }
    this.owner = await this.client.login(this.config.primeroOwnerUsername, this.config.primeroOwnerPassword);
    return this.owner;
  }

  async worker(sender) {
    const saved = this.store.get(sender);
    if (!saved) return null;
    const check = await this.client.validate(saved);
    if (check.ok) return saved;
    try {
      const refreshed = await this.client.login(saved.username, saved.password);
      this.store.updateSession(sender, refreshed);
      return { ...saved, ...refreshed };
    } catch { this.store.logout(sender); return null; }
  }

  async login(sender, username, password) {
    const session = await this.client.login(username, password);
    this.store.save(sender, { username, password, ...session });
    return session;
  }

  logout(sender) { this.store.logout(sender); }
}
