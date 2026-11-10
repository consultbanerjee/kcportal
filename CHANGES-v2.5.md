# KC LEGAL portal v2.5

- Public news feed `/api/public/news` (7 boxes' worth of sources: Supreme Court, Calcutta High Court, Government of India, Government of West Bengal, Law News India, Law News International). Refreshes every 30 minutes; no source names exposed.
- Separate login pages: `#/login/client`, `#/login/firm`, `#/login/admin` (enforced on the server).
- Chatbot: matrimonial knowledge, human-like tone, 5-attempt rule -> ticket (name, email, phone, address), existing-client handling, Client Portal live chat, staff "Tickets" screen.
- Service worker cache bumped to kc-shell-v15.

After upload: on the server run `cd /opt/kcportal && git pull && docker compose up -d --build`.
In AI Control enable `ai_chat` and add https://www.kclegal.us to allowed chat sites.
