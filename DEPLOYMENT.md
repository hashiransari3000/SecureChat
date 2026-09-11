# SecureChat — Production Deployment (AWS)

A free-tier deployment of SecureChat on the user's AWS account. Everything
here keeps monthly cost at **~$0** on the AWS Free Tier.

## Live URLs

| Layer | URL |
|---|---|
| Frontend (React SPA) | https://d2bdhd1gcudfjg.cloudfront.net |
| Backend API + Socket.IO | https://d3qye3r9n8r030.cloudfront.net |
| MongoDB | local `mongodb://127.0.0.1:27017/securechat` on the EC2 instance |

## Architecture

```text
Browser
  └─ HTTPS https://d2bdhd1gcudfjg.cloudfront.net   (CloudFront distribution E24RD2PDWHVA73)
       ├─ S3 bucket  securechat-frontend-593521254468  (private, OAC)  → React/Vite build
       └─ SPA fallback: 403/404 → /index.html (HTTP 200)

Browser → wss/https https://d3qye3r9n8r030.cloudfront.net   (CloudFront dist E360JPG5KHAC9G)
       └─ custom origin ec2-13-234-112-143.ap-south-1.compute.amazonaws.com
            └─ nginx (port 80, WS upgrade proxy) → PM2 “securechat” (Express + Socket.IO :5000)
                 └─ MongoDB 7.0 (mongod, localhost:27017, db “securechat”)
```

- Region: `ap-south-1` (AWS CLI binaries under `~/awscli`).
- WAF remains configured on the separate **Al-Kausar** distribution only; this
  prototype uses CloudFront's default protections.
- A `MonthlyFreeTierGuard` budget alert (~$1, actual spend) emails the account
  owner if costs rise.

## Why MongoDB 7.0 and not 8.0 on this EC2

Ubuntu 24.04 (kernel 6.19+) ships with an incompatible MongoDB 8.x
(`SERVER-121912`). mongod 8.0.30 refuses to start on this kernel. The fix used
here is the MongoDB 7.0 line (7.0.41), installed from the official repo:

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc -o /tmp/mongo-key.asc
sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg /tmp/mongo-key.asc
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y --allow-downgrades mongodb-org=7.0.41 mongodb-org-server=7.0.41 \
  mongodb-org-database=7.0.41 mongodb-org-mongos=7.0.41 mongodb-org-shell=7.0.41 \
  mongodb-org-tools=7.0.41 mongodb-org-database-tools-extra=7.0.41
