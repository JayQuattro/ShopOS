/**
 * Generic (tenant-facing) email sending capability.
 *
 * Unlike the pre-tenant {@link import("@/modules/identity/delivery/auth-delivery-provider").AuthDeliveryProvider},
 * whose sends are fire-and-forget so recovery endpoints never crash, a generic
 * send REJECTS on delivery failure. Callers with retry semantics (the
 * transactional outbox) rely on the rejection to distinguish delivered from
 * failed.
 *
 * `organizationId` rides along so provider implementations and test captures
 * can attribute the send; transport adapters ignore it.
 *
 * Implementations must never log message bodies or recipient addresses.
 */
export interface GenericEmailSender {
  readonly key: string;

  sendRaw(
    input: Readonly<{ organizationId: string; to: string; subject: string; text: string }>,
  ): Promise<void>;
}
