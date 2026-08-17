"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Task = {
  id: string;
  position: number;
  title: string;
  status: "OPEN" | "DONE" | "NEEDS_ATTENTION" | "SKIPPED";
  outcomeNote: string | null;
};

const STATUS_LABELS: Record<Task["status"], string> = {
  OPEN: "open",
  DONE: "done",
  NEEDS_ATTENTION: "flagged",
  SKIPPED: "skipped",
};

export function TaskPanel({
  workOrderId,
  workOrderStatus,
  canWrite,
}: {
  workOrderId: string;
  workOrderStatus: string;
  canWrite: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const coConvertible =
    canWrite && (workOrderStatus === "AUTHORIZED" || workOrderStatus === "IN_PROGRESS");

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/tasks`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/tasks`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setTasks(data.tasks ?? []);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workOrderId]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (newTitle.trim().length < 3) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", title: newTitle.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invalid_title"
            ? "Give the task a clear name."
            : "Could not add the task.",
        );
      }
      setNewTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the task.");
    } finally {
      setPending(false);
    }
  }

  async function setStatus(task: Task, status: Task["status"]) {
    setPending(true);
    setError(null);
    try {
      let outcomeNote: string | undefined;
      if (status === "NEEDS_ATTENTION") {
        const note = window.prompt(
          `What did you find with "${task.title}"? This is shown to the customer.`,
          task.outcomeNote ?? "",
        );
        if (note === null) return;
        outcomeNote = note;
      }
      const res = await fetch(`/api/work-orders/${workOrderId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(outcomeNote !== undefined ? { outcomeNote } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "task_not_found"
            ? "That task no longer exists."
            : "Could not update the task.",
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the task.");
    } finally {
      setPending(false);
    }
  }

  async function convertFlagged() {
    if (
      !window.confirm(
        "Create a change order from the flagged items? You'll price the lines before sending it.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert-flagged" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          no_flagged_tasks: "No flagged items to convert.",
          work_order_not_authorized: "Change orders need an authorized work order.",
          change_order_pending_exists: "Resolve the pending change order first.",
        };
        throw new Error(messages[data.error] ?? "Could not create the change order.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the change order.");
    } finally {
      setPending(false);
    }
  }

  const flagged = tasks.filter((task) => task.status === "NEEDS_ATTENTION");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Tasks &amp; inspection
          {flagged.length > 0 ? (
            <Badge variant="destructive" className="ml-2">
              {flagged.length} flagged
            </Badge>
          ) : null}
        </CardTitle>
        {coConvertible && flagged.length > 0 ? (
          <Button size="sm" onClick={convertFlagged} disabled={pending}>
            Create change order from flagged
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {canWrite ? (
          <form onSubmit={addTask} className="flex gap-2">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Add an inspection item or task (e.g. Front brakes)"
              disabled={pending}
            />
            <Button type="submit" size="sm" disabled={pending || newTitle.trim().length < 3}>
              Add
            </Button>
          </form>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks yet. Add inspection items for the technician to check.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={`flex flex-wrap items-center justify-between gap-2 py-2 ${
                  task.status === "NEEDS_ATTENTION" ? "rounded-md bg-destructive/5 px-2" : ""
                }`}
              >
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {task.position}.
                    </span>
                    {task.title}
                  </p>
                  {task.outcomeNote ? (
                    <p className="text-xs text-muted-foreground">{task.outcomeNote}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      task.status === "NEEDS_ATTENTION"
                        ? "destructive"
                        : task.status === "DONE"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {STATUS_LABELS[task.status]}
                  </Badge>
                  {canWrite ? (
                    <div className="flex gap-1">
                      {task.status !== "DONE" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => void setStatus(task, "DONE")}
                        >
                          Pass
                        </Button>
                      ) : null}
                      {task.status !== "NEEDS_ATTENTION" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => void setStatus(task, "NEEDS_ATTENTION")}
                        >
                          Flag
                        </Button>
                      ) : null}
                      {task.status !== "SKIPPED" && task.status !== "DONE" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => void setStatus(task, "SKIPPED")}
                        >
                          Skip
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
