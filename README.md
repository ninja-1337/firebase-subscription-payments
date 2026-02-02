# Firebase Hosting CICD Dashboard (T3 Frontend)

This project provides a T3-style frontend for uploading website ZIP files,
versioning releases, and queueing Firebase Hosting deployments.

**Features:**

- Upload website ZIPs from the browser.
- Store artifacts in Firebase Storage and release metadata in Firestore.
- Track deployment steps (upload, Git versioning, re-zip, deploy).
- Designed as a T3-style Next.js frontend you can extend with APIs or CI workers.

## Demo

- Update with your Firebase Hosting URL once deployed.

## Setup

If you haven't already, [install the Firebase CLI](https://firebase.google.com/docs/cli):

```bash
npm install -g firebase-tools
```

### Configure Firebase

- Enable Firebase Authentication (Anonymous provider).
- Create Firestore and Storage instances for your project.

### Configure the T3 frontend

- Set the Firebase environment variables in a `.env.local` file:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_DATABASE_URL`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
  - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
  - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
  - `NEXT_PUBLIC_FIREBASE_APP_ID`
- The deployment UI stores ZIP artifacts in Firebase Storage and release metadata
  in Firestore under `cicdDeployments/{uid}/versions`.

## Run locally

```bash
npm run dev
```

## Deploy to Firebase Hosting

```bash
npm run deploy
```

## Author

- [@thorsten-stripe](https://twitter.com/thorwebdev)
