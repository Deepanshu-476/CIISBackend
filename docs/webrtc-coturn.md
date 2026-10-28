# CIIS WebRTC Coturn Setup

CIIS chat calling uses Socket.IO for signaling and WebRTC for media. Calls across different Wi-Fi/mobile networks need a reachable TURN relay when direct peer-to-peer ICE paths fail.

## Current Hostinger Production Setup

The Hostinger VPS already runs Coturn in Docker as `rtc-coturn-1`.

- VPS IP: `147.93.106.84`
- TURN DNS: `turn.ciisnetwork.in`
- Frontend: `ciisnetwork.com`
- Web backend (backendcds.ciisnetwork.in): systemd service `backendr` in `/var/www/CIISWEBBACKEND`
- TURN listening ports: `3478` UDP/TCP and `5349` TLS
- Active relay range: `49160-49200`
- Docker restart policy: `unless-stopped`

Do not start a second systemd Coturn service on the same ports. If Docker Coturn is active, backend `COTURN_STATIC_AUTH_SECRET` must match the Docker container's `--static-auth-secret`.

## Required Backend Environment

Set these variables on the backend VPS, not in the React frontend:

```env
COTURN_HOST=turn.ciisnetwork.in
COTURN_URLS=stun:turn.ciisnetwork.in:3478,turn:turn.ciisnetwork.in:3478?transport=udp,turn:turn.ciisnetwork.in:3478?transport=tcp
COTURN_STATIC_AUTH_SECRET=replace-with-the-active-coturn-shared-secret
COTURN_CREDENTIAL_TTL_SECONDS=3600
```

`COTURN_STATIC_AUTH_SECRET` must match the active Coturn `static-auth-secret`. The React frontend must never contain `COTURN_STATIC_AUTH_SECRET`, `TURN_STATIC_AUTH_SECRET`, `VITE_TURN_USERNAME`, or `VITE_TURN_CREDENTIAL`.

## Existing Docker Coturn Checks

Use this when deploying again to the current Hostinger VPS:

```bash
docker ps --filter name=rtc-coturn-1
docker inspect rtc-coturn-1 --format '{{json .Config.Cmd}} {{json .Args}}' | sed -E 's/(--static-auth-secret=)[^ "\\]+/\1***MASKED***/g'
ss -lntup | grep -E ':3478|:5349'
```

If `rtc-coturn-1` is running, keep systemd Coturn disabled to avoid port conflicts:

```bash
sudo systemctl disable --now coturn || true
```

## Fresh Ubuntu Coturn Install

Use this section only for a fresh VPS where Docker Coturn is not already running.

Edit `/etc/turnserver.conf`:

```conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=replace-with-the-same-secret-as-backend-env
realm=turn.ciisnetwork.in
server-name=turn.ciisnetwork.in

no-multicast-peers
no-loopback-peers

min-port=49160
max-port=49200

log-file=/var/log/turnserver/turnserver.log
simple-log
```

If the VPS is behind NAT, add:

```conf
external-ip=PUBLIC_IP/PRIVATE_IP
```

Do not add `external-ip` when the VPS has the public IP directly on its network interface.

Enable and start:

```bash
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable coturn
sudo systemctl restart coturn
sudo systemctl status coturn --no-pager
```

## Firewall

Open the TURN listening ports and active relay range on Hostinger firewall/security panel. If `ufw` is enabled, open them there too:

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49200/udp
sudo ufw allow 49160:49200/tcp
sudo ufw status
```

On the current VPS, `ufw` was inactive during verification, so Hostinger firewall is the important place to confirm the same ports.

## Backend Restart

After setting environment variables:

```bash
cd /var/www/CIISWEBBACKEND
npm install
systemctl restart backendr
pm2 save
```

## Verification

1. Hit `GET /api/chat/turn-credentials` while authenticated. Response must include `turn:` URLs, a temporary username, and a credential.
2. In the browser console, enable diagnostics:

```js
localStorage.setItem("ciis_webrtc_debug", "true")
```

3. Make calls in these scenarios:
   - Same Wi-Fi audio
   - Same Wi-Fi video
   - Different Wi-Fi audio
   - Different Wi-Fi video
   - Wi-Fi to mobile hotspot

4. Open `chrome://webrtc-internals` and verify:
   - ICE candidate pair reaches `succeeded`
   - Selected candidate pair uses `relay` when direct candidates fail
   - inbound/outbound RTP bytes increase for audio/video

5. Optional server-side smoke test:

```bash
SECRET=$(awk -F= '/^COTURN_STATIC_AUTH_SECRET=/{print $2}' /var/www/CIISWEBBACKEND/.env)
turnutils_uclient -y -n 1 -W "$SECRET" turn.ciisnetwork.in
turnutils_uclient -t -y -n 1 -W "$SECRET" turn.ciisnetwork.in
unset SECRET
```

Both UDP and TCP checks should send/receive packets with `0%` loss.

## Common Failures

- Call connects but no media across networks: TURN relay ports are blocked or credentials endpoint is not returning `turn:` URLs.
- ICE fails immediately: Coturn is not reachable or `external-ip` is wrong.
- Same Wi-Fi works but different Wi-Fi fails: STUN/direct path works, TURN relay is missing or blocked.
- Audio plays but video does not: check camera permission and outbound/inbound video RTP bytes in `chrome://webrtc-internals`.
