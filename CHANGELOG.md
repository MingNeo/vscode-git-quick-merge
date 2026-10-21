# Change Log

All notable changes to the "git quick merge" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [1.0.8]

### Added

- Register the `gitQuickMerge.cleanup-stale-worktrees` command, with confirmation and result feedback
- `gitQuickMerge.logLevel` setting to filter the "Git Quick Merge" output channel
- Optional `name` field for branch items, shown as a label in the quick pick
- "Merge local latest" option when the source branch has unpushed commits

### Changed

- Preset merge results show a one-line summary; the full list opens via "View Details"
- Logs go only to the output channel (no more `console` output)

### Fixed

- Fetch the remote source branch before merging so a stale `origin/<source>` is not merged
- Canceling a preset merge is no longer reported as an error abort, and canceled steps are no longer missing from results
- Preset normalization no longer mutates the settings objects
- Stale worktree detection also checks worktrees registered in git and prunes dangling registrations
- Error objects are logged with their message instead of `{}`

## [1.0.0]

- Initial release