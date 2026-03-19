type IdentityCarrier = {
  applicableIdentities?: unknown;
  identityHint?: string | null;
};

export function normalizeApplicableIdentities(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、，,\n]/)
      : [];

  return Array.from(
    new Set(
      list
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeActiveIdentities(value: unknown) {
  return normalizeApplicableIdentities(value);
}

export function normalizeIdentityHint(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

export function matchesActiveIdentity(task: IdentityCarrier, activeIdentity: string | null | undefined) {
  return matchesActiveIdentities(task, activeIdentity ? [activeIdentity] : []);
}

export function matchesActiveIdentities(task: IdentityCarrier, activeIdentities: unknown) {
  const normalizedActiveIdentities = normalizeActiveIdentities(activeIdentities);
  const identities = normalizeApplicableIdentities(task.applicableIdentities);

  if (normalizedActiveIdentities.length === 0 || identities.length === 0) {
    return true;
  }

  return normalizedActiveIdentities.some((identity) => identities.includes(identity));
}

export function hasIdentityRestriction(task: IdentityCarrier) {
  return normalizeApplicableIdentities(task.applicableIdentities).length > 0;
}

export function describeIdentityScope(task: IdentityCarrier) {
  const identities = normalizeApplicableIdentities(task.applicableIdentities);
  if (identities.length === 0) {
    return task.identityHint || "未限定身份";
  }

  const label = `适用身份：${identities.join(" / ")}`;
  return task.identityHint ? `${label}；${task.identityHint}` : label;
}

export function describeActiveIdentitiesForPrompt(activeIdentities: unknown) {
  const identities = normalizeActiveIdentities(activeIdentities);
  if (identities.length === 0) {
    return "当前用户未设置明确身份，请按一般用户视角抽取需要执行或确认的任务。";
  }

  return `当前用户身份：${identities.join("、")}。若通知中同时出现多个对象或角色，请优先识别这些身份直接需要执行、跟进或确认的任务；其他角色任务除非也直接影响这些身份，否则不要作为主任务输出。`;
}
