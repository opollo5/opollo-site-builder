export type PlatformCompany = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  timezone: string;
  is_opollo_internal: boolean;
  approval_default_required: boolean;
  approval_default_rule: "any_one" | "all_must";
  concurrent_publish_limit: number;
  created_at: string;
  updated_at: string;
};

export type PlatformCompanyListItem = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  timezone: string;
  is_opollo_internal: boolean;
  // Member count is denormalised on read for the list view; cheap join.
  member_count: number;
  created_at: string;
};