sudo systemctl enable --now mongod   # listens on 127.0.0.1:27017
```

> The `--allow-downgrades` flag is required because 8.0 packages were already
> installed, and apt refuses to downgrade otherwise. Remove any
> `mongodb-org-8.0.list` under `/etc/apt/sources.list.d/`.

## EC2 instance

- **Type:** `t3.micro` (free tier) · Ubuntu 24.04 · IP `13.234.112.143`
- **SSH key:** `~/.ssh/securechat-key.pem` (`chmod 600`)
- **Security group** `sg-0643e5b5769cb2a9e`:
  - 80/tcp → `0.0.0.0/0` (nginx, behind CloudFront)
  - 22/tcp → user's current public IP only (update if your IP changes)
- Software: Node.js 22, PM2, nginx, MongoDB 7.0

### Backend layout

```text
/opt/securechat/backend    source (from securechat-backend/backend)
/opt/securechat/backend/.env
/etc/nginx/sites-available/securechat  (symlinked into sites-enabled)
PM2 app name: securechat
```

#### `.env`

```bash
PORT=5000
JWT_SECRET=<openssl rand -hex 32 output>
CLIENT_URL=https://d2bdhd1gcudfjg.cloudfront.net
GOOGLE_CLIENT_ID=432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl.apps.googleusercontent.com
MONGO_URI=mongodb://127.0.0.1:27017/securechat
```

#### nginx (proxy + WebSocket)

```nginx
server {
  listen 80 default_server;
  server_name _;
  client_max_body_size 30m;
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 300s;
  }
}
```

#### Lifecycle

```bash
pm2 start /opt/securechat/backend/src/server.js --name securechat
pm2 save && pm2 startup   # creates the boot script (run pm2 startup and paste its output)
pm2 restart securechat --update-env   # after .env changes
```

## Frontend build & upload

The API origin and Google client ID are baked in at build time:

```bash
cd securechat-frontend/frontend
npm ci
VITE_API_URL="https://d3qye3r9n8r030.cloudfront.net" \
VITE_GOOGLE_CLIENT_ID="432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl.apps.googleusercontent.com" \
npm run build
```

Upload with cache headers tuned for hashed assets vs. `index.html`:

```bash
BUCKET=securechat-frontend-593521254468
aws s3 sync dist/assets "s3://$BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable"  # hashed → immutable
aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --cache-control "no-cache"                            # revalidates each visit
aws s3 cp dist/securechat-logo.jpg        "s3://$BUCKET/securechat-logo.jpg" --cache-control "public,max-age=604800"
aws s3 cp dist/securechat-logo-full.jpg   "s3://$BUCKET/securechat-logo-full.jpg" --cache-control "public,max-age=604800"
aws s3 cp dist/securechat-logo-icon.jpg   "s3://$BUCKET/securechat-logo-icon.jpg" --cache-control "public,max-age=604800"
aws cloudfront create-invalidation --distribution-id E24RD2PDWHVA73 --paths "/*"
```

## CloudFront notes

- Frontend dist hosts S3 via **Origin Access Control** (`SecureChatS3OAC`),
  bucket is private.
- Custom error responses are configured for **both 403 and 404 → `/index.html`
  with HTTP 200**, so client-side routes (`/login`, `/privacy`, …) survive
  deep links and refreshes (a missing object under OAC returns 403, not 404).
- Backend dist uses a custom origin (EC2 DNS name, not the IP) with all methods
  and no caching (private/encrypted content).

## Google Sign-In

Add the **frontend CloudFront URL** to the OAuth Web client
(`432304486079-…apps.googleusercontent.com`) under
**Authorized JavaScript origins**:

```
https://d2bdhd1gcudfjg.cloudfront.net
```

Email/password sign-up works without this step; the Google button does not.
If the Google button still reports *"origin is not allowed"*, the exact origin
above must be on **Authorized JavaScript origins** (not redirect URIs) for the
**Web** client `432304486079-mdgpiraqhiciv9neskk5f34th6ib5ejl`; it can take a
few minutes to propagate.

## Android app (Android 10+)

`securechat-android/` is a Capacitor 7 wrapper (`com.securechat.app`) that ships
the built React app in a WebView.

- **minSdk 29** (Android 10) is pinned in `securechat-android/android/variables.gradle`.
- The WebView origin is `https://securechat.app` (`androidScheme: https`), so the
  OAuth client also needs `https://securechat.app` in **Authorized JavaScript
  origins** for Google Sign-In to work inside the app.
- Debug builds are fine for side-loading. For a store build, add a release
  signing config (keystore) and switch `./gradlew assembleDebug` →
  `assembleRelease` in the workflow, then upload the AAB to Play.

### CI

`.github/workflows/android-build.yml` runs on push/PR to `main`:

1. Install Node 22 → `npm ci` + `npm run build` in the frontend.
2. `npm ci` + `npx cap sync android` to push the built assets into the app.
3. JDK 21 (Capacitor 7 requirement) + Android SDK via `setup-android`.
4. `./gradlew assembleDebug bundleDebug` → APK **and** AAB uploaded as the
   `securechat-android` artifact.

### Local build

```bash
cd securechat-frontend/frontend && npm ci && npm run build
cd ../../securechat-android && npm ci && npx cap sync android
cd android && ./gradlew assembleDebug
```

Needs JDK 21 (`JAVA_HOME`) and the Android SDK (set `ANDROID_HOME` or write
`local.properties` with `sdk.dir`).

## Backend hardening notes

- Global rate limit: 180 requests/min per IP+path; auth endpoints are capped
  tighter at 12/min per IP+path (brute-force damping).
- Security headers set on every response and passed through CloudFront:
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`,
  `X-Frame-Options: DENY`, `Strict-Transport-Security` (63 720 000s, preload).
- `express.json` body limit 150 KB; CORS locked to an explicit allowlist
  (website + Capacitor app origins, dev fallbacks);
  `x-powered-by` disabled; profile photos are served only through the
  authenticated privacy-check route, never as public static files.

## SSH access when your IP changes

SSH (22/tcp) is restricted to your current public IP. If it changes, allow the
new one:

```bash
aws ec2 authorize-security-group-ingress --group-id sg-0643e5b5769cb2a9e \
  --protocol tcp --port 22 --cidr <YOUR-NEW-IP>/32 --region ap-south-1
```

## Cost tracking

- EC2 `t3.micro`, S3, CloudFront, and MongoDB-on-EC2 → free tier.
- Budget alarm `MonthlyFreeTierGuard` (actual > $1) alerts to the owner email.
- If a non-free EC2 is ever used, stop it when not demoing.