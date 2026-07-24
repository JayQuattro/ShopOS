import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db/client";
import { listOperatorGrants } from "@/modules/platform/operator-grants";
import { getPlatformRequestContext } from "@/modules/platform/request-context";
import { GrantOperatorForm } from "./grant-operator-form";
import { RevokeAction } from "./revoke-action";

export default async function OperatorsPage(): Promise<React.ReactElement> {
  const context = await getPlatformRequestContext();
  const grants = await listOperatorGrants(db, context);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Platform operators</h1>
          <p className="text-sm text-muted-foreground">
            Manage operator grants, roles, and revocation.
          </p>
        </div>
        <GrantOperatorForm />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operator grants</CardTitle>
          <CardDescription>All grants including revoked and expired.</CardDescription>
        </CardHeader>
        <CardContent>
          {grants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No operator grants.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Operator</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 pr-4 font-medium">Granted by</th>
                  <th className="py-2 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id} className="border-b border-border/60">
                    <td className="py-3 pr-4">
                      <div className="flex flex-col">
                        <span className="font-medium">{grant.userDisplayName}</span>
                        <span className="text-xs text-muted-foreground">{grant.userEmail}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline">{grant.role}</Badge>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge
                        variant={
                          grant.status === "active"
                            ? "default"
                            : grant.status === "expiring"
                              ? "secondary"
                              : grant.status === "revoked"
                                ? "destructive"
                                : "secondary"
                        }
                      >
                        {grant.status}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {grant.expiresAt ? grant.expiresAt.toISOString().split("T")[0] : "Never"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {grant.grantedByDisplayName ?? "Bootstrap"}
                    </td>
                    <td className="py-3 pr-4">
                      {grant.status === "active" || grant.status === "expiring" ? (
                        <RevokeAction grantId={grant.id} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
