<?php

declare(strict_types=1);

// ---------------------------------------------------------------------------
// MAX Mini App — PHP API
// Endpoints: GET /health, GET /order/{number}, POST /repair, POST /bot/webhook
//
// POST /webhook and POST /debug below are a legacy bot handler that was
// deployed straight to prod on 2026-03-04 and never committed to git (found
// 2026-07-23 while building /bot/webhook for issue #266 — prod and this repo
// had drifted). Recovered byte-for-byte from the live server and merged here
// so it stops being a git blind spot. It targets the deprecated
// platform-api.max.ru domain (current API is platform-api2.max.ru) and its
// own MAX subscription (url=…/max-api/webhook) predates and is independent
// of the /bot/webhook subscription added for #266 — not touched/fixed here.
// ---------------------------------------------------------------------------

// --- Environment -----------------------------------------------------------

function load_env(): void
{
    $paths = [
        '/home/c50684/instrumentburg.ru/max-api-env/.env',
        __DIR__ . '/.env',
    ];

    foreach ($paths as $path) {
        if (file_exists($path)) {
            $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if ($lines === false) {
                continue;
            }
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') {
                    continue;
                }
                $pos = strpos($line, '=');
                if ($pos === false) {
                    continue;
                }
                $key   = trim(substr($line, 0, $pos));
                $value = trim(substr($line, $pos + 1));
                $_ENV[$key]    = $value;
                $_SERVER[$key] = $value;
                putenv("$key=$value");
            }
            return; // first file found wins
        }
    }

    error_log('[max-api] No .env file found in any of the expected paths');
}

function env(string $key, string $default = ''): string
{
    return $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key) ?: $default;
}

// --- Helpers ---------------------------------------------------------------

function json_response($data, int $code = 200)
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function get_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function escape_markdown(string $text): string
{
    return str_replace(
        ['_', '*', '`', '['],
        ['\\_', '\\*', '\\`', '\\['],
        $text
    );
}

// --- CORS ------------------------------------------------------------------

