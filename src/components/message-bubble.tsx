import Image from "next/image";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function renderAttachment(att: Attachment) {
  if (att.type === "image" && att.url) {
    return (
      <div className="overflow-hidden rounded-md border bg-background">
        <Image
          src={att.url}
          alt={att.name ?? "image"}
          width={800}
          height={800}
          className="h-auto max-h-64 w-full object-contain"
          priority={false}
          unoptimized
        />
      </div>
    );
  }

  if (att.type === "video" && att.url) {
    return (
      <>
        {/* biome-ignore lint/a11y/useMediaCaption: demo消息视频暂无字幕源 */}
        <video
          src={att.url}
          controls
          className="max-h-64 w-full rounded-md border bg-background"
          preload="metadata"
        />
      </>
    );
  }

  return null;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">
        {message.role === "assistant" ? "AI" : "你"}
        <span className="ml-2 text-[11px]">
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-md border px-3 py-2 text-sm",
          message.role === "assistant"
            ? "bg-muted/50"
            : "bg-primary text-primary-foreground border-primary/20",
        )}
      >
        {message.content || (message.status === "streaming" ? "…" : "")}
      </div>
      {message.attachments?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {message.attachments.map((att) => (
            <div key={att.url ?? att.name}>{renderAttachment(att)}</div>
          ))}
        </div>
      ) : null}
      {message.status === "error" ? (
        <div className="text-xs text-destructive">发送失败</div>
      ) : null}
    </div>
  );
}
