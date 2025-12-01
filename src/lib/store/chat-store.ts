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

function createConversation(title = "新会话"): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
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
          const conv = createConversation(title ?? "新的聊天");
          return {
            conversations: [conv, ...prev.conversations],
            messages: { [conv.id]: [], ...prev.messages },
          };
        });
        setCurrentId((prev) => prev || crypto.randomUUID());
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
          return {
            conversations: prev.conversations.map((c) =>
              c.id === message.conversationId
                ? { ...c, updatedAt: Date.now() }
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
