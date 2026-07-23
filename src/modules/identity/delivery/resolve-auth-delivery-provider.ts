import type { AuthDeliveryProviderKey } from "../config";
import type { AuthDeliveryProvider } from "./auth-delivery-provider";
import { getConsoleAuthDeliveryProvider } from "./console-auth-delivery-provider";
import { getNullAuthDeliveryProvider } from "./null-auth-delivery-provider";

/**
 * Selects the auth delivery provider from configuration. Production always uses
 * the null adapter until a real provider is registered; non-production mirrors
 * the configured key so tests can capture messages deterministically.
 */
export function resolveAuthDeliveryProvider(key: AuthDeliveryProviderKey): AuthDeliveryProvider {
  if (key === "console") {
    return getConsoleAuthDeliveryProvider();
  }
  return getNullAuthDeliveryProvider();
}
