import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED = ["image/", "video/"];

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: { message: "未找到文件" } },
      { status: 400 },
    );
  }

  if (!ALLOWED.some((prefix) => file.type.startsWith(prefix))) {
    return NextResponse.json(
      { error: { message: "仅支持图片或视频文件" } },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: { message: "文件大小超出 5MB 限制" } },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  return NextResponse.json({
    url: dataUrl,
    thumbUrl: dataUrl,
    mime: file.type,
    size: file.size,
    name: file.name,
  });
}
