<?php

declare(strict_types=1);

// ---------------------------------------------------------------------------
// MAX Mini App — PHP API
// Endpoints: GET /health, GET /order/{number}, POST /repair
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
    // Strip leading 'A' prefix for comparison
    return ltrim($input, 'A');
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

function handle_order_lookup(string $number)
{
    if ($number === '') {
        json_response(['error' => 'Order number is required'], 400);
    }

    $searchNormalized = normalize_order_number($number);

    $token = livesklad_auth();
    if ($token === null) {
        json_response(['error' => 'Service temporarily unavailable'], 503);
    }

    $retried = false;

    for ($page = 1; $page <= 5; $page++) {
        $result = livesklad_fetch_orders($token, $page);

        if ($result === null) {
            json_response(['error' => 'Service temporarily unavailable'], 503);
        }

        // Re-auth on 401
        if ($result['http_code'] === 401 && !$retried) {
            $retried = true;
            $token = livesklad_auth();
            if ($token === null) {
                json_response(['error' => 'Service temporarily unavailable'], 503);
            }
            // Retry same page
            $page--;
            continue;
        }

        if ($result['http_code'] !== 200) {
            error_log("[max-api] LiveSklad orders HTTP {$result['http_code']}: {$result['body']}");
            json_response(['error' => 'Service temporarily unavailable'], 503);
        }

        $data = json_decode($result['body'], true);
        if (!is_array($data)) {
            error_log('[max-api] LiveSklad orders invalid JSON');
            json_response(['error' => 'Service temporarily unavailable'], 503);
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
                json_response(format_order($order));
            }
        }

        // If we got fewer orders than pageSize, no more pages
        if (count($orders) < 50) {
            break;
        }
    }

    json_response(['error' => 'Заказ не найден'], 404);
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

// 404
json_response(['error' => 'Not found'], 404);
