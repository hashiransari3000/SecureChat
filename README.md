<div align="center">
  <img src="securechat-frontend/frontend/public/securechat-logo-full.jpg" alt="SecureChat logo" width="260" />

  # SecureChat

  **Privacy by design, simple by interaction.**

  An HCI-focused secure chat prototype exploring **Privacy and Data Ethics in UX Design**.

  ![HCI](https://img.shields.io/badge/Focus-Human--Computer%20Interaction-1769e0)
  ![Privacy](https://img.shields.io/badge/Design-Privacy%20by%20Design-20b8c7)
  ![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-0d2948)
  ![Node](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-1769e0)
</div>

## Project Overview

SecureChat demonstrates how privacy can be made understandable and controllable inside a messaging experience. Instead of exposing technical details at every step, the interface uses progressive disclosure, clear consent, informative feedback and reversible actions.

> **Course focus:** This is primarily an HCI and data-ethics project. The implementation supports the interaction design and usability concepts being evaluated.

## 🌐 Live Deployment

This project is deployed on AWS (free tier) and can be opened directly in a browser:

| Layer | URL |
|---|---|
| **Frontend** | https://d2bdhd1gcudfjg.cloudfront.net |
| **Backend API + Socket.IO** | https://d3qye3r9n8r030.cloudfront.net |
| **Database** | MongoDB 7.0 running locally on the EC2 instance |

Architecture, setup commands and cost notes are documented in **[DEPLOYMENT.md](DEPLOYMENT.md)** — including the WebSocket/API CloudFront distribution, nginx proxy, PM2 lifecycle, and why this stack runs MongoDB 7.0 on Ubuntu 24.04.

> ⚠️ Email/password sign-up works immediately. The **Continue with Google** button needs the frontend domain added to the OAuth client's *Authorized JavaScript origins* in Google Cloud Console (see DEPLOYMENT.md).

## Design Challenge

Many digital products make privacy difficult to understand: settings are hidden, consent is unclear, and users cannot easily reverse decisions. SecureChat addresses this through three design goals:

| Visible | Consensual | Reversible |
|---|---|---|
| Show privacy status at the relevant moment | Ask before creating a new connection | Provide clear cancel, decline, clear-chat and data-control actions |

## Main Interaction Flow

```text
Discover user → Send introduction → Accept or decline → Secure chat → Privacy and data controls
```

## Key Features

- Dynamic username discovery with privacy-aware limited profiles
- Google Sign-In with server-verified identity and a user-chosen public username
- Consent-first chat requests with an introduction message
- End-to-end encrypted chat status shown in context
- Fixed chat header and composer with a scrollable message area
- Profile and account view inspired by familiar chat applications
- Clear chat with confirmation and easy cancellation
- Privacy controls for discoverability, identity and relationship signals
- Notification and accessibility preferences
- Reduced-motion support, high contrast and responsive layouts
- Loading, empty, success and error feedback states
- Private group creation with participant consent
- Encrypted attachments and voice-message interaction
- Encrypted data export and deliberate account-data wipe
- Help Center, feedback, About, Terms and Privacy information

## HCI Foundation

The interface applies **Shneiderman's Eight Golden Rules**:

| Golden Rule | SecureChat Application |
|---|---|
| Consistency | Shared navigation, controls, spacing and visual language |
| Shortcuts | Keyboard-friendly search, including `Ctrl + K` |
| Informative feedback | Loading states, notifications, delivery status and confirmations |
| Dialog closure | Clear completion after requests, messages and settings changes |
| Error prevention | Confirmation before destructive or privacy-sensitive actions |
| Easy reversal | Cancel, decline, back and clear-chat controls |
| Internal locus of control | Users choose visibility, consent and data actions |
| Reduce memory load | Explanations appear beside the decision they affect |

## Privacy and Data Ethics

- **Privacy by Design:** Privacy is part of the primary interaction flow.
- **Data minimization:** Discovery is limited and unnecessary identity details remain hidden.
- **Consent and transparency:** Consequences are explained before users act.
- **Mutual privacy:** Presence, typing and read signals respect relationship choices.
- **Progressive disclosure:** Reassurance is visible; advanced cryptographic details remain available on demand.
- **User control:** Users can change settings, export data or initiate account-data deletion.
- **Honest boundaries:** The interface distinguishes protected message content from operational metadata.

## Technology Overview

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, React Router, Socket.IO Client, Web Crypto APIs |
| Backend | Node.js, Express, Socket.IO, MongoDB/Mongoose |
| Security support | Browser-side cryptography, encrypted attachment storage, JWT authentication |

## Run Locally

### Prerequisites

- Node.js and npm
- MongoDB running locally or a MongoDB connection string
- A modern Chromium, Edge or Firefox browser

### 1. Backend

```powershell
cd securechat-backend/backend
Copy-Item .env.example .env
npm install
npm run dev
```

The backend runs on `http://localhost:5000` by default.

For Google Sign-In, set `GOOGLE_CLIENT_ID` in the backend `.env`. The included `.env.example` shows the required field.

### 2. Frontend

Open a second terminal:

```powershell
cd securechat-frontend/frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

In Google Cloud Console, add `http://localhost:5173` under **Authorized JavaScript origins** for the Web client. For deployment, add the production frontend origin as well.

> Never commit the `.env` file, private uploads, database credentials or real user data.

## Suggested Demonstration

1. Create two test accounts in separate browser profiles.
2. Search using the beginning of a username.
3. Send a consent-first request with an introduction.
4. Accept or decline it from the second account.
5. Demonstrate chat, attachments and privacy-aware status indicators.
6. Change discoverability or accessibility settings.
7. Show encrypted export and the confirmation required for data deletion.

## Project Documents

- [HCI Project Report](SecureChat_HCI_Project_Report.docx)
- [Visual Presentation](SecureChat_HCI_Visual_Presentation.pptx)
- [Implementation Guide](IMPLEMENTATION_GUIDE.md)
- [Verification Report](VERIFICATION_REPORT.md)
- [AWS Deployment Guide](DEPLOYMENT.md)

## Limitations

- The project is an academic prototype, not a production-audited messenger.
- Formal usability testing with a larger and more diverse participant sample remains future work.
- Production deployment would require security review, infrastructure hardening, monitoring and recovery planning.

## Academic Information

| | |
|---|---|
| **Student** | Vishaka Bharwanu — 69518 |
| **Course** | Human–Computer Interaction & Graphics |
| **Instructor** | Dr. Rizwan Munir |
| **Topic** | Privacy and Data Ethics in UX Design |

---

<div align="center">
  <strong>A secure experience is usable only when people understand it.</strong>
</div>
