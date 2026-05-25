<p align="center">
  <img src="./docs/assets/og-card.png" alt="ModelFlux OG Card" width="100%" />
</p>

<h1 align="center">ModelFlux</h1>

<p align="center">
  Health-aware OpenAI-compatible model traffic router for Codex, CLIProxyAPI, sub2api, CPA, and other front proxies.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#docker">Docker</a> ·
  <a href="#integration-examples">Integration</a> ·
  <a href="./README.zh-CN.md">中文说明</a>
</p>

> ModelFlux provides one reusable OpenAI-compatible entry point. Clients or front proxies point to ModelFlux, protocol adaptation stays in one place, upstream account pools stay inside ModelFlux, and unhealthy upstream accounts are isolated and recovered automatically.

## Why ModelFlux

- One stable OpenAI-compatible entry point for multiple clients or front proxies
- Health-aware account-pool scheduling with cooldown, probing, failover, and recovery
- Admin console for account pools, routing, auth, tests, and restart operations
- Friendly to direct usage, CLIProxyAPI, sub2api, CPA, and other compatible chains

## Console preview

![ModelFlux Admin Console](./docs/assets/console-providers.png)

## Features

- OpenAI-compatible inbound endpoints: `/v1/responses` and `/v1/chat/completions`
- Chat Completions adaptation for MIMO, DeepSeek, and generic compatible upstreams
- Model aliases such as `gpt-5.5=mimo:mimo-v2-pro`
- Health-aware upstream key scheduling with cooldown and recovery probes
- React admin console at `/admin`
- Front-proxy-friendly deployment: Codex, CLIProxyAPI, sub2api, CPA, or any compatible client can point to ModelFlux

## Supported integration patterns

ModelFlux is not tied to one particular front-proxy chain. It provides a reusable OpenAI-compatible traffic entry point. Any client or front proxy that can configure `base_url`, `api_key`, and `model`, and can speak Responses or Chat Completions, can use it.

```text
Codex -> ModelFlux -> upstream provider
Codex -> CLIProxyAPI -> ModelFlux -> upstream provider
Codex / client -> sub2api -> ModelFlux -> upstream provider
OpenAI-compatible client / CPA -> ModelFlux -> upstream provider
```

ModelFlux owns inbound auth, model aliases, protocol adaptation, upstream account scheduling, and recovery probes. Codex, CLIProxyAPI, and sub2api are optional entry points or front proxies.

## Brand assets

- Social preview card: `./docs/assets/og-card.png`
- Editable vector source: `./docs/assets/og-card.svg`
- Latest admin console screenshot: `./docs/assets/console-providers.png`

## Quick start

```bash
cp env.example .env
npm install
npm run build
npm start
```

Default URL:

```text
http://127.0.0.1:19090
```

Admin console:

```text
http://127.0.0.1:19090/admin
```

## Docker

The project includes `Dockerfile` and `docker-compose.yml`. The container listens on `19090`; the default host mapping is `127.0.0.1:19090` to avoid conflicts with other local services. The container entrypoint reads the mounted `/app/.env` on every process start, so config saved from the admin console is picked up after restart.

```bash
cp env.example .env
# edit .env: configure PROXY_AUTH_KEY and at least one upstream key
docker compose up -d --build
```

URLs:

```text
http://127.0.0.1:19090/health
http://127.0.0.1:19090/admin
```

To change the host port, set these values in `.env`:

```bash
HOST_PORT=19090
BIND_HOST=0.0.0.0
PROXY_PORT=19090
```

Minimal `.env` example:

```bash
PROXY_AUTH_KEY=mf-local-CHANGE_ME
DEFAULT_PROVIDER=mimo
MODEL_ALIASES=gpt-5.5=mimo:mimo-v2-pro,gpt-5.4=mimo:mimo-v2-pro
MIMO_API_KEY=your-mimo-api-key
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODELS=mimo-v2-pro,mimo-v2-flash,mimo-v2-omni,mimo-v2-tts
```

## Integration examples

First decide **where the caller runs**. This is the most common source of bad configuration:

