import test from "node:test";
import assert from "node:assert/strict";
import { InferenceMode } from "firebase/ai";
import { scrubPII, restorePII } from "../src/piiScrubber.js";
import { selectInferencePolicy, ANALYSIS_SCHEMA, VaultScribeEngine } from "../src/hybridRouter.js";

test("scrubPII redacts IBAN, EU VAT, Email, Phone, SSN, and Luhn-valid Card deterministically", () => {
  const raw = "Client Tax SI12345678, IBAN SI56 1910 0001 0123 456, email alice@example.eu, phone +386 40 555 123, SSN 123-45-6789.";
  const res = scrubPII(raw);
  assert.ok(res.redactionCount >= 5, `Expected >=5 redactions, got ${res.redactionCount}`);
  assert.ok(!res.sanitizedText.includes("SI12345678"));
  assert.ok(!res.sanitizedText.includes("alice@example.eu"));
  assert.ok(!res.sanitizedText.includes("123-45-6789"));
  assert.equal(restorePII(res.sanitizedText, res.tokenMap), raw);
});

test("selectInferencePolicy maps privacyLock, deepAudit, and hybrid default to real firebase/ai InferenceMode enums", () => {
  const locked = selectInferencePolicy({ textLength: 800, privacyLock: true });
  assert.equal(locked.mode, InferenceMode.ONLY_ON_DEVICE);
  assert.equal(locked.requiresPiiScrub, false);

  const hybrid = selectInferencePolicy({ textLength: 1200, privacyLock: false, deepAudit: false });
  assert.equal(hybrid.mode, InferenceMode.PREFER_ON_DEVICE);
  assert.equal(hybrid.requiresPiiScrub, true);

  const longDoc = selectInferencePolicy({ textLength: 9000, privacyLock: false, deepAudit: false });
  assert.equal(longDoc.mode, InferenceMode.ONLY_IN_CLOUD);
  assert.equal(longDoc.requiresPiiScrub, true);
});

test("VaultScribeEngine exports valid Firebase AI Logic Schema and handles unconfigured preview cleanly", async () => {
  assert.ok(ANALYSIS_SCHEMA);
  const engine = new VaultScribeEngine(null);
  const st = await engine.init();
  assert.equal(st.initialized, false);
  await assert.rejects(() => engine.analyzeDocument("Test NDA"), /Firebase AI Logic not configured/);
});
