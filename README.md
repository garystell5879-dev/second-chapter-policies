# Second Chapter

Matchmaking for singles 40 and over, launching in the Tulsa area. This repository is the whole website, served free by GitHub Pages. The database, sign-in and photo storage run on Supabase (project `second-chapter-app`, the staging project).

## What's in here

| File | What it does |
|---|---|
| `index.html`, `app.js`, `app.css` | The member site: sign-up, profile and photo, membership, 20 questions, daily introductions, match cart, glints, matches and messaging, admin page |
| `config.js` | Which Supabase project the site talks to. Swap these two values at launch to point at the live project |
| `questions.js` | The 20 questions and the Tulsa-area town list |
| `samples.js` | Sample profiles shown to visitors (not real people; never matched) |
| `terms.html`, `privacy.html`, `acceptable-use.html`, `pricing.html`, `refunds.html`, `law-enforcement.html`, `contact.html`, `policies.html` | The policy pages Stripe requires |

Email addresses on the policy pages (support@, safety@, privacy@, legal@) need their mailboxes created.

## How matching works

- Every morning at 6:05 a.m. Central, the database picks up to 5 introductions for each member who has a complete profile with photo, an active membership and all 20 answers. It also fills in on the spot when a member opens the site.
- People are paired only when each one's "interested in" fits the other's gender, and both are in the same state.
- The score compares the 20 answers. Dealbreakers rule a pair out: a non-smoker who wants a non-smoker is never paired with a smoker, and someone who won't date a person with kids at home is never paired with someone who has them.
- The same pair isn't introduced again for 30 days, and never again after a pass, unmatch or report.
- Unanswered introductions from earlier days wait in the match cart (up to 5).
- When both people say yes, a match is created and messaging opens for both. Messages are limited to 500 characters.
- Glints: one per member per day, only to someone you've been introduced to.

## Membership rules (enforced by the database)

- The first 100 people to finish a profile (including photo) become founders: free for 2 months, with the founder badge. Admin accounts don't use up a founder spot.
- Everyone else must have paid time before answering the 20 questions. Until online payment is connected, an admin can give paid time from the Admin page.

## Payments (Stripe)

- `billing` program (Supabase): starts checkout ($9.99/week or $36/month, auto-renewing), credit-pack checkout, cancel/resume, card portal, and the admin-only "Connect Stripe" step.
- `stripe-webhook` program: Stripe tells it about payments; it updates each member's paid-through date and adds booth credits. Every message is checked against Stripe's signature.
- Founders who pick a plan early aren't charged until their 2 free months end.
- Switching on: add the `STRIPE_SECRET_KEY` secret in Supabase, then tap "Connect Stripe" on the Admin page.

## Photo booth

- Off for each member until they turn it on in Profile; works only when both people in a match have it on.
- First picture per person per match is free; after that, credits (5 for $4.99, 12 for $9.99). A failed picture gives the credit back.
- `booth` program creates the picture with OpenAI's image service (gpt-image-1) from both profile photos, stamps `booth-watermark.png` on it, and saves it to the chat. Pictures are deleted for both people on unmatch.
- Switching on: add the `OPENAI_API_KEY` secret in Supabase.

## Admin

Accounts marked as admin get an Admin tab showing visitors, sign-ups, founders, men and women, matches, messages, reports and the member list.
