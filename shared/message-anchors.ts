export const MESSAGE_ANCHOR_PREFIX = "message-";

export function messageAnchorId(messageId: string): string {
  return `${MESSAGE_ANCHOR_PREFIX}${messageId}`;
}

export function messageAnchorFragment(messageId: string): string {
  return `#${encodeURIComponent(messageAnchorId(messageId))}`;
}

export function messageAnchorHref(projectId: string, conversationId: string, messageId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}${messageAnchorFragment(messageId)}`;
}

export function messageIdFromAnchorHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;

  try {
    const anchorId = decodeURIComponent(hash.slice(1));
    if (!anchorId.startsWith(MESSAGE_ANCHOR_PREFIX)) return null;
    const messageId = anchorId.slice(MESSAGE_ANCHOR_PREFIX.length);
    return messageId.length > 0 ? messageId : null;
  } catch {
    return null;
  }
}
