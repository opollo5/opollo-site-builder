export { dispatch } from "./dispatch";
export { getNotifications, markAllRead } from "./queries";
export {
  resolveCompanyAdmins,
  resolveOpolloAdmins,
  resolveUserById,
  resolveUsersByIds,
  dedupeByEmail,
} from "./recipients";
export { EVENT_CHANNELS } from "./types";
export type {
  NotificationEvent,
  NotificationChannel,
  DispatchPayload,
  DispatchResult,
  ResolvedRecipient,
  RecipientKind,
} from "./types";
export type { InAppNotification } from "./queries";
