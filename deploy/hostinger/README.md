# Hostinger VPS deployment

This application is a Node.js + Express + EJS server. Deploy the full application to a **Hostinger VPS** (Ubuntu 22.04 or 24.04), not shared hosting.

## Before cutover

1. Create an Ubuntu VPS and note its public IP address.
2. In Hostinger DNS, point the `payment` A record to that VPS IP. Keep the current Render record in place until the VPS passes testing.
3. In MongoDB Atlas, allow the VPS IP in Network Access.
4. Create the real `.env` on the VPS from `.env.example`. Generate a new session secret with `openssl rand -hex 32`.
5. Rotate any database credentials that were previously committed to source control before the final DNS cutover.

## Server setup

Run these commands on the VPS:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo mkdir -p /var/www/wgs-payment
sudo chown $USER:$USER /var/www/wgs-payment
git clone https://github.com/mufaddalbatti53/WGS_Payment.git /var/www/wgs-payment
cd /var/www/wgs-payment
cp .env.example .env
# Edit .env with the production values.
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Nginx and HTTPS

```bash
sudo cp deploy/hostinger/wgs-payment.nginx.conf /etc/nginx/sites-available/wgs-payment
sudo ln -s /etc/nginx/sites-available/wgs-payment /etc/nginx/sites-enabled/wgs-payment
sudo nginx -t
sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d payment.webgraphicsstudio.in
```

## Verify before DNS cutover

```bash
curl http://127.0.0.1:3000/health
pm2 status
pm2 logs wgs-payment
```

The health endpoint must return `{"status":"ok","database":"connected"}`. Once HTTPS, login, Google Drive callback, uploads, and backups have been checked on the VPS, point the DNS record fully to Hostinger and then retire the Render service.
