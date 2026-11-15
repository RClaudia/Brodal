# Brodal Handmade Inventory

A static, mobile-first PWA for tracking handmade product stock and sales across markets and shop updates. It uses plain HTML, CSS, ES modules, and Firebase's modular browser SDK; there is no build step or package manager.

## Set up Firebase

1. Create a Firebase project and register a **Web app** in Project settings.
2. Copy the complete `firebaseConfig` values into the placeholder object in [`firebase-config.js`](./firebase-config.js). Keep the object property names intact. The app deliberately remains on its setup/login screen until every placeholder is replaced.
3. In **Authentication → Sign-in method**, enable **Email/Password**. In **Authentication → Users**, add the email/password account you will use.
4. In **Authentication → Settings → Authorized domains**, add your Pages hostname, for example `yourusername.github.io` (hostname only; do not include `https://` or the repository path).
5. Create a **Cloud Firestore** database.
6. In **Authentication → Users**, copy your account's UID. In [`firestore.rules`](./firestore.rules), replace `REPLACE_WITH_YOUR_FIREBASE_AUTH_UID` with that UID, then publish the rules in **Firestore Database → Rules**. The rules intentionally allow only that one UID and enforce the documented event, market inventory, materials, reusable item, category, and accounting-entry fields. Do not publish permissive test-mode rules.

After signing in, the main navigation includes only **Home**, **Settings**, and **Log out**. Use the Workspace Hub on Home to open **Inventory**, **Items**, **Contabilitate**, or **Market history**. Settings actions are grouped by Markets, Contabilitate, Items, and Account. **Inventory** contains separate **Markets** and **Materials** sections; materials are stored independently from market stock. A material record includes its name, distributor, unit price, unit (pieces, meters, or centimeters), quantity, and manually editable used quantity; remaining quantity and total price (unit price multiplied by quantity) are calculated. New item forms suggest the next numeric SKU based on existing numeric SKUs, while keeping the field editable; Items and market inventory are sorted by SKU by default. Items can have up to 12 named color variants, each with its own image. Stock quantities are tracked per color in each market, not in the reusable item catalog; new market variant rows default to zero and can then be adjusted. Market CSV files include a Color column so these rows can be imported again. The accounting ledger is stored in the separate `accounting_entries` collection; it does not share documents with `events`, `inventory`, or `products`. Each row includes `nrCrt`, `dataOperatiunii`, `document`, `explicatii`, the four income/payment amounts in RON, optional fiscal classifications, and Firestore `createdAt`/`updatedAt` timestamps. **Contabilitate** has four subviews: Registru de Încasări și Plăți, Registru de Evidență Fiscală, Facturi Oblio, and Declarația F4109. The fiscal register includes only entries explicitly classified as taxable income or deductible expenses; legacy/imported entries without classification are excluded until reviewed in the journal editor. Limited deductions are capped at the amount entered and cannot exceed the recorded payment total. Check classifications and supporting documents with your accountant. A monthly F4109 reminder appears from the 1st through the 20th and can be dismissed for the current month in that browser. Accounting CSV import is in **Settings → Contabilitate**: choose a year and select the exported-format CSV. It validates dates and row numbers, previews blank-document/signed-correction notes, appends entries without overwriting existing ones, and stops if an entry number already exists for that year. Dates may be `YYYY-MM-DD` or `DD.MM.YYYY`; signed amounts are supported for accounting corrections. Number suggestions are based on the visible year/month selection and can be edited; the number is not a database-enforced counter.

### Oblio proxy integration

The static app never contains an Oblio `client_secret`. Configure the serverless proxy base URL as the GitHub Actions variable `VITE_OBLIO_PROXY_URL` (or as a secret with the same name), for example `https://api.example.ro/api/oblio`. The Pages deployment workflow injects it directly into the published `app.js`; there is no endpoint settings field or extra config file in the app. The generated URL is delivered to browsers and is publicly visible, so use this only for the proxy URL, never for a client secret or other credential. Implement these proxy routes on a trusted server:

- `POST /api/authorize/token` performs the Oblio OAuth2 token exchange using server-side credentials.
- `GET /invoices?limit=20` returns recent invoices.
- `GET /invoices?status=paid` returns invoices eligible for sync.

