/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Our convention: milestone prefixes land as scopes (e.g.
    // feat(m3-6): ...), infra prefixes too (feat(infra): ...).
    // Cap subject length at 100 rather than the default 72 so
    // milestone-tagged messages don't get artificially cramped.
    "header-max-length": [2, "always", 100],
    // Allow the rendered body; we use HEREDOCs for multi-paragraph
    // descriptions and occasionally include URL-wrapped lines.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
