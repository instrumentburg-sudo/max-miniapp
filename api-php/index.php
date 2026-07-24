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

// --- LiveSklad token cache -------------------------------------------------
//
// Mirrors convex/lib/liveskladAuth.ts in the calculator: /auth is hard
// rate-limited, and every uncached lookup used to burn a fresh token. The token
// lives ~15 min (`ttl` in the response), so cache it on disk between requests
// and, once LiveSklad answers 429, store a ban marker instead of hammering it.

const LS_TOKEN_SAFETY_MARGIN_SEC = 60;   // refresh slightly before real expiry
const LS_DEFAULT_TTL_SEC         = 900;  // LiveSklad currently reports ttl=900
const LS_BAN_FALLBACK_SEC        = 60;   // 429 without expireDate
const LS_BAN_MAX_SEC             = 1800;

function livesklad_cache_path(): string
{
    // Outside www: the file holds a live API token and must never be servable.
    $envDir = '/home/c50684/instrumentburg.ru/max-api-env';
    $dir    = is_dir($envDir) && is_writable($envDir) ? $envDir : sys_get_temp_dir();

    return $dir . '/.livesklad-token.json';
}

function livesklad_cache_read(): array
{
    $raw = @file_get_contents(livesklad_cache_path());
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);

    return is_array($data) ? $data : [];
}

function livesklad_cache_write(array $data): void
{
    $path = livesklad_cache_path();
    // Atomic replace so a concurrent reader never sees a half-written file.
    $tmp = $path . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($data)) === false) {
        return;
    }
    @chmod($tmp, 0600);
    @rename($tmp, $path);
}

/**
 * Seconds left on an active 429 ban, or 0 when we're free to call LiveSklad.
 */
function livesklad_ban_seconds_left(): int
{
    $cache = livesklad_cache_read();
    $until = isset($cache['banned_until']) ? (int)$cache['banned_until'] : 0;

    return $until > time() ? $until - time() : 0;
}

/**
 * Remembers a 429 so the next requests fail fast instead of piling onto the
 * banned endpoint. `expireDate` comes from LiveSklad's error body.
 */
function livesklad_mark_banned(string $body): void
{
    $until = time() + LS_BAN_FALLBACK_SEC;

    $parsed = json_decode($body, true);
    $expire = $parsed['error']['expireDate'] ?? null;
    if (is_string($expire)) {
        $ts = strtotime($expire);
        if ($ts !== false && $ts > time()) {
            $until = min($ts + 1, time() + LS_BAN_MAX_SEC);
        }
    }

    $cache = livesklad_cache_read();
    $cache['banned_until'] = $until;
    unset($cache['token'], $cache['expires_at']);
    livesklad_cache_write($cache);

    error_log('[max-api] LiveSklad 429 — ban marker until ' . date('c', $until));
}

function livesklad_auth(bool $forceRefresh = false): ?string
{
    if (!$forceRefresh) {
        $cache = livesklad_cache_read();
        $token = $cache['token'] ?? '';
        $expiresAt = isset($cache['expires_at']) ? (int)$cache['expires_at'] : 0;
        if (is_string($token) && $token !== '' && $expiresAt - LS_TOKEN_SAFETY_MARGIN_SEC > time()) {
            return $token;
        }
    }

    if (livesklad_ban_seconds_left() > 0) {
        return null;
    }

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

    if ($httpCode === 429) {
        livesklad_mark_banned((string)$response);
        return null;
    }

    if ($httpCode !== 200) {
        error_log("[max-api] LiveSklad auth HTTP $httpCode: $response");
        return null;
    }

    $data  = json_decode($response, true);
    $token = $data['token'] ?? null;
    if (!is_string($token) || $token === '') {
        return null;
    }

    $ttl   = isset($data['ttl']) && is_numeric($data['ttl']) && $data['ttl'] > 0
        ? (int)$data['ttl']
        : LS_DEFAULT_TTL_SEC;
    $cache = livesklad_cache_read();
    unset($cache['banned_until']);
    $cache['token']      = $token;
    $cache['expires_at'] = time() + $ttl;
    livesklad_cache_write($cache);

    return $token;
}

