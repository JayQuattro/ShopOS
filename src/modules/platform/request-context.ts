import { cache } from "react";
import { headers } from "next/headers";

import { db } from "@/db/client";
import { getCurrentSession } from "@/modules/identity/session";

import {
  PlatformContextNotResolved,
  resolvePlatformContext,
  type PlatformContext,
} from "./authorization";

const REQUEST_ID_HEADER = "x-request-id";

export const getPlatformRequestContext = cache(async (): Promise<PlatformContext> => {
  const session = await getCurrentSession();
  if (!session) {
    throw new PlatformContextNotResolved("operator_grant_not_found");
  }

  const requestHeaders = await headers();
  const requestId = requestHeaders.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  return resolvePlatformContext({
    db,
    actorId: session.user.id,
    requestId,
  });
});
