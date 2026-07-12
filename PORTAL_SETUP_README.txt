GREEN GRIN PORTAL SETUP

This portal is built for Netlify + Supabase + app notifications.
There is no SMS setup in this version.
There are no customer pay links in this version.

LIVE URLS
- Main site: /
- Customer portal: /portal/
- Admin portal: /admin/
- Employee portal: /employee/

WHAT WORKS AFTER SETUP
- Customers can create an account and sign in with email/password.
- New customer accounts show in Admin -> Customers.
- Admin can create jobs tied to customers.
- Admin can set service plan, annual price, and monthly price.
- Admin can create, save, send, edit, and delete invoices.
- Admin can mark invoices paid, search paid invoices, and keep paid invoices collapsed below open invoices.
- Admin can build a starting bid from mowing, spraying, cleanups, and custom service totals.
- Admin can scan receipt photos with AI, review the result, and save expenses.
- Admin can log start/end mileage and have the calculated miles added as a vehicle expense at $0.76 per mile.
- Sent invoices show in the customer's Billing tab.
- Admin can send a monthly invoice from the customer's monthly service number.
- Employees can request access.
- Admin can approve/deactivate/delete employees, set PINs, and set hourly rates.
- Employees can see assigned jobs and click Done.
- Employees can clock in/out.
- Admin can view time clock totals and pay totals by day/week/month.
- Customers, admin, and employees can enable app notifications on their device.
- Morning cleanup reminders send through app notifications only.
- Done notices send through app notifications only.
- Sent invoices send through app notifications only.
- Admin can send a broadcast app notification to all customers who enabled notifications.
- Notifications can arrive while the portal app is closed after that device has enabled notifications.

SUPABASE SETUP
1. Open Supabase.
2. Go to SQL Editor.
3. Paste and run portal-setup.sql.
4. If you already ran setup before, run portal-setup.sql again. It safely adds the new notification table.
5. Go to Project Settings -> API.
6. Copy:
   - Project URL
   - anon public key
   - service_role key
7. Go to Authentication -> Providers.
8. Make sure Email is enabled.
9. Go to Authentication -> URL Configuration.
10. Add your Netlify site URL as an allowed redirect URL.

NETLIFY ENVIRONMENT VARIABLES
In Netlify, go to:
Site configuration -> Environment variables

Add these:
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
GREEN_GRIN_ADMIN_PIN=make up a private admin PIN
GREEN_GRIN_TIMEZONE=America/Denver
GREEN_GRIN_VAPID_PUBLIC_KEY=from GGL-1.55-NOTIFICATION-KEYS.txt
GREEN_GRIN_VAPID_PRIVATE_KEY=from GGL-1.55-NOTIFICATION-KEYS.txt
GREEN_GRIN_VAPID_SUBJECT=mailto:notifications@greengrinlawns.com
OPENAI_API_KEY=your OpenAI API key for receipt scanning

Do not put the notification keys text file in GitHub.
Do not share the service_role key, private notification key, OpenAI API key, or admin PIN.
The SUPABASE_ANON_KEY and GREEN_GRIN_VAPID_PUBLIC_KEY are okay to expose.

OPENAI_RECEIPT_MODEL is optional. Leave it out unless you are intentionally changing the receipt scanner model.

APP NOTIFICATION SETUP
1. Upload/deploy this site to Netlify.
2. Add the Netlify environment variables above.
3. Run portal-setup.sql in Supabase.
4. Redeploy the site. Netlify must include package.json so it installs the push sender.
5. Open /portal/, /admin/, or /employee/.
6. Sign in.
7. Click Enable Notifications on each device that should receive alerts.

NOTIFICATION NOTES
- Customers only receive app reminders after they sign in and tap Enable Notifications.
- Admin only receives admin notifications after you sign in to /admin/ and tap Enable Notifications.
- Employees only receive employee notifications after they sign in to /employee/ and tap Enable Notifications.
- iPhone users usually need to add the portal to their Home Screen before notifications work.
- After notifications are enabled, the app can be closed and notifications can still arrive.
- If a customer blocks notifications, they will not receive reminders.
- If a customer changes phone/browser, they need to enable notifications again.

AUTOMATIC MORNING REMINDERS
Netlify checks every 15 minutes.
It does not notify every 15 minutes.
Each scheduled job gets one morning cleanup reminder per service day, after the saved morning notification time.

INSTALLED APP UPDATES
The downloaded app is still your website.
When you deploy a new version, the installed app usually updates the next time it opens.
If it looks stuck on an old version, fully close and reopen the app.

PAYMENTS
Payments are intentionally turned off in this version.
Invoices can be created and sent, but customers will not see a pay button.

EXPENSE SCANNER
Admin -> Expenses can scan receipt photos after OPENAI_API_KEY is added in Netlify.
The scan fills the form only. Review the vendor, date, category, and total before saving.
Receipt photos are not saved in Supabase by this version; only the reviewed expense details are saved.
