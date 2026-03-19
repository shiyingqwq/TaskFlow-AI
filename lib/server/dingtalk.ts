import crypto from "crypto";

export type SendDingtalkTextOptions = {
  webhookUrl?: string | null;
  secret?: string | null;
  atAll?: boolean;
};

export type DingtalkResponse = {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
};

function createDingtalkSign(secret: string, timestamp: string) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", secret).update(stringToSign).digest("base64");
}

function buildSignedWebhookUrl(webhookUrl: string, secret?: string | null) {
  if (!secret) {
    return webhookUrl;
  }

  const timestamp = Date.now().toString();
  const sign = createDingtalkSign(secret, timestamp);
  const url = new URL(webhookUrl);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

export async function sendDingtalkText(content: string, options: SendDingtalkTextOptions = {}) {
  const webhookUrl = (options.webhookUrl ?? process.env.DINGTALK_WEBHOOK_URL ?? "").trim();
  const secret = (options.secret ?? process.env.DINGTALK_SECRET ?? "").trim();

  if (!webhookUrl) {
    throw new Error("未配置 DINGTALK_WEBHOOK_URL。");
  }

  const endpoint = buildSignedWebhookUrl(webhookUrl, secret || null);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content },
      at: {
        isAtAll: Boolean(options.atAll),
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as DingtalkResponse;

  if (!response.ok) {
    throw new Error(`钉钉请求失败（HTTP ${response.status}）。`);
  }

  if (typeof data.errcode === "number" && data.errcode !== 0) {
    throw new Error(`钉钉返回错误：${data.errcode} ${String(data.errmsg ?? "")}`.trim());
  }

  return data;
}