| Caller location | ModelFlux base URL | Use cases |
|---|---|---|
| Host / local process | `http://127.0.0.1:19090/v1` | Direct Codex, local CLIProxyAPI, local CPA, curl, SDK |
| Container in the same Docker Compose / Docker network | `http://model-flux:19090/v1` | sub2api container or another proxy container in the same network |
| Another machine or public reverse proxy | `http://<ModelFlux host IP or domain>:19090/v1` | LAN machines, public domain, reverse proxy |

> Important: inside a container, `127.0.0.1` means that container itself, not the host and not ModelFlux. Conversely, host-local processes usually cannot resolve the Docker service name `model-flux`.
>
> If sub2api and ModelFlux run in two separate `docker compose` projects, setting sub2api's `base_url` to `http://model-flux:19090/v1` is not enough. ModelFlux must be attached to sub2api's Docker network, and if sub2api uses `HTTP_PROXY` / `HTTPS_PROXY`, add `model-flux` to `NO_PROXY` / `no_proxy`; otherwise the service-name request can be sent through the proxy and return `502 Bad Gateway`.
>
> The OpenAI-compatible sub2api upstream account that points to ModelFlux should not bind any proxy. It is calling ModelFlux on the local Docker network, so it should not go through Clash, an HTTP proxy, or any other outbound proxy.

### Host / local process direct to ModelFlux

Use this for Codex, CPA, or any OpenAI-compatible client running on the host machine:

```text
base_url = http://127.0.0.1:19090/v1
api_key  = <ModelFlux PROXY_AUTH_KEY>
model    = gpt-5.5 or another alias model
```

### Host / local CLIProxyAPI -> ModelFlux

If Codex already uses CLIProxyAPI as its local provider manager, add a new OpenAI-compatible upstream in CLIProxyAPI and point it to the host-mapped ModelFlux port:

```text
upstream_base_url = http://127.0.0.1:19090/v1
upstream_api_key  = <ModelFlux PROXY_AUTH_KEY>
upstream_model    = gpt-5.5 or another alias model
```

### Container sub2api -> ModelFlux

If sub2api and ModelFlux run in the same Docker Compose / Docker network, create one OpenAI-compatible/API-key upstream account in sub2api and use the service name:

```text
base_url = http://model-flux:19090/v1
api_key  = <ModelFlux PROXY_AUTH_KEY>
model    = gpt-5.5 or another alias model
proxy    = disabled / no proxy
```

Clients continue using sub2api-issued keys. sub2api is only an optional front proxy; ModelFlux still owns model routing and upstream account scheduling.

If sub2api is a separate compose project, use the optional override in this project to attach ModelFlux to the sub2api network:

```bash
# Check the sub2api network name. The local default is usually sub2api-deploy_sub2api-network.
docker network ls | grep sub2api

# Run in the ModelFlux project directory.
SUB2API_DOCKER_NETWORK=sub2api-deploy_sub2api-network \\
docker compose -f docker-compose.yml -f docker-compose.sub2api.yml up -d
```

Also make sure the sub2api container environment contains:

```text
NO_PROXY=localhost,127.0.0.1,::1,postgres,redis,sub2api,host.docker.internal,model-flux
no_proxy=localhost,127.0.0.1,::1,postgres,redis,sub2api,host.docker.internal,model-flux
```

Validate from inside the sub2api container:

```bash
docker exec sub2api sh -lc 'curl -sS http://model-flux:19090/health'
```

If sub2api runs directly on the host instead of in a container, use this base URL instead:

```text
base_url = http://127.0.0.1:19090/v1
```

### Other OpenAI-compatible clients

Host-local tools:

```bash
OPENAI_BASE_URL=http://127.0.0.1:19090/v1
OPENAI_API_KEY=<ModelFlux PROXY_AUTH_KEY>
OPENAI_MODEL=gpt-5.5
```

Containerized tools:

```bash
OPENAI_BASE_URL=http://model-flux:19090/v1
OPENAI_API_KEY=<ModelFlux PROXY_AUTH_KEY>
OPENAI_MODEL=gpt-5.5
```

## Configuration

### Inbound auth

| Variable | Description |
|---|---|
| `PROXY_AUTH_KEY` | Single inbound key for clients or front proxies calling ModelFlux |
| `PROXY_KEYS` | Multiple inbound keys: `<key>:<provider>` where provider is `mimo/deepseek/compat/openai/*` |
| `ADMIN_AUTH_KEY` | Optional admin console password |

