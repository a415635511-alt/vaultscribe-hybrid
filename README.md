# VaultScribe Hybrid — Privacy-First Document & Contract Analyst Powered by Firebase AI Logic

**Hackathon**: `#BuildHybridAI 2026` (Firebase AI Logic Hybrid Inference — Web & Chrome Extension)  
**License**: Apache-2.0  
**Stack**: `firebase/ai` (`GoogleAIBackend`, `InferenceMode`, `InferenceSource`, `Schema`) + `firebase/app-check` + `firebase/remote-config` + `firebase/firestore` + Vite + Chrome Manifest V3 Side Panel

---

## Why Hybrid Inference Is Essential Here

Freelancers, legal teams, and patients hesitate to paste raw contracts, EU tax notices, bank IBANs, or medical invoices into cloud chatbots. Yet pure on-device small models cannot always handle long multi-page legal cross-references or devices without Chrome Gemini Nano enabled.

**VaultScribe Hybrid** solves both with a two-stage hybrid privacy architecture:
1. **Deterministic Local PII Shield (`src/piiScrubber.js`)**: Runs 100% locally in-browser with reversible placeholders (`[IBAN_1]`, `[EU_VAT_TAX_ID_1]`, `[EMAIL_1]`, `[PHONE_1]`, `[SSN_1]`, Luhn-verified `[CARD_1]`) before any bytes touch the cloud.
2. **Real Firebase AI Logic Hybrid Routing (`src/hybridRouter.js`)**:
   - **Default (`InferenceMode.PREFER_ON_DEVICE`)**: Executes on **Chrome Gemini Nano** on-device when available, and seamlessly falls back to **Cloud Gemini (`gemini-2.5-flash`)** on sanitized text when local AI is unavailable.
   - **Strict Privacy Lock (`InferenceMode.ONLY_ON_DEVICE`)**: Guarantees zero bytes leave the device.
   - **Deep Compliance Audit / Long Document (`InferenceMode.ONLY_IN_CLOUD`)**: Automatically escalates when document length exceeds the **Firebase Remote Config** threshold (`hybrid_local_char_limit`) — strictly after local PII scrubbing — returning structured JSON via `Schema.object(...)`.
3. **Full Firebase Ecosystem Integration**:
   - **Firebase App Check** (`initializeAppCheck` + debug token support)
   - **Firebase Remote Config** (`hybrid_local_char_limit` dynamic routing threshold)
   - **Cloud Firestore** (optional anonymized telemetry log storing only redaction counts, `inferenceSource`, and latency — never raw document text or PII)
   - **Dual Web + Chrome Manifest V3 Side Panel** (`chrome-extension/manifest.json`)

---

## Quick Start

```bash
git clone https://github.com/a415635511-alt/vaultscribe-hybrid.git
cd vaultscribe-hybrid
npm install
cp .env.example .env  # fill in your Firebase AI Logic Web Config
npm test              # runs 3/3 automated tests against real firebase/ai exports
npm run build         # builds production bundle into dist/
npm run dev           # launch local web app
```

### Load as Chrome Manifest V3 Side Panel Extension
1. Run `npm run build` and copy `chrome-extension/manifest.json` + `chrome-extension/background.js` into `dist/`.
2. Open `chrome://extensions` → Enable **Developer mode** → **Load unpacked** → select `dist/`.
