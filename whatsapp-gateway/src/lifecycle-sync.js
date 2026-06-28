// Keep Maestro's monitor lifecycle aligned with confirmed Primero lifecycle writes.
// This module is intentionally pure apart from the injected monitor/logger so it can be tested
// without starting the WhatsApp or UiPath runtimes.

export async function syncClosedCaseMonitor(result, caseMonitor, logger) {
  if (result?.caseClosed !== true || !result?.closedCaseId) {
    return { ok: false, skipped: "no confirmed closure" };
  }
  try {
    const outcome = await caseMonitor.cancelForCase(result.closedCaseId);
    if (!outcome?.ok && outcome?.error !== "no monitor for case") {
      logger?.warn?.(
        { caseId: result.closedCaseId, error: outcome?.error },
        "Could not cancel Maestro monitor after Primero closure",
      );
    }
    return outcome;
  } catch (error) {
    logger?.error?.(
      { err: error?.message, caseId: result.closedCaseId },
      "Failed to cancel Maestro monitor after Primero closure",
    );
    return { ok: false, error: error?.message || String(error) };
  }
}
