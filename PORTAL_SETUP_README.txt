GREEN GRIN CUSTOMER PORTAL SETUP

This portal is built for Netlify + Supabase + Twilio.

What works after setup:
- Customers can sign in with email and password
- Customer profiles are created/loaded automatically
- Customers can save property notes to their account
- New service requests attach to the signed-in customer
- Customers can request service at /portal/
- Customers can check status by phone number
- Owner dashboard can view requests
- Owner can create jobs directly in the portal
- Owner can schedule a job
- Employees can log in with an employee PIN
- Employees can request their own account access from the portal
- Owner can approve, deactivate, or reactivate employee accounts
- Owner can set each employee's PIN inside the portal
- Employees can view scheduled jobs without billing/pricing
- Employees can click Done to send the completed-service text
- Owner can view an activity log showing who clicked Done
- Owner can deactivate or delete customers from the admin job list
- Owner can deactivate or delete employees from Employee Access
- Owner can send text messages:
  - pick up yard objects
  - job complete
- Automatic morning cleanup reminders can send on scheduled mow days
- Owner can choose the morning reminder time while creating or editing a job
- Customer billing buttons can open secure hosted payment links after payment URLs are added

LIVE URLS
- Customer portal: /portal/
- Employee portal: /employee/
- Admin portal: /admin/

The homepage links customers to /portal/.
Keep /admin/ and /employee/ for you and your crew.

What you need:
1. Netlify site
2. Supabase project
3. Twilio account and phone number

SUPABASE SETUP
1. Create a Supabase project.
2. Go to SQL Editor.
3. Paste and run the SQL from portal-setup.sql.
4. Go to Project Settings -> API.
5. Copy:
   - Project URL
   - anon public key
   - service_role key
6. Go to Authentication -> Providers.
7. Make sure Email is enabled.
8. Go to Authentication -> URL Configuration.
9. Add your Netlify site URL as an allowed redirect URL.

TWILIO SETUP
1. Create a Twilio account.
2. Get a Twilio phone number that can send SMS.
3. Copy:
   - Account SID
   - Auth Token
   - Twilio phone number

PAYMENT LINK SETUP
Use hosted payment links from Stripe, GoCardless, Square, your bank, or another provider.
Do not store bank or card details in this website.

NETLIFY ENVIRONMENT VARIABLES
In Netlify, go to:
Site configuration -> Environment variables

Add these:
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
SUPABASE_SERVICE_ROLE_KEY=your Supabase service_role key
GREEN_GRIN_ADMIN_PIN=make up a private PIN
TWILIO_ACCOUNT_SID=your Twilio account SID
TWILIO_AUTH_TOKEN=your Twilio auth token
TWILIO_FROM_NUMBER=your Twilio phone number, like +12085551234
GREEN_GRIN_TIMEZONE=America/Denver
GREEN_GRIN_PAY_DEFAULT_URL=your default secure payment link
GREEN_GRIN_PAY_BIWEEKLY_URL=optional bi-weekly mowing payment link
GREEN_GRIN_PAY_WEEKLY_URL=optional weekly mowing payment link
GREEN_GRIN_PAY_COMMERCIAL_URL=optional commercial care payment link
GREEN_GRIN_PAY_INVOICE_URL=optional invoice payment link

Then redeploy the site.

IMPORTANT
Do not share your service_role key, Twilio auth token, or admin PIN.
The SUPABASE_ANON_KEY is okay to use in the browser. The service_role key is private.

CUSTOMER ACCOUNTS NOTE
The portal uses Supabase email + password accounts for customers.
Customers can create an account, then sign in later with the same email and password.
If Supabase email confirmation is turned on, they may need to confirm their email once.

After sign-in, the portal loads:
- customer profile
- property notes
- customer service requests

The "Preview Demo Account" button only shows a fake local preview. Real saved data
requires Supabase environment variables and the SQL setup.

AUTOMATIC TEXTING NOTE
The morning cleanup reminder is automatic.
If a job has a scheduled_date for today, Netlify checks every 15 minutes and sends after the job's saved reminder time:
"Please pick up toys, hoses, pet waste, and yard objects before we arrive."

The check every 15 minutes is only a quick lookup. It does not text every 15 minutes.
Each job only receives one automatic cleanup reminder per scheduled day.

There is no "on the way" customer text.
The "job complete" message is manual, so you click "Text: Done" when the work is done.

EMPLOYEE ACCOUNTS NOTE
Employees can request access on the portal.
Owner opens the Owner tab, loads Employee Access with the admin PIN, then approves employees and sets each employee's PIN.
Active employees can sign in by email or use the PIN you set. They can only see the employee job list and the Done button.
Deactivated employees cannot load jobs or mark jobs done.

IMPORTANT UPDATE NOTE
If you already ran portal-setup.sql before this version, run it again in Supabase SQL Editor.
It safely adds the employee PIN and activity log columns without deleting your data.
This version also adds a customer active/inactive column.