/**
 * Точечный поиск заказа: LiveSklad принимает `number` фильтром, поэтому листать
 * страницы не нужно — и находятся заказы любой давности, а не только последние
 * 250 (именно поэтому раньше «А024337» от 08.06 не находился ни в мини-аппе,
 * ни у бота). Тот же приём используется в калькуляторе: convex/livesklad.ts.
 */
function livesklad_fetch_by_number(string $token, string $number): ?array
{
    $url = 'https://api.livesklad.com/company/orders?' . http_build_query([
        'number' => $number,
        'limit'  => 10,
    ]);

    return livesklad_request($url, $token);
}

function livesklad_request(string $url, string $token): ?array
{
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

    if ($httpCode === 429) {
        livesklad_mark_banned((string)$response);
    }

    return ['http_code' => $httpCode, 'body' => $response];
}

/**
 * Order numbers a customer might type for the same order: LiveSklad stores
 * «A» + six digits with a leading zero (A025121), people drop the prefix
 * («25121»), the zero, or type the Cyrillic «А».
 */
function order_number_candidates(string $rawInput): array
{
    $candidates = [];

    $digits = extract_order_number($rawInput);
    if ($digits !== null) {
        // Шестизначная форма первой: именно так номер лежит в LiveSklad,
        // остальные варианты — запасные, чтобы не тратить лишний запрос.
        $trimmed = ltrim($digits, '0');
        $padded  = str_pad($trimmed, 6, '0', STR_PAD_LEFT);
        $variants = [$padded, $digits, $trimmed];

        // Legacy-строки лежат как «A0» + шестизначный номер (A0022962) —
        // так же, как их ищет калькулятор (buildLiveskladNumberCandidates).
        if (preg_match('/^0\d{5}$/', $padded) === 1) {
            $variants[] = '0' . $padded;
        }

        foreach ($variants as $variant) {
            if ($variant !== '') {
                $candidates[] = 'A' . $variant;
            }
        }
    }

    // Free-form input that isn't digits at all (a legacy prefix, say) still
    // gets one straight attempt after homoglyph normalisation.
    $direct = str_replace(["\xD0\x90", '#', ' '], ['A', '', ''], mb_strtoupper(trim($rawInput)));
    if ($direct !== '' && preg_match('/^A?\d+$/', $direct) === 1) {
        $candidates[] = $direct[0] === 'A' ? $direct : 'A' . $direct;
    }

    return array_values(array_unique($candidates));
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

/**
 * Pulls the order number out of free-form text. Clients rarely send a bare
 * number: they copy the whole receipt line («А025121 от 20 07.2026») or write
 * a sentence around it. Returns the digits only, or null if nothing looks like
 * an order number.
 */
function extract_order_number(string $text): ?string
{
    $text = mb_strtoupper(trim($text));
    $text = str_replace(["\xD0\x90", '#'], ['A', ''], $text);

    // Prefer an A-prefixed run of digits — that's the receipt format.
    if (preg_match('/A\s*(\d{3,10})/u', $text, $m) === 1) {
        return $m[1];
    }

    // Strip phone numbers first: a customer who writes «заказ 25121, звоните
    // +7 900 …» still asks about an order, but chunks of the phone must not be
    // mistaken for one.
    $text = preg_replace('/(?:\+7|\b8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/u', ' ', $text);

    // Without the «A» prefix only the LiveSklad number length is trustworthy
    // (A023222 → 6 digits, 5 once a leading zero is dropped). Shorter runs are
    // tool models and prices («Bosch GSR 180», «ремонт 1500»), longer ones are
    // phones and card numbers.
    if (preg_match('/(?<![\d.])(\d{5,7})(?![\d.])/u', $text, $m) === 1) {
        return $m[1];
    }

    return null;
}

function looks_like_order_number(string $text): bool
{
    return extract_order_number($text) !== null;
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

    $searchDigits = ltrim($searchNormalized, '0');

    foreach ($candidates as $candidate) {
        $candidateUp   = mb_strtoupper($candidate);
        $candidateBase = ltrim($candidateUp, 'A');

        if ($candidateUp === $searchNormalized || $candidateBase === $searchNormalized) {
            return true;
        }

        // Clients drop leading zeros («25121» for A025121) — compare numerically.
        if ($searchDigits !== '' && ctype_digit($candidateBase) && ltrim($candidateBase, '0') === $searchDigits) {
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
 * Extracts the order list out of a LiveSklad response: it nests them under
 * data / data.data / orders depending on the endpoint.
 */
function livesklad_orders_from_body(string $body): ?array
{
    $data = json_decode($body, true);
    if (!is_array($data)) {
        error_log('[max-api] LiveSklad orders invalid JSON');
        return null;
    }

    $orders = $data['data'] ?? $data['orders'] ?? $data;
    if (!is_array($orders)) {
        return [];
    }
    if (isset($orders['data']) && is_array($orders['data'])) {
        $orders = $orders['data'];
    }

    return $orders;
}

/**
 * Looks up a LiveSklad order by its number. Shared by the /order/{number}
 * route and the bot webhook — does not emit an HTTP response itself.
 *
 * Queries `company/orders?number=…` per candidate spelling instead of paging
 * through the list: the filter matches orders of any age, while paging only
 * ever saw the ~250 most recent ones (an order from June was simply invisible).
 *
 * @return array{ok: bool, http_code: int, order: ?array, retry_after?: int}
 */
function lookup_order_by_number(string $number): array
{
    if (trim($number) === '') {
        return ['ok' => false, 'http_code' => 400, 'order' => null];
    }

    $candidates = order_number_candidates($number);
    if ($candidates === []) {
        return ['ok' => false, 'http_code' => 404, 'order' => null];
    }

    $banLeft = livesklad_ban_seconds_left();
    if ($banLeft > 0) {
        return ['ok' => false, 'http_code' => 429, 'order' => null, 'retry_after' => $banLeft];
    }

    $token = livesklad_auth();
    if ($token === null) {
        $banLeft = livesklad_ban_seconds_left();
        return $banLeft > 0
            ? ['ok' => false, 'http_code' => 429, 'order' => null, 'retry_after' => $banLeft]
            : ['ok' => false, 'http_code' => 503, 'order' => null];
    }

    $searchNormalized = extract_order_number($number) ?? normalize_order_number($number);
    $retried          = false;

    foreach ($candidates as $candidate) {
        $result = livesklad_fetch_by_number($token, $candidate);

        if ($result === null) {
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        // Token expired mid-flight — refresh once and retry the same candidate.
        if ($result['http_code'] === 401 && !$retried) {
            $retried = true;
            $token   = livesklad_auth(true);
            if ($token === null) {
                return ['ok' => false, 'http_code' => 503, 'order' => null];
            }
            $result = livesklad_fetch_by_number($token, $candidate);
            if ($result === null) {
                return ['ok' => false, 'http_code' => 503, 'order' => null];
            }
        }

        if ($result['http_code'] === 429) {
            $banLeft = max(1, livesklad_ban_seconds_left());
            return ['ok' => false, 'http_code' => 429, 'order' => null, 'retry_after' => $banLeft];
        }

        if ($result['http_code'] !== 200) {
            error_log("[max-api] LiveSklad orders HTTP {$result['http_code']}: {$result['body']}");
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        $orders = livesklad_orders_from_body($result['body']);
        if ($orders === null) {
            return ['ok' => false, 'http_code' => 503, 'order' => null];
        }

        foreach ($orders as $order) {
            if (!is_array($order)) {
                continue;
            }
            // The filter is a search, not an exact match — verify the number.
            if (match_order_number($order, $searchNormalized)) {
                return ['ok' => true, 'http_code' => 200, 'order' => $order];
            }
        }
    }

    return ['ok' => false, 'http_code' => 404, 'order' => null];
}

function handle_order_lookup(string $number)
{
    $result = lookup_order_by_number($number);

    if (!$result['ok']) {
        if ($result['http_code'] === 429) {
            $wait = $result['retry_after'] ?? 60;
            header('Retry-After: ' . $wait);
            json_response([
                'error' => "Сервис учёта временно ограничил запросы. Попробуйте через {$wait} сек.",
            ], 429);
        }

        $messages = [
            400 => 'Order number is required',
            503 => 'Сервис учёта сейчас недоступен. Попробуйте через минуту или позвоните: +7 (343) 226-44-43.',
            404 => 'Заказ не найден',
        ];
        json_response(['error' => $messages[$result['http_code']] ?? 'Error'], $result['http_code']);
    }

    json_response(format_order($result['order']));
}

// --- MAX Bot API (outgoing) -------------------------------------------------

const MAX_BOT_API_BASE      = 'https://platform-api2.max.ru';
const MAX_MINIAPP_URL       = 'https://instrumentburg.ru/max-app/';
const MAX_MINIAPP_DEEPLINK  = 'https://max.ru/id662337117117_bot?startapp';

/**
 * Button that opens the mini-app.
 *
 * NOT type=open_app: that button takes `web_app` as a URL string which MAX
 * resolves against its own registry of linked mini-apps, and our URL is not in
 * it — MAX answers the whole POST /messages with
 * 404 {"code":"not.found", … LinkPK{name='https://instrumentburg.ru/max-app/'}}
 * so the client gets no reply at all (broken 23.07–24.07.2026).
 * A plain `link` button on the `?startapp` deeplink opens the same mini-app
 * inside MAX and is accepted by the API.
 */
function max_miniapp_button(string $text): array
{
    return [
        'type' => 'link',
        'text' => $text,
        'url'  => MAX_MINIAPP_DEEPLINK,
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

/**
 * Status reply for a found order: the status line first, then whatever detail
 * LiveSklad actually has — clients ask «что с моей пилой», not just «какой этап».
 */
function format_order_reply(array $formatted): string
{
    $lines = ["Заказ {$formatted['order_number']} — статус: «{$formatted['status_label']}»."];

    if (!empty($formatted['device_name'])) {
        $lines[] = "Инструмент: {$formatted['device_name']}";
    }
    if (!empty($formatted['date_received'])) {
        $date = date('d.m.Y', strtotime((string)$formatted['date_received']));
        if ($date !== '01.01.1970') {
            $lines[] = "Принят: {$date}";
        }
    }
    if (!empty($formatted['estimated_cost'])) {
        $cost = number_format((float)$formatted['estimated_cost'], 0, ',', ' ');
        $lines[] = "Сумма по заказу: {$cost} ₽";
    }
    if (!empty($formatted['master_comment'])) {
        $lines[] = "Мастер: {$formatted['master_comment']}";
    }

    return implode("\n", $lines);
}

function respond_to_order_query(int $userId, string $rawText): void
{
    $trimmed = trim($rawText);

    if (looks_like_order_number($trimmed)) {
        $result = lookup_order_by_number($trimmed);

        if ($result['ok']) {
            max_send_message(
                $userId,
                format_order_reply(format_order($result['order'])),
                [[max_miniapp_button('Подробнее в мини-приложении')]]
            );
            return;
        }

        // «Сервис занят» — не то же самое, что «такого заказа нет»: раньше
        // клиент в обоих случаях слышал «не нашли» и шёл сверять номер зря.
        if ($result['http_code'] === 429 || $result['http_code'] === 503) {
            $wait = $result['retry_after'] ?? 60;
            max_send_message(
                $userId,
                "Сервис учёта сейчас не отвечает — не можем посмотреть заказ. Повторите примерно через {$wait} сек. или позвоните: +7 (343) 226-44-43 (ежедневно 9:00–18:00).",
                [[max_miniapp_button('Проверить статус')]]
            );
            return;
        }

        $shown = extract_order_number($trimmed) ?? $trimmed;
        max_send_message(
            $userId,
            "Не нашли заказ с номером {$shown}. Сверьте номер в квитанции или позвоните: +7 (343) 226-44-43 (ежедневно 9:00–18:00).",
            [[max_miniapp_button('Открыть проверку статуса')]]
        );
        return;
    }

    max_send_message(
        $userId,
        'Здравствуйте! Это бот ИнструментБург. Пришлите номер заказа из квитанции (например, A023222) — покажем статус ремонта.',
        [[max_miniapp_button('Проверить статус')]]
    );
}

function process_bot_update(array $update): void
{
    $updateType = (string)($update['update_type'] ?? '');

    // bot_started carries the user at the top level, not inside a message.
    if ($updateType === 'bot_started') {
        $userId = $update['user_id'] ?? ($update['user']['user_id'] ?? null);
        if ($userId !== null && is_numeric($userId)) {
            respond_to_order_query((int)$userId, '');
        }
        return;
    }

    if ($updateType !== 'message_created') {
        // message_callback, message_edited, etc. are outside this webhook's scope.
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
