# Give the team their own logins

The web app now **runs as whoever opens it** (`executeAs: USER_ACCESSING`) and is
locked to your Google Workspace domain (`access: DOMAIN` =
anyone `@lockherndigital.com`). Each teammate authorizes once with their own
Google account, and the tool then uses **their** Google Ads access — so everyone
sees and pulls exactly the accounts they can reach under the MCC.

There is no separate password: the login **is** their Lockhern Google account.

---

## One-time setup (you, the owner — about 5 minutes)

### 1. Share the bound Google Sheet with the team

The tool caches every pull in the bound Spreadsheet. Because the app now runs as
each teammate, they each need **Editor** access to that Sheet or their pulls
can't be saved.

- Open the bound Sheet → **Share** → add your team (or the
  `lockherndigital.com` domain) as **Editor**.

> The cache is shared: once anyone pulls an account, everyone opens it instantly.
> That's the point — one pull, whole team benefits.

### 2. Confirm the API token is in place (already done if the tool worked)

- Apps Script → **Project Settings → Script properties**:
  `DEVELOPER_TOKEN` = your MCC's Google Ads API developer token, and
  `LOGIN_CUSTOMER_ID` = your MCC id (digits only). These are shared by the
  script, so teammates never see or need them.

### 3. Redeploy the web app with the new access settings

The new `executeAs` / `access` come from `appsscript.json`, but an **existing**
deployment keeps its old settings until you update it:

- Apps Script → **Deploy → Manage deployments** → edit your web-app deployment
  (pencil) → set:
  - **Execute as:** *User accessing the web app*
  - **Who has access:** *Anyone within Lockhern Digital* (your domain)
  - **Version:** *New version*
  - **Deploy**

  (The clasp auto-sync bumps the code on every push; this access change is a
  one-time manual step in the deploy dialog.)

### 4. Send the team the `/exec` link

Share the web-app URL. That's it.

---

## What each teammate does (once)

1. Open the link. Google shows a one-time **authorization** screen (it lists the
   Google Ads + Sheets access the tool needs). Because the app is internal to
   your domain, there's **no Google verification warning** and no review — they
   just click **Allow**.
2. They land on **"Connect your Google Ads"** → **Find my accounts** → the tool
   lists every Demand Gen account they can reach under the MCC.
3. **Pull** one → its report opens. Anyone else on the team can now **Open** it
   instantly (it's cached).

The header shows who's signed in, so it's always clear whose access is in use.

---

## Notes

- **A teammate only sees accounts they actually have Ads access to.** The
  discovery call runs as them, so it can't surface accounts they can't reach.
- **Pulls run as the teammate**, so the old "wrong identity" 403s can't happen —
  each person uses their own access.
- **The daily 6am refresh and the editor `recover()` / `refresh()`** still run as
  you (the owner). That keeps the shared cache warm for everyone.
- If a teammate gets a **permission error on a pull**, they don't have Ads access
  to that account — grant it in Google Ads, or have someone who does pull it.
