export type OwnerIdentityOptions = {
  ownerEmail?: string;
  ownerUserId?: string;
};

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