The invoice routes should return JSON as either an array or `{ "invoices": [...] }`; each invoice needs an ID (or a stable invoice number), number, total, status, date, and optional client name. Mark paid invoices with `paid: true` or a status of `paid`, `achitat`, or `achitata`. The proxy must authenticate with Oblio, validate and constrain requests, protect its credentials, and allow the deployed Pages origin through CORS. The app maps paid invoices into Firestore using a stable invoice document ID to avoid duplicate syncs; choose the cash/bank channel before syncing. Sync uses invoice date as the journal operation date and marks the income taxable, so review the resulting ledger entries. Never put Oblio credentials in this repository or browser storage.

The app also stores `events`, market `inventory`, independent `materials`, reusable `products`, and `categories` in Firestore. Materials use their own collection and do not affect products or market stock. Inventory documents link to an event with `marketId` and a reusable item with `productId`; product details and prices are copied into each market inventory record so catalog price changes never rewrite market history. On first load, existing inventory is used to seed the reusable item catalog by SKU. Events store `startDate` and `endDate` in `YYYY-MM-DD` format (older single-date events are still displayed). Market records also keep organizer, edition, cash and bank income, closed status, and a final sold-item count. The Home hub and Markets page link to **Market history**, which lists markets by year and adds annual totals for cash income, bank income, total income, and items sold. Use **Finish / Close market** on an active market to enter final income; sold items are calculated from its linked inventory, and closing makes that inventory read-only. To enter an older market without inventory records, choose **Settings → Markets → Add past market**, select its year, and enter the period, duration, location, organizer, edition, income, and sold count. Total income is calculated from cash and bank income. These manual historical entries are closed records and do not change product inventory.

Use the **Settings** page to rename/update or delete the selected event, add events, manage categories, or import a market. Event deletion removes its linked inventory and requires an internet connection and confirmation. Category renames update reusable catalog items but leave past market records unchanged; removing a category is disabled while a catalog item uses it. The separate **Items** page manages reusable products, including prices for future markets. Adding an item to a market copies the current catalog details and price into that market's history.

CSV import asks for the new event details; required product columns are SKU, Product Name, Category, Price, and Total Qty. Sold Qty, Unit Cost, and Notes are optional. Product images are not included in CSV export/import. Product categories start with Magnet, Brosa, and Globulet. Prices and summaries are displayed in RON. Available quantity, potential value, revenue, and net profit are calculated in the app and are not stored. Catalog copies reset both quantities to zero.

The rules template is for a single-owner inventory. If you later let multiple accounts use the same project, add an owner UID field to documents and scope both the Firestore rules and client queries to that owner before granting access to those accounts.

## Run and deploy on GitHub Pages

1. In repository **Settings → Secrets and variables → Actions → Variables → New repository variable** (or **Secrets → New repository secret**), add `VITE_OBLIO_PROXY_URL` with the HTTPS base URL of the Oblio proxy. If it is configured under an Actions environment, use the `github-pages` environment selected by the workflow.
2. In **Settings → Pages**, set the build and deployment source to **GitHub Actions**. The workflow at `.github/workflows/pages.yml` injects the configured proxy URL into `app.js` during deployment.
3. Serve the repository over HTTP or HTTPS while testing; ES modules and service workers do not work from a `file://` URL. For example, use the static server feature of your editor.
4. Commit and push the static files:

   ```text
   git add .github/workflows/pages.yml index.html styles.css app.js oblioService.js firebase-config.js manifest.json sw.js firestore.rules README.md images/logo.png
   git commit -m "Configure accounting workspace deployment"
   git push origin main
   ```

5. Before publishing the app, replace the owner UID placeholder in `firestore.rules` with the signed-in Firebase user's UID and publish those rules from **Firestore Database → Rules**. Confirm that the deployed rules include `accounting_entries` read/create/update/delete access for that owner. Then open the published HTTPS URL, such as `https://yourusername.github.io/repo-name/`, and sign in to verify Authentication, inventory, and accounting access. GitHub Pages only hosts the static app; Firestore rules must be published separately in Firebase. The service worker, manifest, and asset paths are relative so the repository subfolder is supported.

## Install on your phone and use offline

- **Android:** open the HTTPS Pages URL in Chrome, then choose **Install app** or **Add to Home screen** from the browser menu.
- **iPhone/iPad:** open the HTTPS URL in Safari, tap **Share**, then **Add to Home Screen**.
- Load the app and sign in while online at least once. Firestore local persistence and the service worker cache support viewing and queuing changes during intermittent connectivity. Browser storage must remain available; avoid clearing site data. Pending Firebase writes synchronize when the connection returns.

The supplied `images/logo.png` is used as the login, header, and install icon. Firebase API keys identify the project and are expected in a browser app; Firestore rules and Authentication are what protect its data.
