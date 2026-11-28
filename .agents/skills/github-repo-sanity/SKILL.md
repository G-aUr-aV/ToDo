---
name: github-repo-sanity
description: Audit or harden a GitHub repository's public presentation, default-branch rules, CI, community files, and security alerts. Use for a repo sanity check, public-readiness review, or CodeQL and Dependabot triage across repositories.
---

# GitHub repository sanity

Identify the exact target owner, repository, remote, default branch, and requested changes. Treat reference repositories as read-only. Check the worktree and existing rules before choosing what to change. A review does not authorize changing settings, dismissing alerts, pushing, or deploying.

## Inspect once

- Compare the public Code and About pages with the README and shipped product. Verify the description, topics, homepage, badges, install instructions, license, and release links. Keep private deployments and personal paths out of public metadata.
- Use the GitHub API or CLI for effective settings. Read repository metadata, `rules/branches/BRANCH`, classic branch protection, `community/profile`, `private-vulnerability-reporting`, and the current default-branch commit's check runs. Inspect actual workflow files. Distinguish an empty result from a permission error or unsupported feature. Use Chrome for UI checks when requested.
- Read CodeQL, Dependabot, and secret scanning separately. The Security and quality badge can combine categories. Record open counts, alert IDs, analyzed refs, and relevant commit or check links. Never print secret values.

## Choose changes that fit the repository

- Protect the default branch from deletion and force pushes where authorized. Keep the established merge workflow in mind. Require PRs, reviews, or checks only when staffing and workflow support them. Before requiring a check, verify its exact name and provider and that it runs on all relevant PR paths.
- Prefer reproducible CI with lockfiles or wrappers, minimal token permissions, trusted actions pinned to verified full SHAs where practical, and tests against isolated data. Review dependency updates, secret scanning with push protection, and CodeQL coverage. Consider dependency review on PRs where supported.
- Give users clear setup and tests in the README. Add a security policy backed by a working private reporting channel, then add contribution guidance, issue and PR templates, and a changelog or release process when maintainership warrants them. Use releases for real deliverables. Adopt CODEOWNERS, a code of conduct, signed provenance, or stronger branch gates when the project has a concrete use for them.
- For examples, Daily Reminders has an Android CI badge, development and privacy docs, private vulnerability reporting, issue and PR templates, Dependabot configuration, and a changelog. Memex has CI, contributor and security guidance, issue and PR templates, and a changelog. Recheck current settings before borrowing their conventions.

## Triage and verify

For Dependabot, match each advisory range to the installed lockfile version and trace its direct parent. Separate package presence from application reachability. Use the smallest compatible update and rerun the ecosystem audit, build, and app tests.

For CodeQL, trace the source, validation, sink, and runtime entry point for each finding. Group duplicates while preserving every alert ID. Distinguish an analyzer false positive from code that exists but is outside the shipped entry points. Fix reachable defects. Remove retired paths only after confirming callers and preserving coverage of supported behavior. Avoid global suppressions and leave uncertain findings open.

Check tracked files, ignore rules, and the exact staged diff for live databases, vaults, account state, backups, tokens, and generated output. Run project checks against invented data. When authorized to push, verify the remote commit and wait for relevant CI and security scans. Report the scan's actual state separately from local results. Re-read applied repository rules instead of inferring success from a settings response.

[GitHub repository best practices](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories) · [GitHub Actions hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
