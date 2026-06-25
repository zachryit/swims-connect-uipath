const GREETING = `Hello! Welcome to SWIMS-Connect.
I can help you:
- Report a case
- Check case status
- Find social services
- Get help

Type a message or use a keyword to begin.`;

export function deterministicIntent(text) {
  const value = String(text || "").trim().toLowerCase();
  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening))[!. ]*$/.test(value)) return "greeting";
  if (/^(logout|log out|sign out|unlink)( me)?[!. ]*$/.test(value)) return "logout";
  if (/\b(log ?in|sign ?in|link (my )?(swims )?account)\b/.test(value)) return "login";
  if (/\b(case status|check (a |my )?case|list (my )?cases|my cases|how many cases|case count|cases so far|case analysis|analyse case|analyze case|schedule\b.*\breport|schedule(d)? report|report schedule|caseload|overdue tasks?|pending referrals?|my referrals?|service referrals?)\b/.test(value)) return "worker_only";
  if (/\b(how many|number of|total|count)\b.*\b(cases?|reports?)\b/.test(value)) return "worker_only";
  if (/\b(cases?|reports?)\b.*\b(so far|total|count|analysis|analytics|dashboard|summary|schedule|generate|generation)\b/.test(value)) return "worker_only";
  if (/\b(show|see|view|open|read|list|get|fetch)\b.*\b(cases?|reports?|analytics|analysis)\b/.test(value)) return "worker_only";
  return null;
}

export function isConsentReply(text) {
  const value = String(text || "").trim().toLowerCase();
  if (/^(yes|y|ok|okay|sure|you can|allowed)(\b|[,.!])/.test(value) || /^\+?\d[\d\s-]{7,}$/.test(value)) return true;
  if (/^(no|n|don't|do not|not allowed)(\b|[,.!])/.test(value)) return false;
  return null;
}

export { GREETING };
