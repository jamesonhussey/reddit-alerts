Reddit Alerts 📢 (Redd-Alert)

A simple mobile app + Cloudflare Worker that sends push notifications when new Reddit posts match your subreddit + keyword rules. Checks every ~2 minutes using the Reddit API.
Features

    Create alerts for any subreddit + keyword

    Push notifications via Expo

    View and delete your active rules

    Alerts feed sorted by post time

Tech

    Frontend: React Native + Expo

    Backend: Cloudflare Workers + KV Storage

    Push: Expo Notifications API

Quick Start

# 1. Clone repo
git clone https://github.com/your-username/reddit-alerts.git

cd reddit-alerts

# 2. Install frontend dependencies
cd reddit-alerts-app

npm install

# 3. Install backend dependencies
cd ../reddit-alerts-worker

npm install

# 4. Deploy Worker (requires Wrangler CLI)
wrangler login

wrangler publish

# 5. Run Expo app
cd ../reddit-alerts-app

npx expo start

Setup Notes

    Set your WORKER_BASE_URL in App.tsx

    Store secrets (like REDDIT_CLIENT_SECRET) in Cloudflare via:

wrangler secret put REDDIT_CLIENT_SECRET

Security

Secrets like REDDIT_CLIENT_SECRET are stored in Cloudflare, not in the repo.