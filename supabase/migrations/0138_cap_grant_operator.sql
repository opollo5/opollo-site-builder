-- Grant CAP operator access to the primary Opollo admin account.
-- is_cap_operator enables access to CAP admin UI and all /api/platform/cap/* routes.
UPDATE platform_users
SET is_cap_operator = true
WHERE email = 'hi@opollo.com';
