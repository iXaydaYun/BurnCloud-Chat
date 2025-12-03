import Image from "next/image";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function renderAttachment(att: Attachment) {
  if (att.type === "image" && att.url) {
    return (
      <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
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
          className="max-h-64 w-full rounded-lg border bg-background shadow-sm"
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
      <div
        className={cn(
          "text-[11px] text-muted-foreground",
          message.role === "assistant" ? "text-left" : "text-right",
        )}
      >
        {new Date(message.createdAt).toLocaleTimeString()}
      </div>
      <div className="w-full whitespace-pre-wrap text-[15px] leading-7 text-foreground">
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
