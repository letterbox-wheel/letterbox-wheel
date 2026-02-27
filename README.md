# Letterboxd Top 500 Random Wheel

A simple local web app to pick a random movie from Letterboxd Top 500 with a spinning wheel.

## GitHub Pages deploy

This project is static (`index.html`, `styles.css`, `app.js`, `data/movies.json`), so it works on GitHub Pages without server code.

1. Create a GitHub repo and push this folder.
2. On GitHub, open **Settings → Pages**.
3. In **Build and deployment**, set:
	- **Source**: `Deploy from a branch`
	- **Branch**: `main` (or your default branch)
	- **Folder**: `/ (root)`
4. Save, wait for Pages to publish, then open your `https://<username>.github.io/<repo>/` URL.

## Private storage (Firebase Firestore)

This project uses Firestore with one private list per authenticated user, so each user has their own watched/removed movies.

1. Create a Firebase project.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. In Firebase Console, create a **Firestore Database** (start in production or test mode).
4. In **Project settings → General → Your apps**, create a Web App and copy config values.
5. Open [firebase-config.js](firebase-config.js) and replace all `YOUR_...` placeholders.
6. Deploy to GitHub Pages.

### Firestore rules (username registry + private per user)

Use rules like this so each verified user can only read/write their own list, and username lookups can resolve login:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usernames/{username} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.auth.uid == request.resource.data.uid;
      allow update, delete: if request.auth != null
                            && request.auth.uid == resource.data.uid;
    }

    match /userLists/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

### In-app auth flow

- Sign up with email/password.
- Sign in uses username + password.
- Sign up uses username + email + password.
- Then enter nickname and use the wheel.

## Production checklist

- Add your GitHub Pages domain in **Authentication → Settings → Authorized domains**.
- Use Firestore rules from this README (auth required for private per-user reads/writes).
- Keep Firebase project in production mode and disable test rules.
- Rotate Firebase keys only if leaked in other contexts (web API key itself is public by design).
- Restrict who can restore movies: only the user who removed a movie can restore it.

## Features

- Sign in by nickname
- Username/password sign-in (with email/password under the hood)
- Spin wheel to select a movie
- Remove selected movie after spin
- Manually remove watched movies with a note
- Searchable Top 500 checkbox list for quick mark/unmark
- Private realtime watched/removed list per user via Firestore
- Uses the Top 500 list in `data/movies.json`

## Run

Use any local static server, for example:

- VS Code extension: **Live Server** (open `index.html` and start Live Server)
- Any static file server you already use

Then open the app in your browser.

## Data source

Movie titles were scraped from:

`https://letterboxd.com/official/list/letterboxds-top-500-films/`
