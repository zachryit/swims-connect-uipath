// Maestro Case runtime client — drives the deployed case (SWIMSChildProtectionCase) over the
// UiPath REST APIs using the user-context PAT the gateway already holds (config.uipathToken).
//
// Why PAT-REST and not the `uip` CLI: the CLI authenticates as the External App (client-credentials),
// whose token has no user and is REJECTED by the Maestro runtime (process run / list → error). The
// PAT is user-context and works. Two surfaces are used:
//   - Orchestrator StartJobs  (start a CaseManagement instance from the release; OU = Shared folder id)
//   - PIMS  /pims_/api/v1/...  (read incidents, cancel; auth header is x-uipath-folderkey = folder KEY)
//   - Orchestrator Jobs        (lifecycle: the job Key == the Maestro instance/workflow id)
//
// Everything returns parsed JSON or null; nothing throws, so an undeployed/misconfigured case degrades
// to a logged no-op rather than crashing the gateway.

const START_JOBS = "/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs";

export class MaestroClient {
  constructor(config, logger) {
    this.logger = logger;
    this.token = config.uipathToken || "";
    const base = (config.uipathBaseUrl || "").replace(/\/$/, "");
    const org = config.uipathOrg || "";
    const tenant = config.uipathTenant || "";
    this.orchBase = `${base}/${org}/${tenant}/orchestrator_`;
    this.pimsBase = `${base}/${org}/${tenant}/pims_/api/v1`;
    this.folderId = config.uipathFolderId || null; // OU id for Orchestrator (StartJobs / Jobs)
    this.timeoutMs = config.maestroCliTimeoutMs || 60_000;
  }

  async #req(url, { method = "GET", headers = {}, body } = {}) {
    if (!this.token) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...headers },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger?.warn({ url, status: res.status, body: text.slice(0, 300) }, "Maestro REST non-OK");
        return null;
      }
      return text ? JSON.parse(text) : {};
    } catch (error) {
      this.logger?.error({ url, err: error?.message }, "Maestro REST call failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Start ONE CaseManagement instance from the release. Returns { instanceId } (== job key) or null.
  // inputs map to the case In-arguments ({ swimsCaseId, caseOwner }), serialized as the job's InputArguments.
  async startInstance(releaseKey, _folderKey, inputs) {
    if (!releaseKey || !this.folderId) return null;
    const data = await this.#req(`${this.orchBase}${START_JOBS}`, {
      method: "POST",
      headers: { "X-UIPATH-OrganizationUnitId": String(this.folderId) },
      body: {
        startInfo: {
          ReleaseKey: releaseKey,
          Strategy: "ModernJobsCount",
          JobsCount: 1,
          InputArguments: JSON.stringify(inputs || {}),
        },
      },
    });
    const job = data?.value?.[0];
    return job?.Key ? { instanceId: job.Key, raw: job } : null;
  }

  // Lifecycle via the Orchestrator job (Key == instance/workflow id).
  async jobState(instanceId) {
    if (!instanceId || !this.folderId) return null;
    const url = `${this.orchBase}/odata/Jobs?$filter=${encodeURIComponent(`Key eq ${instanceId}`)}&$select=Key,State,Info`;
    const data = await this.#req(url, { headers: { "X-UIPATH-OrganizationUnitId": String(this.folderId) } });
    return data?.value?.[0] || null;
  }

  // PIMS reads/writes use the folder KEY header.
  async getIncidents(instanceId, folderKey) {
    return this.#req(`${this.pimsBase}/instances/${instanceId}/incidents`, { headers: { "x-uipath-folderkey": folderKey } });
  }
  async cancelInstance(instanceId, folderKey, comment = "SWIMS case closed in Primero") {
    return this.#req(`${this.pimsBase}/instances/${instanceId}/cancel`, {
      method: "POST",
      headers: { "x-uipath-folderkey": folderKey },
      body: { comment },
    });
  }

  // Map an Orchestrator job State to a coarse lifecycle bucket.
  static lifecycle(job) {
    const s = String(job?.State || "").toLowerCase();
    if (!s) return "unknown";
    if (s === "successful" || s.includes("complet")) return "completed";
    if (s === "stopped" || s.includes("cancel")) return "canceled";
    if (s === "faulted" || s.includes("fault") || s.includes("fail")) return "faulted";
    if (s === "running" || s === "pending" || s === "resumed") return "running";
    return "running";
  }
}
