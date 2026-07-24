import { getAuthConfig } from "./config";

export function hasTrustedMutationOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return false;
  }

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  const config = getAuthConfig();
  const trustedOrigins = new Set([
    new URL(config.baseURL).origin,
    ...config.trustedOrigins.map((candidate) => new URL(candidate).origin),
  ]);
  return trustedOrigins.has(origin);
}
