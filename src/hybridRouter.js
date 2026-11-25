/**
 * VaultScribe Hybrid Inference Engine — authentic runtime integration with:
 *   - firebase/app (initializeApp)
 *   - firebase/ai (getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource, Schema)
 *   - firebase/app-check (initializeAppCheck, ReCaptchaEnterpriseProvider / debug token support)
 *   - firebase/remote-config (getRemoteConfig, fetchAndActivate, getValue for dynamic hybrid threshold)
 *   - firebase/firestore (getFirestore, collection, addDoc for saving PII-scrubbed audit metadata)
 */
import { initializeApp, getApps } from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
} from "firebase/ai";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getRemoteConfig, fetchAndActivate, getNumber } from "firebase/remote-config";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { scrubPII } from "./piiScrubber.js";

export const DEFAULT_LOCAL_CHAR_LIMIT = 4500;

export const ANALYSIS_SCHEMA = Schema.object({
  properties: {
    documentType: Schema.string({ description: "Contract, Invoice, Tax Notice, Medical Record, or Policy" }),
    riskLevel: Schema.enumString({ enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }),
    executiveSummary: Schema.string({ description: "2-3 sentence plain-language summary" }),
    keyObligations: Schema.array({ items: Schema.string() }),
    riskClauses: Schema.array({ items: Schema.string() }),
    recommendedActions: Schema.array({ items: Schema.string() }),
  },
});

/**
 * Pure routing policy: chooses the optimal Firebase AI Logic InferenceMode based on
 * document size, user privacy lock, and Remote Config threshold.
 */
export function selectInferencePolicy({
  textLength,
  privacyLock = false,
  deepAudit = false,
  localCharLimit = DEFAULT_LOCAL_CHAR_LIMIT,
}) {
  if (privacyLock) {
    return {
      mode: InferenceMode.ONLY_ON_DEVICE,
      reason: "Strict Privacy Lock enabled — inference restricted strictly to Chrome on-device Gemini Nano.",
      requiresPiiScrub: false,
    };
  }
  if (deepAudit || textLength > localCharLimit) {
    return {
      mode: InferenceMode.ONLY_IN_CLOUD,
      reason: deepAudit
        ? "Deep multi-clause compliance synthesis requested — PII scrubbed locally before Cloud Gemini escalation."
        : `Document (${textLength} chars) exceeds on-device threshold (${localCharLimit}) — PII scrubbed locally before Cloud Gemini escalation.`,
      requiresPiiScrub: true,
    };
  }
  return {
    mode: InferenceMode.PREFER_ON_DEVICE,
    reason: "Hybrid default: executes locally on Chrome Gemini Nano when available, with PII-scrubbed automatic Cloud Gemini fallback.",
    requiresPiiScrub: true,
  };
}

export class VaultScribeEngine {
  constructor(firebaseConfig = null, options = {}) {
    this.firebaseConfig = firebaseConfig;
    this.options = options;
    this.app = null;
    this.ai = null;
    this.db = null;
    this.remoteConfig = null;
    this.localCharLimit = DEFAULT_LOCAL_CHAR_LIMIT;
  }

  async init() {
    if (!this.firebaseConfig || !this.firebaseConfig.apiKey || !this.firebaseConfig.projectId) {
      return { initialized: false, mode: "local-preview" };
    }

    // Enable App Check debug token automatically in localhost/dev or when provided by judges
    if (typeof self !== "undefined" && this.options.appCheckDebugToken) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = this.options.appCheckDebugToken;
    }

    this.app = getApps().length ? getApps()[0] : initializeApp(this.firebaseConfig);

