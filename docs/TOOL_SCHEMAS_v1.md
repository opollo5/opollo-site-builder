Tool Schemas — Opollo Site Builder
Version: 1.0
Status: Production contract
Every tool definition is the contract between Claude and the WordPress API. Input validation is enforced at the API layer before WordPress ever sees the call. Output is structured so Claude can react to success/failure deterministically.
Shared patterns
Standard success response
```json
{
  "ok": true,
  "data": { /* tool-specific */ },
  "validation": {
    "passed": true,
    "checks": ["structural", "html", "sanity"]
  },
  "ds_version": "1.2.0",
  "timestamp": "2026-04-18T14:30:00Z"
}
```
Standard error response
```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED | WP_API_ERROR | AUTH_FAILED | RATE_LIMIT | NETWORK_ERROR",
    "message": "human-readable summary",
    "details": { /* error-specific */ },
    "retryable": true | false,
    "suggested_action": "what Claude should try next"
  },
  "timestamp": "2026-04-18T14:30:00Z"
}
```
Universal input validation
Every tool call passes through pre-WP validation in the Next.js API route. Failures return `VALIDATION_FAILED` and never hit WordPress.
---
Page tools
`create_page`
Purpose: Create a WordPress page as a draft.
```typescript
{
  name: "create_page",
  description: "Create a new WordPress page as a draft. Page content must use only components from the locked design system and be wrapped in the scoped container per HC-2. Returns the page ID and preview URL.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 3,
        maxLength: 160
      },
      slug: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        maxLength: 100,
        description: "Kebab-case slug. No slashes, no uppercase, no special characters."
      },
      content: {
        type: "string",
        minLength: 200,
        description: "Full HTML body wrapped in scoped container per HC-2. Must use only design system components."
      },
      meta_description: {
        type: "string",
        minLength: 50,
        maxLength: 160
      },
      parent_slug: {
        type: "string",
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description: "Optional parent page slug for hierarchy"
      },
      template_type: {
        type: "string",
        enum: ["homepage", "integration", "troubleshooting", "problem_led", "use_case", "seo_landing", "blog", "legal", "generic"],
        description: "Template category — determines validation rules applied"
      },
      ds_version: {
        type: "string",
        pattern: "^\\d+\\.\\d+\\.\\d+$",
        description: "Design system version used to generate this page. Must match current system."
      }
    },
    required: ["title", "slug", "content", "meta_description", "template_type", "ds_version"]
  }
}
```
Validation pipeline (executed in order):
Schema validation — all required fields, correct types, pattern matches
Design system version match — rejects if `ds_version` doesn't match current
Wrapper check — content starts with `<div class="{prefix}-page {prefix}-page-{template_type}" data-ds-version="...">`
Class scope check — every class matches `^{prefix}-[a-z-]+$` and exists in design system
Forbidden patterns — no `<script>`, no `<iframe>` (unless whitelisted), no `<style>`, no external `href` to stylesheets
Structural check — required sections for `template_type` present
HTML validity — balanced tags, valid nesting, no malformed attributes
Slug uniqueness — no collision with existing pages
Content sanity — no lorem ipsum, no Claude disclaimers, no placeholder markers
Success response:
```json
{
  "ok": true,
  "data": {
    "page_id": 1247,
    "preview_url": "https://leadsource.co/?page_id=1247&preview=true",
    "admin_url": "https://leadsource.co/wp-admin/post.php?post=1247&action=edit",
    "slug": "gravity-forms-lead-tracking",
    "status": "draft"
  },
  "validation": { "passed": true, "checks": ["schema", "ds_version", "wrapper", "class_scope", "forbidden_patterns", "structural", "html", "slug_unique", "sanity"] },
  "ds_version": "1.2.0"
}
```
Failure modes:
```json
// Validation failure — Claude sees specific reason
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Content contains undefined CSS class 'ls-custom-hero'",
    "details": { "check": "class_scope", "offending_classes": ["ls-custom-hero"] },
    "retryable": true,
    "suggested_action": "Use ls-hero-default or ls-hero-split from design system, or call propose_design_system_addition"
  }
}

// WordPress API failure
{
  "ok": false,
  "error": {
    "code": "WP_API_ERROR",
    "message": "WordPress rejected content: invalid_json",
    "details": { "wp_response_code": 400, "wp_error": "..." },
    "retryable": false,
    "suggested_action": "Review content for invalid characters or malformed markup"
  }
}

// Design system version mismatch
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Page generated against DS v1.1.0 but current is v1.2.0",
    "details": { "provided": "1.1.0", "current": "1.2.0" },
    "retryable": true,
    "suggested_action": "Re-read design system and regenerate content"
  }
}
```
---
`update_page`
Purpose: Update an existing page. Respects HC-5 for destructive updates.
```typescript
{
  name: "update_page",
  description: "Update a page's content, title, or metadata. Updates to published pages with content changes >50% require user confirmation (HC-5).",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "integer", minimum: 1 },
      title: { type: "string", minLength: 3, maxLength: 160 },
      content: { type: "string", minLength: 200 },
      meta_description: { type: "string", minLength: 50, maxLength: 160 },
      ds_version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
      change_scope: {
        type: "string",
        enum: ["minor_edit", "section_replacement", "major_rewrite"],
        description: "Declared scope of change. major_rewrite on published pages requires confirmation."
      },
      user_confirmed: {
        type: "boolean",
        description: "Set true only when user has explicitly confirmed a destructive update this turn"
      }
    },
    required: ["page_id", "change_scope"]
  }
}
```
Validation: All create_page validations apply to `content` field if provided, plus HC-5 enforcement.
---
`publish_page` / `unpublish_page` / `delete_page`
```typescript
{
  name: "publish_page",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "integer", minimum: 1 }
    },
    required: ["page_id"]
  }
}

{
  name: "delete_page",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "integer", minimum: 1 },
      user_confirmed: { type: "boolean", const: true, description: "Must be true — deletion requires confirmation per HC-5" }
    },
    required: ["page_id", "user_confirmed"]
  }
}
```
Delete always goes to trash, never hard-delete. Recovery via WordPress admin is always available.
---
`list_pages` / `get_page` / `get_site_structure`
```typescript
{
  name: "get_site_structure",
  description: "Get complete current state of the site: all pages in tree form, all menus, homepage, available templates. Call at session start and when external changes suspected.",
  input_schema: { type: "object", properties: {} }
}
```
Returns the data that's injected into [5] Current Site Context at session start, refreshed.
---
Menu tools
`get_menu`
```typescript
{
  name: "get_menu",
  input_schema: {
    type: "object",
    properties: {
      menu_location: { type: "string", enum: ["primary", "footer", "mobile"] }
    },
    required: ["menu_location"]
  }
}
```
`add_to_menu`
Direct operation per WR-4. No confirmation needed for simple append.
```typescript
{
  name: "add_to_menu",
  description: "Add a page to a menu. For simple append to end of menu, no confirmation required. For nested or positioned adds, use propose_menu_change instead.",
  input_schema: {
    type: "object",
    properties: {
      menu_location: { type: "string", enum: ["primary", "footer", "mobile"] },
      page_id: { type: "integer", minimum: 1 },
      operation: {
        type: "string",
        enum: ["append_to_end"],
        description: "Only append_to_end allowed here. Other ops via propose_menu_change."
      }
    },
    required: ["menu_location", "page_id", "operation"]
  }
}
```
`propose_menu_change`
Anything structural per WR-4. Returns a proposal object — doesn't execute until user approves.
```typescript
{
  name: "propose_menu_change",
  description: "Propose a menu change that requires confirmation: removes, reorders, nesting, bulk updates. Returns a diff for user to approve. Use execute_menu_change with the proposal ID after approval.",
  input_schema: {
    type: "object",
    properties: {
      menu_location: { type: "string", enum: ["primary", "footer", "mobile"] },
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "remove", "move", "nest", "unnest", "rename"] },
            item_id: { type: "integer" },
            page_id: { type: "integer" },
            target_parent_id: { type: "integer" },
            target_position: { type: "integer" },
            new_label: { type: "string" }
          },
          required: ["action"]
        }
      },
      reason: {
        type: "string",
        description: "One-line explanation of what this change achieves. Shown to user with the diff."
      }
    },
    required: ["menu_location", "operations", "reason"]
  }
}
```
Response includes the tree diff the user sees in chat:
```json
{
  "ok": true,
  "data": {
    "proposal_id": "menu_prop_8a3f2",
    "diff_visual": "BEFORE:\n  • Home\n  • Services\n    └ Managed IT\n  • Contact\n\nAFTER:\n  • Home\n  • Services\n    ├ Managed IT\n    └ Cybersecurity  ← NEW\n  • Contact",
    "expires_in_seconds": 300
  }
}
```
`execute_menu_change`
```typescript
{
  name: "execute_menu_change",
  description: "Execute a previously proposed menu change after user approval. Proposal expires in 5 minutes.",
  input_schema: {
    type: "object",
    properties: {
      proposal_id: { type: "string", pattern: "^menu_prop_[a-z0-9]+$" },
      user_confirmed: { type: "boolean", const: true }
    },
    required: ["proposal_id", "user_confirmed"]
  }
}
```
---
Design system tools
`propose_design_system_addition`
This is the critical anti-improvisation mechanism. Claude calls this instead of improvising. Non-blocking — Claude continues with what it can do.
```typescript
{
  name: "propose_design_system_addition",
  description: "Flag that a requested page needs a component not in the design system. DO NOT improvise — use this tool. Does not block the session; you continue with what you can build. The user reviews and approves additions in the pending panel asynchronously.",
  input_schema: {
    type: "object",
    properties: {
      component_name: {
        type: "string",
        pattern: "^[a-z]+(-[a-z]+)*$",
        description: "Proposed kebab-case component name (will be prefixed automatically)"
      },
      purpose: {
        type: "string",
        minLength: 20,
        maxLength: 300,
        description: "What this component is for. When would it be used."
      },
      proposed_html: {
        type: "string",
        minLength: 50,
        description: "Suggested HTML structure including all CSS needed. Will be reviewed before adoption."
      },
      blocking_context: {
        type: "object",
        properties: {
          page_slug: { type: "string" },
          page_template: { type: "string" },
          section_purpose: { type: "string" }
        },
        required: ["page_slug", "section_purpose"]
      },
      existing_alternatives_considered: {
        type: "string",
        description: "Which existing design system components did you consider and why they didn't work."
      }
    },
    required: ["component_name", "purpose", "proposed_html", "blocking_context", "existing_alternatives_considered"]
  }
}
```
Response:
```json
{
  "ok": true,
  "data": {
    "proposal_id": "ds_add_4b8c1",
    "status": "pending_review",
    "panel_url": "/pending#ds_add_4b8c1",
    "note": "Flagged for review. Continue with alternative approach or skip this section."
  }
}
```
`get_design_system_section`
For when the full design system exceeds token budget. Loads specific sections on demand.
```typescript
{
  name: "get_design_system_section",
  input_schema: {
    type: "object",
    properties: {
      component_category: {
        type: "string",
        enum: ["heroes", "content_blocks", "ctas", "forms", "cards", "pricing", "faq", "testimonials", "footer_elements", "nav_elements"]
      }
    },
    required: ["component_category"]
  }
}
```
---
Batch tools
`start_batch_generation`
Enforces first-page-locks-template per WR-5.
```typescript
{
  name: "start_batch_generation",
  description: "Begin a batch generation. First page is generated normally. After user approval, template locks and remaining pages are constrained to match.",
  input_schema: {
    type: "object",
    properties: {
      batch_name: { type: "string", description: "e.g. 'WordPress integration pages'" },
      template_type: { type: "string" },
      pages: {
        type: "array",
        minItems: 2,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            brief: { type: "string", minLength: 20, maxLength: 500 },
            variables: { type: "object", description: "Template-specific variables e.g. {tool_name: 'Jotform'}" }
          },
          required: ["title", "slug", "brief"]
        }
      }
    },
    required: ["batch_name", "template_type", "pages"]
  }
}
```
Behaviour:
Generates first page from array
Returns with `batch_id` and `awaiting_template_lock: true`
User approves first page
Claude calls `lock_batch_template(batch_id)` which extracts structural pattern
Remaining pages generated under HC-6, each validated against locked template
Progress streamed via session log
`lock_batch_template` / `get_batch_status` / `cancel_batch`
Support tools for the batch lifecycle.
---
Media tools
`upload_media_from_url`
```typescript
{
  name: "upload_media_from_url",
  input_schema: {
    type: "object",
    properties: {
      source_url: { type: "string", format: "uri" },
      alt_text: { type: "string", minLength: 5, maxLength: 200 },
      title: { type: "string", maxLength: 100 }
    },
    required: ["source_url", "alt_text"]
  }
}
```
Alt text is required — no silent accessibility failures.
---
Meta tools
`get_session_log`
Lets Claude self-check what has been done in the session.
`refresh_site_context`
Re-fetches site structure mid-session. For when external changes are suspected.
---
Validation rules injected into system prompt
The following rules are injected into Section [6] so Claude generates valid output first time rather than looping on validation failures:
```
GENERATION-TIME VALIDATION RULES (enforce during writing, not after):

1. Every <div> or <section> that opens must have a matching closing tag before the page ends.
2. Every class attribute uses only prefixed classes from the design system.
3. Every link href is populated (no "#" placeholders).
4. Every image has alt text.
5. No <script>, <style>, <iframe> tags except where explicitly documented as component-level.
6. Heading hierarchy: exactly one h1, h2s before h3s, no skipped levels.
7. The wrapper div is the outermost element with correct data-ds-version attribute.
8. Meta description is 50-160 characters. Slug is kebab-case. Title is 3-160 characters.
9. No lorem ipsum, no "[INSERT]" markers, no Claude disclaimers, no incomplete sections.
10. Word count ranges per template type are documented in design system — stay within them.

Before calling create_page, mentally verify each rule. If any fails, fix before the call.
If a rule cannot be satisfied within the design system, use propose_design_system_addition.
```
This dual-layer approach (generation-time rules in prompt + API-layer validation) is what eliminates fix loops. Claude gets it right first time in 95%+ of cases; the validator catches the remaining edge cases with specific actionable errors.