function handle_cors(): void
{
    $allowed = [
        'https://instrumentburg.ru',
        'http://localhost:5180',
        'http://localhost:5173',
    ];

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if (in_array($origin, $allowed, true)) {
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: X-Init-Data, Content-Type');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// --- LiveSklad client ------------------------------------------------------

function livesklad_auth(): ?string
{
    $login    = env('LIVESKLAD_LOGIN');
    $password = env('LIVESKLAD_PASSWORD');

    if ($login === '' || $password === '') {
        error_log('[max-api] LIVESKLAD_LOGIN or LIVESKLAD_PASSWORD not set');
        return null;
    }

    $ch = curl_init('https://api.livesklad.com/auth');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(['login' => $login, 'password' => $password]),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("[max-api] LiveSklad auth curl error: $error");
        return null;
    }

    if ($httpCode !== 200) {
        error_log("[max-api] LiveSklad auth HTTP $httpCode: $response");
        return null;
    }

    $data = json_decode($response, true);
    return $data['token'] ?? null;
}

function livesklad_fetch_orders(string $token, int $page): ?array
{
    $url = 'https://api.livesklad.com/company/orders?' . http_build_query([
        'pageSize' => 50,
        'page'     => $page,
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ["Authorization: $token"],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("[max-api] LiveSklad orders curl error: $error");
        return null;
    }

    return ['http_code' => $httpCode, 'body' => $response];
}

function normalize_order_number(string $input): string
{
    $input = mb_strtoupper(trim($input));
    $input = str_replace('#', '', $input);
    // Homoglyph fix: Cyrillic А (U+0410) is visually identical to Latin A —
    // common typo on mobile keyboards that auto-detect Cyrillic layout.
    $input = str_replace("\xD0\x90", 'A', $input);
    // Strip leading 'A' prefix for comparison
    return ltrim($input, 'A');
}

function looks_like_order_number(string $text): bool
{
    if (trim($text) === '') {
        return false;
    }
    $normalized = normalize_order_number($text);
    return $normalized !== '' && ctype_digit($normalized);
}

function match_order_number(array $order, string $searchNormalized): bool
{
    $candidates = [];

    if (isset($order['number']) && $order['number'] !== '') {
        $candidates[] = (string)$order['number'];
    }
    if (isset($order['id']) && $order['id'] !== '') {
        $candidates[] = (string)$order['id'];
    }

    foreach ($candidates as $candidate) {
        $candidateUp   = mb_strtoupper($candidate);
        $candidateBase = ltrim($candidateUp, 'A');

        if ($candidateUp === $searchNormalized || $candidateBase === $searchNormalized) {
            return true;
        }
    }

    return false;
}

/**
 * @return array{status: string, status_label: string}
 */
function map_status(array $order): array
{
    $statusMap = [
        'new'                  => ['Принят', 'received'],
        'inwork'               => ['В работе', 'in_progress'],
        'inWork'               => ['В работе', 'in_progress'],
        'ready'                => ['Готов к выдаче', 'ready'],
        'done'                 => ['Выполнен', 'completed'],
        'completed'            => ['Выполнен', 'completed'],
        'closed'               => ['Выполнен', 'completed'],
        'принят'               => ['Принят', 'received'],
        'в работе'             => ['В работе', 'in_progress'],
        'диагностика'          => ['На диагностике', 'diagnosing'],
        'ожидает запчасти'     => ['Ожидает запчасти', 'waiting_parts'],
        'ожидание запчастей'   => ['Ожидает запчасти', 'waiting_parts'],
        'готов'                => ['Готов к выдаче', 'ready'],
        'готов к выдаче'       => ['Готов к выдаче', 'ready'],
        'выполнен'             => ['Выполнен', 'completed'],
        'выдан'                => ['Выполнен', 'completed'],
    ];

    $statusObj = $order['status'] ?? null;

    // Try status.type first (e.g. "inWork"), then status.name (e.g. "В работе")
    $candidates = [];
    if (is_array($statusObj)) {
        if (isset($statusObj['type'])) $candidates[] = (string)$statusObj['type'];
        if (isset($statusObj['name'])) $candidates[] = (string)$statusObj['name'];
    } elseif (is_string($statusObj)) {
        $candidates[] = $statusObj;
    }

    foreach ($candidates as $raw) {
        if (isset($statusMap[$raw])) {
            return ['status' => $statusMap[$raw][1], 'status_label' => $statusMap[$raw][0]];
        }
        $lower = mb_strtolower($raw);
        if (isset($statusMap[$lower])) {
            return ['status' => $statusMap[$lower][1], 'status_label' => $statusMap[$lower][0]];
        }
    }

    // Fallback
    $label = $candidates[0] ?? 'Неизвестно';
    return ['status' => 'unknown', 'status_label' => $label];
}

function format_order(array $order): array
{
    $mapped = map_status($order);

    // date_received
    $dateReceived = null;
    $rawDate = $order['dateCreate'] ?? $order['date_create'] ?? null;
    if ($rawDate !== null) {
        $ts = strtotime((string)$rawDate);
        if ($ts !== false) {
            $dateReceived = date('d.m.Y', $ts);
        }
    }

    // device_name
    $deviceName = null;
    foreach (['device', 'typeDevice'] as $field) {
        if (isset($order[$field]) && is_string($order[$field]) && trim($order[$field]) !== '') {
            $deviceName = trim($order[$field]);
            break;
        }
    }
    if ($deviceName === null) {
        $deviceName = 'Не указано';
    }

    // estimated_cost
    $cost = null;
    if (isset($order['summ']) && is_array($order['summ'])) {
        $raw = $order['summ']['soldPrice'] ?? $order['summ']['price'] ?? 0;
        $numeric = is_numeric($raw) ? (float)$raw : 0;
        $cost = $numeric > 0 ? $numeric : null;
    }

    // master_comment
    $comment = null;
    foreach (['recommendation', 'masterComment'] as $field) {
        if (isset($order[$field]) && is_string($order[$field]) && trim($order[$field]) !== '') {
            $comment = trim($order[$field]);
            break;
        }
    }

    return [
        'order_number'   => (string)($order['number'] ?? $order['id'] ?? ''),
        'status'         => $mapped['status'],
        'status_label'   => $mapped['status_label'],
        'date_received'  => $dateReceived,
        'device_name'    => $deviceName,
        'estimated_cost' => $cost,
        'master_comment' => $comment,
    ];
}

// --- Endpoint handlers -----------------------------------------------------

function handle_health()
{
    json_response([
        'status'  => 'ok',
        'service' => 'max-miniapp-api-php',
    ]);
}

/**
 * Looks up a LiveSklad order by its number/id. Shared by the /order/{number}
 * route and the bot webhook — does not emit an HTTP response itself.
 *
 * @return array{ok: bool, http_code: int, order: ?array}
 */
function lookup_order_by_number(string $number): array
{
    if ($number === '') {
        return ['ok' => false, 'http_code' => 400, 'order' => null];
    }

    $searchNormalized = normalize_order_number($number);

    $token = livesklad_auth();
    if ($token === null) {
        return ['ok' => false, 'http_code' => 503, 'order' => null];
    }

    $retried = false;

    for ($page = 1; $page <= 5; $page++) {
        $result = livesklad_fetch_orders($token, $page);

        if ($result === null) {
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        // Re-auth on 401
        if ($result['http_code'] === 401 && !$retried) {
            $retried = true;
            $token = livesklad_auth();
            if ($token === null) {
                return ['ok' => false, 'http_code' => 503, 'order' => null];
            }
            // Retry same page
            $page--;
            continue;
        }

        if ($result['http_code'] !== 200) {
            error_log("[max-api] LiveSklad orders HTTP {$result['http_code']}: {$result['body']}");
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        $data = json_decode($result['body'], true);
        if (!is_array($data)) {
            error_log('[max-api] LiveSklad orders invalid JSON');
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        // LiveSklad may return orders in data.data, data.orders, or as top-level array
        $orders = $data['data'] ?? $data['orders'] ?? $data;
        if (!is_array($orders)) {
            $orders = [];
        }

        // If nested under another key (data.data is common)
        if (isset($orders['data']) && is_array($orders['data'])) {
            $orders = $orders['data'];
        }

        foreach ($orders as $order) {
            if (!is_array($order)) {
                continue;
            }
            if (match_order_number($order, $searchNormalized)) {
                return ['ok' => true, 'http_code' => 200, 'order' => $order];
            }
        }

        // If we got fewer orders than pageSize, no more pages
        if (count($orders) < 50) {
            break;
        }
    }

    return ['ok' => false, 'http_code' => 404, 'order' => null];
}

function handle_order_lookup(string $number)
{
    $result = lookup_order_by_number($number);

    if (!$result['ok']) {
        $messages = [
            400 => 'Order number is required',
            503 => 'Service temporarily unavailable',
            404 => 'Заказ не найден',
        ];
        json_response(['error' => $messages[$result['http_code']] ?? 'Error'], $result['http_code']);
    }

    json_response(format_order($result['order']));
}

// --- MAX Bot API (outgoing) -------------------------------------------------

const MAX_BOT_API_BASE = 'https://platform-api2.max.ru';
const MAX_MINIAPP_URL  = 'https://instrumentburg.ru/max-app/';

function max_open_app_button(string $text): array
{
    return [
        'type'    => 'open_app',
        'text'    => $text,
        'web_app' => MAX_MINIAPP_URL,
    ];
}

function max_send_message(int $userId, string $text, array $buttonRows): void
{
    $token = env('MAX_BOT_TOKEN');
    if ($token === '') {
        error_log('[max-api] MAX_BOT_TOKEN not set, cannot send bot reply');
        return;
    }

    $payload = json_encode([
        'text'        => $text,
        'attachments' => [
            [
                'type'    => 'inline_keyboard',
                'payload' => ['buttons' => $buttonRows],
            ],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $url = MAX_BOT_API_BASE . '/messages?' . http_build_query(['user_id' => $userId]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ["Authorization: $token", 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    // platform-api2.max.ru's certificate chains to the Russian Ministry of
    // Digital Development root CA, which is not in the system trust store.
    // Bundle it explicitly instead of disabling verification.
    $maxCaBundle = __DIR__ . '/max-ru-ca.pem';
    if (is_file($maxCaBundle)) {
        curl_setopt($ch, CURLOPT_CAINFO, $maxCaBundle);
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("[max-api] MAX send message curl error: $error");
        return;
    }

    if ($httpCode !== 200) {
        error_log("[max-api] MAX send message HTTP $httpCode: $response");
    }
}

// --- Bot webhook (incoming) -------------------------------------------------

function respond_to_order_query(int $userId, string $rawText): void
{
    $trimmed = trim($rawText);

    if (looks_like_order_number($trimmed)) {
        $result = lookup_order_by_number($trimmed);

        if ($result['ok']) {
            $formatted = format_order($result['order']);
            max_send_message(
                $userId,
                "Заказ {$formatted['order_number']} — статус: «{$formatted['status_label']}».",
                [[max_open_app_button('Подробнее в мини-приложении')]]
            );
            return;
        }

        max_send_message(
            $userId,
            "Не нашли заказ с номером {$trimmed}. Сверьте номер в квитанции или позвоните: +7 (343) 226-44-43 (ежедневно 9:00–18:00).",
            [[max_open_app_button('Открыть проверку статуса')]]
        );
        return;
    }

    max_send_message(
        $userId,
        'Здравствуйте! Это бот ИнструментБург. Пришлите номер заказа из квитанции (например, A023222) — покажем статус ремонта.',
        [[max_open_app_button('Проверить статус')]]
    );
}

function process_bot_update(array $update): void
{
    $updateType = (string)($update['update_type'] ?? '');
    if ($updateType !== 'message_created') {
        // bot_started, message_callback, etc. are outside this webhook's scope.
        return;
    }

    $message = $update['message'] ?? null;
    if (!is_array($message)) {
        return;
    }

    $sender = $message['sender'] ?? null;
    $userId = is_array($sender) ? ($sender['user_id'] ?? null) : null;
    if ($userId === null || !is_numeric($userId)) {
        return;
    }

    $body = $message['body'] ?? null;
    $text = is_array($body) ? (string)($body['text'] ?? '') : '';

    respond_to_order_query((int)$userId, $text);
}

function handle_bot_webhook(): void
{
    $secretHeader   = $_SERVER['HTTP_X_MAX_BOT_API_SECRET'] ?? '';
    $expectedSecret = env('MAX_WEBHOOK_SECRET');

    if ($expectedSecret === '' || !hash_equals($expectedSecret, $secretHeader)) {
        json_response(['error' => 'Forbidden'], 403);
    }

    // From here on, MAX must always get HTTP 200 — internal failures go to the log only.
    try {
        $update = get_json_body();
        process_bot_update($update);
    } catch (\Throwable $e) {
        error_log('[max-api] bot webhook error: ' . $e->getMessage());
    }

    json_response(['ok' => true]);
}

// --- Legacy MAX bot webhook (recovered from prod, see header comment) ------

function legacy_max_send_message(int $chatId, string $text, array $attachments = []): void
{
    $token = env('MAX_BOT_TOKEN');
    if ($token === '') {
        error_log('[max-api] MAX_BOT_TOKEN not set');
        return;
    }

    $payload = ['chat_id' => $chatId, 'text' => $text];
    if (!empty($attachments)) {
        $payload['attachments'] = $attachments;
    }

    $ch = curl_init('https://platform-api.max.ru/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . $token,
            'Content-Type: application/json',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);

    $response = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("[max-api] MAX send_message curl error: $error");
    } elseif ($httpCode !== 200) {
        error_log("[max-api] MAX send_message HTTP $httpCode: $response");
    }
}

function handle_legacy_webhook(): void
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        json_response(['ok' => true]);
    }

    $update = json_decode($raw, true);
    if (!is_array($update)) {
        json_response(['ok' => true]);
    }

    // Log for debugging (remove in production)
    error_log('[max-api] webhook: ' . substr($raw, 0, 2000));

    $type = $update['update_type'] ?? '';

    if ($type === 'bot_started') {
        $chatId = $update['chat_id'] ?? null;
        if ($chatId !== null) {
            $welcome = "Добро пожаловать в ИнструментБург!\n\n"
                     . "Аренда и ремонт строительного инструмента в Екатеринбурге.\n\n"
                     . "Что вы хотите сделать?";
            $keyboard = [
                'type' => 'inline_keyboard',
                'payload' => ['buttons' => [
                    [['type' => 'link', 'text' => 'Открыть приложение', 'url' => 'https://instrumentburg.ru/max-app/']],
                    [['type' => 'link', 'text' => 'Проверить статус заказа', 'url' => 'https://instrumentburg.ru/max-app/order']],
                    [['type' => 'link', 'text' => 'Записаться на ремонт', 'url' => 'https://instrumentburg.ru/max-app/repair']],
                    [['type' => 'callback', 'text' => 'Позвонить нам', 'payload' => 'phone']],
                ]],
            ];
            legacy_max_send_message((int)$chatId, $welcome, [$keyboard]);
        }
        json_response(['ok' => true]);
    }

    if ($type === 'message_created') {
        $body  = $update['message']['body'] ?? [];
        $text  = $body['text'] ?? '';
        $chatId = $body['chat_id'] ?? ($update['message']['recipient']['chat_id'] ?? null);

        if ($chatId === null) {
            json_response(['ok' => true]);
        }

        $lower = mb_strtolower(trim($text));

        if ($lower === '/start' || $lower === 'start' || $lower === 'привет') {
            $welcome = "Добро пожаловать в ИнструментБург!\n\n"
                     . "Аренда и ремонт строительного инструмента в Екатеринбурге.\n\n"
                     . "Нажмите кнопку ниже для перехода в приложение.";
            $keyboard = [
                'type' => 'inline_keyboard',
                'payload' => ['buttons' => [
                    [['type' => 'link', 'text' => 'Открыть приложение', 'url' => 'https://instrumentburg.ru/max-app/']],
                    [['type' => 'callback', 'text' => 'Позвонить нам', 'payload' => 'phone']],
                ]],
            ];
            legacy_max_send_message((int)$chatId, $welcome, [$keyboard]);
        } else {
            $reply = "Для работы с приложением используйте кнопку в меню бота.\n\n"
                   . "Или позвоните: +7 (343) 226-44-43";
            legacy_max_send_message((int)$chatId, $reply);
        }
        json_response(['ok' => true]);
    }

    if ($type === 'message_callback') {
        $cb      = $update['callback'] ?? [];
        $payload = $cb['payload'] ?? '';
        $chatId  = $cb['chat_id'] ?? null;

        if ($chatId !== null && $payload === 'phone') {
            $phoneMsg = "ИнструментБург\n\n"
                      . "+7 (343) 226-44-43 — основной\n"
                      . "+7 (343) 226-44-43 — дополнительный\n\n"
                      . "Пн-Пт: 9:00-18:00, Сб: 10:00-15:00";
            legacy_max_send_message((int)$chatId, $phoneMsg);
        }
        json_response(['ok' => true]);
    }

    json_response(['ok' => true]);
}

function handle_legacy_debug(): void
{
    $raw = file_get_contents('php://input');
    $logFile = '/home/c50684/instrumentburg.ru/max-api-env/debug.log';
    $entry = date('Y-m-d H:i:s') . " | " . ($_SERVER['REMOTE_ADDR'] ?? '?') . "\n" . $raw . "\n---\n";
    file_put_contents($logFile, $entry, FILE_APPEND);
    json_response(['ok' => true]);
}

function handle_repair()
{
    $body = get_json_body();

    // Validation
    $instrumentType = trim((string)($body['instrument_type'] ?? ''));
    $phone          = trim((string)($body['phone'] ?? ''));

    if ($instrumentType === '' || $phone === '') {
        json_response([
            'success' => false,
            'message' => 'Поля "instrument_type" и "phone" обязательны',
        ], 400);
    }

    $brandModel = trim((string)($body['brand_model'] ?? ''));
    $problem    = trim((string)($body['problem'] ?? ''));
    $userName   = trim((string)($body['user_name'] ?? ''));
    $maxUserId  = $body['max_user_id'] ?? null;

    // Build Telegram message
    $lines = [];
    $lines[] = escape_markdown($instrumentType);
    $brandLine = $brandModel !== '' ? escape_markdown($brandModel) : 'не указана';
    $problemLine = $problem !== '' ? escape_markdown($problem) : 'не указана';
    $phoneLine = escape_markdown($phone);

    $text = "\xF0\x9F\x94\xA7 *Новая заявка на ремонт* (MAX Mini App)\n\n"
        . "*Тип:* {$lines[0]}\n"
        . "*Марка/модель:* $brandLine\n"
        . "*Проблема:* $problemLine\n"
        . "*Телефон:* $phoneLine";

    if ($userName !== '') {
        $text .= "\n*Имя:* " . escape_markdown($userName);
    }
    if ($maxUserId !== null) {
        $text .= "\n*MAX ID:* " . escape_markdown((string)$maxUserId);
    }

    // Send to Telegram
    $botToken = env('TELEGRAM_BOT_TOKEN');
    $chatId   = env('TELEGRAM_IB_TASKS_CHAT_ID');

    if ($botToken === '' || $chatId === '') {
        error_log('[max-api] TELEGRAM_BOT_TOKEN or TELEGRAM_IB_TASKS_CHAT_ID not set');
        json_response([
            'success' => false,
            'message' => 'Не удалось отправить заявку. Позвоните: +7 (343) 226-44-43',
        ], 500);
    }

    $payload = json_encode([
        'chat_id'    => $chatId,
        'text'       => $text,
        'parse_mode' => 'Markdown',
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init("https://api.telegram.org/bot$botToken/sendMessage");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        error_log("[max-api] Telegram curl error: $error");
        json_response([
            'success' => false,
            'message' => 'Не удалось отправить заявку. Позвоните: +7 (343) 226-44-43',
        ], 500);
    }

    $tgData = json_decode($response, true);

    if ($httpCode !== 200 || !($tgData['ok'] ?? false)) {
        error_log("[max-api] Telegram HTTP $httpCode: $response");
        json_response([
            'success' => false,
            'message' => 'Не удалось отправить заявку. Позвоните: +7 (343) 226-44-43',
        ], 500);
    }

    json_response([
        'success' => true,
        'message' => 'Заявка отправлена! Мы свяжемся с вами в ближайшее время.',
    ]);
}

// --- Main ------------------------------------------------------------------

load_env();
handle_cors();

$method = $_SERVER['REQUEST_METHOD'];
$uri    = $_SERVER['REQUEST_URI'] ?? '/';

// Strip query string
$path = parse_url($uri, PHP_URL_PATH);
if (!is_string($path)) {
    $path = '/';
}

// Strip /max-api prefix
if (substr($path, 0, 8) === '/max-api') {
    $path = substr($path, strlen('/max-api'));
    if ($path === '' || $path === false) {
        $path = '/';
    }
}

// Route
if ($method === 'GET' && $path === '/health') {
    handle_health();
}

if ($method === 'GET' && preg_match('#^/order/([^/]+)$#', $path, $m)) {
    handle_order_lookup(urldecode($m[1]));
}

if ($method === 'POST' && $path === '/repair') {
    handle_repair();
}

if ($method === 'POST' && $path === '/bot/webhook') {
    handle_bot_webhook();
}

// Legacy routes — recovered from prod, see header comment.
if ($method === 'POST' && $path === '/webhook') {
    handle_legacy_webhook();
}

if ($method === 'POST' && $path === '/debug') {
    handle_legacy_debug();
}

// 404
json_response(['error' => 'Not found'], 404);
