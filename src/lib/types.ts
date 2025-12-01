export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageStatus = "pending" | "streaming" | "done" | "error";

export type Attachment = {
  type: "image" | "video";
  url?: string;
  mime?: string;
  size?: number;
  name?: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: MessageStatus;
  createdAt: number;
  attachments?: Attachment[];
};
