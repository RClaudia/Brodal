# Brodal Handmade Inventory

A static, mobile-first PWA for tracking handmade product stock and sales across markets and shop updates. It uses plain HTML, CSS, ES modules, and Firebase's modular browser SDK; there is no build step or package manager.

## Set up Firebase

1. Create a Firebase project and register a **Web app** in Project settings.
2. Copy the complete `firebaseConfig` values into the placeholder object in [`firebase-config.js`](./firebase-config.js). Keep the object property names intact. The app deliberately remains on its setup/login screen until every placeholder is replaced.
3. In **Authentication → Sign-in method**, enable **Email/Password**. In **Authentication → Users**, add the email/password account you will use.
4. In **Authentication → Settings → Authorized domains**, add your Pages hostname, for example `yourusername.github.io` (hostname only; do not include `https://` or the repository path).
5. Create a **Cloud Firestore** database.
6. In **Authentication → Users**, copy your account's UID. In [`firestore.rules`](./firestore.rules), replace `REPLACE_WITH_YOUR_FIREBASE_AUTH_UID` with that UID, then publish the rules in **Firestore Database → Rules**. The rules intentionally allow only that one UID and enforce the documented event, inventory, reusable item, category, and accounting-entry fields. Do not publish permissive test-mode rules.

After signing in, the main navigation includes only **Home**, **Settings**, and **Log out**. Use the Workspace Hub on Home to open **Inventory**, **Items**, **Contabilitate**, or **Market history**. Settings actions are grouped by Markets, Contabilitate, Items, and Account. **Inventory → Markets** is the current inventory section; additional inventory sections can be added later. New item forms suggest the next numeric SKU based on existing numeric SKUs, while keeping the field editable; Items and market inventory are sorted by SKU by default. Items can have up to 12 named color variants, each with its own image. Stock quantities are tracked per color in each market, not in the reusable item catalog; new market variant rows default to zero and can then be adjusted. Market CSV files include a Color column so these rows can be imported again. The accounting ledger is stored in the separate `accounting_entries` collection; it does not share documents with `events`, `inventory`, or `products`. Each row includes `nrCrt`, `dataOperatiunii`, `document`, `explicatii`, the four income/payment amounts in RON, and Firestore `createdAt`/`updatedAt` timestamps. Accounting CSV import is in **Settings → Contabilitate**: choose a year and select the exported-format CSV. It validates dates and row numbers, previews blank-document/signed-correction notes, appends entries without overwriting existing ones, and stops if an entry number already exists for that year. Dates may be `YYYY-MM-DD` or `DD.MM.YYYY`; signed amounts are supported for accounting corrections. Number suggestions are based on the visible year/month selection and can be edited; the number is not a database-enforced counter.

The app also stores `events`, `inventory`, reusable `products`, and `categories` in Firestore. Inventory documents link to an event with `marketId` and a reusable item with `productId`; product details and prices are copied into each market inventory record so catalog price changes never rewrite market history. On first load, existing inventory is used to seed the reusable item catalog by SKU. Events store `startDate` and `endDate` in `YYYY-MM-DD` format (older single-date events are still displayed). Market records also keep organizer, edition, cash and bank income, closed status, and a final sold-item count. The Home hub and Markets page link to **Market history**, which lists markets by year and adds annual totals for cash income, bank income, total income, and items sold. Use **Finish / Close market** on an active market to enter final income; sold items are calculated from its linked inventory, and closing makes that inventory read-only. To enter an older market without inventory records, choose **Settings → Markets → Add past market**, select its year, and enter the period, duration, location, organizer, edition, income, and sold count. Total income is calculated from cash and bank income. These manual historical entries are closed records and do not change product inventory.

Use the **Settings** page to rename/update or delete the selected event, add events, manage categories, or import a market. Event deletion removes its linked inventory and requires an internet connection and confirmation. Category renames update reusable catalog items but leave past market records unchanged; removing a category is disabled while a catalog item uses it. The separate **Items** page manages reusable products, including prices for future markets. Adding an item to a market copies the current catalog details and price into that market's history.

CSV import asks for the new event details; required product columns are SKU, Product Name, Category, Price, and Total Qty. Sold Qty, Unit Cost, and Notes are optional. Product images are not included in CSV export/import. Product categories start with Magnet, Brosa, and Globulet. Prices and summaries are displayed in RON. Available quantity, potential value, revenue, and net profit are calculated in the app and are not stored. Catalog copies reset both quantities to zero.

The rules template is for a single-owner inventory. If you later let multiple accounts use the same project, add an owner UID field to documents and scope both the Firestore rules and client queries to that owner before granting access to those accounts.

## Run and deploy on GitHub Pages

1. Serve the repository over HTTP or HTTPS while testing; ES modules and service workers do not work from a `file://` URL. For example, use the static server feature of your editor, or deploy a test branch.
2. Commit and push the static files:

   ```text
   git add index.html styles.css app.js firebase-config.js manifest.json sw.js firestore.rules README.md images/logo.png
   git commit -m "Add accounting workspace"
   git push origin main
   ```

3. On GitHub, open **Settings → Pages**, choose the `main` branch and `/ (root)` (or the folder where these files live), and save.
4. Before publishing the app, replace the owner UID placeholder in `firestore.rules` with the signed-in Firebase user's UID and publish those rules from **Firestore Database → Rules**. Confirm that the deployed rules include `accounting_entries` read/create/update/delete access for that owner. Then open the published HTTPS URL, such as `https://yourusername.github.io/repo-name/`, and sign in to verify Authentication, inventory, and accounting access. GitHub Pages only hosts the static app; Firestore rules must be published separately in Firebase. The service worker, manifest, and asset paths are relative so the repository subfolder is supported.

## Install on your phone and use offline

- **Android:** open the HTTPS Pages URL in Chrome, then choose **Install app** or **Add to Home screen** from the browser menu.
- **iPhone/iPad:** open the HTTPS URL in Safari, tap **Share**, then **Add to Home Screen**.
- Load the app and sign in while online at least once. Firestore local persistence and the service worker cache support viewing and queuing changes during intermittent connectivity. Browser storage must remain available; avoid clearing site data. Pending Firebase writes synchronize when the connection returns.

The supplied `images/logo.png` is used as the login, header, and install icon. Firebase API keys identify the project and are expected in a browser app; Firestore rules and Authentication are what protect its data.
