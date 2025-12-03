"use client";

import { PanelRightOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
    capabilities: { vision: true, video: false },
  },
];

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_PROVIDER = "openai";
const ROW_ESTIMATE = 120;
const OVERSCAN = 6;

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

type StreamOptions = { controller: AbortController };

type ChatRequestPayload = {
  messages: { role: ChatMessage["role"]; content: string }[];
  model: string;
  provider: string;
  options?: { stream?: boolean };
  attachments?: unknown;
};

function formatBytes(size: number) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1,
  );
  const value = size / 1024 ** idx;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
}

function formatDateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(timestamp));
}

const THREAD_MAX_WIDTH = {
  base: "96%",
  sm: "88%",
  lg: "78%",
};

async function streamChat(
  payload: ChatRequestPayload,
  onDelta: (chunk: string) => void,
  onError: (message: string) => void,
  options: StreamOptions,
): Promise<{ status: number; durationMs: number } | null> {
  const started = performance.now();
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
      return null;
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
          const ended = performance.now();
          return { status: res.status, durationMs: ended - started };
        }
        if (line) onDelta(line);
      }
    }
    const ended = performance.now();
    return { status: res.status, durationMs: ended - started };
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      onError((error as Error).message);
    }
    return null;
  }
}

export default function Home() {
  const { loaded, conversations, messages, currentConversationId, actions } =
    useChatStore();
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState(DEFAULT_PROVIDER);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [isSending, setIsSending] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [windowRange, setWindowRange] = useState({ start: 0, end: 50 });
  const [toast, setToast] = useState<{
    type: "error" | "info";
    message: string;
  } | null>(null);
  const lastPayloadRef = useRef<ChatRequestPayload | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [dialog, setDialog] = useState<
    | { type: "rename"; id: string; title: string }
    | { type: "delete"; id: string; title: string }
    | { type: null }
  >({ type: null });
  const [dialogInput, setDialogInput] = useState("");

  const currentMessages = messages[currentConversationId] ?? [];
  const currentConversation = conversations.find(
    (c) => c.id === currentConversationId,
  );
  const total = currentMessages.length;
  const providerModels = useMemo(() => {
    const p = PROVIDER_OPTIONS.find((item) => item.key === provider);
    return p?.models ?? [];
  }, [provider]);

  const canUploadMedia = useMemo(() => {
    const p = PROVIDER_OPTIONS.find((item) => item.key === provider);
    return Boolean(p?.capabilities?.vision || p?.capabilities?.video);
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

  // 切换会话重置窗口
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      const viewport = el.clientHeight ?? 0;
      const visibleCount = Math.ceil(viewport / ROW_ESTIMATE) + OVERSCAN * 2;
      setWindowRange({ start: Math.max(total - visibleCount, 0), end: total });
    } else {
      setWindowRange({ start: 0, end: Math.min(total, 50) });
    }
  }, [total]);

  // 消息增量时滚到底并刷新窗口
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    const viewport = el.clientHeight || 0;
    const visibleCount = Math.ceil(viewport / ROW_ESTIMATE) + OVERSCAN * 2;
    const startIndex = Math.max(
      0,
      Math.floor(el.scrollTop / ROW_ESTIMATE) - OVERSCAN,
    );
    setWindowRange({
      start: startIndex,
      end: Math.min(total, startIndex + visibleCount),
    });
    setIsAtBottom(true);
  }, [total]);

  useEffect(() => {
    if (dialog.type === "rename") {
      setDialogInput(dialog.title);
    }
  }, [dialog]);

  const jumpConversation = useCallback(
    (delta: number) => {
      if (!currentConversationId || conversations.length === 0) return;
      const idx = conversations.findIndex(
        (c) => c.id === currentConversationId,
      );
      if (idx === -1) return;
      const next = (idx + delta + conversations.length) % conversations.length;
      actions.setCurrent(conversations[next]?.id);
    },
    [actions, conversations, currentConversationId],
  );

  // 键盘快捷键：Cmd/Ctrl+K 聚焦输入，Alt+↑↓ 切会话，Esc 关闭侧栏/抽屉
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        jumpConversation(1);
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        jumpConversation(-1);
      }
      if (event.key === "Escape") {
        setShowSidebar(false);
        setShowContext(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jumpConversation]);

  const handleSend = async () => {
    if (
      (!input.trim() && pendingFiles.length === 0) ||
      !currentConversationId ||
      isSending
    )
      return;
    setError(null);
    if (pendingFiles.length && !canUploadMedia) {
      setError("当前 provider 不支持图片/视频，请切换支持视觉的模型");
      return;
    }
    const attachments = await uploadPendingFiles();
    if (attachments === null) {
      setIsSending(false);
      return;
    }

    const payload: ChatRequestPayload = {
      messages: [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...currentMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: input.trim() },
      ],
      model,
      provider,
      options: { stream: true },
      attachments,
    };
    lastPayloadRef.current = payload;
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

    const result = await streamChat(
      payload,
      (delta) => {
        actions.updateMessage(currentConversationId, assistantId, (prev) => ({
          ...prev,
          content: prev.content + delta,
        }));
      },
      (msg) => {
        setError(msg);
        setToast({ type: "error", message: msg });
        actions.updateMessage(currentConversationId, assistantId, {
          status: "error",
        });
      },
      { controller },
    );

    actions.updateMessage(currentConversationId, assistantId, {
      status: "done",
    });
    if (result) {
      actions.updateStats(currentConversationId, {
        lastLatencyMs: Math.round(result.durationMs),
        lastStatus: result.status,
        lastProvider: provider,
      });
      setToast({
        type: "info",
        message: `完成，耗时 ${Math.round(result.durationMs)}ms`,
      });
    }
    setIsSending(false);
    controllerRef.current = null;
    setPendingFiles([]);
  };

  const retryLast = async () => {
    const payload = lastPayloadRef.current;
    if (!payload || !currentConversationId || isSending) return;
    setInput("");
    setError(null);
    setToast(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsSending(true);
    const assistantId = crypto.randomUUID();
    actions.addMessage({
      id: assistantId,
      conversationId: currentConversationId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: Date.now(),
    });
    const result = await streamChat(
      payload,
      (delta) => {
        actions.updateMessage(currentConversationId, assistantId, (prev) => ({
          ...prev,
          content: prev.content + delta,
        }));
      },
      (msg) => {
        setError(msg);
        setToast({ type: "error", message: msg });
        actions.updateMessage(currentConversationId, assistantId, {
          status: "error",
        });
      },
      { controller },
    );
    actions.updateMessage(currentConversationId, assistantId, {
      status: "done",
    });
    if (result) {
      actions.updateStats(currentConversationId, {
        lastLatencyMs: Math.round(result.durationMs),
        lastStatus: result.status,
        lastProvider: provider,
      });
      setToast({
        type: "info",
        message: `重试成功，耗时 ${Math.round(result.durationMs)}ms`,
      });
    }
    setIsSending(false);
    controllerRef.current = null;
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

  const removePendingFile = (name: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
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
          setToast({ type: "error", message: text || "上传失败" });
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
        const msg = (err as Error).message;
        setError(msg);
        setToast({ type: "error", message: msg });
        return null;
      }
    }
    return uploaded;
  }

  const start = windowRange.start;
  const end = Math.min(windowRange.end, total);
  const visibleMessages = currentMessages.slice(start, end);
  const paddingTop = start * ROW_ESTIMATE;
  const paddingBottom = Math.max(total - end, 0) * ROW_ESTIMATE;
  const lastStats = currentConversation?.stats;
  const currentTitle = currentConversation?.title ?? "未命名会话";

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      setIsAtBottom(true);
    }
  };

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        正在加载会话...
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30 text-foreground">
      {/* 侧栏 */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r bg-sidebar p-4 shadow-lg transition-transform duration-200 md:static md:translate-x-0",
          showSidebar ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="会话列表"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-muted-foreground">
              会话
            </h2>
            <span className="text-[11px] text-muted-foreground">
              Alt+↑↓ 快速切换
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.addConversation()}
            aria-label="新建会话"
          >
            <Plus className="size-4" />
            <span className="sr-only">新建会话</span>
          </Button>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground shadow-sm">
              暂无会话，点击“新建”或使用 Alt+↑↓ 快速切换。
            </div>
          ) : null}
          {[...conversations]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((conv) => {
              const active = conv.id === currentConversationId;
              return (
                <div
                  key={conv.id}
                  className={cn(
                    "rounded-3xl border border-border/80 px-3 py-2 text-left text-sm transition",
                    active ? "bg-background" : "hover:bg-background/70",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        actions.setCurrent(conv.id);
                        setShowSidebar(false);
                      }}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="line-clamp-1 font-medium">
                            {conv.title || "未命名会话"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {new Date(conv.updatedAt).toLocaleString()}
                          </span>
                          {active ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                              当前
                            </span>
                          ) : null}
                        </div>
                        {conv.stats ? (
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {conv.stats.lastLatencyMs
                                ? `${conv.stats.lastLatencyMs}ms`
                                : "-"}
                            </span>
                            <span>状态 {conv.stats.lastStatus ?? "-"}</span>
                            <span>{conv.stats.lastProvider ?? ""}</span>
                          </div>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-accent"
                        title="重命名"
                        aria-label="重命名会话"
                        onClick={() =>
                          setDialog({
                            type: "rename",
                            id: conv.id,
                            title: conv.title,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-destructive hover:bg-accent"
                        title="删除"
                        aria-label="删除会话"
                        onClick={() =>
                          setDialog({
                            type: "delete",
                            id: conv.id,
                            title: conv.title,
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </aside>

      {/* 遮罩（移动端） */}
      {showSidebar ? (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm md:hidden"
          aria-label="关闭侧栏遮罩"
          onClick={() => setShowSidebar(false)}
        />
      ) : null}

      {/* 主区域 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 顶部状态条 */}
        <header className="sticky top-0 z-10 border-b bg-background/80 px-4 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={() => setShowSidebar((v) => !v)}
                aria-label="切换会话侧栏"
              >
                ☰
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={() => setShowContext((v) => !v)}
                aria-label="切换上下文面板"
              >
                ☰+
              </Button>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{currentTitle}</span>
                <span className="text-[11px] text-muted-foreground">
                  Enter 发送 · Shift+Enter 换行 · Cmd/Ctrl+K 聚焦输入
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Provider</span>
              <select
                className="rounded-md border bg-background px-2 py-1 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={isSending}
                aria-label="选择 Provider"
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
                aria-label="选择模型"
              >
                {providerModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs text-foreground">
              <span>最近</span>
              <span>{lastStats?.lastLatencyMs ?? "-"} ms</span>
              <span>状态 {lastStats?.lastStatus ?? "-"}</span>
              <span>{lastStats?.lastProvider ?? provider}</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {isSending ? (
                <Button variant="outline" size="sm" onClick={handleStop}>
                  停止
                </Button>
              ) : null}
              {lastPayloadRef.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void retryLast()}
                >
                  重试
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 px-4 py-4 overflow-hidden">
          {/* 消息 + 输入 */}
          <section className="flex flex-1 flex-col gap-3 overflow-hidden">
            <section
              ref={scrollRef}
              onScroll={() => {
                const el = scrollRef.current;
                if (!el) return;
                const viewport = el.clientHeight || 0;
                const visibleCount =
                  Math.ceil(viewport / ROW_ESTIMATE) + OVERSCAN * 2;
                const startIndex = Math.max(
                  0,
                  Math.floor(el.scrollTop / ROW_ESTIMATE) - OVERSCAN,
                );
                setWindowRange({
                  start: startIndex,
                  end: Math.min(total, startIndex + visibleCount),
                });
                const atBottom =
                  Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) <
                  40;
                setIsAtBottom(atBottom);
              }}
              className="relative h-full flex-1 overflow-y-auto rounded-xl border bg-card shadow-sm"
              aria-label="消息列表"
              aria-live="polite"
            >
              {total === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <div className="mx-auto max-w-md space-y-2 rounded-xl border bg-background/80 p-4 shadow-sm">
                    <div className="text-base font-semibold text-foreground">
                      发送消息开始对话
                    </div>
                    <div>试试上传图片/视频，或套用右侧的提示模板。</div>
                    <div className="flex flex-wrap justify-center gap-2 text-xs">
                      {PROMPT_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          className="rounded-md border px-2 py-1 hover:bg-accent"
                          onClick={() => setSystemPrompt(tpl.value)}
                          disabled={isSending}
                          aria-label={`应用模板 ${tpl.label}`}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 px-2 py-4 sm:px-4">
                  <ul
                    className="space-y-4"
                    style={{ paddingTop, paddingBottom }}
                  >
                    {visibleMessages.map((msg, idx) => {
                      const globalIndex = start + idx;
                      const prev = currentMessages[globalIndex - 1];
                      const needDate =
                        !prev ||
                        new Date(prev.createdAt).toDateString() !==
                          new Date(msg.createdAt).toDateString();
                      const needRoleHeader =
                        !prev || prev.role !== msg.role || needDate;
                      const isUser = msg.role === "user";
                      return (
                        <li key={msg.id} className="space-y-2">
                          {needDate ? (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="flex-1 border-t" />
                              <span className="rounded-full border bg-background px-2 py-0.5">
                                {formatDateLabel(msg.createdAt)}
                              </span>
                              <span className="flex-1 border-t" />
                            </div>
                          ) : null}
                          <div
                            className={cn(
                              "flex w-full items-start",
                              isUser ? "justify-end" : "justify-start",
                            )}
                          >
                            <div
                              className={cn(
                                "flex w-full items-start gap-3",
                                isUser
                                  ? "flex-row-reverse text-right"
                                  : "flex-row",
                              )}
                              style={{
                                maxWidth: `var(--thread-max-width, ${THREAD_MAX_WIDTH.lg})`,
                                width: "100%",
                              }}
                            >
                              <div className="flex-1 min-w-[140px] space-y-1">
                                {needRoleHeader ? (
                                  <div
                                    className={cn(
                                      "flex items-center gap-2 text-[11px] text-muted-foreground",
                                      isUser ? "justify-end" : "justify-start",
                                    )}
                                  >
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">
                                      {isUser ? "你" : "助手"}
                                    </span>
                                    <span>
                                      {new Date(
                                        msg.createdAt,
                                      ).toLocaleTimeString()}
                                    </span>
                                  </div>
                                ) : null}
                                <MessageBubble message={msg} />
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {total > end ? (
                    <div className="text-center text-xs text-muted-foreground">
                      已显示 {start + visibleMessages.length}/{total}{" "}
                      条，滚动加载更多
                    </div>
                  ) : null}
                </div>
              )}
              {!isAtBottom && total > 0 ? (
                <button
                  type="button"
                  className="absolute bottom-3 right-3 rounded-full border bg-background px-3 py-1 text-xs shadow-md hover:bg-accent"
                  onClick={scrollToBottom}
                  aria-label="回到底部"
                >
                  回到底部
                </button>
              ) : null}
            </section>

            <div
              className="rounded-2xl border bg-card p-4"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  快捷键：Enter 发送 · Shift+Enter 换行 · Cmd/Ctrl+K 聚焦输入
                </span>
                {canUploadMedia ? (
                  <span className="rounded-full bg-accent px-2 py-1 text-[11px]">
                    支持图片/视频，≤5MB
                  </span>
                ) : (
                  <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">
                    当前模型不支持视觉
                  </span>
                )}
              </div>

              {/* 待发送附件托盘 */}
              {pendingFiles.length ? (
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  {pendingFiles.map((file) => (
                    <div
                      key={file.name}
                      className="flex items-center justify-between rounded-lg border bg-muted/60 px-3 py-2 text-xs shadow-sm"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{file.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {file.type} · {formatBytes(file.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => removePendingFile(file.name)}
                        aria-label={`移除 ${file.name}`}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <textarea
                ref={inputRef}
                className="h-28 w-full resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                aria-label="消息输入框"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1",
                      !canUploadMedia && "cursor-not-allowed opacity-60",
                    )}
                    title={
                      canUploadMedia
                        ? "支持图片/视频上传"
                        : "当前 provider 不支持视觉能力"
                    }
                    aria-label="上传图片或视频"
                  >
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files)}
                      disabled={isSending || !canUploadMedia}
                    />
                    上传媒体
                  </label>
                  {PROMPT_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      className="rounded-md border px-2 py-1 hover:bg-accent"
                      onClick={() => setSystemPrompt(tpl.value)}
                      disabled={isSending}
                      aria-label={`应用模板 ${tpl.label}`}
                    >
                      {tpl.label}
                    </button>
                  ))}
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
                    aria-label="发送消息"
                  >
                    发送
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* 浮动上下文面板 */}
      <section
        className={cn(
          "fixed right-4 top-24 z-30 w-[320px] max-h-[70vh] overflow-y-auto rounded-2xl border bg-card p-4 shadow-lg transition-all duration-200",
          showContext
            ? "opacity-100 translate-y-0"
            : "pointer-events-none -translate-y-2 opacity-0",
        )}
        aria-label="上下文与提示面板"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground">
            上下文 & 提示
          </h3>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowContext(false)}
            aria-label="关闭上下文面板"
          >
            ✕
          </Button>
        </div>

        <div className="space-y-2 rounded-xl border bg-background p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>系统提示</span>
            <span>{systemPrompt.length} 字</span>
          </div>
          <textarea
            className="min-h-[120px] w-full resize-y rounded-lg border px-2 py-2 text-sm"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={isSending}
            aria-label="系统提示编辑"
            placeholder="为当前会话设定系统提示"
          />
          <div className="flex flex-wrap gap-2 text-xs">
            {PROMPT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                className="rounded-md border px-2 py-1 hover:bg-accent"
                onClick={() => setSystemPrompt(tpl.value)}
                disabled={isSending}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-xl border bg-background p-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between text-sm text-foreground">
            <span>模型能力</span>
            <span className="rounded-full bg-accent px-2 py-1 text-[11px]">
              {providerModels.length} 模型
            </span>
          </div>
          <div className="space-y-1">
            <div>视觉能力：{canUploadMedia ? "可用" : "当前不可用"}</div>
            <div>上传限制：图片/视频，单文件 ≤ 5MB</div>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border bg-background p-3 text-xs text-muted-foreground">
          <div className="text-sm text-foreground">常用操作</div>
          <ul className="space-y-1">
            <li>Enter 发送 · Shift+Enter 换行</li>
            <li>Cmd/Ctrl+K 聚焦输入</li>
            <li>Alt+↑↓ 切换会话</li>
            <li>Esc 关闭侧栏/面板</li>
          </ul>
        </div>
      </section>

      {/* 浮动开关按钮 */}
      <button
        type="button"
        className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border bg-background px-3 py-2 text-sm shadow-lg hover:bg-accent"
        onClick={() => setShowContext((v) => !v)}
        aria-label="切换上下文面板"
      >
        <PanelRightOpen className="size-4" />
        上下文
      </button>

      {toast ? (
        <output
          className={cn(
            "fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg",
            toast.type === "error"
              ? "bg-destructive text-destructive-foreground"
              : "bg-muted text-foreground",
          )}
          aria-live="polite"
        >
          {toast.message}
          {toast.type === "error" && lastPayloadRef.current ? (
            <Button
              variant="link"
              size="sm"
              className="ml-2 px-1 py-0 text-destructive-foreground underline"
              onClick={() => void retryLast()}
            >
              重试
            </Button>
          ) : null}
        </output>
      ) : null}

      {dialog.type ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {dialog.type === "rename" ? "重命名会话" : "删除会话"}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDialog({ type: null })}
                aria-label="关闭对话框"
              >
                ✕
              </Button>
            </div>
            <div className="mt-3 text-sm text-muted-foreground">
              {dialog.type === "rename"
                ? "输入新的会话名称："
                : `确定删除「${dialog.title}」吗？此操作不可撤销。`}
            </div>
            {dialog.type === "rename" ? (
              <input
                className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
                value={dialogInput}
                onChange={(e) => setDialogInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (dialogInput.trim()) {
                      actions.renameConversation(dialog.id, dialogInput.trim());
                      setDialog({ type: null });
                    }
                  }
                }}
              />
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialog({ type: null })}
              >
                取消
              </Button>
              {dialog.type === "rename" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (!dialogInput.trim()) return;
                    actions.renameConversation(dialog.id, dialogInput.trim());
                    setDialog({ type: null });
                  }}
                >
                  确定
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    actions.deleteConversation(dialog.id);
                    setDialog({ type: null });
                  }}
                >
                  删除
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
