/**
 * Deterministic local PII scrubber for EU/US legal, tax, medical & financial documents.
 * Runs 100% locally in-browser BEFORE any Firebase AI Logic cloud fallback is invoked.
 */

const RULES = [
  {
    type: "IBAN",
    regex: /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}(?:[\s-]?[A-Z0-9]{1,4})?\b/g,
  },
  {
    type: "EMAIL",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: "CARD",
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return false;
      // Luhn check to avoid false positives on regular document IDs
      let sum = 0;
      let alt = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alt) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
        alt = !alt;
      }
      return sum % 10 === 0;
    },
  },
  {
    type: "EU_VAT_TAX_ID",
    regex: /\b(?:SI|DE|FR|IT|ES|AT|NL|BE|PL|GB)\s?\d{8,12}\b/g,
  },
  {
    type: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: "PHONE",
    regex: /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?!\w)/g,
    validate: (m) => m.replace(/\D/g, "").length >= 9,
  },
];

/**
 * Redacts PII tokens with reversible deterministic placeholders (e.g. [IBAN_1], [EMAIL_1])
 * so cloud Gemini reasoning preserves entity relationships without ever seeing raw secrets.
 */
export function scrubPII(text) {
  const input = String(text ?? "");
  const map = {};
  const counts = {};
  const detections = [];
  let output = input;

  for (const rule of RULES) {
    output = output.replace(rule.regex, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      // Reuse placeholder if same raw value seen before
      for (const [placeholder, raw] of Object.entries(map)) {
        if (raw === match) return placeholder;
      }
      counts[rule.type] = (counts[rule.type] || 0) + 1;
      const token = `[${rule.type}_${counts[rule.type]}]`;
      map[token] = match;
      detections.push({ type: rule.type, token, preview: maskPreview(match) });
      return token;
    });
  }

  return {
    sanitizedText: output,
    redactionCount: detections.length,
    detections,
    tokenMap: map,
  };
}

export function restorePII(sanitizedOutput, tokenMap) {
  let restored = String(sanitizedOutput ?? "");
  for (const [token, raw] of Object.entries(tokenMap || {})) {
    restored = restored.split(token).join(raw);
  }
  return restored;
}

function maskPreview(val) {
  if (val.length <= 6) return "***";
  return `${val.slice(0, 3)}…${val.slice(-2)}`;
}
