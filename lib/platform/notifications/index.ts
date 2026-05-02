export { dispatch } from "./dispatch";
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
