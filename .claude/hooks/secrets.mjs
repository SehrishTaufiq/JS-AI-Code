// Secret patterns shared by the hooks.
// STRONG: high-confidence token formats. Used to keep files out of auto-commits and to mask
//         the prompt log. Few false positives in code.
// GENERIC: "password = ..." style assignments. Only used to mask the prompt log, where a false
//          positive just hides a few characters.

export const STRONG = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub classic tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, // GitHub fine-grained tokens
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, // Anthropic / OpenAI keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, // private keys
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, // credentials inside URLs (user:pass@host)
];

export const GENERIC = [
  /\b(aws_secret_access_key|password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b(\s*[:=]\s*)(["']?)[^\s"']{6,}\3/gi,
];

const fresh = (re) => new RegExp(re.source, re.flags);

export function findSecrets(text) {
  return STRONG.flatMap((re) => text.match(fresh(re)) || []);
}

export function redact(text) {
  let out = text;
  for (const re of STRONG) out = out.replace(fresh(re), '[REDACTED]');
  for (const re of GENERIC) out = out.replace(fresh(re), (_m, key, sep, q) => `${key}${sep}${q}[REDACTED]${q}`);
  return out;
}
