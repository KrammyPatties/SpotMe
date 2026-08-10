export type MessageForLabel = {
  sender_id: string | null;
  type: string;
};

export function shouldShowSenderName(
  message: MessageForLabel,
  previous: MessageForLabel | null,
  viewerId: string,
  isGroup: boolean
): boolean {
  if (!isGroup) return false;
  if (message.type !== "user") return false;
  if (message.sender_id === null) return false;
  if (message.sender_id === viewerId) return false;
  if (previous === null) return true;
  if (previous.type !== "user") return true;
  return previous.sender_id !== message.sender_id;
}