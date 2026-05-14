/**
 * PII Redaction Utilities
 *
 * Redacts personally identifiable information from log data before export.
 */

export function redactAccountNumber(fullNumber: string): string {
  if (!fullNumber || fullNumber.length < 4) return "XXXX";
  return "XXXX" + fullNumber.slice(-4);
}

export function redactAmount(amount: number): string {
  if (amount < 1000) return "<₹1k";
  if (amount < 10000) return "₹1k-10k";
  return ">₹10k";
}

export function redactPhoneNumber(phone: string): string {
  if (!phone || phone.length < 4) return "XXXX";
  return "XXXX" + phone.slice(-4);
}

export function redactEmail(email: string): string {
  if (!email || !email.includes('@')) return "redacted@***.com";
  const [local, domain] = email.split('@');
  return `${local}@***.com`;
}

export function redactContext(context: unknown): unknown {
  if (!context) return null;
  if (typeof context === 'string') {
    return context; // Don't redact string context (might be error message)
  }
  if (typeof context === 'object') {
    const obj = context as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('account') || key.toLowerCase().includes('number')) {
        redacted[key] = typeof value === 'string' ? redactAccountNumber(value) : value;
      } else if (key.toLowerCase().includes('amount')) {
        redacted[key] = typeof value === 'number' ? redactAmount(value) : value;
      } else if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) {
        redacted[key] = typeof value === 'string' ? redactPhoneNumber(value) : value;
      } else if (key.toLowerCase().includes('email')) {
        redacted[key] = typeof value === 'string' ? redactEmail(value) : value;
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }
  return context;
}
