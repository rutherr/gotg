// server/password.test.js
const { hashPassword, verifyPassword, isPasswordValid, MIN_PASSWORD_LENGTH } = require("./password");

let passed = 0, failed = 0;
function checkTrue(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

// --- hashPassword/verifyPassword: correct password verifies, wrong doesn't ---
{
  const hash = hashPassword("correct horse battery staple");
  checkTrue("verifyPassword accepts the correct password", verifyPassword("correct horse battery staple", hash));
  checkTrue("verifyPassword rejects a wrong password", !verifyPassword("wrong password", hash));
  checkTrue("verifyPassword rejects a missing hash without throwing", !verifyPassword("anything", undefined));
  checkTrue("verifyPassword rejects a malformed stored value without throwing", !verifyPassword("anything", "not-a-real-hash"));
}

// --- hashPassword: salted, so the same password hashes differently each time ---
{
  const a = hashPassword("same-password-123");
  const b = hashPassword("same-password-123");
  checkTrue("hashPassword salts (two hashes of the same password differ)", a !== b);
  checkTrue("...but both still verify correctly", verifyPassword("same-password-123", a) && verifyPassword("same-password-123", b));
}

// --- isPasswordValid ---
{
  checkTrue(`isPasswordValid accepts a ${MIN_PASSWORD_LENGTH}-char password`, isPasswordValid("a".repeat(MIN_PASSWORD_LENGTH)));
  checkTrue("isPasswordValid rejects a too-short password", !isPasswordValid("short1"));
  checkTrue("isPasswordValid rejects empty string", !isPasswordValid(""));
  checkTrue("isPasswordValid rejects non-string input", !isPasswordValid(undefined));
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
