import { NextResponse } from "next/server";

import { getSessionCookieName } from "@/lib/auth/basic-session";

export async function POST() {
  const cookieName = getSessionCookieName();
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: cookieName,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return response;
}
