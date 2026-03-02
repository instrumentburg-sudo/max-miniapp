---
paths: "{deploy.sh,setup-service.sh,nginx.conf.example}"
---

# Deploy — NetAngels

## Первый деплой (один раз)

### 1. Nginx

Добавить в конфиг сервера instrumentburg.ru:

```nginx
# MAX Mini App — static frontend
location /max-app/ {
    alias /home/c50684/instrumentburg.ru/www/max-app/;
    try_files $uri $uri/ /max-app/index.html;
    expires 7d;
}

# MAX Mini App — API proxy
location /max-api/ {
    proxy_pass http://127.0.0.1:8100/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 2. API service

```bash
# На сервере:
scp setup-service.sh c50684@h31.netangels.ru:~/
ssh c50684@h31.netangels.ru bash setup-service.sh
# Отредактировать service file — подставить реальные env vars
systemctl --user daemon-reload
systemctl --user enable --now max-miniapp-api
sudo loginctl enable-linger c50684   # чтобы работал без логина
```

### 3. MAX Platform

Зарегистрировать URL мини-приложения: `https://instrumentburg.ru/max-app/`

## Обновление

```bash
./deploy.sh                 # Всё (build + upload + restart)
./deploy.sh --frontend-only # Только фронт (быстро)
./deploy.sh --api-only      # Только API
```

## Проверка

```bash
curl https://instrumentburg.ru/max-api/health
# → {"status":"ok","service":"max-miniapp-api"}

curl https://instrumentburg.ru/max-app/
# → HTML index
```

## Пути на сервере

| Путь | Что |
|------|-----|
| `/home/c50684/instrumentburg.ru/www/max-app/` | Frontend static files |
| `/home/c50684/instrumentburg.ru/max-api/` | API Python files |
| `~/.config/systemd/user/max-miniapp-api.service` | Systemd unit |

## Логи

```bash
ssh c50684@h31.netangels.ru "journalctl --user -u max-miniapp-api -f"
```
