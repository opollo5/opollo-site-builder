export { issue, validate, consume, revoke, regenerate, hashToken } from "./service";
export { regenerateApprovalLink } from "./approval";
export { LINK_TTL_MS, SESSION_TTL_MS } from "./types";
export type {
  MagicLink,
  MagicLinkPurpose,
  IssueInput,
  IssueResult,
  ValidateResult,
  ConsumeResult,
} from "./types";
