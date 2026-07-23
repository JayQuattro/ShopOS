export type DomainEvent<
  TType extends string = string,
  TData = Readonly<Record<string, unknown>>,
> = Readonly<{
  id: string;
  type: TType;
  organizationId: string;
  locationId?: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  data: TData;
}>;

export interface DomainEventRecorder {
  record(events: readonly DomainEvent[]): Promise<void>;
}
