import { NextResponse } from "next/server";

import { resolveProvider } from "@/lib/providers";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type AttachmentMeta = {
  type: "image" | "video";
  url?: string;
  mime?: string;
  size?: number;
  name?: string;
};

const encoder = new TextEncoder();

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: { message } }, { status });
}

function isChatMessageArray(val: unknown): val is ChatMessage[] {
  return (
    Array.isArray(val) &&
    val.length > 0 &&
    val.every(
      (m) =>
        m &&
        typeof m === "object" &&
        typeof (m as ChatMessage).content === "string" &&
        ["user", "assistant", "system"].includes((m as ChatMessage).role),
    )
  );
}

function isAttachmentArray(val: unknown): val is AttachmentMeta[] {
  if (!Array.isArray(val)) return false;
  return val.every((a) => {
    if (!a || typeof a !== "object") return false;
    const meta = a as AttachmentMeta;
    if (!["image", "video"].includes(meta.type)) return false;
    if (meta.size !== undefined && typeof meta.size !== "number") return false;
    if (meta.mime !== undefined && typeof meta.mime !== "string") return false;
    return true;
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch (_error) {
    return errorResponse("请求体需为 JSON", 400);
  }

  const {
    messages,
    model,
    provider: providerKey,
    attachments,
    options,
    systemPrompt,
    providerConfig,
  } = (body as Record<string, unknown>) ?? {};

  if (!isChatMessageArray(messages)) {
    return errorResponse("messages 必须为非空数组且包含 role/content", 400);
  }

  if (typeof model !== "string") {
    return errorResponse("model 必须为字符串", 400);
  }

  if (typeof providerKey !== "string") {
    return errorResponse("provider 必须为字符串", 400);
  }

  // 允许客户端传入的临时配置（用于本地调试/自定义网关），优先级高于 env
  const overrideBaseUrl =
    typeof (providerConfig as Record<string, unknown>)?.baseUrl === "string"
      ? (providerConfig as Record<string, string>).baseUrl
      : undefined;
  const overrideApiKey =
    typeof (providerConfig as Record<string, unknown>)?.apiKey === "string"
      ? (providerConfig as Record<string, string>).apiKey
      : undefined;
  const overrideModels = Array.isArray(
    (providerConfig as Record<string, unknown>)?.models,
  )
    ? ((providerConfig as Record<string, string[]>).models ?? [])
    : undefined;

  const provider = resolveProvider(providerKey, Boolean(overrideApiKey));
  if (!provider) {
    return errorResponse("未找到可用的 provider 或缺少对应密钥", 400);
  }

  const baseUrl = overrideBaseUrl ?? provider.baseUrl;
  const modelsAllow = overrideModels ?? provider.models;

  if (modelsAllow.length > 0 && !modelsAllow.includes(model)) {
    return errorResponse("model 不在该 provider 允许列表中", 400);
  }

  if (attachments !== undefined && !isAttachmentArray(attachments)) {
    return errorResponse("attachments 格式不合法", 400);
  }

  const streamFlag =
    typeof (options as Record<string, unknown>)?.stream === "boolean"
      ? (options as Record<string, boolean>).stream
      : true;

  const url = new URL(provider.path, baseUrl).toString();

  const upstreamBody = {
    model,
    messages: [
      ...(typeof systemPrompt === "string" && systemPrompt.trim()
        ? [{ role: "system", content: systemPrompt.trim() }]
        : []),
      ...messages,
    ],
    stream: streamFlag,
    ...(attachments ? { attachments } : {}),
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.headers ?? {}),
        ...(overrideApiKey
          ? { Authorization: `Bearer ${overrideApiKey}` }
          : {}),
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (_error) {
    return errorResponse("上游请求失败，请稍后重试", 502);
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const text = await upstreamResponse.text().catch(() => "");
    const masked =
      upstreamResponse.status === 401 || upstreamResponse.status === 403
        ? "上游认证失败，请检查密钥"
        : text || "上游返回异常";
    return errorResponse(masked, upstreamResponse.status || 502);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        controller.error(new Error("无法读取上游响应"));
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${String(error)}\n\n`),
        );
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type":
        upstreamResponse.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
