"use client";

import { useEffect, useMemo, useState } from "react";

import type { ChatMessage, Conversation } from "@/lib/types";

const STORAGE_KEY = "ai-chat-store-v1";
const CURRENT_KEY = "ai-chat-current-v1";

export type ChatStoreState = {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
};

const emptyState: ChatStoreState = { conversations: [], messages: {} };

function loadState(): ChatStoreState {
  if (typeof window === "undefined") return emptyState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as ChatStoreState;
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? {},
    };
  } catch (_error) {
    return emptyState;
  }
}

function persistState(state: ChatStoreState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_error) {
    // 忽略存储错误
  }
}

function loadCurrentId(conversations: Conversation[]): string {
  if (typeof window === "undefined") return conversations[0]?.id ?? "";
  const saved = window.localStorage.getItem(CURRENT_KEY);
  if (saved && conversations.find((c) => c.id === saved)) return saved;
  return conversations[0]?.id ?? "";
}

function persistCurrentId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CURRENT_KEY, id);
  } catch (_error) {
    // ignore
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
      buf[8] = (buf[8] & 0x3f) | 0x80; // variant
      const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createConversation(title = "新会话"): Conversation {
  const now = Date.now();
  return {
    id: generateId(),
    title,
    systemPrompt: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function useChatStore() {
  const [state, setState] = useState<ChatStoreState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string>("");

  useEffect(() => {
    const initial = loadState();
    if (initial.conversations.length === 0) {
      const first = createConversation("新的聊天");
      const next = { conversations: [first], messages: { [first.id]: [] } };
      setState(next);
      setCurrentId(first.id);
      persistState(next);
      persistCurrentId(first.id);
    } else {
      setState(initial);
      setCurrentId(loadCurrentId(initial.conversations));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    persistState(state);
  }, [state, loaded]);

  useEffect(() => {
    if (!loaded || !currentId) return;
    persistCurrentId(currentId);
  }, [currentId, loaded]);

  const currentConversationId = currentId || state.conversations[0]?.id || "";

  const actions = useMemo(
    () => ({
      addConversation(title?: string) {
        setState((prev) => {
          const emptyExisting = prev.conversations.find(
            (c) => (prev.messages[c.id]?.length ?? 0) === 0,
          );
          if (emptyExisting) {
            setCurrentId(emptyExisting.id);
            return {
              conversations: [
                { ...emptyExisting, updatedAt: Date.now() },
                ...prev.conversations.filter((c) => c.id !== emptyExisting.id),
              ],
              messages: prev.messages,
            };
          }

          const conv = createConversation(title ?? "新的聊天");
          setCurrentId(conv.id);
          return {
            conversations: [conv, ...prev.conversations],
            messages: { [conv.id]: [], ...prev.messages },
          };
        });
      },
      renameConversation(id: string, title: string) {
        setState((prev) => ({
          conversations: prev.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
          ),
          messages: prev.messages,
        }));
      },
      deleteConversation(id: string) {
        setState((prev) => {
          const conversations = prev.conversations.filter((c) => c.id !== id);
          const messages = { ...prev.messages };
          delete messages[id];
          const nextCurrent = conversations[0]?.id ?? "";
          setCurrentId(nextCurrent);
          return { conversations, messages };
        });
      },
      addMessage(message: ChatMessage) {
        setState((prev) => {
          const list = prev.messages[message.conversationId] ?? [];
          // 首条用户消息时，用消息内容更新会话标题，便于识别话题
          const isFirstUserMessage =
            list.length === 0 && message.role === "user";
          const nextTitle = isFirstUserMessage
            ? message.content.slice(0, 30)
            : undefined;
          return {
            conversations: prev.conversations.map((c) =>
              c.id === message.conversationId
                ? {
                    ...c,
                    title: nextTitle ? nextTitle : c.title,
                    updatedAt: Date.now(),
                  }
                : c,
            ),
            messages: {
              ...prev.messages,
              [message.conversationId]: [...list, message],
            },
          };
        });
      },
      updateMessage(
        conversationId: string,
        messageId: string,
        patch: Partial<ChatMessage> | ((msg: ChatMessage) => ChatMessage),
      ) {
        setState((prev) => {
          const list = prev.messages[conversationId] ?? [];
          const mapper =
            typeof patch === "function"
              ? patch
              : (m: ChatMessage) => ({ ...m, ...patch });
          return {
            conversations: prev.conversations,
            messages: {
              ...prev.messages,
              [conversationId]: list.map((m) =>
                m.id === messageId ? mapper(m) : m,
              ),
            },
          };
        });
      },
      updateStats(
        id: string,
        stats: {
          lastLatencyMs?: number;
          lastStatus?: number;
          lastProvider?: string;
        },
      ) {
        setState((prev) => ({
          conversations: prev.conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  stats: {
                    ...(c.stats ?? {}),
                    ...stats,
                  },
                  updatedAt: Date.now(),
                }
              : c,
          ),
          messages: prev.messages,
        }));
      },
      setCurrent(id: string) {
        setState((prev) => {
          const others = prev.conversations.filter((c) => c.id !== id);
          const current = prev.conversations.find((c) => c.id === id);
          if (!current) return prev;
          setCurrentId(id);
          return {
            conversations: [current, ...others],
            messages: prev.messages,
          };
        });
      },
      updateSystemPrompt(id: string, prompt: string) {
        setState((prev) => ({
          conversations: prev.conversations.map((c) =>
            c.id === id
              ? { ...c, systemPrompt: prompt, updatedAt: Date.now() }
              : c,
          ),
          messages: prev.messages,
        }));
      },
    }),
    [],
  );

  return {
    loaded,
    conversations: state.conversations,
    messages: state.messages,
    currentConversationId,
    actions,
  };
}
