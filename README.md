# Brodal Handmade Inventory

A static, mobile-first PWA for tracking handmade product stock and sales across markets and shop updates. It uses plain HTML, CSS, ES modules, and Firebase's modular browser SDK; there is no build step or package manager.

## Set up Firebase

1. Create a Firebase project and register a **Web app** in Project settings.
2. Copy the complete `firebaseConfig` values into the placeholder object in [`firebase-config.js`](./firebase-config.js). Keep the object property names intact. The app deliberately remains on its setup/login screen until every placeholder is replaced.
3. In **Authentication → Sign-in method**, enable **Email/Password**. In **Authentication → Users**, add the email/password account you will use.
4. In **Authentication → Settings → Authorized domains**, add your Pages hostname, for example `yourusername.github.io` (hostname only; do not include `https://` or the repository path).
5. Create a **Cloud Firestore** database.
6. In **Authentication → Users**, copy your account's UID. In [`firestore.rules`](./firestore.rules), replace `REPLACE_WITH_YOUR_FIREBASE_AUTH_UID` with that UID, then publish the rules in **Firestore Database → Rules**. The rules intentionally allow only that one UID and enforce the documented event and inventory fields. Do not publish permissive test-mode rules.

The app's collections are `events` and `inventory`; inventory documents link to an event with `marketId`. Summary values (available quantity, potential value, revenue, and net profit) are calculated in the app and are not stored. Catalog copies reset both quantities to zero.

The rules template is for a single-owner inventory. If you later let multiple accounts use the same project, add an owner UID field to documents and scope both the Firestore rules and client queries to that owner before granting access to those accounts.

## Run and deploy on GitHub Pages

1. Serve the repository over HTTP or HTTPS while testing; ES modules and service workers do not work from a `file://` URL. For example, use the static server feature of your editor, or deploy a test branch.
2. Commit and push the static files:

   ```text
   git add index.html styles.css app.js firebase-config.js manifest.json app-icon.svg sw.js firestore.rules README.md images/logo.png
   git commit -m "Add handmade inventory PWA"
   git push origin main
   ```

3. On GitHub, open **Settings → Pages**, choose the `main` branch and `/ (root)` (or the folder where these files live), and save.
4. Open the published HTTPS URL, such as `https://yourusername.github.io/repo-name/`. Sign in and create a market to verify Authentication and Firestore access. The service worker, manifest, and asset paths are relative so the repository subfolder is supported.

## Install on your phone and use offline

- **Android:** open the HTTPS Pages URL in Chrome, then choose **Install app** or **Add to Home screen** from the browser menu.
- **iPhone/iPad:** open the HTTPS URL in Safari, tap **Share**, then **Add to Home Screen**.
- Load the app and sign in while online at least once. Firestore local persistence and the service worker cache support viewing and queuing changes during intermittent connectivity. Browser storage must remain available; avoid clearing site data. Pending Firebase writes synchronize when the connection returns.

The app uses the supplied `images/logo.png` as its in-app logo and `app-icon.svg` as the install icon. Firebase API keys identify the project and are expected in a browser app; Firestore rules and Authentication are what protect its data.