### Admin authentication prompt

When opening `http://127.0.0.1:19090/admin`, the UI shows an admin authentication dialog if `.env` contains `ADMIN_AUTH_KEY`. This is expected: it protects configuration, upstream account-pool status, account-key tests, and restart operations.

Read the current admin key locally:

```bash
cd /Users/tyit-db/personal/AI/project/sub2api-deploy/model-flux
grep '^ADMIN_AUTH_KEY=' .env
```

Enter the value after `=` in the dialog. The UI stores it in browser `localStorage` and the `modelflux_admin_key` cookie for subsequent requests.

For local-only development, you can disable the prompt by clearing `ADMIN_AUTH_KEY` and restarting the container:

```bash
ADMIN_AUTH_KEY=
docker compose restart
```

Do not set `ADMIN_ENABLED=0` just to hide the prompt; that disables the admin API and most console features. Set a strong `ADMIN_AUTH_KEY` again before LAN, reverse-proxy, or public exposure.

### Upstream account pools

| Account pool | Key | Default Base URL | Models |
|---|---|---|---|
| MIMO | `MIMO_API_KEY` / `MIMO_API_KEYS` | `MIMO_BASE_URL` | `MIMO_MODELS` |
| DeepSeek | `DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEYS` | `DEEPSEEK_BASE_URL` | `DEEPSEEK_MODELS` |
| OpenAI-compatible | `COMPAT_API_KEY` / `COMPAT_API_KEYS` | `COMPAT_BASE_URL` | `COMPAT_MODELS` |
| Native OpenAI | `OPENAI_API_KEY` / `OPENAI_API_KEYS` | `OPENAI_BASE_URL` | `OPENAI_MODELS` |

`*_API_KEYS` supports multiple keys and optional per-key Base URL:

```bash
MIMO_API_KEYS=key-2|backup|enabled|https://region-a.example/v1,key-3|old|disabled|https://region-b.example/v1
```

Format: `key|label|enabled`, `key|label|disabled`, or `key|label|enabled|base_url`. If the fourth segment is omitted, the account uses the pool default Base URL.

## Scheduler

Each upstream key has an in-memory runtime state:

| State | Meaning |
|---|---|
| `healthy` | Schedulable |
| `probing` | Waiting for or running a recovery probe |
| `insufficient_balance` | Balance issue; long cooldown |
| `rate_limited` | Rate limited; short cooldown |
| `auth_error` | Auth or permission issue; long cooldown |
| `temporary_error` | 5xx, EOF, timeout, or network issue; short cooldown |
| `manual_disabled` | Disabled from the admin console |

Scheduling behavior:

- Select only enabled, healthy, non-cooled-down accounts.
- Prefer lowest current load.
- Tie-break by least recently used.
- Retry another account within the same request when the current account fails with a retryable account-level error.
- Auto-probe cooled-down accounts and rejoin them when healthy.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/v1/models` | Model catalog |
| `POST` | `/v1/responses` | Main Responses API endpoint |
| `POST` | `/v1/chat/completions` | Chat Completions endpoint |
| `GET` | `/admin` | Admin console |
| `GET` | `/admin/api/scheduler` | Scheduler runtime state |
| `POST` | `/admin/api/provider-key/test` | Test one upstream key |
| `POST` | `/admin/api/provider-key/status` | Enable or disable one key |
| `POST` | `/admin/api/provider-key/probe` | Force recovery probe |

## Verification

```bash
npm test
npm run build
./scripts/smoke.sh http://127.0.0.1:19090
```

## Project layout

```text
server/   Hono + TypeScript backend
admin/    React + Vite admin console
scripts/  Smoke tests
proxy.mjs Compatibility launcher; prefers server/dist/index.js
```

## Boundaries

- ModelFlux is not bound to Codex, CLIProxyAPI, sub2api, CPA, or any fixed chain; it only requires an OpenAI-compatible inbound protocol.
- ModelFlux does not modify sub2api source code or database records.
- Static configuration is kept in `.env`.
- Runtime account health is kept in memory in this version.
