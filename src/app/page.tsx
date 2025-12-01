"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageBubble } from "@/components/message-bubble";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/lib/store/chat-store";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROVIDER_OPTIONS = [
  {
    key: "openai",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4.1", "gpt-3.5-turbo"],
    capabilities: { vision: true },
  },
];

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_PROVIDER = "openai";

const PROMPT_TEMPLATES = [
  { label: "简洁回答", value: "请用简洁的要点回答用户问题。" },
  {
    label: "代码助手",
    value: "你是代码助手，回答时附上简短注释与复杂度提醒。",
  },
  {
    label: "多模态说明",
    value: "根据用户上传的图片或视频，先描述内容，再提出可能的改进建议。",
  },
];

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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentMessages = messages[currentConversationId] ?? [];
  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId,
  );

  const providerModels = useMemo(() => {
    const p = PROVIDER_OPTIONS.find((item) => item.key === provider);
    return p?.models ?? [];
  }, [provider]);

  useEffect(() => {
    if (!providerModels.includes(model)) {
      setModel(providerModels[0] ?? DEFAULT_MODEL);
    }
  }, [providerModels, model]);

  useEffect(() => {
    if (currentConversation?.systemPrompt !== undefined) {
      setSystemPrompt(currentConversation.systemPrompt ?? "");
    }
  }, [currentConversation?.systemPrompt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 需要在消息数量变化时滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [currentMessages.length]);

  const handleSend = async () => {
    if (
      (!input.trim() && pendingFiles.length === 0) ||
      !currentConversationId ||
      isSending
    )
      return;
    setError(null);
    const attachments = await uploadPendingFiles();
    if (attachments === null) {
      setIsSending(false);
      return;
    }
    actions.updateSystemPrompt(currentConversationId, systemPrompt);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      role: "user",
      content: input.trim(),
      status: "done",
      createdAt: Date.now(),
      attachments,
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
        messages: [
          ...(systemPrompt
            ? [{ role: "system" as const, content: systemPrompt }]
            : []),
          ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: userMessage.content },
        ],
        model,
        provider,
        options: { stream: true },
        attachments,
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
    setPendingFiles([]);
  };

  const handleStop = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsSending(false);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const next: File[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        setError("仅支持图片或视频文件");
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("文件大小需小于 5MB");
        continue;
      }
      next.push(file);
    }
    if (next.length) {
      setPendingFiles((prev) => [...prev, ...next]);
    }
  };

  async function uploadPendingFiles(): Promise<Attachment[] | null> {
    if (pendingFiles.length === 0) return [];
    const uploaded: Attachment[] = [];
    for (const file of pendingFiles) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const text = await res.text();
          setError(text || "上传失败");
          return null;
        }
        const json = (await res.json()) as {
          url: string;
          mime?: string;
          size?: number;
          name?: string;
        };
        uploaded.push({
          type: file.type.startsWith("image/") ? "image" : "video",
          url: json.url,
          mime: json.mime ?? file.type,
          size: json.size ?? file.size,
          name: json.name ?? file.name,
        });
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    }
    return uploaded;
  }

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
            <div
              key={conv.id}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-sm transition",
                conv.id === currentConversationId
                  ? "bg-background shadow-sm ring-1 ring-primary/40"
                  : "hover:bg-background",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => actions.setCurrent(conv.id)}
                >
                  <div className="line-clamp-1 font-medium">{conv.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(conv.updatedAt).toLocaleString()}
                  </div>
                </button>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    className="rounded px-1 hover:bg-accent"
                    onClick={() => {
                      const next = prompt("重命名会话", conv.title);
                      if (next?.trim()) {
                        actions.renameConversation(conv.id, next.trim());
                      }
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="rounded px-1 text-destructive hover:bg-accent"
                    onClick={() => {
                      if (confirm("确认删除该会话？")) {
                        actions.deleteConversation(conv.id);
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
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
          {currentConversation ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">系统提示</span>
              <textarea
                className="flex-1 min-w-[200px] rounded-md border bg-background px-2 py-1 text-xs"
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                disabled={isSending}
                placeholder="为当前会话设定系统提示"
              />
              <div className="flex flex-wrap gap-1">
                {PROMPT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    className="rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                    onClick={() => setSystemPrompt(tpl.value)}
                    disabled={isSending}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
                <MessageBubble key={msg.id} message={msg} />
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
                <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                    disabled={isSending}
                  />
                  添加图片/视频
                </label>
                {pendingFiles.length ? (
                  <span className="text-xs text-muted-foreground">
                    待发送文件：{pendingFiles.length} 个
                  </span>
                ) : null}
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
