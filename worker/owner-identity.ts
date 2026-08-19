export type OwnerIdentityOptions = {
  ownerEmail?: string;
  ownerUserId?: string;
};

// Long-term authorization contract: these headers are trusted only because
// Sites dispatch owns and sanitizes them. The configured user ID is an exact
// per-Site SIWC allowlist. The email bridge is accepted only when dispatch also
// supplies a non-empty authenticated user ID; it must never become a standalone
// browser claim or replace server-side authorization.

function normalizedEmail(value?: string | null) {
  return value?.trim().toLocaleLowerCase("en-US") || null;
}

export function ownerIdentityConfigured(options: OwnerIdentityOptions) {
  return Boolean(options.ownerUserId?.trim() || normalizedEmail(options.ownerEmail));
}

export function isVerifiedOwnerRequest(request: Request, options: OwnerIdentityOptions) {
  const authenticatedUserId = request.headers.get("oai-authenticated-user-id")?.trim();
  if (!authenticatedUserId) return false;

  const configuredUserId = options.ownerUserId?.trim();
  if (configuredUserId && authenticatedUserId === configuredUserId) return true;

  const authenticatedEmail = normalizedEmail(request.headers.get("oai-authenticated-user-email"));
  const configuredEmail = normalizedEmail(options.ownerEmail);
  return Boolean(authenticatedEmail && configuredEmail && authenticatedEmail === configuredEmail);
}
