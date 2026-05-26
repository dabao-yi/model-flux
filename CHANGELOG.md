# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-25

### Added
- OpenAI-compatible inbound endpoints for `/v1/responses` and `/v1/chat/completions`.
- React admin console for account pools, model routing, auth, integration guidance, and runtime health visibility.
- Health-aware weighted least-load account scheduling with cooldown, failover, recovery probing, and per-account priority.
- Support for per-account Base URL, account copy-add workflow, sticky provider navigation, and improved account-pool operations.
- Branding assets including favicon set, manifest, social preview card, and admin console screenshots.
- English and Chinese project documentation with integration examples for direct clients, CLIProxyAPI, sub2api, CPA, and other OpenAI-compatible front proxies.

### Changed
- Productized the admin experience with improved layout, routing interactions, account pool management, and clearer local-vs-container integration instructions.
- Unified documentation and repository presentation for the first public release under `dabao-yi/model-flux`.

### Fixed
- Draft-aware account testing and probing now use current page values instead of stale persisted environment values.
- Account Base URL inheritance now correctly allows falling back to the pool default Base URL.
- Provider/account scheduling now honors per-account priority in selection decisions.
