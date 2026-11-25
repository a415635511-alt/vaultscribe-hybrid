import { scrubPII } from "./piiScrubber.js";
import { VaultScribeEngine, selectInferencePolicy } from "./hybridRouter.js";

const SAMPLE_CONTRACT = `INDEPENDENT CONTRACTOR AGREEMENT (EU / SLOVENIA)
Client: Alpine Robotics d.o.o., Tax ID SI12345678, Contact: legal@alpinerobotics.si, +386 40 555 123
Contractor: Janez Novak, IBAN SI56 1910 0001 0123 456, Email: janez.novak@example.eu

1. PAYMENT & PENALTY: Client shall pay EUR 4,500 within 60 days of invoice. Late deliverables incur a 25% liquidated penalty per week.
2. INTELLECTUAL PROPERTY: Contractor assigns all worldwide IP, including pre-existing open-source libraries used during engagement, irrevocably and without limitation.
3. NON-COMPETE: Contractor may not work for any AI, robotics, or software company globally for 36 months after termination without additional compensation.
4. LIABILITY: Contractor accepts unlimited personal liability for indirect and consequential damages.
`;

const $ = (id) => document.getElementById(id);

function updateRouteBadge() {
  const text = $("docInput").value;
  const policy = selectInferencePolicy({
    textLength: text.length,
    privacyLock: $("privacyLock").checked,
    deepAudit: $("deepAudit").checked,
  });
  const el = $("routeBadge");
  el.textContent = `Route: ${policy.mode}`;
  el.className = `pill ${policy.mode === "only_on_device" ? "pill-green" : policy.mode === "only_in_cloud" ? "pill-amber" : "pill-blue"}`;
}

async function detectChromeOnDeviceAI() {
  const el = $("chromeAiBadge");
  try {
    if (typeof LanguageModel !== "undefined" && typeof LanguageModel.availability === "function") {
      const status = await LanguageModel.availability();
      el.textContent = `Chrome Gemini Nano: ${status}`;
      el.className = `pill ${status === "available" ? "pill-green" : "pill-amber"}`;
      return;
    }
  } catch {
    // fallback below
  }
  el.textContent = "Chrome Gemini Nano: Cloud Fallback Active";
  el.className = "pill pill-amber";
}

function getFirebaseConfigFromUI() {
  const apiKey = $("cfgApiKey").value.trim() || import.meta.env.VITE_FIREBASE_API_KEY || "";
  const projectId = $("cfgProjectId").value.trim() || import.meta.env.VITE_FIREBASE_PROJECT_ID || "";
  const appId = $("cfgAppId").value.trim() || import.meta.env.VITE_FIREBASE_APP_ID || "";
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, appId };
}

$("loadSampleBtn").addEventListener("click", () => {
  $("docInput").value = SAMPLE_CONTRACT;
  updateRouteBadge();
});

$("docInput").addEventListener("input", updateRouteBadge);
$("privacyLock").addEventListener("change", updateRouteBadge);
$("deepAudit").addEventListener("change", updateRouteBadge);

$("scrubBtn").addEventListener("click", () => {
  const raw = $("docInput").value.trim();
  if (!raw) return;
  const res = scrubPII(raw);
  const banner = $("piiBanner");
  banner.classList.remove("hidden");
  banner.textContent = `Local PII Shield: Redacted ${res.redactionCount} sensitive item(s) offline (${res.detections.map((d) => `${d.token}`).join(", ") || "none"}). Zero bytes sent over network.`;
  const box = $("scrubPreviewBox");
  box.classList.remove("hidden");
  box.textContent = res.sanitizedText;
});

$("analyzeBtn").addEventListener("click", async () => {
  const raw = $("docInput").value.trim();
  if (!raw) return;
  const out = $("reportOutput");
  $("latencyLabel").textContent = "Running Firebase AI Logic…";
  out.innerHTML = '<p class="muted">Scrubbing PII locally and executing hybrid inference…</p>';

  try {
    const cfg = getFirebaseConfigFromUI();
    const engine = new VaultScribeEngine(cfg, {
      appCheckDebugToken: $("cfgDebugToken").value.trim() || import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true,
    });
    await engine.init();
    const res = await engine.analyzeDocument(raw, {
      privacyLock: $("privacyLock").checked,
      deepAudit: $("deepAudit").checked,
      saveAuditLog: true,
    });
    const t = res.telemetry;
    const a = res.analysis;
    $("latencyLabel").textContent = `${t.actualSource} · ${t.latencyMs} ms`;
    const banner = $("piiBanner");
    banner.classList.remove("hidden");
    banner.textContent = `Inference Source: ${t.actualSource} (requested ${t.requestedMode}) | Redacted ${t.piiRedactedCount} PII token(s) locally before model call.`;

    out.innerHTML = `
      <div class="card"><h3>${a.documentType || "Document"} — Risk: ${a.riskLevel || "MEDIUM"}</h3><p>${a.executiveSummary || ""}</p></div>
      <div class="card"><h3>Key Obligations</h3><ul>${(a.keyObligations || []).map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div class="card"><h3>High-Risk Clauses</h3><ul>${(a.riskClauses || []).map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <div class="card"><h3>Recommended Actions</h3><ul>${(a.recommendedActions || []).map((x) => `<li>${x}</li>`).join("")}</ul></div>
    `;
  } catch (err) {
    $("latencyLabel").textContent = "Config Needed / Error";
    out.innerHTML = `<div class="card"><h3>Runtime Status</h3><p>${String(err.message || err)}</p><p class="muted">Tip: Click "Preview Local PII Redaction" to test offline redaction immediately, or paste your Firebase AI Logic Web Config above.</p></div>`;
  }
});

detectChromeOnDeviceAI();
updateRouteBadge();
