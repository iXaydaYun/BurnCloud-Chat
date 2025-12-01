"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useChatStore } from "@/lib/store/chat-store";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROVIDER_OPTIONS = [
  {
    key: "openai",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4.1", "gpt-3.5-turbo"],
  },
];

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_PROVIDER = "openai";

type StreamOptions = {
  controller: AbortController;
};

type ChatRequestPayload = {
  messages: { role: ChatMessage["role"]; content: string }[];
  model: string;
  provider: string;
  options?: { stream?: boolean };
  attachments?: unknown;
};

async function streamChat(
  payload: ChatRequestPayload,
  onDelta: (chunk: string) => void,
  onError: (message: string) => void,
  options: StreamOptions,
) {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      onError(text || "请求失败");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part
          .split("\n")
          .map((l) => l.replace(/^data: /, ""))
          .join("\n");
        if (line === "[DONE]") {
          return;
        }
        if (line) {
          onDelta(line);
        }
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    onError((error as Error).message);
  }
}

export default function Home() {
  const { loaded, conversations, messages, currentConversationId, actions } =
    useChatStore();
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentMessages = messages[currentConversationId] ?? [];

  const providerModels = useMemo(() => {
    const p = PROVIDER_OPTIONS.find((item) => item.key === provider);
    return p?.models ?? [];
  }, [provider]);

  useEffect(() => {
    if (!providerModels.includes(model)) {
      setModel(providerModels[0] ?? DEFAULT_MODEL);
    }
  }, [providerModels, model]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 需要在消息数量变化时滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [currentMessages.length]);

  const handleSend = async () => {
    if (!input.trim() || !currentConversationId || isSending) return;
    setError(null);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      role: "user",
      content: input.trim(),
      status: "done",
      createdAt: Date.now(),
    };
    actions.addMessage(userMessage);

    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      conversationId: currentConversationId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: Date.now(),
    };
    actions.addMessage(assistantMessage);
    setIsSending(true);
    setInput("");

    const controller = new AbortController();
    controllerRef.current = controller;

    await streamChat(
      {
        messages: currentMessages
          .map((m) => ({ role: m.role, content: m.content }))
          .concat({ role: "user", content: userMessage.content }),
        model,
        provider,
        options: { stream: true },
      },
      (delta) => {
        actions.updateMessage(currentConversationId, assistantId, (prev) => ({
          ...prev,
          content: prev.content + delta,
        }));
      },
      (msg) => {
        setError(msg);
        actions.updateMessage(currentConversationId, assistantId, {
          status: "error",
        });
      },
      { controller },
    );

    actions.updateMessage(currentConversationId, assistantId, {
      status: "done",
    });
    setIsSending(false);
    controllerRef.current = null;
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsSending(false);
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        正在加载会话...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-72 border-r bg-muted/30 p-4 md:flex md:flex-col md:gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">会话</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.addConversation()}
          >
            新建
          </Button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-sm transition",
                conv.id === currentConversationId
                  ? "bg-background shadow-sm ring-1 ring-primary/40"
                  : "hover:bg-background",
              )}
              type="button"
              onClick={() => actions.setCurrent(conv.id)}
            >
              <div className="line-clamp-1 font-medium">{conv.title}</div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(conv.updatedAt).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Provider</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={isSending}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Model</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSending}
            >
              {providerModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <div className="ml-auto text-sm text-destructive">{error}</div>
          ) : null}
        </header>

        <div className="flex flex-1 flex-col gap-4 px-4 py-4">
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto rounded-lg border bg-background p-4"
          >
            {currentMessages.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground">
                发送消息开始对话
              </div>
            ) : (
              currentMessages.map((msg) => (
                <div key={msg.id} className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {msg.role === "assistant" ? "AI" : "你"}
                    <span className="ml-2 text-[11px]">
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "whitespace-pre-wrap rounded-md border px-3 py-2 text-sm",
                      msg.role === "assistant"
                        ? "bg-muted/50"
                        : "bg-primary text-primary-foreground border-primary/20",
                    )}
                  >
                    {msg.content || (msg.status === "streaming" ? "…" : "")}
                  </div>
                  {msg.status === "error" ? (
                    <div className="text-xs text-destructive">发送失败</div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl border bg-background p-4 shadow-sm">
            <textarea
              className="h-24 w-full resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="输入消息，Shift+Enter 换行"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={isSending}
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                当前会话：{conversations[0]?.title ?? "-"}
              </div>
              <div className="flex items-center gap-2">
                {isSending ? (
                  <Button variant="outline" size="sm" onClick={handleStop}>
                    停止
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => void handleSend()}
                  disabled={isSending}
                >
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
