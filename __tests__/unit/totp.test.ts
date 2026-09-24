import { generateTOTP, isValidTotpSecret, totpSecondsRemaining } from '@/utils/totp';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890" in base32; the RFC's
// 8-digit codes truncated to the last 6 digits.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('generateTOTP', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches RFC 6238 vector at T=%i', (seconds, expected) => {
    expect(generateTOTP(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('ignores spaces, padding and lowercase in the secret', () => {
    const messy = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq==';
    expect(generateTOTP(messy, 59_000)).toBe('287082');
  });
});

describe('totpSecondsRemaining', () => {
  it('counts down within the 30s window', () => {
    expect(totpSecondsRemaining(0)).toBe(30);
    expect(totpSecondsRemaining(29_000)).toBe(1);
    expect(totpSecondsRemaining(30_500)).toBe(30);
  });
});

describe('isValidTotpSecret', () => {
  it('accepts base32 secrets of at least 80 bits', () => {
    expect(isValidTotpSecret(RFC_SECRET)).toBe(true);
    expect(isValidTotpSecret('gezd gnbv gy3t qojq')).toBe(true);
  });

  it('rejects non-base32 or too-short input', () => {
    expect(isValidTotpSecret('')).toBe(false);
    expect(isValidTotpSecret('123456')).toBe(false);
    expect(isValidTotpSecret('ABCDEFGH')).toBe(false);
  });
});
