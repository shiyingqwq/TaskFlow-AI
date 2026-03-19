import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "个人 AI 辅助任务决策系统",
    short_name: "任务助手",
    description: "把通知、截图、PDF 扔进来，自动拆解任务、提醒今天该做什么，并支持手机安装使用。",
    start_url: "/?section=today",
    display: "standalone",
    background_color: "#f6f1e8",
    theme_color: "#b24b2a",
    orientation: "portrait",
    icons: [
      {
        src: "/icon?size=192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon?size=512",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
