type SourceTitleInput = {
  explicitTitle?: string | null;
  filename?: string | null;
  text?: string | null;
  summary?: string | null;
};

function collapseWhitespace(value: string) {
  return value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function trimNoise(value: string) {
  return value.replace(/^[#*_\-=\s]+|[#*_\-=\s]+$/g, "").replace(/[：:，,。；;]+$/g, "").trim();
}

function normalizeTitleCandidate(value: string | null | undefined, maxLength = 36) {
  if (!value) {
    return null;
  }

  const normalized = trimNoise(collapseWhitespace(value));
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function isLowSignalFilename(filename: string | null | undefined) {
  if (!filename) {
    return false;
  }

  const normalized = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");

  return /^(img|image|photo|picture|screenshot|screenrecording|screenrecorder|scan|document|file|mmexport|wechatimage|wxcamera|pxl)\d{0,}$/.test(
    normalized,
  )
    ? true
    : /^(img|image|photo|picture|screenshot|scan|mmexport|wechatimage)\d{6,}$/.test(normalized) ||
        /^(截图|屏幕截图|图片|照片|扫描件|微信图片|文档)\d*$/.test(filename.replace(/\.[^.]+$/, "").trim());
}

function titleFromFilename(filename: string | null | undefined) {
  if (!filename) {
    return null;
  }

  return normalizeTitleCandidate(filename.replace(/\.[^.]+$/, ""));
}

function titleFromText(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const firstMeaningfulLine = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return normalizeTitleCandidate(firstMeaningfulLine ?? null);
}

export function deriveSourceTitle(input: SourceTitleInput) {
  const filenameTitle = titleFromFilename(input.filename);
  const textTitle = titleFromText(input.text);
  const summaryTitle = titleFromText(input.summary);
  const lowSignalFilename = isLowSignalFilename(input.filename);

  return (
    normalizeTitleCandidate(input.explicitTitle) ??
    (lowSignalFilename ? null : filenameTitle) ??
    textTitle ??
    summaryTitle ??
    filenameTitle ??
    "未命名来源"
  );
}
