import type { Metadata, Viewport } from "next";

import "./globals.css";

import { PwaRegister } from "@/components/pwa-register";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "面向学习、通知、线下材料流转场景的个人 AI 任务决策助手。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "任务助手",
  },
};

export const viewport: Viewport = {
  themeColor: "#b24b2a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <PwaRegister />
        <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 rounded-[28px] border border-[var(--line)] bg-[var(--panel)] px-5 py-4 shadow-[0_14px_40px_rgba(90,67,35,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Decision-first MVP</p>
                <h1 className="mt-2 text-2xl font-semibold text-[var(--text)]">{APP_NAME}</h1>
                <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                  把通知、截图、PDF 扔进来，系统自动拆任务、识别风险，并告诉你现在最该推进哪一步。
                </p>
              </div>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
