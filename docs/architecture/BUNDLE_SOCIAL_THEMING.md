# bundle.social hosted portal — theming and customisation

## What is customisable

The bundle.social hosted portal exposes a small set of **white-label visual fields**
that we pass via `socialAccountCreatePortalLink`. These are the only knobs available
on the hosted portal surface:

| Field | Type | Effect |
|---|---|---|
| `logoUrl` | `string` (absolute URL) | Replaces the bundle.social logo in the portal header with the supplied image |
| `userLogoUrl` | `string` (absolute URL) | Replaces the user avatar circle; we deliberately omit this — the placeholder avatar is fine until per-user avatars are wired |
| `userName` | `string` | Replaces the user name displayed in the portal header |
| `hidePoweredBy` | `boolean` | Hides the "Powered by bundle.social" footer badge |
| `hideGoBackButton` | `boolean` | Removes the back chevron from the portal nav |
| `hideUserLogo` | `boolean` | Hides the avatar area entirely |
| `hideUserName` | `boolean` | Hides the user name area entirely |
| `hideLanguageSwitcher` | `boolean` | Removes the language picker |
| `showModalOnConnectSuccess` | `boolean` | Shows a success modal inside the portal on connect |
| `language` | `"en" \| "pl" \| "fr" \| "hi" \| "sv" \| "de" \| "es" \| "it" \| "nl" \| "pt" \| "ru" \| "tr" \| "zh"` | Sets the portal UI language |

All fields are optional. We currently pass `logoUrl`, `userName`, and `language: "en"`.
`hidePoweredBy` is gated behind a TODO until companies have a paid-plan flag.

## What is NOT customisable

The bundle.social hosted portal has **no colour, theme, or CSS customisation API**.
There is no `primaryColor`, `theme`, `accentColor`, `stylesheet`, or `cssVariables`
parameter. The portal renders in bundle.social's own design system regardless of what
the operator passes.

If you need full visual control over the OAuth connect flow, the alternative is
**bundle.social's Custom UI** integration path:

- Instead of `socialAccountCreatePortalLink`, use the individual platform OAuth
  endpoints directly.
- Render your own UI shell around the OAuth flow.
- Handle the OAuth callback in your own route.

This is a significantly larger integration surface and is not currently planned.
The hosted portal with logo + name branding is the right trade-off for now.

## Where the fields are passed

`lib/platform/social/connections/initiate-connect.ts` — `InitiateConnectInput` type
and the `requestPayload` object in `initiateBundlesocialConnect`.

`app/api/platform/social/connections/connect/route.ts` — fetches brand profile +
company name, passes them through. Same pattern in `reconnect/route.ts`.

## Contract test coverage

`lib/__tests__/bundle-social.contract.test.ts` has a snapshot test for the branding
payload shape. Any change to which fields we send (or their values for a given input)
shows as a snapshot diff in the PR — treat it with the same scrutiny as a Zod schema
change at a route boundary.
