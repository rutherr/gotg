// server/auth.test.js
const {
  OTP_LENGTH,
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  verifyOtpHash,
  isEmailValid,
  normalizeEmail,
} = require("./otp");

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  ok ? passed++ : failed++;
}
function checkTrue(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

// --- generateOtp: right shape ---
{
  const code = generateOtp();
  checkTrue(`generateOtp produces a ${OTP_LENGTH}-digit numeric string ('${code}')`, /^\d{6}$/.test(code) && code.length === OTP_LENGTH);
}

// --- hashOtp/verifyOtpHash: correct code verifies, wrong code doesn't ---
{
  const code = "482913";
  const hash = hashOtp(code);
  checkTrue("verifyOtpHash accepts the correct code", verifyOtpHash(code, hash));
  checkTrue("verifyOtpHash rejects a wrong code", !verifyOtpHash("000000", hash));
  checkTrue("verifyOtpHash rejects a missing hash without throwing", !verifyOtpHash(code, undefined));
}

// --- hashOtp: same code hashes the same way twice (needed for DB lookups) ---
{
  const a = hashOtp("111111");
  const b = hashOtp("111111");
  check("hashOtp is deterministic for the same code", a, b);
}

// --- email validation ---
{
  checkTrue("isEmailValid accepts a normal address", isEmailValid("player@example.com"));
  checkTrue("isEmailValid rejects a missing @", !isEmailValid("playerexample.com"));
  checkTrue("isEmailValid rejects empty string", !isEmailValid(""));
  checkTrue("isEmailValid rejects non-string input", !isEmailValid(undefined));
}

// --- normalizeEmail ---
{
  check("normalizeEmail lowercases and trims", normalizeEmail("  Player@Example.COM  "), "player@example.com");
}

// --- sanity on the exported constants other modules rely on ---
{
  checkTrue("OTP_TTL_MS is a positive number", typeof OTP_TTL_MS === "number" && OTP_TTL_MS > 0);
  checkTrue("MAX_ATTEMPTS is a positive integer", Number.isInteger(MAX_ATTEMPTS) && MAX_ATTEMPTS > 0);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
