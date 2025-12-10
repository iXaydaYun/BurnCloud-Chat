import { type NextRequest, NextResponse } from "next/server";

import {
  BASIC_USER_HEADER,
  findCredential,
  generateSessionValue,
  getLogoutCookieName,
  getSessionCookieName,
  getSessionTtlSeconds,
  loadBasicCredentials,
  verifySessionValue,
} from "@/lib/auth/basic-session";

const REALM = "BurnCloud AI Chat";

function unauthorized(message: string) {
  return new NextResponse(message || "需要 Basic Auth 登录", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

function missingConfiguration(message: string) {
  return new NextResponse(message, { status: 500 });
}

function passThrough(request: NextRequest, username: string) {
  const headers = new Headers(request.headers);
  headers.set(BASIC_USER_HEADER, username);
  return NextResponse.next({
    request: {
      headers,
    },
  });
}

function decodeBasicCredentials(authHeader: string | null) {
  if (!authHeader?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authHeader.slice(6).trim());
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const secret = process.env.BASIC_AUTH_SESSION_SECRET;
  if (!secret) {
    return missingConfiguration("BASIC_AUTH_SESSION_SECRET 未配置");
  }

  const credentials = loadBasicCredentials();
  if (credentials.length === 0) {
    return missingConfiguration("BASIC_AUTH_USERS 未配置");
  }

  const cookieName = getSessionCookieName();
  const logoutCookieName = getLogoutCookieName();
  const nextUrl = request.nextUrl;
  const isSecureCookie = nextUrl.protocol === "https:";
  const wantsLogout = nextUrl.pathname === "/logout";
  const hasLogoutFlag = request.cookies.get(logoutCookieName)?.value === "1";
  const authHeader = request.headers.get("authorization");

  if (wantsLogout) {
    if (!hasLogoutFlag) {
      const response = unauthorized("已退出登录");
      response.cookies.set({
        name: cookieName,
        value: "",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureCookie,
        maxAge: 0,
      });
      response.cookies.set({
        name: logoutCookieName,
        value: "1",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureCookie,
        maxAge: 300,
      });
      return response;
    }

    const decoded = decodeBasicCredentials(authHeader);
    if (!decoded) {
      return unauthorized("请重新登录");
    }
    const credential = findCredential(decoded.username, decoded.password);
    if (!credential) {
      return unauthorized("用户名或密码不正确");
    }

    const ttlSeconds = getSessionTtlSeconds();
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sessionValue = await generateSessionValue(
      decoded.username,
      expiresAt,
      secret,
    );
    const redirectTo = nextUrl.searchParams.get("next") ?? "/";
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    response.cookies.set({
      name: cookieName,
      value: sessionValue,
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie,
      path: "/",
      maxAge: ttlSeconds,
    });
    response.cookies.set({
      name: logoutCookieName,
      value: "",
      path: "/",
      maxAge: 0,
    });
    return response;
  }
  const sessionCookie = request.cookies.get(cookieName)?.value;
  if (sessionCookie) {
    const payload = await verifySessionValue(sessionCookie, secret);
    if (payload) {
      return passThrough(request, payload.username);
    }
  }

  const decoded = decodeBasicCredentials(authHeader);
  if (!decoded) {
    return unauthorized("未提供 Basic Auth 凭据");
  }

  const credential = findCredential(decoded.username, decoded.password);
  if (!credential) {
    return unauthorized("用户名或密码不正确");
  }

  const ttlSeconds = getSessionTtlSeconds();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sessionValue = await generateSessionValue(
    decoded.username,
    expiresAt,
    secret,
  );
  const response = passThrough(request, decoded.username);
  response.cookies.set({
    name: cookieName,
    value: sessionValue,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie,
    path: "/",
    maxAge: ttlSeconds,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
