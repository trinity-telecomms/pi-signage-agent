# Raspberry Pi MQTT Agent (Bun)

Production-oriented MQTT device agent for Raspberry Pi signage.

Features:
- Runs as a single Bun-compiled executable (`signage-agent`)
- Auto-registers device in Connect (`/devices/device/`)
- Performs ZTE enrollment (`/devices/zte/...`) and persists credentials in local JSON state
- Connects to MQTT broker using Connect/ZTE credential model
- Publishes initial and heartbeat telemetry payloads with `username` and `ipv4`
- Subscribes for commands and can download/play media via VLC kiosk mode
- No SQLite dependency

## Runtime flow

1. Load `.env` config (service account, company/folder IDs, ZTE, MQTT settings)
2. Derive stable device UID (or use `DEVICE_UID` override)
3. Ensure device exists in Connect
4. Enroll with ZTE and persist `{cid,key}` into `AGENT_STATE_FILE`
5. Connect to MQTT and publish initial payload
6. Listen for command messages and execute signage actions

## Environment

Copy `.env.example` to `.env` and set values:

- `CONNECT_API_KEY`
- `CONNECT_COMPANY_ID`
- `CONNECT_FOLDER_ID`
- `ZTE_USERNAME`
- `ZTE_PASSWORD`
- `MQTT_HOST`

Optional overrides:
- `DEVICE_UID` (15-20 numeric chars)
- `AGENT_STATE_FILE` (default `./data/agent-state.json`)
- `AGENT_HEARTBEAT_INTERVAL_MS` (default `60000`)
- `MEDIA_DIR` (default `/opt/signage/media`)
- `VLC_BIN` (default `/usr/bin/cvlc`)
- `VLC_EXTRA_ARGS`
- `STARTUP_AUTOPLAY` (default `true`)
- `STARTUP_MEDIA_PATH` (default `/opt/signage/media/current.mp4`)
- `MQTT_REJECT_UNAUTHORIZED` (default `true`)
- `MQTT_CA_CERT_PATH` (optional)
- `MQTT_SERVERNAME` (optional)

## Development

```bash
bun install
bun run dev
```

## Build a single executable

Build on the target Pi:

```bash
bun run build
```

Output binary:

- `dist/signage-agent`

## Commands handled over MQTT

The agent parses Connect command envelopes from subscribed topic `CID/UID/+/</#`.

Supported RPC names:
- `ping`
- `start` (requires media mode: `image` or `video`)
- `stop`
- `download` (requires media mode and public URL; downloads, overwrites slot file, and starts playback)
- `signage_download`
- `signage_play`
- `signage_download_and_play`
- `signage_set_media` (alias of download+play)
- `signage_stop`

Argument examples:

```json
{"c":[0,["signage_download","https://example.com/loop.mp4","current.mp4"]]}
```

```json
{"c":[0,["signage_play","/opt/signage/media/current.mp4"]]}
```

```json
{"c":[0,["signage_set_media",{"url":"https://example.com/screen.jpg","filename":"screen.jpg"}]]}
```

```json
{"c":[0,["stop"]]}
```

```json
{"c":[0,["start","video"]]}
```

```json
{"c":[0,["start","image"]]}
```

```json
{"c":[0,["download","video","https://example.com/media/playlist-a.m3u8"]]}
```

```json
{"c":[0,["download","image","https://example.com/media/poster.png"]]}
```

Also accepted (nested tuple arg style):

```json
{"c":[0,["download",["video","https://google.com/test.mp4"]]]}
```

## systemd deployment

Template unit file:

- `config/signage-agent.service`

Install helper:

- `scripts/install.sh`

Expected deployment layout:

```text
/opt/signage/agent/
  signage-agent
  .env
  state.json
```

## Notes

- If ZTE says enrollment is complete but no state file exists, seed `AGENT_STATE_FILE` with `cid` and `key` or re-provision enrollment.
- Run under a service account with permissions for target folder/device creation and ZTE enrollment.
- Latest data paths for status payload are:
  - `0.signage_agent.username`
  - `0.signage_agent.ipv4`
  - `0.signage_agent.hostname`

## MQTT TLS troubleshooting

If logs show `Client network socket disconnected before secure TLS connection was established`:

- Verify protocol/port pair in `.env`:
  - TLS broker: `MQTT_PROTOCOL=mqtts`, `MQTT_PORT=8883` (or provider-specific TLS port)
  - Plain broker: `MQTT_PROTOCOL=mqtt`, `MQTT_PORT=1883` (or provider-specific plain port)
- If broker uses private CA, set:
  - `MQTT_CA_CERT_PATH=/path/to/ca.crt`
- If required by broker certificate/SNI, set:
  - `MQTT_SERVERNAME=<broker-cert-hostname>`
