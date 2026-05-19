import type { TListStandardProps } from "./T-LIST-STANDARD";
import { TListStandard } from "./T-LIST-STANDARD";

export type TListWideProps = Omit<TListStandardProps, "width">;

/**
 * T-LIST-WIDE — wide-layout index list template.
 *
 * Same composition as T-LIST-STANDARD but rendered at max-w-screen-2xl.
 * Use for admin tabular data that benefits from more horizontal space.
 *
 * Wave 2 routes: /admin/users, /admin/users/audit, /admin/companies,
 * /admin/companies/[id]/social-profiles, /admin/batches/[siteId],
 * /admin/maintenance/social-connections, /admin/images
 */
export function TListWide(props: TListWideProps) {
  return <TListStandard {...props} width="wide" />;
}