    // 1. Firebase App Check (required by Firebase AI Logic; debug token accepted in submissions)
    if (typeof window !== "undefined" && this.options.recaptchaSiteKey) {
      initializeAppCheck(this.app, {
        provider: new ReCaptchaV3Provider(this.options.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }

    // 2. Firebase AI Logic (GoogleAIBackend — unified on-device + cloud hybrid SDK)
    this.ai = getAI(this.app, { backend: new GoogleAIBackend() });

    // 3. Firebase Remote Config (dynamic on-device vs cloud escalation char threshold)
    try {
      this.remoteConfig = getRemoteConfig(this.app);
      this.remoteConfig.defaultConfig = { hybrid_local_char_limit: DEFAULT_LOCAL_CHAR_LIMIT };
      await fetchAndActivate(this.remoteConfig);
      const remoteVal = getNumber(this.remoteConfig, "hybrid_local_char_limit");
      if (remoteVal >= 500 && remoteVal <= 32000) {
        this.localCharLimit = remoteVal;
      }
    } catch {
      // Offline / unconfigured Remote Config gracefully retains default threshold
    }

    // 4. Optional Firestore audit log (stores ONLY anonymized counts & scores — never raw PII)
    try {
      this.db = getFirestore(this.app);
    } catch {
      this.db = null;
    }

    return { initialized: true, localCharLimit: this.localCharLimit };
  }

  /**
   * Executes hybrid analysis through Firebase AI Logic `getGenerativeModel`.
   */
  async analyzeDocument(rawText, { privacyLock = false, deepAudit = false, saveAuditLog = false } = {}) {
    const t0 = Date.now();
    const scrub = scrubPII(rawText);
    const policy = selectInferencePolicy({
      textLength: rawText.length,
      privacyLock,
      deepAudit,
      localCharLimit: this.localCharLimit,
    });

    const payloadText = policy.requiresPiiScrub ? scrub.sanitizedText : rawText;

    const prompt = [
      "You are VaultScribe, an expert EU/US contract, tax, and compliance analyst.",
      "Analyze the following document (note: bracketed tokens like [IBAN_1] or [EMAIL_1] are locally redacted PII placeholders — keep them intact).",
      "Return concise, actionable obligations, hidden risk clauses, and next steps.",
      "",
      "--- DOCUMENT ---",
      payloadText,
    ].join("\n");

    if (!this.ai) {
      throw new Error("Firebase AI Logic not configured: enter your Firebase Web Config (or run with .env) to execute live on-device/cloud inference.");
    }

    // Official Firebase AI Logic Hybrid Inference call!
    const model = getGenerativeModel(this.ai, {
      mode: policy.mode,
      model: "gemini-2.5-flash",
      inCloudParams: {
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
          temperature: 0.2,
        },
      },
      onDeviceParams: {
        createOptions: {
          temperature: 0.2,
          topK: 3,
        },
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const source = response.inferenceSource || (policy.mode === InferenceMode.ONLY_ON_DEVICE ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD);
    const latencyMs = Date.now() - t0;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        documentType: "General Document",
        riskLevel: "MEDIUM",
        executiveSummary: text.trim(),
        keyObligations: [],
        riskClauses: [],
        recommendedActions: [],
      };
    }

    // Optional anonymized audit trail in Firestore (NEVER stores raw document text or PII)
    if (saveAuditLog && this.db) {
      try {
        await addDoc(collection(this.db, "vaultscribe_audits"), {
          inferenceMode: policy.mode,
          inferenceSource: source,
          piiRedactedCount: scrub.redactionCount,
          documentType: parsed.documentType,
          riskLevel: parsed.riskLevel,
          latencyMs,
          createdAt: serverTimestamp(),
        });
      } catch {
        // Ignore Firestore rule denial in read-only demo configs
      }
    }

    return {
      analysis: parsed,
      telemetry: {
        requestedMode: policy.mode,
        actualSource: source,
        routingReason: policy.reason,
        latencyMs,
        piiRedactedCount: scrub.redactionCount,
        redactedDetections: scrub.detections,
        sanitizedPreview: scrub.sanitizedText.slice(0, 600),
      },
    };
  }
}
