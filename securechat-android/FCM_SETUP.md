# Push Notifications (FCM) Setup

SecureChat notifications have two layers:

1. **Local notifications** — work today with no extra setup. Shown by the app
   itself when the app is open and a message arrives while you're not reading
   that chat (and on desktop web via the browser Notification API).
2. **FCM push** — required so notifications reach the phone while the app is
   killed or fully closed. Requires a Google Firebase project.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and create a new project
   (e.g. `securechat`).
2. Add an **Android app** in the project with package name **`com.securechat.app`**.
3. Follow the wizard and download the generated **`google-services.json`** file.
4. Place it at `securechat-android/android/app/google-services.json`.
   The Gradle build already has the `com.google.gms:google-services:4.4.2`
   plugin, so the next APK build automatically wires Firebase in.
5. (Optional) Add the SHA-1 fingerprint of the debug signing key so Google
   login and cloud messaging diagnostics map to this APK:
   `e4fa8f5d831218e8955634a4d2175d5ce872d6f4`

## 2. Create a service-account key for the backend

1. In the Firebase console: Project settings → Service accounts →
   **Generate new private key** (a `*.json` downloads).
2. Copy it to the server and point the backend at it:

   ```bash
   scp -i ~/.ssh/securechat-key.pem firebase-service-account.json \
       ubuntu@13.234.112.143:/opt/securechat/backend/firebase-service-account.json

   ssh -i ~/.ssh/securechat-key.pem ubuntu@13.234.112.143
   cd /opt/securechat/backend
   # add FCM_SERVICE_ACCOUNT to the pm2 env:
   pm2 restart securechat --update-env
   ```

   Add `FCM_SERVICE_ACCOUNT=/opt/securechat/backend/firebase-service-account.json`
   to the process env (e.g. via `pm2 start` env block in the ecosystem file or
   `pm2 env` / a `.env` loaded by dotenv). The backend logs
   `[push] Firebase Cloud Messaging initialized.` on success.
3. The backend degrades gracefully: if `FCM_SERVICE_ACCOUNT` is unset it logs
   a warning once and push is skipped (online users still get messages over
   their live socket + local notifications).

## 3. Privacy behavior (server side)

FCM is sent **only to offline recipients** (online participants are covered by
the live socket), and only when the recipient has
`PrivacySettings.notificationsEnabled` on. The notification body respects
`notificationPrivacyLevel`:

- `anonymous` → "New encrypted message received."
- `sender_only` / `detailed` → "<sender> sent a secure message."

Message contents are never included because payloads are end-to-end encrypted
and the server never sees plaintext.

## 4. Rebuild & verify

1. Rebuild the web frontend and redeploy (see summary in project notes), or:
   ```bash
   cd securechat-android && npx cap sync android
   cd android && JAVA_HOME=$HOME/jdk-21 ./gradlew assembleDebug
   ```
2. Confirm a token registers: run the app, then check the DB:
   ```bash
   mongosh securechat --eval 'db.pushtokens.countDocuments({})'
   ```
3. Kill the app on a second account and send a message — the phone should
   show a system notification from channel **messages**.