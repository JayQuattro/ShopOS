"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/i18n/formatters";

type Conversation = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastDirection: "outbound" | "inbound" | null;
  messageCount: number;
};

type Message = {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  createdAt: string;
  workOrderId: string | null;
  sentByDisplayName: string | null;
};

/**
 * Two-way texting inbox: conversation list on the left, thread and composer
 * on the right. Polls while open so inbound replies appear.
 */
export function SmsInbox({ orgPath }: { orgPath: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch(`${orgPath}/sms`);
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations ?? []);
    }
  }, [orgPath]);

  const loadThread = useCallback(
    async (conversationId: string) => {
      const res = await fetch(`${orgPath}/sms?conversationId=${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    },
    [orgPath],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        await loadConversations();
        if (!cancelled) setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadConversations]);

  // Poll the open thread for inbound replies.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      void loadThread(selectedId);
      void loadConversations();
    }, 10_000);
    return () => clearInterval(interval);
  }, [selectedId, loadThread, loadConversations]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const selected = conversations.find((conversation) => conversation.id === selectedId);

  async function send() {
    if (!selected || !draft.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${orgPath}/sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selected.customerId,
          to: selected.customerPhone,
          body: draft.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          sms_not_configured: "Texting isn't configured for this shop yet.",
          invalid_phone: "That number isn't a valid SMS destination.",
        };
        throw new Error(messages[data.error] ?? "Could not send the text.");
      }
      setDraft("");
      await loadThread(selected.id);
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the text.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No conversations yet. Text a customer from their profile or a work order.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(conversation.id);
                      void loadThread(conversation.id);
                    }}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      selectedId === conversation.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{conversation.customerName}</span>
                      {conversation.lastDirection === "inbound" ? (
                        <Badge variant="default" className="text-[10px]">
                          reply
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {conversation.lastMessagePreview ?? conversation.customerPhone}
                    </p>
                    {conversation.lastMessageAt ? (
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {formatDateTime(new Date(conversation.lastMessageAt), "UTC", "en-US")}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex min-h-[28rem] flex-col p-0">
          {selected ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium">
                  {selected.customerName}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {selected.customerPhone}
                  </span>
                </p>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      message.direction === "outbound"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-line">{message.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        message.direction === "outbound"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {message.direction === "outbound"
                        ? (message.sentByDisplayName ?? "Shop")
                        : "Customer"}{" "}
                      · {formatDateTime(new Date(message.createdAt), "UTC", "en-US")}
                    </p>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
              {error ? (
                <Alert variant="destructive" className="mx-4 mb-2">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <form
                className="flex gap-2 border-t border-border p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Text message…"
                  disabled={pending}

                  aria-label="Text message…"
                />
                <Button type="submit" disabled={pending || !draft.trim()}>
                  {pending ? "…" : "Send"}
                </Button>
              </form>
            </>
          ) : (
            <p className="m-auto text-sm text-muted-foreground">
              Select a conversation to read and reply.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
